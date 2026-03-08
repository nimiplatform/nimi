use std::collections::HashMap;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use url::Url;

use super::types::{
    generate_ulid_string, normalize_non_empty, now_iso_timestamp, slugify_local_model_id,
    ImportedModelManifest, LocalAiModelRecord, LocalAiModelSource, LocalAiModelStatus,
    DEFAULT_LOCAL_ENDPOINT,
};

const SUPPORTED_CAPABILITIES: [&str; 6] = ["chat", "image", "video", "tts", "stt", "embedding"];
const MODEL_MANIFEST_FILE_NAME: &str = "model.manifest.json";
const ARTIFACT_MANIFEST_FILE_NAME: &str = "artifact.manifest.json";

fn err(code: &str, message: impl AsRef<str>) -> String {
    format!("{code}: {}", message.as_ref())
}

fn normalize_manifest_hash(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .trim_start_matches("sha256:")
        .to_string()
}

fn sha256_hex_for_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_HASH_READ_FAILED",
            format!("读取 hash 文件失败 ({}): {error}", path.display()),
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hasher.finalize();
    Ok(format!("{digest:x}"))
}

pub fn normalize_and_validate_capabilities(capabilities: &[String]) -> Result<Vec<String>, String> {
    let mut output = Vec::<String>::new();
    for raw in capabilities {
        let normalized = raw.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if !SUPPORTED_CAPABILITIES.contains(&normalized.as_str()) {
            return Err(err(
                "LOCAL_AI_MODEL_CAPABILITY_INVALID",
                format!(
                    "capability 不受支持: {normalized}，仅允许 {}",
                    SUPPORTED_CAPABILITIES.join(", ")
                ),
            ));
        }
        if !output.iter().any(|item| item == &normalized) {
            output.push(normalized);
        }
    }

    if output.is_empty() {
        return Err(err(
            "LOCAL_AI_MODEL_CAPABILITY_EMPTY",
            "capabilities 不能为空",
        ));
    }

    Ok(output)
}

pub fn validate_loopback_endpoint(endpoint: &str) -> Result<String, String> {
    let normalized = normalize_non_empty(endpoint, DEFAULT_LOCAL_ENDPOINT);
    let parsed = Url::parse(normalized.as_str()).map_err(|error| {
        err(
            "LOCAL_AI_ENDPOINT_INVALID",
            format!("endpoint 不是合法 URL: {error}"),
        )
    })?;

    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(err(
            "LOCAL_AI_ENDPOINT_SCHEME_INVALID",
            format!("endpoint 协议仅允许 http/https，当前为: {scheme}"),
        ));
    }

    let host = parsed.host_str().unwrap_or("").trim();
    let normalized_host = host.trim_matches(|ch| ch == '[' || ch == ']');
    if normalized_host.is_empty() {
        return Err(err("LOCAL_AI_ENDPOINT_HOST_MISSING", "endpoint 缺少 host"));
    }

    if normalized_host.eq_ignore_ascii_case("localhost") {
        return Ok(normalized);
    }

    let parsed_ip = normalized_host.parse::<IpAddr>().map_err(|_| {
        err(
            "LOCAL_AI_ENDPOINT_NOT_LOOPBACK",
            format!("endpoint host 仅允许 loopback，当前为: {host}"),
        )
    })?;

    if !parsed_ip.is_loopback() {
        return Err(err(
            "LOCAL_AI_ENDPOINT_NOT_LOOPBACK",
            format!("endpoint host 仅允许 loopback，当前为: {host}"),
        ));
    }

    Ok(normalized)
}

