mod stream_server;

use std::path::Path;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::AppHandle;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn select_folder(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|file_path| file_path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn select_folder() -> Result<Option<String>, String> {
    Err("Folder selection is unavailable on mobile. Select media files instead.".to_string())
}

#[tauri::command]
async fn scan_directory(
    folder_path: String,
    extensions: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut results = Vec::new();
    let ext_set: Vec<String> = extensions.iter().map(|e| e.to_lowercase()).collect();
    let root = Path::new(&folder_path);

    if !root.is_dir() {
        return Err(format!(
            "The folder does not exist or is not a directory: {folder_path}"
        ));
    }

    for entry in WalkDir::new(root) {
        let entry = entry.map_err(|error| {
            let path = error
                .path()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| folder_path.clone());
            format!("Failed to scan {path}: {error}")
        })?;

        if entry.file_type().is_file() {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext_set.contains(&ext.to_lowercase()) {
                    results.push(path.to_string_lossy().into_owned());
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
fn get_video_stream_url(file_path: String) -> Result<String, String> {
    let port = stream_server::ensure_stream_server_running();
    let encoded = urlencoding::encode(&file_path);
    Ok(format!("http://127.0.0.1:{}/stream?path={}", port, encoded))
}

#[tauri::command]
fn get_subtitle_url(file_path: String) -> Result<String, String> {
    let port = stream_server::ensure_stream_server_running();
    let encoded = urlencoding::encode(&file_path);
    Ok(format!("http://127.0.0.1:{}/subtitle?path={}", port, encoded))
}

#[tauri::command]
fn list_subtitle_files(video_path: String) -> Result<Vec<String>, String> {
    let video = Path::new(&video_path);
    let parent = video
        .parent()
        .ok_or_else(|| format!("Could not determine the video directory: {video_path}"))?;
    let video_stem = video
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| format!("Could not determine the video filename: {video_path}"))?;
    let lower_video_stem = video_stem.to_lowercase();
    let prefix = format!("{lower_video_stem}.");

    let entries = std::fs::read_dir(parent)
        .map_err(|error| format!("Could not scan for subtitle files: {error}"))?;
    let mut subtitle_paths = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default();
        if !matches!(extension.to_ascii_lowercase().as_str(), "srt" | "vtt") {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if stem == lower_video_stem || stem.starts_with(&prefix) {
            subtitle_paths.push(path.to_string_lossy().into_owned());
        }
    }

    subtitle_paths.sort();
    Ok(subtitle_paths)
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut result = String::new();
        for b in s.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(b as char);
                }
                _ => {
                    result.push_str(&format!("%{:02X}", b));
                }
            }
        }
        result
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_android_fs::builder().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            select_folder,
            scan_directory,
            get_video_stream_url,
            get_subtitle_url,
            list_subtitle_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
