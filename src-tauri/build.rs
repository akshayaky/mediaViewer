fn main() {
    #[cfg(target_os = "windows")]
    {
        use std::path::Path;
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let lib_dir = Path::new(&manifest_dir).join("lib");
            let mpv_src = lib_dir.join("libmpv-2.dll");
            if mpv_src.exists() {
                if let Ok(out_dir) = std::env::var("OUT_DIR") {
                    if let Some(target) = Path::new(&out_dir).ancestors().nth(3) {
                        let _ = std::fs::copy(&mpv_src, target.join("libmpv-2.dll"));
                        let _ = std::fs::copy(&mpv_src, target.join("mpv-2.dll"));
                    }
                }
            }
        }
    }
    tauri_build::build()
}