fn assert_required_manifest_fields(manifest: &ImportedModelManifest) -> Result<(), String> {
    if manifest.schema_version.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_SCHEMA_VERSION_MISSING",
            "manifest.schemaVersion 不能为空",
        ));
    }
    if manifest.model_id.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_MODEL_ID_MISSING",
            "manifest.modelId 不能为空",
        ));
    }
    let _ = normalize_and_validate_capabilities(&manifest.capabilities)?;
    if manifest.engine.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_ENGINE_MISSING",
            "manifest.engine 不能为空",
        ));
    }
    if manifest.entry.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_ENTRY_MISSING",
            "manifest.entry 不能为空",
        ));
    }
    if !manifest.files.is_empty() {
        let entry = manifest.entry.trim();
        if !manifest.files.iter().any(|item| item.trim() == entry) {
            return Err(err(
                "LOCAL_AI_IMPORT_MANIFEST_ENTRY_NOT_IN_FILES",
                "manifest.entry 必须存在于 manifest.files",
            ));
        }
    }
    if manifest.license.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_LICENSE_MISSING",
            "manifest.license 不能为空",
        ));
    }
    if manifest.source.repo.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_SOURCE_REPO_MISSING",
            "manifest.source.repo 不能为空",
        ));
    }
    if manifest.source.revision.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_SOURCE_REVISION_MISSING",
            "manifest.source.revision 不能为空",
        ));
    }
    if manifest.hashes.is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_HASHES_MISSING",
            "manifest.hashes 不能为空",
        ));
    }
    Ok(())
}

fn assert_manifest_hashes(
    manifest: &ImportedModelManifest,
    manifest_path: &Path,
) -> Result<(), String> {
    let base_dir = manifest_path.parent().ok_or_else(|| {
        err(
            "LOCAL_AI_IMPORT_MANIFEST_PARENT_MISSING",
            "manifest 路径没有父目录",
        )
    })?;
    let canonical_base = base_dir.canonicalize().map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_MANIFEST_PARENT_RESOLVE_FAILED",
            format!("解析 manifest 父目录失败 ({}): {error}", base_dir.display()),
        )
    })?;

    for (relative_path, expected_hash_raw) in &manifest.hashes {
        let rel = relative_path.trim();
        if rel.is_empty() {
            return Err(err(
                "LOCAL_AI_IMPORT_MANIFEST_HASH_PATH_EMPTY",
                "manifest.hashes 包含空路径",
            ));
        }
        let expected_hash = normalize_manifest_hash(expected_hash_raw);
        if expected_hash.is_empty() {
            return Err(err(
                "LOCAL_AI_IMPORT_MANIFEST_HASH_VALUE_EMPTY",
                format!("manifest.hashes 中 {rel} 的 hash 为空"),
            ));
        }
        let candidate = canonical_base.join(rel);
        let canonical_candidate = candidate.canonicalize().map_err(|error| {
            err(
                "LOCAL_AI_IMPORT_HASH_FILE_MISSING",
                format!("hash 文件不存在或不可读 ({}): {error}", candidate.display()),
            )
        })?;
        if !canonical_candidate.starts_with(&canonical_base) {
            return Err(err(
                "LOCAL_AI_IMPORT_HASH_PATH_TRAVERSAL",
                format!("hash 路径越界: {rel}"),
            ));
        }
        let actual_hash = sha256_hex_for_file(&canonical_candidate)?;
        if actual_hash != expected_hash {
            return Err(err(
                "LOCAL_AI_IMPORT_HASH_MISMATCH",
                format!("hash 校验失败: {rel}, expected={expected_hash}, actual={actual_hash}"),
            ));
        }
    }
    Ok(())
}

