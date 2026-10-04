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
fn scan_directory(folder_path: String, extensions: Vec<String>) -> Vec<String> {
    let mut results = Vec::new();
    let ext_set: Vec<String> = extensions.iter().map(|e| e.to_lowercase()).collect();

    if !Path::new(&folder_path).exists() {
        return results;
    }

    for entry in WalkDir::new(&folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext_set.contains(&ext.to_lowercase()) {
                    results.push(path.to_string_lossy().into_owned());
                }
            }
        }
    }

    results
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            select_folder,
            scan_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
