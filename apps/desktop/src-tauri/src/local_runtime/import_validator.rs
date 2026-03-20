use std::collections::HashMap;
use std::path::Path;

mod helpers;
mod manifest_checks;
use helpers::{
    err, normalize_manifest_hash, ARTIFACT_MANIFEST_FILE_NAME, MODEL_MANIFEST_FILE_NAME,
};
pub(crate) use helpers::{normalize_and_validate_capabilities, validate_loopback_endpoint};
use manifest_checks::normalize_artifact_kind;
pub(crate) use manifest_checks::{
    parse_and_validate_artifact_manifest, parse_and_validate_manifest,
    validate_import_artifact_manifest_path, validate_import_manifest_path,
};

use super::types::{
    generate_ulid_string, normalize_non_empty, now_iso_timestamp, slugify_local_model_id,
    ImportedArtifactManifest, ImportedModelManifest, LocalAiArtifactKind, LocalAiArtifactRecord,
    LocalAiArtifactSource, LocalAiArtifactStatus, LocalAiModelRecord, LocalAiModelSource,
    LocalAiModelStatus,
};

pub fn manifest_to_model_record(
    manifest: &ImportedModelManifest,
    endpoint_override: Option<&str>,
    model_dir: Option<&Path>,
) -> Result<LocalAiModelRecord, String> {
    let slug = slugify_local_model_id(&manifest.model_id);
    let local_model_id = format!("local_{slug}_{}", generate_ulid_string());
    let now = now_iso_timestamp();
    let capabilities = normalize_and_validate_capabilities(&manifest.capabilities)?;
    let files = if manifest.files.is_empty() {
        vec![manifest.entry.trim().to_string()]
    } else {
        manifest
            .files
            .iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
    };
    let known_total_size_bytes = model_dir.and_then(|root| {
        let mut total = 0_u64;
        let mut seen_any = false;
        for file in &files {
            let file_size = std::fs::metadata(root.join(file)).ok()?.len();
            total = total.saturating_add(file_size);
            seen_any = true;
        }
        if seen_any { Some(total) } else { None }
    });

    Ok(LocalAiModelRecord {
        local_model_id,
        model_id: manifest.model_id.trim().to_string(),
        logical_model_id: normalize_non_empty(&manifest.logical_model_id, &manifest.model_id),
        capabilities,
        engine: normalize_non_empty(&manifest.engine, "llama"),
        entry: manifest.entry.trim().to_string(),
        files,
        license: manifest.license.trim().to_string(),
        source: LocalAiModelSource {
            repo: manifest.source.repo.trim().to_string(),
            revision: manifest.source.revision.trim().to_string(),
        },
        hashes: manifest
            .hashes
            .iter()
            .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
            .collect::<HashMap<_, _>>(),
        tags: Vec::new(),
        known_total_size_bytes,
        endpoint: validate_loopback_endpoint(endpoint_override.unwrap_or_default())?,
        status: LocalAiModelStatus::Installed,
        installed_at: now.clone(),
        updated_at: now,
        health_detail: None,
        artifact_roles: manifest.artifact_roles.clone(),
        preferred_engine: manifest.preferred_engine.clone(),
        fallback_engines: manifest.fallback_engines.clone(),
        engine_config: manifest.engine_config.clone(),
        recommendation: None,
    })
}