fn validate_import_manifest_path_with_expected_file_name(
    manifest_path: &str,
    runtime_models_root: &Path,
    expected_file_name: &str,
    invalid_file_name_code: &str,
) -> Result<PathBuf, String> {
    let path = PathBuf::from(manifest_path.trim());
    if !path.exists() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_NOT_FOUND",
            format!("manifest 文件不存在: {}", path.display()),
        ));
    }
    if !path.is_file() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_NOT_FILE",
            format!("manifest 不是文件: {}", path.display()),
        ));
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if file_name != expected_file_name {
        return Err(err(
            invalid_file_name_code,
            format!("仅支持导入 {expected_file_name}"),
        ));
    }

    let canonical_root = runtime_models_root.canonicalize().map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_RUNTIME_MODELS_ROOT_UNAVAILABLE",
            format!(
                "无法解析 runtime models 根目录 ({}): {error}",
                runtime_models_root.display()
            ),
        )
    })?;
    let canonical_manifest = path.canonicalize().map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_MANIFEST_PATH_RESOLVE_FAILED",
            format!("解析 manifest 路径失败 ({}): {error}", path.display()),
        )
    })?;

    if !canonical_manifest.starts_with(&canonical_root) {
        return Err(err(
            "LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT",
            format!(
                "导入路径必须位于 runtime models 目录下: {}",
                canonical_root.display()
            ),
        ));
    }

    Ok(canonical_manifest)
}

pub fn validate_import_manifest_path(
    manifest_path: &str,
    runtime_models_root: &Path,
) -> Result<PathBuf, String> {
    validate_import_manifest_path_with_expected_file_name(
        manifest_path,
        runtime_models_root,
        MODEL_MANIFEST_FILE_NAME,
        "LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID",
    )
}

pub fn validate_import_artifact_manifest_path(
    manifest_path: &str,
    runtime_models_root: &Path,
) -> Result<PathBuf, String> {
    validate_import_manifest_path_with_expected_file_name(
        manifest_path,
        runtime_models_root,
        ARTIFACT_MANIFEST_FILE_NAME,
        "LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID",
    )
}

pub fn parse_and_validate_manifest(path: &Path) -> Result<ImportedModelManifest, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_MANIFEST_READ_FAILED",
            format!("读取 manifest 失败 ({}): {error}", path.display()),
        )
    })?;
    let manifest = serde_json::from_str::<ImportedModelManifest>(&raw).map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_MANIFEST_PARSE_FAILED",
            format!("解析 manifest JSON 失败: {error}"),
        )
    })?;
    assert_required_manifest_fields(&manifest)?;
    assert_manifest_hashes(&manifest, path)?;
    Ok(manifest)
}

