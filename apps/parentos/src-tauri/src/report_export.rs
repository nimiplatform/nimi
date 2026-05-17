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
        _ => ("File", &["*"]),
    }
}

#[tauri::command]
pub fn save_report_file(
    base64_data: String,
    default_filename: String,
    kind: String,
    title: Option<String>,
) -> Result<Option<String>, String> {
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

    let Some(chosen) = dialog.save_file() else {
        return Ok(None);
    };

    std::fs::write(&chosen, &bytes).map_err(|error| {
        format!(
            "failed to write report export ({}): {error}",
            chosen.display()
        )
    })?;

    Ok(Some(chosen.to_string_lossy().to_string()))
}
