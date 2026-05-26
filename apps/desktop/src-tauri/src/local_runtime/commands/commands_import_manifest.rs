fn symlink_target_display(source_path: &std::path::Path) -> Option<String> {
    source_path
        .canonicalize()
        .ok()
        .map(|target| target.display().to_string())
        .or_else(|| {
            std::fs::read_link(source_path)
                .ok()
                .map(|target| target.display().to_string())
        })
}

fn symlink_forbidden_error(source_path: &std::path::Path) -> String {
    let source = source_path.display().to_string();
    match symlink_target_display(source_path) {
        Some(target) => format!(
            "LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN: Symbolic links are not supported for import. Import the real file path instead. Link source: {source}. Link target: {target}"
        ),
        None => format!(
            "LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN: Symbolic links are not supported for import. Import the real file path instead. Link source: {source}"
        ),
    }
}

#[tauri::command]
pub fn runtime_local_pick_asset_file(app: AppHandle) -> Result<Option<String>, String> {
    let start_dir =
        dirs::home_dir().unwrap_or_else(|| runtime_models_dir(&app).unwrap_or_default());
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select asset file to import")
        .add_filter(
            "Asset Files",
            &["gguf", "safetensors", "bin", "pt", "onnx", "pth"],
        )
        .add_filter("All Files", &["*"])
        .pick_file();
    Ok(selected.map(|p| p.to_string_lossy().to_string()))
}

fn copy_file_with_progress<F, C>(
    mut reader: std::fs::File,
    dest: &std::path::Path,
    mut on_progress: F,
    mut cancel_check: C,
) -> Result<(), String>
where
    F: FnMut(u64),
    C: FnMut() -> Result<(), String>,
{
    let mut writer = std::fs::File::create(dest).map_err(|e| {
        format!("LOCAL_AI_FILE_IMPORT_WRITE_FAILED: cannot create target file: {e}")
    })?;
    let mut buffer = vec![0u8; 64 * 1024];
    let mut bytes_copied: u64 = 0;
    loop {
        cancel_check()?;
        let n = reader.read(&mut buffer).map_err(|e| {
            format!("LOCAL_AI_FILE_IMPORT_READ_FAILED: read error at byte {bytes_copied}: {e}")
        })?;
        if n == 0 {
            break;
        }
        cancel_check()?;
        writer.write_all(&buffer[..n]).map_err(|e| {
            format!("LOCAL_AI_FILE_IMPORT_WRITE_FAILED: write error at byte {bytes_copied}: {e}")
        })?;
        bytes_copied += n as u64;
        on_progress(bytes_copied);
    }
    cancel_check()?;
    writer
        .flush()
        .map_err(|e| format!("LOCAL_AI_FILE_IMPORT_FLUSH_FAILED: {e}"))?;
    cancel_check()?;
    writer
        .sync_all()
        .map_err(|e| format!("LOCAL_AI_FILE_IMPORT_SYNC_FAILED: {e}"))?;
    Ok(())
}
