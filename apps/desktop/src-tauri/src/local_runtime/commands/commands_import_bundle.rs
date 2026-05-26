fn runtime_local_pick_asset_directory_impl(app: &AppHandle) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir().unwrap_or_else(|| runtime_models_dir(app).unwrap_or_default());
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select asset bundle directory to import")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn runtime_local_pick_asset_directory(app: AppHandle) -> Result<Option<String>, String> {
    runtime_local_pick_asset_directory_impl(&app)
}
