use std::path::{Path, PathBuf};

pub const ASSET_MANIFEST_FILE_NAME: &str = "asset.manifest.json";
pub const RUNTIME_MODELS_DIR_NAME: &str = "models";

pub fn runtime_models_dir(data_root: &Path) -> PathBuf {
    data_root.join(RUNTIME_MODELS_DIR_NAME)
}

pub fn canonical_asset_manifest_path(path: &Path, models_root: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if file_name != ASSET_MANIFEST_FILE_NAME {
        return Err(
            "LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: only asset.manifest.json can be imported"
                .to_string(),
        );
    }

    let canonical_models_root = models_root
        .canonicalize()
        .map_err(|error| format!("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT: {error}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT: {error}"))?;
    if !canonical_path.starts_with(&canonical_models_root) {
        return Err(
            "LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT: manifest must live under the runtime models root"
                .to_string(),
        );
    }
    Ok(canonical_path)
}

fn safe_local_asset_dir(models_root: &Path, local_asset_id: &str) -> Option<PathBuf> {
    let trimmed = local_asset_id.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return None;
    }

    let candidate = models_root.join(trimmed);
    if candidate.starts_with(models_root) && candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

pub fn reveal_target_for_asset(models_root: &Path, local_asset_id: &str) -> PathBuf {
    safe_local_asset_dir(models_root, local_asset_id).unwrap_or_else(|| models_root.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_asset_manifest_path, reveal_target_for_asset, runtime_models_dir,
        ASSET_MANIFEST_FILE_NAME,
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-runtime-local-assets-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn runtime_models_dir_uses_declared_models_child() {
        let root = std::path::Path::new("/tmp/nimi-data");
        assert_eq!(runtime_models_dir(root), root.join("models"));
    }

    #[test]
    fn manifest_picker_accepts_only_runtime_root_manifest() {
        let tmp = temp_dir("accept");
        let root = tmp.join("models");
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
        let tmp = temp_dir("wrong-name");
        let root = tmp.join("models");
        std::fs::create_dir_all(&root).expect("models dir");
        let manifest = root.join("manifest.json");
        std::fs::write(&manifest, "{}").expect("manifest");

        let error = canonical_asset_manifest_path(&manifest, &root).expect_err("wrong filename");
        assert!(error.starts_with("LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID"));
    }

    #[test]
    fn manifest_picker_rejects_outside_runtime_root() {
        let tmp = temp_dir("outside");
        let root = tmp.join("models");
        let outside = tmp.join("outside");
        std::fs::create_dir_all(&root).expect("models dir");
        std::fs::create_dir_all(&outside).expect("outside dir");
        let manifest = outside.join(ASSET_MANIFEST_FILE_NAME);
        std::fs::write(&manifest, "{}").expect("manifest");

        let error = canonical_asset_manifest_path(&manifest, &root).expect_err("outside root");
        assert!(error.starts_with("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT"));
    }

    #[test]
    fn reveal_target_never_interprets_asset_id_as_a_path() {
        let tmp = temp_dir("reveal");
        let root = tmp.join("models");
        let asset = root.join("asset-1");
        std::fs::create_dir_all(&asset).expect("asset dir");

        assert_eq!(reveal_target_for_asset(&root, "asset-1"), asset);
        assert_eq!(reveal_target_for_asset(&root, "../asset-1"), root);
        assert_eq!(reveal_target_for_asset(&root, "nested/asset-1"), root);
        assert_eq!(reveal_target_for_asset(&root, "core.local-ai"), root);
    }
}
