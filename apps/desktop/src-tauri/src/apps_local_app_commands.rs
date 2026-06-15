use std::path::PathBuf;

use tauri::AppHandle;

fn local_app_picker_start_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

#[tauri::command]
pub fn apps_pick_local_app_root_directory(_app: AppHandle) -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_directory(local_app_picker_start_dir())
        .set_title("Select local app root directory")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}