pub fn manifest_to_model_record(
    manifest: &ImportedModelManifest,
    endpoint_override: Option<&str>,
) -> Result<LocalAiModelRecord, String> {
    let slug = slugify_local_model_id(&manifest.model_id);
    let local_model_id = format!("local_{slug}_{}", generate_ulid_string());
    let now = now_iso_timestamp();
    let capabilities = normalize_and_validate_capabilities(&manifest.capabilities)?;

    Ok(LocalAiModelRecord {
        local_model_id,
        model_id: manifest.model_id.trim().to_string(),
        capabilities,
        engine: normalize_non_empty(&manifest.engine, "localai"),
        entry: manifest.entry.trim().to_string(),
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
        endpoint: validate_loopback_endpoint(endpoint_override.unwrap_or_default())?,
        status: LocalAiModelStatus::Installed,
        installed_at: now.clone(),
        updated_at: now,
        health_detail: None,
        engine_config: manifest.engine_config.clone(),
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

    #[test]
    fn validate_import_manifest_path_requires_models_ancestor_and_file_name() {
        let temp = unique_temp_dir("manifest-path");
        let models_dir = temp.join("models");
        fs::create_dir_all(&models_dir).expect("create models dir");
        let manifest_path = models_dir.join("model.manifest.json");
        fs::write(&manifest_path, "{}").expect("write manifest");

        let validated =
            validate_import_manifest_path(manifest_path.to_str().unwrap(), models_dir.as_path());
        assert!(validated.is_ok());

        let outside_models_dir = temp.join("outside-models");
        fs::create_dir_all(&outside_models_dir).expect("create outside-models dir");
        let invalid_path = outside_models_dir.join("model.manifest.json");
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
        let artifact_dir = models_dir.join("companion-artifact");
        fs::create_dir_all(&artifact_dir).expect("create artifact dir");
        let manifest_path = artifact_dir.join("artifact.manifest.json");
        fs::write(&manifest_path, "{}").expect("write artifact manifest");

        let validated = validate_import_artifact_manifest_path(
            manifest_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(validated.is_ok());

        let invalid_name_path = artifact_dir.join("model.manifest.json");
        fs::write(&invalid_name_path, "{}").expect("write wrong manifest");
        let invalid_name = validate_import_artifact_manifest_path(
            invalid_name_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(invalid_name.is_err());
        assert!(
            invalid_name
                .unwrap_err()
                .contains("LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID")
        );

        let outside_models_dir = temp.join("outside-artifacts");
        fs::create_dir_all(&outside_models_dir).expect("create outside artifacts dir");
        let invalid_path = outside_models_dir.join("artifact.manifest.json");
        fs::write(&invalid_path, "{}").expect("write outside artifact manifest");
        let invalid = validate_import_artifact_manifest_path(
            invalid_path.to_str().unwrap(),
            models_dir.as_path(),
        );
        assert!(invalid.is_err());
        assert!(
            invalid
                .unwrap_err()
                .contains("LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT")
        );

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn parse_and_validate_manifest_rejects_hash_mismatch() {
        let temp = unique_temp_dir("manifest-hash");
        let models_dir = temp.join("models");
        fs::create_dir_all(&models_dir).expect("create models dir");
        let entry_path = models_dir.join("model.gguf");
        fs::write(&entry_path, b"hello-world").expect("write entry");
        let correct_hash = sha256_hex(b"hello-world");

        let manifest_path = models_dir.join("model.manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "hf:test/model",
                "capabilities": ["chat"],
                "engine": "localai",
                "entry": "model.gguf",
                "license": "apache-2.0",
                "source": {
                    "repo": "hf://test/model",
                    "revision": "main"
                },
                "hashes": {
                    "model.gguf": format!("sha256:{correct_hash}")
                }
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
                "capabilities": ["chat"],
                "engine": "localai",
                "entry": "model.gguf",
                "license": "apache-2.0",
                "source": {
                    "repo": "hf://test/model",
                    "revision": "main"
                },
                "hashes": {
                    "model.gguf": "sha256:deadbeef"
                }
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
        let manifest_path = temp.join("model.manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "",
                "modelId": "hf:test/model",
                "capabilities": ["chat"],
                "engine": "localai",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {"model.gguf": "sha256:abc123"}
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
        let manifest_path = temp.join("model.manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "",
                "capabilities": ["chat"],
                "engine": "localai",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {"model.gguf": "sha256:abc123"}
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
        let manifest_path = temp.join("model.manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "hf:test/model",
                "capabilities": ["chat"],
                "engine": "localai",
                "entry": "model.gguf",
                "files": ["config.json"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {"config.json": "sha256:abc123"}
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
        let manifest_path = temp.join("model.manifest.json");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "modelId": "hf:test/model",
                "capabilities": ["chat"],
                "engine": "localai",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {"repo": "hf://test/model", "revision": "main"},
                "hashes": {}
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
            capabilities: vec!["chat".to_string()],
            engine: "localai".to_string(),
            entry: "model.gguf".to_string(),
            files: vec!["model.gguf".to_string()],
            license: "apache-2.0".to_string(),
            source: ImportedModelSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            hashes: HashMap::from([("model.gguf".to_string(), "sha256:abc123".to_string())]),
            engine_config: None,
        };
        let record = manifest_to_model_record(&manifest, None).expect("model record");
        assert_eq!(record.status, LocalAiModelStatus::Installed);
        assert!(record.local_model_id.starts_with("local_hf-test-model_"));
        assert_eq!(record.model_id, "hf:test/model");
        assert_eq!(record.capabilities, vec!["chat"]);
        assert_eq!(record.engine, "localai");
    }
}
