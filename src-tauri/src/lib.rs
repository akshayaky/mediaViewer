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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            select_folder,
            scan_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
