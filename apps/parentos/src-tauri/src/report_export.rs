use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::path::PathBuf;

const MAX_REPORT_EXPORT_BYTES: usize = 60 * 1024 * 1024;

fn picker_start_dir() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::download_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
}

fn filter_for_kind(kind: &str) -> (&'static str, &'static [&'static str]) {
    match kind {
        "pdf" => ("PDF Document", &["pdf"]),
        "png" => ("PNG Image", &["png"]),
        "csv" => ("CSV File", &["csv"]),
        _ => ("File", &["*"]),
    }
}

/// Opens the OS-native "Save as" dialog without producing any file
/// content. Returning the chosen path up front lets the renderer show
/// the dialog *immediately* on click — render + encode then happens
/// while the user is already committed to a destination.
///
/// Returns `Ok(None)` if the user cancels.
#[tauri::command]
pub fn pick_report_save_path(
    default_filename: String,
    kind: String,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let trimmed_filename = default_filename.trim();
    if trimmed_filename.is_empty() {
        return Err("default filename is required".to_string());
    }

    let (filter_label, filter_exts) = filter_for_kind(kind.as_str());
    let dialog = rfd::FileDialog::new()
        .set_directory(picker_start_dir())
        .set_file_name(trimmed_filename)
        .set_title(title.as_deref().unwrap_or("保存报告"))
        .add_filter(filter_label, filter_exts);

    Ok(dialog.save_file().map(|p| p.to_string_lossy().to_string()))
}

/// Writes the encoded report bytes to a pre-chosen absolute path.
/// Pair with [`pick_report_save_path`].
#[tauri::command]
pub fn write_report_file_at(path: String, base64_data: String) -> Result<String, String> {
    let bytes = BASE64_STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|error| format!("invalid base64 payload: {error}"))?;
    if bytes.is_empty() {
        return Err("report export payload is empty".to_string());
    }
    if bytes.len() > MAX_REPORT_EXPORT_BYTES {
        return Err(format!(
            "report export exceeds {} byte limit",
            MAX_REPORT_EXPORT_BYTES
        ));
    }

    let target = PathBuf::from(path.trim());
    if !target.is_absolute() {
        return Err("report save path must be absolute".to_string());
    }

    std::fs::write(&target, &bytes).map_err(|error| {
        format!(
            "failed to write report export ({}): {error}",
            target.display()
        )
    })?;

    Ok(target.to_string_lossy().to_string())
}
