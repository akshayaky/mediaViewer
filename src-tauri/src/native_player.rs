use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use libloading::Library;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[repr(C)]
pub struct MpvEventRaw {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventPropertyRaw {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

#[allow(dead_code)]
pub const MPV_EVENT_NONE: c_int = 0;
pub const MPV_EVENT_SHUTDOWN: c_int = 1;
pub const MPV_EVENT_LOG_MESSAGE: c_int = 2;
pub const MPV_EVENT_START_FILE: c_int = 6;
pub const MPV_EVENT_END_FILE: c_int = 7;
pub const MPV_EVENT_FILE_LOADED: c_int = 8;
pub const MPV_EVENT_TRACKS_CHANGED: c_int = 18;
pub const MPV_EVENT_IDLE: c_int = 11;
pub const MPV_EVENT_SEEK: c_int = 20;
pub const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

#[allow(dead_code)]
pub const MPV_FORMAT_NONE: c_int = 0;
pub const MPV_FORMAT_STRING: c_int = 1;
pub const MPV_FORMAT_FLAG: c_int = 3;
pub const MPV_FORMAT_INT64: c_int = 4;
pub const MPV_FORMAT_DOUBLE: c_int = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackInfo {
    pub id: String,
    pub title: String,
    pub language: Option<String>,
    pub codec: Option<String>,
    pub channels: Option<String>,
    pub channel_count: Option<i32>,
    pub is_default: bool,
    pub is_selected: bool,
    pub is_external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrackInfo {
    pub id: String,
    pub title: String,
    pub language: Option<String>,
    pub codec: Option<String>,
    pub is_default: bool,
    pub is_selected: bool,
    pub is_external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub is_ready: bool,
    pub is_frame_ready: bool,
    pub is_playing: bool,
    pub is_paused: bool,
    pub is_buffering: bool,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub is_muted: bool,
    pub playback_rate: f64,
    pub audio_tracks: Vec<AudioTrackInfo>,
    pub selected_audio_track_id: Option<String>,
    pub subtitle_tracks: Vec<SubtitleTrackInfo>,
    pub selected_subtitle_track_id: Option<String>,
    pub active_file: Option<String>,
    pub error: Option<String>,
}

#[allow(dead_code)]
pub struct MpvBindings {
    _lib: Library,
    create: unsafe extern "C" fn() -> *mut c_void,
    initialize: unsafe extern "C" fn(*mut c_void) -> c_int,
    destroy: unsafe extern "C" fn(*mut c_void),
    terminate_destroy: unsafe extern "C" fn(*mut c_void),
    command: unsafe extern "C" fn(*mut c_void, *mut *const c_char) -> c_int,
    command_string: unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int,
    set_option: unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *const c_void) -> c_int,
    set_option_string: unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int,
    set_property: unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *const c_void) -> c_int,
    set_property_string: unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char,
    free_mem: unsafe extern "C" fn(*mut c_void),
    observe_property: unsafe extern "C" fn(*mut c_void, u64, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(*mut c_void, f64) -> *mut MpvEventRaw,
    wakeup: unsafe extern "C" fn(*mut c_void),
}

impl MpvBindings {
    pub fn load() -> Result<Self, String> {
        let candidates = Self::find_candidate_libraries();
        let mut checked_paths = Vec::new();
        let mut last_err = String::from("No candidate library paths checked");

        for candidate in candidates {
            if candidate.is_absolute() && !candidate.exists() {
                continue;
            }
            checked_paths.push(candidate.display().to_string());
            #[cfg(target_os = "windows")]
            {
                if let Some(parent) = candidate.parent() {
                    if parent.exists() {
                        use std::os::windows::ffi::OsStrExt;
                        let wide: Vec<u16> = parent.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
                        extern "system" {
                            fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
                        }
                        unsafe {
                            SetDllDirectoryW(wide.as_ptr());
                        }
                    }
                }
            }
            match unsafe { Library::new(&candidate) } {
                Ok(lib) => {
                    println!("[NativePlayer] Successfully loaded libmpv from: {}", candidate.display());
                    unsafe {
                        let create = match lib.get::<unsafe extern "C" fn() -> *mut c_void>(b"mpv_create") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_create in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let initialize = match lib.get::<unsafe extern "C" fn(*mut c_void) -> c_int>(b"mpv_initialize") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_initialize in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let destroy = match lib.get::<unsafe extern "C" fn(*mut c_void)>(b"mpv_destroy") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_destroy in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let terminate_destroy = match lib.get::<unsafe extern "C" fn(*mut c_void)>(b"mpv_terminate_destroy") {
                            Ok(sym) => *sym,
                            Err(_) => destroy,
                        };
                        let command = match lib.get::<unsafe extern "C" fn(*mut c_void, *mut *const c_char) -> c_int>(b"mpv_command") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_command in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let command_string = match lib.get::<unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int>(b"mpv_command_string") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_command_string in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let set_option = match lib.get::<unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *const c_void) -> c_int>(b"mpv_set_option") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_set_option in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let set_option_string = match lib.get::<unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int>(b"mpv_set_option_string") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_set_option_string in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let set_property = match lib.get::<unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *const c_void) -> c_int>(b"mpv_set_property") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_set_property in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let set_property_string = match lib.get::<unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int>(b"mpv_set_property_string") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_set_property_string in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let get_property_string = match lib.get::<unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char>(b"mpv_get_property_string") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_get_property_string in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let free_mem = match lib.get::<unsafe extern "C" fn(*mut c_void)>(b"mpv_free") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_free in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let observe_property = match lib.get::<unsafe extern "C" fn(*mut c_void, u64, *const c_char, c_int) -> c_int>(b"mpv_observe_property") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_observe_property in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let wait_event = match lib.get::<unsafe extern "C" fn(*mut c_void, f64) -> *mut MpvEventRaw>(b"mpv_wait_event") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_wait_event in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };
                        let wakeup = match lib.get::<unsafe extern "C" fn(*mut c_void)>(b"mpv_wakeup") {
                            Ok(sym) => *sym,
                            Err(e) => {
                                last_err = format!("Failed to find mpv_wakeup in {}: {}", candidate.display(), e);
                                continue;
                            }
                        };

                        return Ok(Self {
                            _lib: lib,
                            create,
                            initialize,
                            destroy,
                            terminate_destroy,
                            command,
                            command_string,
                            set_option,
                            set_option_string,
                            set_property,
                            set_property_string,
                            get_property_string,
                            free_mem,
                            observe_property,
                            wait_event,
                            wakeup,
                        });
                    }
                }
                Err(err) => {
                    last_err = format!("Error loading {}: {}", candidate.display(), err);
                }
            }
        }

