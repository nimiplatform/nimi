use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetIdPayload {
    pub local_asset_id: String,
}

fn runtime_root_dir() -> Result<PathBuf, String> {
    crate::desktop_paths::resolve_nimi_data_dir()
}

fn runtime_models_dir() -> Result<PathBuf, String> {
    Ok(nimi_shell_tauri::capabilities::local_assets::runtime_models_dir(&runtime_root_dir()?))
}

fn picker_start_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| runtime_models_dir().unwrap_or_default())
}

fn reveal_path_in_os(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn runtime_local_pick_asset_file(_app: AppHandle) -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_directory(picker_start_dir())
        .set_title("Select asset file to import")
        .add_filter(
            "Asset Files",
            &["gguf", "safetensors", "bin", "pt", "onnx", "pth"],
        )
        .add_filter("All Files", &["*"])
        .pick_file();
    Ok(selected.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn runtime_local_pick_asset_manifest_path(_app: AppHandle) -> Result<Option<String>, String> {
    let models_root = runtime_models_dir()?;
    let selected = rfd::FileDialog::new()
        .set_directory(&models_root)
        .set_title("Select asset.manifest.json")
        .add_filter("Asset Manifest", &["asset.manifest.json"])
        .pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    Ok(Some(
        nimi_shell_tauri::capabilities::local_assets::canonical_asset_manifest_path(
            &path,
            &models_root,
        )?
        .to_string_lossy()
        .to_string(),
    ))
}

#[tauri::command]
pub fn runtime_local_pick_asset_directory(_app: AppHandle) -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_directory(picker_start_dir())
        .set_title("Select asset bundle directory to import")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn runtime_local_assets_reveal_in_folder(
    _app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<(), String> {
    if payload.local_asset_id.trim().is_empty() {
        return Err("LOCAL_AI_ASSET_ID_REQUIRED".to_string());
    }
    let models_root = runtime_models_dir()?;
    let target = nimi_shell_tauri::capabilities::local_assets::reveal_target_for_asset(
        &models_root,
        &payload.local_asset_id,
    );
    reveal_path_in_os(&target)
}

#[tauri::command]
pub fn runtime_local_assets_reveal_root_folder(_app: AppHandle) -> Result<(), String> {
    let models_root = runtime_models_dir()?;
    reveal_path_in_os(&models_root)
}

#[cfg(test)]
mod tests {
    use nimi_shell_tauri::capabilities::local_assets::{
        canonical_asset_manifest_path, reveal_target_for_asset, ASSET_MANIFEST_FILE_NAME,
    };

    #[test]
    fn manifest_picker_accepts_only_runtime_root_manifest() {
        let tmp = tempfile::tempdir().expect("temp dir");
        let root = tmp.path().join("models");
        std::fs::create_dir_all(&root).expect("models dir");
        let manifest = root.join(ASSET_MANIFEST_FILE_NAME);
        std::fs::write(&manifest, "{}").expect("manifest");

        let resolved = canonical_asset_manifest_path(&manifest, &root).expect("manifest accepted");
        assert_eq!(
            resolved,
            manifest.canonicalize().expect("canonical manifest")
        );
    }

    #[test]
    fn manifest_picker_rejects_wrong_name() {
        let tmp = tempfile::tempdir().expect("temp dir");
        let root = tmp.path().join("models");
        std::fs::create_dir_all(&root).expect("models dir");
        let manifest = root.join("manifest.json");
        std::fs::write(&manifest, "{}").expect("manifest");

        let error = canonical_asset_manifest_path(&manifest, &root).expect_err("wrong filename");
        assert!(error.starts_with("LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID"));
    }

    #[test]
    fn manifest_picker_rejects_outside_runtime_root() {
        let tmp = tempfile::tempdir().expect("temp dir");
        let root = tmp.path().join("models");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&root).expect("models dir");
        std::fs::create_dir_all(&outside).expect("outside dir");
        let manifest = outside.join(ASSET_MANIFEST_FILE_NAME);
        std::fs::write(&manifest, "{}").expect("manifest");

        let error = canonical_asset_manifest_path(&manifest, &root).expect_err("outside root");
        assert!(error.starts_with("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT"));
    }

    #[test]
    fn reveal_target_never_interprets_asset_id_as_a_path() {
        let tmp = tempfile::tempdir().expect("temp dir");
        let root = tmp.path().join("models");
        let asset = root.join("asset-1");
        std::fs::create_dir_all(&asset).expect("asset dir");

        assert_eq!(reveal_target_for_asset(&root, "asset-1"), asset);
        assert_eq!(reveal_target_for_asset(&root, "../asset-1"), root);
        assert_eq!(reveal_target_for_asset(&root, "nested/asset-1"), root);
        assert_eq!(reveal_target_for_asset(&root, "core.local-ai"), root);
    }
}
