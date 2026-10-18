use std::path::Path;
use walkdir::WalkDir;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn select_folder() -> Option<String> {
    let folder = rfd::FileDialog::new().pick_folder();
    folder.map(|p| p.to_string_lossy().into_owned())
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
        .invoke_handler(tauri::generate_handler![
            greet,
            select_folder,
            scan_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
