mod helpers;
mod manifest_checks;
use helpers::{err, ASSET_MANIFEST_FILE_NAME};
pub(crate) use helpers::{normalize_and_validate_capabilities, validate_loopback_endpoint};
pub(crate) use manifest_checks::validate_import_asset_manifest_path;

#[cfg(test)]
mod tests {
    use super::{
        normalize_and_validate_capabilities, validate_import_asset_manifest_path,
        validate_loopback_endpoint,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nimi-{prefix}-{nanos}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn resolved_manifest_dir(models_dir: &PathBuf, logical_model_id: &str) -> PathBuf {
        let dir = crate::local_runtime::types::resolved_model_dir(models_dir, logical_model_id);
        fs::create_dir_all(&dir).expect("create resolved manifest dir");
        dir
    }

    #[test]
    fn validate_import_asset_manifest_path_requires_resolved_manifest_location() {
        let temp = unique_temp_dir("manifest-path");
        let models_dir = temp.join("models");
        fs::create_dir_all(&models_dir).expect("create models dir");
        let manifest_dir = resolved_manifest_dir(&models_dir, "nimi/test-model");
        let manifest_path = manifest_dir.join("asset.manifest.json");
        fs::write(&manifest_path, "{}").expect("write manifest");

        let validated = validate_import_asset_manifest_path(
            manifest_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(validated.is_ok());

        let legacy_path = models_dir.join("model.manifest.json");
        fs::write(&legacy_path, "{}").expect("write legacy manifest");
        let legacy = validate_import_asset_manifest_path(
            legacy_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(legacy.is_err());
        assert!(legacy
            .unwrap_err()
            .contains("LOCAL_AI_IMPORT_ASSET_MANIFEST_FILE_NAME_INVALID"));

        let outside_models_dir = temp.join("outside-models");
        fs::create_dir_all(&outside_models_dir).expect("create outside-models dir");
        let invalid_path = outside_models_dir.join("asset.manifest.json");
        fs::write(&invalid_path, "{}").expect("write invalid manifest");
        let invalid = validate_import_asset_manifest_path(
            invalid_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(invalid.is_err());

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn validate_import_asset_manifest_path_requires_models_ancestor_and_file_name() {
        let temp = unique_temp_dir("artifact-manifest-path");
        let models_dir = temp.join("models");
        let artifact_dir = resolved_manifest_dir(&models_dir, "companion-artifact");
        let manifest_path = artifact_dir.join("asset.manifest.json");
        fs::write(&manifest_path, "{}").expect("write artifact manifest");

        let validated = validate_import_asset_manifest_path(
            manifest_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(validated.is_ok());

        let invalid_name_path = artifact_dir.join("manifest.json");
        fs::write(&invalid_name_path, "{}").expect("write wrong manifest");
        let invalid_name = validate_import_asset_manifest_path(
            invalid_name_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(invalid_name.is_err());
        assert!(invalid_name
            .unwrap_err()
            .contains("LOCAL_AI_IMPORT_ASSET_MANIFEST_FILE_NAME_INVALID"));

        let outside_models_dir = temp.join("outside-artifacts");
        fs::create_dir_all(&outside_models_dir).expect("create outside artifacts dir");
        let invalid_path = outside_models_dir.join("asset.manifest.json");
        fs::write(&invalid_path, "{}").expect("write outside artifact manifest");
        let invalid = validate_import_asset_manifest_path(
            invalid_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(invalid.is_err());
        assert!(invalid
            .unwrap_err()
            .contains("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT"));

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn validate_loopback_endpoint_rejects_non_loopback_hosts() {
        assert!(validate_loopback_endpoint("http://127.0.0.1:1234/v1").is_ok());
        assert!(validate_loopback_endpoint("http://localhost:8080/v1").is_ok());
        assert!(validate_loopback_endpoint("http://[::1]:9999/v1").is_ok());
        assert!(validate_loopback_endpoint("https://8.8.8.8/v1").is_err());
        assert!(validate_loopback_endpoint("http://example.com/v1").is_err());
    }

    #[test]
    fn normalize_and_validate_capabilities_rejects_unknown_values() {
        let valid = normalize_and_validate_capabilities(&[
            "chat".to_string(),
            "tts".to_string(),
            "CHAT".to_string(),
        ])
        .expect("valid capabilities");
        assert_eq!(valid, vec!["chat".to_string(), "tts".to_string()]);

        let invalid = normalize_and_validate_capabilities(&["voice".to_string()]);
        assert!(invalid.is_err());
    }

}