        Err(format!("libmpv dynamic library not found. Last error: {}", last_err))
    }

    fn find_candidate_libraries() -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        #[cfg(target_os = "windows")]
        {
            let lib_names = ["mpv-2.dll", "libmpv-2.dll", "mpv-1.dll", "libmpv.dll"];
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(parent) = exe_path.parent() {
                    for name in &lib_names {
                        candidates.push(parent.join(name));
                        candidates.push(parent.join("lib").join(name));
                    }
                    if let Some(p2) = parent.parent() {
                        if let Some(p3) = p2.parent() {
                            for name in &lib_names {
                                candidates.push(p3.join("lib").join(name));
                            }
                        }
                    }
                }
            }
            if let Ok(cwd) = std::env::current_dir() {
                for name in &lib_names {
                    candidates.push(cwd.join(name));
                    candidates.push(cwd.join("lib").join(name));
                    candidates.push(cwd.join("src-tauri").join("lib").join(name));
                }
            }
            for name in &lib_names {
                candidates.push(PathBuf::from(*name));
            }
        }

        #[cfg(target_os = "android")]
        {
            candidates.push(PathBuf::from("libmpv.so"));
            candidates.push(PathBuf::from("libmpv.so.2"));
            candidates.push(PathBuf::from("libmpv.so.1"));
        }

        #[cfg(target_os = "linux")]
        {
            candidates.push(PathBuf::from("libmpv.so.2"));
            candidates.push(PathBuf::from("libmpv.so.1"));
            candidates.push(PathBuf::from("libmpv.so"));
        }

        #[cfg(target_os = "macos")]
        {
            candidates.push(PathBuf::from("libmpv.2.dylib"));
            candidates.push(PathBuf::from("libmpv.dylib"));
            candidates.push(PathBuf::from("/opt/homebrew/lib/libmpv.dylib"));
            candidates.push(PathBuf::from("/usr/local/lib/libmpv.dylib"));
        }

        candidates
    }

    pub unsafe fn create(&self) -> *mut c_void {
        (self.create)()
    }

    pub unsafe fn initialize(&self, handle: *mut c_void) -> Result<(), String> {
        let code = (self.initialize)(handle);
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_initialize failed with code: {code}"))
        }
    }

    pub unsafe fn destroy(&self, handle: *mut c_void) {
        (self.terminate_destroy)(handle);
    }

    pub unsafe fn command(&self, handle: *mut c_void, args: &[&str]) -> Result<(), String> {
        let c_args: Vec<CString> = args.iter().map(|&a| CString::new(a).unwrap_or_default()).collect();
        let mut ptrs: Vec<*const c_char> = c_args.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());

        let code = (self.command)(handle, ptrs.as_mut_ptr());
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_command failed with code: {code} for args {:?}", args))
        }
    }

    pub unsafe fn command_string(&self, handle: *mut c_void, cmd: &str) -> Result<(), String> {
        let c_cmd = CString::new(cmd).map_err(|e| e.to_string())?;
        let code = (self.command_string)(handle, c_cmd.as_ptr());
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_command_string failed with code: {code}"))
        }
    }

    pub unsafe fn set_option(&self, handle: *mut c_void, name: &str, format: c_int, data: *const c_void) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let code = (self.set_option)(handle, c_name.as_ptr(), format, data);
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_set_option failed for {name} with code {code}"))
        }
    }

    pub unsafe fn set_option_string(&self, handle: *mut c_void, name: &str, val: &str) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let c_val = CString::new(val).map_err(|e| e.to_string())?;
        let code = (self.set_option_string)(handle, c_name.as_ptr(), c_val.as_ptr());
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_set_option_string failed for {name}={val} with code {code}"))
        }
    }

    pub unsafe fn set_property(&self, handle: *mut c_void, name: &str, format: c_int, data: *const c_void) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let code = (self.set_property)(handle, c_name.as_ptr(), format, data);
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_set_property failed for {name} with code {code}"))
        }
    }

    pub unsafe fn set_property_string(&self, handle: *mut c_void, name: &str, val: &str) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let c_val = CString::new(val).map_err(|e| e.to_string())?;
        let code = (self.set_property_string)(handle, c_name.as_ptr(), c_val.as_ptr());
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_set_property_string failed for {name}={val} with code {code}"))
        }
    }

    pub unsafe fn get_property_string(&self, handle: *mut c_void, name: &str) -> Option<String> {
        let c_name = CString::new(name).ok()?;
        let ptr = (self.get_property_string)(handle, c_name.as_ptr());
        if ptr.is_null() {
            return None;
        }
        let str_slice = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        (self.free_mem)(ptr as *mut c_void);
        Some(str_slice)
    }

    pub unsafe fn observe_property(&self, handle: *mut c_void, id: u64, name: &str, format: c_int) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let code = (self.observe_property)(handle, id, c_name.as_ptr(), format);
        if code >= 0 {
            Ok(())
        } else {
            Err(format!("mpv_observe_property failed for {name} with code {code}"))
        }
    }

    pub unsafe fn wait_event(&self, handle: *mut c_void, timeout: f64) -> *mut MpvEventRaw {
        (self.wait_event)(handle, timeout)
    }

    pub unsafe fn wakeup(&self, handle: *mut c_void) {
        (self.wakeup)(handle);
    }
}

#[cfg(target_os = "android")]
static ANDROID_SURFACE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(target_os = "android")]
static ANDROID_SURFACE_REF: std::sync::Mutex<Option<jni::objects::GlobalRef>> = std::sync::Mutex::new(None);
#[cfg(target_os = "android")]
static ANDROID_SURFACE_SIZE: std::sync::Mutex<(i32, i32)> = std::sync::Mutex::new((0, 0));
#[cfg(target_os = "android")]
static ACTIVE_MPV_HANDLE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(target_os = "android")]
pub fn set_android_native_surface(global_ref: jni::objects::GlobalRef) {
    let addr = global_ref.as_raw() as usize;
    ANDROID_SURFACE.store(addr, Ordering::SeqCst);
    *ANDROID_SURFACE_REF.lock().unwrap() = Some(global_ref);

    let handle = ACTIVE_MPV_HANDLE.load(Ordering::SeqCst);
    if handle != 0 && addr != 0 {
        println!("[NativePlayer] Updating active mpv instance with Android surface jobject={addr:#x}");
        if let Ok(bindings) = MpvBindings::load() {
            unsafe {
                let mut wid_val = addr as i64;
                let _ = bindings.set_option(handle as *mut c_void, "wid", MPV_FORMAT_INT64, &mut wid_val as *mut _ as *const c_void);
                let _ = bindings.set_property(handle as *mut c_void, "wid", MPV_FORMAT_INT64, &mut wid_val as *mut _ as *const c_void);
            }
        }
    }
}

