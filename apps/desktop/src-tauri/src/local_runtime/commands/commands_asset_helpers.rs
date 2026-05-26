const ASSET_MANIFEST_FILE_NAME: &str = "asset.manifest.json";
const KNOWN_MODEL_EXTENSIONS: &[&str] = &["gguf", "safetensors", "bin", "pt", "onnx", "pth"];

fn is_ignored_local_asset_metadata_path(path: &std::path::Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let lower = name.trim().to_ascii_lowercase();
    name.starts_with("._")
        || matches!(
            lower.as_str(),
            ".ds_store" | "thumbs.db" | "desktop.ini" | "__macosx"
        )
}

fn is_model_file_extension(path: &std::path::Path) -> bool {
    if is_ignored_local_asset_metadata_path(path) {
        return false;
    }
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| KNOWN_MODEL_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}