pub fn manifest_to_artifact_record(
    manifest: &ImportedArtifactManifest,
) -> Result<LocalAiArtifactRecord, String> {
    let slug = slugify_local_model_id(&manifest.artifact_id);
    let local_artifact_id = format!("local_artifact_{slug}_{}", generate_ulid_string());
    let now = now_iso_timestamp();
    let kind = normalize_artifact_kind(&manifest.kind)?;

    Ok(LocalAiArtifactRecord {
        local_artifact_id,
        artifact_id: manifest.artifact_id.trim().to_string(),
        kind,
        engine: normalize_non_empty(&manifest.engine, "llama"),
        entry: manifest.entry.trim().to_string(),
        files: if manifest.files.is_empty() {
            vec![manifest.entry.trim().to_string()]
        } else {
            manifest
                .files
                .iter()
                .map(|item| item.trim().to_string())
                .collect()
        },
        license: manifest.license.trim().to_string(),
        source: LocalAiArtifactSource {
            repo: manifest.source.repo.trim().to_string(),
            revision: manifest.source.revision.trim().to_string(),
        },
        hashes: manifest.hashes.clone(),
        status: LocalAiArtifactStatus::Installed,
        installed_at: now.clone(),
        updated_at: now,
        health_detail: None,
        metadata: manifest.metadata.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        manifest_to_model_record, normalize_and_validate_capabilities, parse_and_validate_manifest,
        validate_import_artifact_manifest_path, validate_import_manifest_path,
        validate_loopback_endpoint,
    };
    use sha2::{Digest, Sha256};
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

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn resolved_manifest_dir(models_dir: &PathBuf, logical_model_id: &str) -> PathBuf {
        let dir = crate::local_runtime::types::resolved_model_dir(models_dir, logical_model_id);
        fs::create_dir_all(&dir).expect("create resolved manifest dir");
        dir
    }

    #[test]
    fn validate_import_manifest_path_requires_resolved_manifest_location() {
        let temp = unique_temp_dir("manifest-path");
        let models_dir = temp.join("models");
        fs::create_dir_all(&models_dir).expect("create models dir");
        let manifest_dir = resolved_manifest_dir(&models_dir, "nimi/test-model");
        let manifest_path = manifest_dir.join("manifest.json");
        fs::write(&manifest_path, "{}").expect("write manifest");

        let validated =
            validate_import_manifest_path(manifest_path.to_str().unwrap(), models_dir.as_path());
        assert!(validated.is_ok());

        let legacy_path = models_dir.join("model.manifest.json");
        fs::write(&legacy_path, "{}").expect("write legacy manifest");
        let legacy =
            validate_import_manifest_path(legacy_path.to_str().unwrap(), models_dir.as_path());
        assert!(legacy.is_err());
        assert!(legacy
            .unwrap_err()
            .contains("LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID"));

        let outside_models_dir = temp.join("outside-models");
        fs::create_dir_all(&outside_models_dir).expect("create outside-models dir");
        let invalid_path = outside_models_dir.join("manifest.json");
        fs::write(&invalid_path, "{}").expect("write invalid manifest");
        let invalid =
            validate_import_manifest_path(invalid_path.to_str().unwrap(), models_dir.as_path());
        assert!(invalid.is_err());

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn validate_import_artifact_manifest_path_requires_models_ancestor_and_file_name() {
        let temp = unique_temp_dir("artifact-manifest-path");
        let models_dir = temp.join("models");
        let artifact_dir = models_dir.join(artifact_relative_dir("companion-artifact"));
        fs::create_dir_all(&artifact_dir).expect("create artifact dir");
        let manifest_path = artifact_dir.join("artifact.manifest.json");
        fs::write(&manifest_path, "{}").expect("write artifact manifest");

        let validated = validate_import_artifact_manifest_path(
            manifest_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(validated.is_ok());

        let invalid_name_path = artifact_dir.join("manifest.json");
        fs::write(&invalid_name_path, "{}").expect("write wrong manifest");
        let invalid_name = validate_import_artifact_manifest_path(
            invalid_name_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(invalid_name.is_err());
        assert!(invalid_name
            .unwrap_err()
            .contains("LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID"));

        let outside_models_dir = temp.join("outside-artifacts");
        fs::create_dir_all(&outside_models_dir).expect("create outside artifacts dir");
        let invalid_path = outside_models_dir.join("artifact.manifest.json");
        fs::write(&invalid_path, "{}").expect("write outside artifact manifest");
        let invalid = validate_import_artifact_manifest_path(
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
    fn parse_and_validate_manifest_rejects_hash_mismatch() {
        let temp = unique_temp_dir("manifest-hash");
        let models_dir = temp.join("models");
        let manifest_dir = resolved_manifest_dir(&models_dir, "nimi/test-model");
        let entry_path = manifest_dir.join("model.gguf");
        fs::write(&entry_path, b"hello-world").expect("write entry");
        let correct_hash = sha256_hex(b"hello-world");

        let manifest_path = manifest_dir.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "hf:test/model",
                "logicalModelId": "nimi/test-model",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {
                    "repo": "hf://test/model",
                    "revision": "main"
                },
                "hashes": {
                    "model.gguf": format!("sha256:{correct_hash}")
                },
                "artifactRoles": ["llm", "tokenizer"],
                "preferredEngine": "llama",
                "fallbackEngines": []
            })
            .to_string(),
        )
        .expect("write manifest");

        let parsed = parse_and_validate_manifest(&manifest_path);
        assert!(parsed.is_ok());

        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "hf:test/model",
                "logicalModelId": "nimi/test-model",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {
                    "repo": "hf://test/model",
                    "revision": "main"
                },
                "hashes": {
                    "model.gguf": "sha256:deadbeef"
                },
                "artifactRoles": ["llm", "tokenizer"],
                "preferredEngine": "llama",
                "fallbackEngines": []
            })
            .to_string(),
        )
        .expect("write mismatched manifest");

        let mismatched = parse_and_validate_manifest(&manifest_path);
        assert!(mismatched.is_err());

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

    // --- K-LOCAL-026 manifest schema field validation ---

    #[test]
    fn parse_manifest_rejects_empty_schema_version() {
        let temp = unique_temp_dir("schema-ver");
        let manifest_path = temp.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "",
                "modelId": "hf:test/model",
                "logicalModelId": "nimi/test-model",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {"model.gguf": "sha256:abc123"},
                "artifactRoles": ["llm", "tokenizer"],
                "preferredEngine": "llama",
                "fallbackEngines": []
            })
            .to_string(),
        )
        .expect("write manifest");
        let result = parse_and_validate_manifest(&manifest_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("SCHEMA_VERSION_MISSING"));
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn parse_manifest_rejects_empty_model_id() {
        let temp = unique_temp_dir("model-id");
        let manifest_path = temp.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "",
                "logicalModelId": "nimi/test-model",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {"model.gguf": "sha256:abc123"},
                "artifactRoles": ["llm", "tokenizer"],
                "preferredEngine": "llama",
                "fallbackEngines": []
            })
            .to_string(),
        )
        .expect("write manifest");
        let result = parse_and_validate_manifest(&manifest_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("MODEL_ID_MISSING"));
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn parse_manifest_rejects_entry_not_in_files() {
        let temp = unique_temp_dir("entry-files");
        let manifest_path = temp.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "hf:test/model",
                "logicalModelId": "nimi/test-model",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["config.json"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {"config.json": "sha256:abc123"},
                "artifactRoles": ["llm", "tokenizer"],
                "preferredEngine": "llama",
                "fallbackEngines": []
            })
            .to_string(),
        )
        .expect("write manifest");
        let result = parse_and_validate_manifest(&manifest_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ENTRY_NOT_IN_FILES"));
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn parse_manifest_rejects_empty_hashes() {
        let temp = unique_temp_dir("empty-hashes");
        let manifest_path = temp.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "hf:test/model",
                "logicalModelId": "nimi/test-model",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {},
                "artifactRoles": ["llm", "tokenizer"],
                "preferredEngine": "llama",
                "fallbackEngines": []
            })
            .to_string(),
        )
        .expect("write manifest");
        let result = parse_and_validate_manifest(&manifest_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("HASHES_MISSING"));
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn manifest_to_model_record_generates_installed_status() {
        use crate::local_runtime::types::{
            ImportedModelManifest, ImportedModelSource, LocalAiModelStatus,
        };
        use std::collections::HashMap;

        let manifest = ImportedModelManifest {
            schema_version: "1.0.0".to_string(),
            model_id: "hf:test/model".to_string(),
            logical_model_id: "nimi/test-model".to_string(),
            capabilities: vec!["chat".to_string()],
            engine: "llama".to_string(),
            entry: "model.gguf".to_string(),
            files: vec!["model.gguf".to_string()],
            license: "apache-2.0".to_string(),
            source: ImportedModelSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            hashes: HashMap::from([("model.gguf".to_string(), "sha256:abc123".to_string())]),
            artifact_roles: vec!["llm".to_string(), "tokenizer".to_string()],
            preferred_engine: Some("llama".to_string()),
            fallback_engines: Vec::new(),
            engine_config: None,
        };
        let record = manifest_to_model_record(&manifest, None, None).expect("model record");
        assert_eq!(record.status, LocalAiModelStatus::Installed);
        assert!(record.local_model_id.starts_with("local_hf-test-model_"));
        assert_eq!(record.model_id, "hf:test/model");
        assert_eq!(record.capabilities, vec!["chat"]);
        assert_eq!(record.engine, "llama");
    }
}