#[cfg(target_os = "android")]
pub fn clear_android_native_surface() {
    ANDROID_SURFACE.store(0, Ordering::SeqCst);
    *ANDROID_SURFACE_REF.lock().unwrap() = None;

    let handle = ACTIVE_MPV_HANDLE.load(Ordering::SeqCst);
    if handle != 0 {
        if let Ok(bindings) = MpvBindings::load() {
            unsafe {
                let mut zero: i64 = 0;
                let _ = bindings.set_option(handle as *mut c_void, "wid", MPV_FORMAT_INT64, &mut zero as *mut _ as *const c_void);
                let _ = bindings.set_property(handle as *mut c_void, "wid", MPV_FORMAT_INT64, &mut zero as *mut _ as *const c_void);
            }
        }
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_com_akymaster_veyview_MainActivity_onNativeSurfaceCreated(
    env: *mut jni::sys::JNIEnv,
    _class: jni::sys::jclass,
    surface: jni::sys::jobject,
) {
    if surface.is_null() {
        return;
    }
    let mut jni_env = match unsafe { jni::JNIEnv::from_raw(env) } {
        Ok(e) => e,
        Err(err) => {
            eprintln!("[NativePlayer] Failed to get JNIEnv from raw: {err}");
            return;
        }
    };
    let local_obj = unsafe { jni::objects::JObject::from_raw(surface) };
    match jni_env.new_global_ref(&local_obj) {
        Ok(global_ref) => {
            println!("[NativePlayer] Android onNativeSurfaceCreated: created GlobalRef for surface {:p}", global_ref.as_raw());
            set_android_native_surface(global_ref);
        }
        Err(err) => {
            eprintln!("[NativePlayer] Failed to create global ref for surface: {err}");
        }
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_com_akymaster_veyview_MainActivity_onNativeSurfaceChanged(
    _env: *mut jni::sys::JNIEnv,
    _class: jni::sys::jclass,
    _surface: jni::sys::jobject,
    width: jni::sys::jint,
    height: jni::sys::jint,
) {
    println!("[NativePlayer] Android onNativeSurfaceChanged: {width}x{height}");
    *ANDROID_SURFACE_SIZE.lock().unwrap() = (width as i32, height as i32);
    let handle = ACTIVE_MPV_HANDLE.load(Ordering::SeqCst);
    if handle != 0 {
        if let Ok(bindings) = MpvBindings::load() {
            let size_str = format!("{width}x{height}");
            let _ = bindings.set_property_string(handle as *mut c_void, "android-surface-size", &size_str);
            let _ = bindings.command(handle as *mut c_void, &["vo-cmd", "reconfig"]);
        }
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_com_akymaster_veyview_MainActivity_onNativeSurfaceDestroyed(
    _env: *mut jni::sys::JNIEnv,
    _class: jni::sys::jclass,
    _surface: jni::sys::jobject,
) {
    println!("[NativePlayer] Android onNativeSurfaceDestroyed");
    clear_android_native_surface();
}

pub struct NativePlayer {
    bindings: Arc<MpvBindings>,
    mpv_handle: *mut c_void,
    state: Arc<Mutex<PlayerState>>,
    is_running: Arc<AtomicBool>,
    app_handle: AppHandle,
}

unsafe impl Send for NativePlayer {}
unsafe impl Sync for NativePlayer {}

impl NativePlayer {
    pub fn new(window: &WebviewWindow) -> Result<Self, String> {
        let bindings = Arc::new(MpvBindings::load()?);
        let mpv_handle = unsafe { bindings.create() };
        if mpv_handle.is_null() {
            return Err("Failed to create mpv instance (mpv_create returned null)".to_string());
        }

        // Configure platform rendering & hardware acceleration
        #[cfg(target_os = "windows")]
        {
            let hwnd = window.hwnd().map_err(|e| format!("Failed to get window HWND: {e}"))?;
            let wid = hwnd.0 as isize;
            let wid_str = format!("{wid}");
            println!("[NativePlayer] Attaching mpv to HWND wid={wid_str}");
            unsafe {
                let _ = bindings.set_option_string(mpv_handle, "wid", &wid_str);
                // Hardware decoding on Windows: prefer d3d11va with automatic fallback
                let _ = bindings.set_option_string(mpv_handle, "hwdec", "d3d11va");
                let _ = bindings.set_option_string(mpv_handle, "hwdec-codecs", "all");
                let _ = bindings.set_option_string(mpv_handle, "vo", "gpu");
                let _ = bindings.set_option_string(mpv_handle, "gpu-api", "d3d11");
                let _ = bindings.set_option_string(mpv_handle, "d3d11-flip", "yes");
                let _ = bindings.set_option_string(mpv_handle, "force-window", "yes");
                let _ = bindings.set_option_string(mpv_handle, "alpha", "no");
                let _ = bindings.set_option_string(mpv_handle, "background-color", "#FF000000");
            }
        }

        #[cfg(target_os = "android")]
        {
            // Register JavaVM with FFmpeg/libavcodec for MediaCodec decoding
            let vm_ptr = ndk_context::android_context().vm();
            if !vm_ptr.is_null() {
                for lib_name in &["libmpv.so", "libplayer.so", "libavcodec.so"] {
                    if let Ok(lib) = unsafe { libloading::Library::new(*lib_name) } {
                        unsafe {
                            if let Ok(func) = lib.get::<unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int>(b"av_jni_set_java_vm") {
                                let res = func(vm_ptr as *mut c_void, std::ptr::null_mut());
                                println!("[NativePlayer] Registered JavaVM with FFmpeg av_jni_set_java_vm via {lib_name}: {res}");
                                std::mem::forget(lib);
                                break;
                            }
                        }
                    }
                }
            }

            let mut win = ANDROID_SURFACE.load(Ordering::SeqCst);
            if win == 0 {
                // Wait briefly for native surface to be created
                for _ in 0..50 {
                    std::thread::sleep(Duration::from_millis(10));
                    win = ANDROID_SURFACE.load(Ordering::SeqCst);
                    if win != 0 {
                        break;
                    }
                }
            }

            if win != 0 {
                let mut wid_val = win as i64;
                println!("[NativePlayer] Attaching mpv to Android surface jobject={win:#x}");
                unsafe {
                    let _ = bindings.set_option(mpv_handle, "wid", MPV_FORMAT_INT64, &mut wid_val as *mut _ as *const c_void);
                }
            } else {
                eprintln!("[NativePlayer] Warning: Android surface not available yet before mpv_initialize");
            }
            ACTIVE_MPV_HANDLE.store(mpv_handle as usize, Ordering::SeqCst);

            let (w, h) = *ANDROID_SURFACE_SIZE.lock().unwrap();
            if w > 0 && h > 0 {
                let size_str = format!("{w}x{h}");
                println!("[NativePlayer] Initializing android-surface-size: {size_str}");
                unsafe {
                    let _ = bindings.set_option_string(mpv_handle, "android-surface-size", &size_str);
                }
            }

            unsafe {
                let _ = bindings.set_option_string(mpv_handle, "hwdec", "mediacodec-copy");
                let _ = bindings.set_option_string(mpv_handle, "hwdec-codecs", "all");
                let _ = bindings.set_option_string(mpv_handle, "vo", "gpu");
                let _ = bindings.set_option_string(mpv_handle, "gpu-context", "android");
                let _ = bindings.set_option_string(mpv_handle, "force-window", "yes");
                let _ = bindings.set_option_string(mpv_handle, "alpha", "no");
                let _ = bindings.set_option_string(mpv_handle, "background-color", "#FF000000");
            }
        }

        // Player configuration
        unsafe {
            let _ = bindings.set_option_string(mpv_handle, "idle", "yes");
            let _ = bindings.set_option_string(mpv_handle, "keep-open", "yes");
            let _ = bindings.set_option_string(mpv_handle, "osc", "no");
            let _ = bindings.set_option_string(mpv_handle, "osd-level", "0");
            let _ = bindings.set_option_string(mpv_handle, "sub-auto", "exact");
            let _ = bindings.set_option_string(mpv_handle, "audio-file-auto", "exact");
            let _ = bindings.set_option_string(mpv_handle, "sub-use-margins", "no");
            let _ = bindings.set_option_string(mpv_handle, "sub-ass-override", "scale");
            let _ = bindings.initialize(mpv_handle)?;

            // Observe essential properties
            let _ = bindings.observe_property(mpv_handle, 1, "time-pos", MPV_FORMAT_DOUBLE);
            let _ = bindings.observe_property(mpv_handle, 2, "duration", MPV_FORMAT_DOUBLE);
            let _ = bindings.observe_property(mpv_handle, 3, "pause", MPV_FORMAT_FLAG);
            let _ = bindings.observe_property(mpv_handle, 4, "paused-for-cache", MPV_FORMAT_FLAG);
            let _ = bindings.observe_property(mpv_handle, 5, "volume", MPV_FORMAT_DOUBLE);
            let _ = bindings.observe_property(mpv_handle, 6, "mute", MPV_FORMAT_FLAG);
            let _ = bindings.observe_property(mpv_handle, 7, "speed", MPV_FORMAT_DOUBLE);
            let _ = bindings.observe_property(mpv_handle, 8, "track-list", MPV_FORMAT_NONE);
            let _ = bindings.observe_property(mpv_handle, 9, "aid", MPV_FORMAT_STRING);
            let _ = bindings.observe_property(mpv_handle, 10, "sid", MPV_FORMAT_STRING);
            let _ = bindings.observe_property(mpv_handle, 11, "eof-reached", MPV_FORMAT_FLAG);
        }

        let state = Arc::new(Mutex::new(PlayerState {
            is_ready: false,
            is_frame_ready: false,
            volume: 100.0,
            playback_rate: 1.0,
            ..Default::default()
        }));

        let is_running = Arc::new(AtomicBool::new(true));

        let app_handle = window.app_handle().clone();

        // Start event processing loop
        let player = Self {
            bindings,
            mpv_handle,
            state,
            is_running,
            app_handle: app_handle.clone(),
        };

        player.spawn_event_loop(app_handle);

        Ok(player)
    }

    fn spawn_event_loop(&self, app_handle: AppHandle) {
        let bindings = Arc::clone(&self.bindings);
        let mpv_handle = self.mpv_handle as usize; // Cast to usize for thread boundary
        let state = Arc::clone(&self.state);
        let is_running = Arc::clone(&self.is_running);

        thread::spawn(move || {
            let handle = mpv_handle as *mut c_void;
            let mut last_position = -1.0;

            while is_running.load(Ordering::SeqCst) {
                let event_ptr = unsafe { bindings.wait_event(handle, 0.01) };
                if event_ptr.is_null() {
                    continue;
                }

                let event = unsafe { &*event_ptr };
                match event.event_id {
                    MPV_EVENT_NONE => {}
                    MPV_EVENT_SHUTDOWN => break,
                    MPV_EVENT_TRACKS_CHANGED => {
                        Self::refresh_tracks(&bindings, handle, &state);
                        Self::emit_state(&app_handle, &state);
                    }
                    MPV_EVENT_FILE_LOADED => {
                        let mut s = state.lock().unwrap();
                        s.is_ready = true;
                        s.is_playing = true;
                        s.is_buffering = true;
                        drop(s);
                        Self::refresh_tracks(&bindings, handle, &state);
                        Self::emit_state(&app_handle, &state);
                    }
                    MPV_EVENT_END_FILE => {
                        let mut s = state.lock().unwrap();
                        s.is_playing = false;
                        s.is_paused = true;
                        s.is_frame_ready = false;
                        drop(s);
                        let _ = app_handle.emit("native-player:ended", ());
                        Self::emit_state(&app_handle, &state);
                    }
                    MPV_EVENT_SEEK => {
                        let mut s = state.lock().unwrap();
                        s.is_buffering = true;
                        drop(s);
                        Self::emit_state(&app_handle, &state);
                    }
                    MPV_EVENT_PLAYBACK_RESTART => {
                        let mut s = state.lock().unwrap();
                        s.is_buffering = false;
                        s.is_frame_ready = true;
                        drop(s);
                        Self::emit_state(&app_handle, &state);
                    }
                    MPV_EVENT_PROPERTY_CHANGE => {
                        let prop_ptr = event.data as *mut MpvEventPropertyRaw;
                        if !prop_ptr.is_null() {
                            let prop = unsafe { &*prop_ptr };
                            let prop_name = if !prop.name.is_null() {
                                unsafe { CStr::from_ptr(prop.name).to_string_lossy() }
                            } else {
                                continue;
                            };

                            let mut state_changed = false;
                            let mut s = state.lock().unwrap();

                            match prop_name.as_ref() {
                                "time-pos" => {
                                    if prop.format == MPV_FORMAT_DOUBLE && !prop.data.is_null() {
                                        let val = unsafe { *(prop.data as *const f64) };
                                        if (val - last_position).abs() >= 0.25 {
                                            s.current_time = val;
                                            last_position = val;
                                            s.is_frame_ready = true;
                                            s.is_buffering = false;
                                            state_changed = true;
                                        }
                                    }
                                }
                                "duration" => {
                                    if prop.format == MPV_FORMAT_DOUBLE && !prop.data.is_null() {
                                        s.duration = unsafe { *(prop.data as *const f64) };
                                        state_changed = true;
                                    }
                                }
                                "pause" => {
                                    if prop.format == MPV_FORMAT_FLAG && !prop.data.is_null() {
                                        let paused = unsafe { *(prop.data as *const c_int) } != 0;
                                        s.is_paused = paused;
                                        s.is_playing = !paused;
                                        state_changed = true;
                                    }
                                }
                                "paused-for-cache" => {
                                    if prop.format == MPV_FORMAT_FLAG && !prop.data.is_null() {
                                        s.is_buffering = unsafe { *(prop.data as *const c_int) } != 0;
                                        state_changed = true;
                                    }
                                }
                                "volume" => {
                                    if prop.format == MPV_FORMAT_DOUBLE && !prop.data.is_null() {
                                        s.volume = unsafe { *(prop.data as *const f64) };
                                        state_changed = true;
                                    }
                                }
                                "mute" => {
                                    if prop.format == MPV_FORMAT_FLAG && !prop.data.is_null() {
                                        s.is_muted = unsafe { *(prop.data as *const c_int) } != 0;
                                        state_changed = true;
                                    }
                                }
                                "speed" => {
                                    if prop.format == MPV_FORMAT_DOUBLE && !prop.data.is_null() {
                                        s.playback_rate = unsafe { *(prop.data as *const f64) };
                                        state_changed = true;
                                    }
                                }
                                "track-list" => {
                                    drop(s);
                                    Self::refresh_tracks(&bindings, handle, &state);
                                    s = state.lock().unwrap();
                                    state_changed = true;
                                }
                                "aid" => {
                                    if prop.format == MPV_FORMAT_STRING && !prop.data.is_null() {
                                        let val_ptr = unsafe { *(prop.data as *const *const c_char) };
                                        let raw_str = if val_ptr.is_null() {
                                            String::new()
                                        } else {
                                            unsafe { CStr::from_ptr(val_ptr).to_string_lossy().into_owned() }
                                        };
                                        let sel_aid = if raw_str == "no" || raw_str.is_empty() { None } else { Some(raw_str) };
                                        s.selected_audio_track_id = sel_aid.clone();
                                        for track in &mut s.audio_tracks {
                                            track.is_selected = Some(&track.id) == sel_aid.as_ref();
                                        }
                                        state_changed = true;
                                    }
                                }
                                "sid" => {
                                    if prop.format == MPV_FORMAT_STRING && !prop.data.is_null() {
                                        let val_ptr = unsafe { *(prop.data as *const *const c_char) };
                                        let raw_str = if val_ptr.is_null() {
                                            String::new()
                                        } else {
                                            unsafe { CStr::from_ptr(val_ptr).to_string_lossy().into_owned() }
                                        };
                                        let sel_sid = if raw_str == "no" || raw_str.is_empty() { None } else { Some(raw_str) };
                                        s.selected_subtitle_track_id = sel_sid.clone();
                                        for track in &mut s.subtitle_tracks {
                                            track.is_selected = Some(&track.id) == sel_sid.as_ref();
                                        }
                                        state_changed = true;
                                    }
                                }
                                _ => {}
                            }

                            drop(s);
                            if state_changed {
                                Self::emit_state(&app_handle, &state);
                            }
                        }
                    }
                    _ => {}
                }
            }
        });
    }

    fn refresh_tracks(bindings: &MpvBindings, handle: *mut c_void, state: &Arc<Mutex<PlayerState>>) {
        let count_str = unsafe { bindings.get_property_string(handle, "track-list/count") };
        let count: i32 = count_str.and_then(|s| s.parse().ok()).unwrap_or(0);

        let mut audio_tracks = Vec::new();
        let mut subtitle_tracks = Vec::new();

        for i in 0..count {
            let prop = |sub: &str| -> Option<String> {
                unsafe { bindings.get_property_string(handle, &format!("track-list/{i}/{sub}")) }
            };

            let track_type = prop("type").unwrap_or_default();
            let id = prop("id").unwrap_or_else(|| format!("{}", i + 1));
            let title = prop("title");
            let lang = prop("lang");
            let codec = prop("codec");
            let is_selected = prop("selected").map(|v| v == "yes").unwrap_or(false);
            let is_default = prop("default").map(|v| v == "yes").unwrap_or(false);
            let is_external = prop("external").map(|v| v == "yes").unwrap_or(false);

            let lang_str = match lang.as_deref() {
                None | Some("und") | Some("") => "Unknown".to_string(),
                Some(c) => match c.to_ascii_lowercase().as_str() {
                    "en" | "eng" => "English".to_string(),
                    "ja" | "jpn" => "Japanese".to_string(),
                    "es" | "spa" => "Spanish".to_string(),
                    "fr" | "fra" | "fre" => "French".to_string(),
                    "de" | "deu" | "ger" => "German".to_string(),
                    "it" | "ita" => "Italian".to_string(),
                    "pt" | "por" => "Portuguese".to_string(),
                    "ko" | "kor" => "Korean".to_string(),
                    "zh" | "zho" | "chi" => "Chinese".to_string(),
                    "ru" | "rus" => "Russian".to_string(),
                    "hi" | "hin" => "Hindi".to_string(),
                    "ar" | "ara" => "Arabic".to_string(),
                    other => other.to_string(),
                },
            };

            if track_type == "audio" {
                let channels = prop("audio-channels");
                let channel_count = prop("demux-channel-count").and_then(|c| c.parse().ok());

                let codec_str = match codec.as_deref() {
                    None => "Audio".to_string(),
                    Some(c) => match c.to_ascii_lowercase().as_str() {
                        "aac" => "AAC".to_string(),
                        "ac3" => "AC3 Dolby Digital".to_string(),
                        "eac3" => "E-AC3 Dolby Digital Plus".to_string(),
                        "truehd" => "Dolby TrueHD".to_string(),
                        "dts" => "DTS".to_string(),
                        "dts-hd" | "dtshd" => "DTS-HD".to_string(),
                        "dts-hd ma" => "DTS-HD MA".to_string(),
                        "flac" => "FLAC".to_string(),
                        "opus" => "Opus".to_string(),
                        "vorbis" => "Vorbis".to_string(),
                        "mp3" => "MP3".to_string(),
                        other => other.to_ascii_uppercase(),
                    },
                };

                let ch_str = if let Some(ref ch) = channels {
                    match ch.to_ascii_lowercase().as_str() {
                        "stereo" => "2.0 Stereo".to_string(),
                        "mono" => "1.0 Mono".to_string(),
                        "5.1" | "5.1(side)" => "5.1 Surround".to_string(),
                        "7.1" => "7.1 Surround".to_string(),
                        other => other.to_string(),
                    }
                } else if let Some(cnt) = channel_count {
                    match cnt {
                        1 => "1.0 Mono".to_string(),
                        2 => "2.0 Stereo".to_string(),
                        6 => "5.1 Surround".to_string(),
                        8 => "7.1 Surround".to_string(),
                        n => format!("{n} Channels"),
                    }
                } else {
                    String::new()
                };

                let mut details = Vec::new();
                if !lang_str.is_empty() && lang_str != "Unknown" {
                    details.push(lang_str.clone());
                }
                if !codec_str.is_empty() {
                    details.push(codec_str);
                }
                if !ch_str.is_empty() {
                    details.push(ch_str);
                }

                let display_title = if let Some(t) = title {
                    if details.is_empty() {
                        t
                    } else {
                        format!("{t} [{}]", details.join(", "))
                    }
                } else if details.is_empty() {
                    format!("Track {id} (Audio)")
                } else {
                    format!("Track {id}: {}", details.join(" · "))
                };

                audio_tracks.push(AudioTrackInfo {
                    id,
                    title: display_title,
                    language: lang,
                    codec,
                    channels,
                    channel_count,
                    is_default,
                    is_selected,
                    is_external,
                });
            } else if track_type == "sub" {
                let codec_str = match codec.as_deref() {
                    Some("subrip") => "SRT",
                    Some("ass") => "ASS",
                    Some("ssa") => "SSA",
                    Some("pgs") | Some("hdmv_pgs_subtitle") => "PGS",
                    Some("vtt") | Some("webvtt") => "WebVTT",
                    Some(other) => other,
                    None => "",
                };

                let display_title = if let Some(t) = title {
                    if codec_str.is_empty() {
                        t
                    } else {
                        format!("{t} [{codec_str}]")
                    }
                } else if codec_str.is_empty() {
                    format!("{lang_str} (Track {id})")
                } else {
                    format!("{lang_str} · {codec_str} (Track {id})")
                };

                subtitle_tracks.push(SubtitleTrackInfo {
                    id,
                    title: display_title,
                    language: lang,
                    codec,
                    is_default,
                    is_selected,
                    is_external,
                });
            }
        }

        let selected_aid = audio_tracks.iter().find(|t| t.is_selected).map(|t| t.id.clone());
        let selected_sid = subtitle_tracks.iter().find(|t| t.is_selected).map(|t| t.id.clone());

        let mut s = state.lock().unwrap();
        s.audio_tracks = audio_tracks;
        s.subtitle_tracks = subtitle_tracks;
        if selected_aid.is_some() {
            s.selected_audio_track_id = selected_aid;
        } else if s.selected_audio_track_id.is_none() {
            s.selected_audio_track_id = unsafe { bindings.get_property_string(handle, "aid") }
                .filter(|a| a != "no" && !a.is_empty());
        }
        if selected_sid.is_some() {
            s.selected_subtitle_track_id = selected_sid;
        } else if s.selected_subtitle_track_id.is_none() {
            s.selected_subtitle_track_id = unsafe { bindings.get_property_string(handle, "sid") }
                .filter(|s| s != "no" && !s.is_empty());
        }
    }

    fn emit_state(app_handle: &AppHandle, state: &Arc<Mutex<PlayerState>>) {
        let snapshot = {
            let s = state.lock().unwrap();
            s.clone()
        };
        let _ = app_handle.emit("native-player:state", snapshot);
    }

    pub fn load_file(&self, path: &str, start_pos: Option<f64>) -> Result<(), String> {
        let final_path = if path.starts_with("content://") {
            crate::stream_server::init_app_handle(self.app_handle.clone());
            let port = crate::stream_server::ensure_stream_server_running();
            let encoded = crate::urlencoding::encode(path);
            format!("http://127.0.0.1:{port}/stream?path={encoded}")
        } else {
            path.to_string()
        };

        let pos_str = start_pos.map(|p| format!("{p}")).unwrap_or_else(|| "0".to_string());
        let pos_arg = format!("start={pos_str}");

        unsafe {
            self.bindings.command(self.mpv_handle, &["loadfile", &final_path, "replace", "-1", &pos_arg])?;
        }

        let mut s = self.state.lock().unwrap();
        s.active_file = Some(path.to_string());
        s.current_time = start_pos.unwrap_or(0.0);
        s.is_playing = true;
        s.is_paused = false;
        s.is_buffering = true;
        s.is_ready = false;
        s.is_frame_ready = false;
        s.error = None;
        Ok(())
    }

    pub fn play(&self) -> Result<(), String> {
        unsafe {
            self.bindings.set_property_string(self.mpv_handle, "pause", "no")?;
        }
        let mut s = self.state.lock().unwrap();
        s.is_paused = false;
        s.is_playing = true;
        Ok(())
    }

    pub fn pause(&self) -> Result<(), String> {
        unsafe {
            self.bindings.set_property_string(self.mpv_handle, "pause", "yes")?;
        }
        let mut s = self.state.lock().unwrap();
        s.is_paused = true;
        s.is_playing = false;
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        unsafe {
            let _ = self.bindings.command(self.mpv_handle, &["stop"]);
        }
        let mut s = self.state.lock().unwrap();
        s.is_playing = false;
        s.is_paused = true;
        s.is_buffering = false;
        s.is_frame_ready = false;
        s.active_file = None;
        s.current_time = 0.0;
        Ok(())
    }

    pub fn toggle_pause(&self) -> Result<(), String> {
        let is_paused = {
            let s = self.state.lock().unwrap();
            s.is_paused
        };
        if is_paused {
            self.play()
        } else {
            self.pause()
        }
    }

    pub fn seek(&self, seconds: f64, relative: bool) -> Result<(), String> {
        let sec_str = format!("{seconds}");
        let mode = if relative { "relative" } else { "absolute" };
        unsafe {
            self.bindings.command(self.mpv_handle, &["seek", &sec_str, mode])?;
        }
        Ok(())
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        let clamped = volume.clamp(0.0, 100.0);
        let val_str = format!("{clamped}");
        unsafe {
            self.bindings.set_property_string(self.mpv_handle, "volume", &val_str)?;
        }
        let mut s = self.state.lock().unwrap();
        s.volume = clamped;
        Ok(())
    }

    pub fn set_mute(&self, muted: bool) -> Result<(), String> {
        let val_str = if muted { "yes" } else { "no" };
        unsafe {
            self.bindings.set_property_string(self.mpv_handle, "mute", val_str)?;
        }
        let mut s = self.state.lock().unwrap();
        s.is_muted = muted;
        Ok(())
    }

    pub fn set_speed(&self, speed: f64) -> Result<(), String> {
        let clamped = speed.clamp(0.1, 4.0);
        let val_str = format!("{clamped}");
        unsafe {
            self.bindings.set_property_string(self.mpv_handle, "speed", &val_str)?;
        }
        let mut s = self.state.lock().unwrap();
        s.playback_rate = clamped;
        Ok(())
    }

    pub fn set_audio_track(&self, track_id: &str) -> Result<(), String> {
        let aid_val = if track_id == "no" || track_id == "off" || track_id.is_empty() {
            "no"
        } else {
            track_id
        };
        unsafe {
            self.bindings.set_property_string(self.mpv_handle, "aid", aid_val)?;
        }
        let mut s = self.state.lock().unwrap();
        s.selected_audio_track_id = if aid_val == "no" { None } else { Some(aid_val.to_string()) };
        for track in &mut s.audio_tracks {
            track.is_selected = track.id == aid_val;
        }
        drop(s);
        Self::refresh_tracks(&self.bindings, self.mpv_handle, &self.state);
        Ok(())
    }

    pub fn set_subtitle_track(&self, track_id: &str) -> Result<(), String> {
        let sid_val = if track_id == "no" || track_id == "off" || track_id.is_empty() {
            "no"
        } else {
            track_id
        };
        unsafe {
            self.bindings.set_property_string(self.mpv_handle, "sid", sid_val)?;
        }
        let mut s = self.state.lock().unwrap();
        s.selected_subtitle_track_id = if sid_val == "no" { None } else { Some(sid_val.to_string()) };
        for track in &mut s.subtitle_tracks {
            track.is_selected = track.id == sid_val;
        }
        drop(s);
        Self::refresh_tracks(&self.bindings, self.mpv_handle, &self.state);
        Ok(())
    }

    pub fn add_subtitle_file(&self, path: &str) -> Result<(), String> {
        let final_path = if path.starts_with("content://") {
            crate::stream_server::init_app_handle(self.app_handle.clone());
            let port = crate::stream_server::ensure_stream_server_running();
            let encoded = crate::urlencoding::encode(path);
            format!("http://127.0.0.1:{port}/subtitle?path={encoded}")
        } else {
            path.to_string()
        };
        unsafe {
            self.bindings.command(self.mpv_handle, &["sub-add", &final_path, "select"])?;
        }
        Ok(())
    }

    pub fn get_state(&self) -> PlayerState {
        let s = self.state.lock().unwrap();
        s.clone()
    }

    pub fn destroy(&self) {
        self.is_running.store(false, Ordering::SeqCst);
        #[cfg(target_os = "android")]
        {
            ACTIVE_MPV_HANDLE.store(0, Ordering::SeqCst);
        }
        unsafe {
            self.bindings.wakeup(self.mpv_handle);
            thread::sleep(Duration::from_millis(60));
            self.bindings.destroy(self.mpv_handle);
        }
    }
}

pub struct PlayerManager {
    player: Mutex<Option<Arc<NativePlayer>>>,
}

impl PlayerManager {
    pub fn new() -> Self {
        Self {
            player: Mutex::new(None),
        }
    }

    pub fn init_player(&self, window: &WebviewWindow) -> Result<(), String> {
        let mut lock = self.player.lock().unwrap();
        if let Some(existing) = lock.as_ref() {
            if existing.is_running.load(Ordering::SeqCst) {
                println!("[NativePlayer] Player already running; reusing instance");
                return Ok(());
            }
        }
        if let Some(existing) = lock.take() {
            existing.destroy();
        }
        let player = Arc::new(NativePlayer::new(window)?);
        *lock = Some(player);
        Ok(())
    }

    pub fn get_player(&self) -> Result<Arc<NativePlayer>, String> {
        let lock = self.player.lock().unwrap();
        lock.as_ref()
            .cloned()
            .ok_or_else(|| "Native player is not initialized".to_string())
    }

    pub fn destroy_player(&self) {
        let mut lock = self.player.lock().unwrap();
        if let Some(player) = lock.take() {
            player.destroy();
        }
    }
}

// ---------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------

#[tauri::command]
pub fn native_player_init(window: WebviewWindow, manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    println!("[NativePlayer] native_player_init called for window: {}", window.label());
    match manager.init_player(&window) {
        Ok(()) => {
            println!("[NativePlayer] native_player_init succeeded!");
            Ok(())
        }
        Err(e) => {
            eprintln!("[NativePlayer] native_player_init failed: {e}");
            Err(e)
        }
    }
}

#[tauri::command]
pub fn native_player_load_file(
    path: String,
    start_position: Option<f64>,
    manager: tauri::State<'_, PlayerManager>,
) -> Result<(), String> {
    println!("[NativePlayer] native_player_load_file called with path: {path}, start_pos: {start_position:?}");
    let player = manager.get_player()?;
    match player.load_file(&path, start_position) {
        Ok(()) => {
            println!("[NativePlayer] native_player_load_file command issued successfully");
            Ok(())
        }
        Err(e) => {
            eprintln!("[NativePlayer] native_player_load_file failed: {e}");
            Err(e)
        }
    }
}

#[tauri::command]
pub fn native_player_play(manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.play()
}

#[tauri::command]
pub fn native_player_pause(manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.pause()
}

#[tauri::command]
pub fn native_player_toggle_pause(manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.toggle_pause()
}

#[tauri::command]
pub fn native_player_seek(
    position: f64,
    relative: bool,
    manager: tauri::State<'_, PlayerManager>,
) -> Result<(), String> {
    let player = manager.get_player()?;
    player.seek(position, relative)
}

#[tauri::command]
pub fn native_player_set_volume(volume: f64, manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.set_volume(volume)
}

#[tauri::command]
pub fn native_player_set_mute(muted: bool, manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.set_mute(muted)
}

#[tauri::command]
pub fn native_player_set_speed(speed: f64, manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.set_speed(speed)
}

#[tauri::command]
pub fn native_player_set_audio_track(
    track_id: String,
    manager: tauri::State<'_, PlayerManager>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let player = manager.get_player()?;
    player.set_audio_track(&track_id)?;
    NativePlayer::emit_state(&app_handle, &player.state);
    Ok(())
}

#[tauri::command]
pub fn native_player_set_subtitle_track(
    track_id: String,
    manager: tauri::State<'_, PlayerManager>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let player = manager.get_player()?;
    player.set_subtitle_track(&track_id)?;
    NativePlayer::emit_state(&app_handle, &player.state);
    Ok(())
}

#[tauri::command]
pub fn native_player_add_subtitle_file(path: String, manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.add_subtitle_file(&path)
}

#[tauri::command]
pub fn native_player_get_state(manager: tauri::State<'_, PlayerManager>) -> Result<PlayerState, String> {
    let player = manager.get_player()?;
    Ok(player.get_state())
}

#[tauri::command]
pub fn native_player_set_property(name: String, value: String, manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    unsafe {
        player.bindings.set_property_string(player.mpv_handle, &name, &value)
    }
}

#[tauri::command]
pub fn native_player_stop(manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    let player = manager.get_player()?;
    player.stop()
}

#[tauri::command]
pub fn native_player_destroy(manager: tauri::State<'_, PlayerManager>) -> Result<(), String> {
    manager.destroy_player();
    Ok(())
}

#[tauri::command]
pub fn set_screen_orientation(orientation: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        println!("[NativePlayer] Setting screen orientation to: {orientation}");
        let vm_ptr = ndk_context::android_context().vm();
        if !vm_ptr.is_null() {
            unsafe {
                let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
                let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
                let j_str = env.new_string(&orientation).map_err(|e| e.to_string())?;
                let class = env.find_class("com/akymaster/veyview/MainActivity").map_err(|e| e.to_string())?;
                env.call_static_method(
                    class,
                    "setOrientation",
                    "(Ljava/lang/String;)V",
                    &[(&j_str).into()],
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = orientation;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_mpv_bindings() {
        let res = MpvBindings::load();
        match &res {
            Ok(_) => println!("[Test] MpvBindings successfully loaded!"),
            Err(e) => eprintln!("[Test] MpvBindings failed to load: {}", e),
        }
        assert!(res.is_ok(), "Failed to load mpv bindings: {:?}", res.err());
    }

    #[test]
    fn test_mpv_observe_aid_and_switch() {
        let bindings = MpvBindings::load().expect("load mpv");
        unsafe {
            let handle = bindings.create();
            let _ = bindings.set_option_string(handle, "vo", "null");
            let _ = bindings.set_option_string(handle, "ao", "null");
            let _ = bindings.initialize(handle);

            let obs_res = bindings.observe_property(handle, 9, "aid", MPV_FORMAT_STRING);
            println!("observe aid res: {:?}", obs_res);

            let test_path = std::path::Path::new("../node_modules/ebml/media/test.webm");
            let abs_path = test_path.canonicalize().unwrap();
            let path_str = abs_path.to_str().unwrap();
            let _ = bindings.command(handle, &["loadfile", path_str, "replace"]);

            // Pump events until file loaded
            for _ in 0..20 {
                let ev_ptr = bindings.wait_event(handle, 0.05);
                if !ev_ptr.is_null() {
                    let ev = &*ev_ptr;
                    println!("Event: id={}, error={}", ev.event_id, ev.error);
                    if ev.event_id == MPV_EVENT_PROPERTY_CHANGE {
                        let prop = &*(ev.data as *mut MpvEventPropertyRaw);
                        let name = if prop.name.is_null() { "" } else { CStr::from_ptr(prop.name).to_str().unwrap() };
                        println!("Prop change: name={}, format={}, data_null={}", name, prop.format, prop.data.is_null());
                        if name == "aid" && !prop.data.is_null() {
                            if prop.format == MPV_FORMAT_STRING {
                                let val_ptr = *(prop.data as *const *const c_char);
                                let val = if val_ptr.is_null() { "null" } else { CStr::from_ptr(val_ptr).to_str().unwrap() };
                                println!("aid value: {}", val);
                            }
                        }
                    }
                }
            }

            println!("--- Now switching aid to 'no' ---");
            let set_res = bindings.set_property_string(handle, "aid", "no");
            println!("set aid res: {:?}", set_res);

            for _ in 0..20 {
                let ev_ptr = bindings.wait_event(handle, 0.05);
                if !ev_ptr.is_null() {
                    let ev = &*ev_ptr;
                    println!("After switch Event: id={}, error={}", ev.event_id, ev.error);
                    if ev.event_id == MPV_EVENT_PROPERTY_CHANGE {
                        let prop = &*(ev.data as *mut MpvEventPropertyRaw);
                        let name = if prop.name.is_null() { "" } else { CStr::from_ptr(prop.name).to_str().unwrap() };
                        println!("After switch Prop change: name={}, format={}, data_null={}", name, prop.format, prop.data.is_null());
                        if name == "aid" && !prop.data.is_null() {
                            if prop.format == MPV_FORMAT_STRING {
                                let val_ptr = *(prop.data as *const *const c_char);
                                let val = if val_ptr.is_null() { "null" } else { CStr::from_ptr(val_ptr).to_str().unwrap() };
                                println!("After switch aid value: {}", val);
                            }
                        }
                    }
                }
            }

            bindings.destroy(handle);
        }
    }

    #[test]
    fn test_mpv_load_file_and_tracks() {
        let bindings = MpvBindings::load().expect("load mpv");
        unsafe {
            let handle = bindings.create();
            assert!(!handle.is_null());
            let _ = bindings.set_option_string(handle, "vo", "null");
            let _ = bindings.set_option_string(handle, "ao", "null");
            let res = bindings.initialize(handle);
            assert!(res.is_ok());

            let test_path = std::path::Path::new("../node_modules/ebml/media/test.webm");
            if test_path.exists() {
                let abs_path = test_path.canonicalize().unwrap();
                let path_str = abs_path.to_str().unwrap();
                println!("Loading test file: {}", path_str);
                let load_res = bindings.command(handle, &["loadfile", path_str, "replace", "-1", "start=0"]);
                println!("Load res with -1 start=0: {:?}", load_res);

                let mut loaded = false;
                for _ in 0..50 {
                    let ev_ptr = bindings.wait_event(handle, 0.1);
                    if !ev_ptr.is_null() {
                        let ev = &*ev_ptr;
                        println!("Event id: {}", ev.event_id);
                        if ev.event_id == MPV_EVENT_FILE_LOADED {
                            loaded = true;
                            break;
                        }
                    }
                }
                println!("Loaded: {}", loaded);
                let count_str = bindings.get_property_string(handle, "track-list/count");
                println!("track-list/count: {:?}", count_str);
                let count: i32 = count_str.and_then(|s| s.parse().ok()).unwrap_or(0);
                for i in 0..count {
                    let prop = |sub: &str| bindings.get_property_string(handle, &format!("track-list/{i}/{sub}"));
                    println!("Track {}: type={:?}, id={:?}, title={:?}, lang={:?}, codec={:?}, selected={:?}",
                        i, prop("type"), prop("id"), prop("title"), prop("lang"), prop("codec"), prop("selected"));
                }
                let aid_before = bindings.get_property_string(handle, "aid");
                println!("aid before: {:?}", aid_before);

                let set_res = bindings.set_property_string(handle, "aid", "2");
                println!("set aid to 2 res: {:?}", set_res);
                let aid_after = bindings.get_property_string(handle, "aid");
                println!("aid after: {:?}", aid_after);
            } else {
                println!("Test path does not exist: {:?}", test_path);
            }
            bindings.destroy(handle);
        }
    }

    #[test]
    fn test_mpv_properties_panscan_subtitles_and_align() {
        let bindings = MpvBindings::load().expect("load mpv");
        unsafe {
            let handle = bindings.create();
            assert!(!handle.is_null());
            let _ = bindings.set_option_string(handle, "vo", "null");
            let _ = bindings.set_option_string(handle, "ao", "null");
            let res = bindings.initialize(handle);
            assert!(res.is_ok());

            assert!(bindings.set_property_string(handle, "panscan", "1.0").is_ok());
            assert!(bindings.set_property_string(handle, "panscan", "0.0").is_ok());
            assert!(bindings.set_property_string(handle, "video-align-y", "-1.0").is_ok());
            assert!(bindings.set_property_string(handle, "video-align-y", "0.0").is_ok());
            assert!(bindings.set_property_string(handle, "sub-font", "Arial").is_ok());
            assert!(bindings.set_property_string(handle, "sub-font-size", "40").is_ok());
            assert!(bindings.set_property_string(handle, "sub-color", "#ffffff").is_ok());
            assert!(bindings.set_property_string(handle, "sub-back-color", "0.0/0.0/0.0/0.65").is_ok());
            assert!(bindings.set_property_string(handle, "sub-back-color", "0.0/0.0/0.0/1.0").is_ok());
            assert!(bindings.set_property_string(handle, "sub-border-style", "opaque-box").is_ok());
            assert!(bindings.set_property_string(handle, "sub-border-style", "background-box").is_ok());
            assert!(bindings.set_property_string(handle, "sub-border-style", "outline-and-shadow").is_ok());
            assert!(bindings.set_property_string(handle, "sub-shadow-offset", "4").is_ok());
            assert!(bindings.set_property_string(handle, "sub-border-size", "3").is_ok());
            assert!(bindings.set_property_string(handle, "sub-pos", "84").is_ok());
            assert!(bindings.set_property_string(handle, "sub-pos", "100").is_ok());

            bindings.destroy(handle);
        }
    }
}
