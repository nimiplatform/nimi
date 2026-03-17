use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::local_runtime::types::{
    default_fallback_engines_for_engine, default_logical_model_id, normalize_local_engine,
};

use super::{
    err, normalize_manifest_hash, ImportedArtifactManifest, ImportedModelManifest,
    LocalAiArtifactKind, ARTIFACT_MANIFEST_FILE_NAME, MODEL_MANIFEST_FILE_NAME,
};

pub(super) fn sha256_hex_for_file(path: &Path) -> Result<String, String> {
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

pub(super) fn assert_required_manifest_fields(
    manifest: &ImportedModelManifest,
) -> Result<(), String> {
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
    let _ = super::normalize_and_validate_capabilities(&manifest.capabilities)?;
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

pub(super) fn normalize_artifact_kind(value: &str) -> Result<LocalAiArtifactKind, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "vae" => Ok(LocalAiArtifactKind::Vae),
        "llm" => Ok(LocalAiArtifactKind::Llm),
        "clip" => Ok(LocalAiArtifactKind::Clip),
        "controlnet" => Ok(LocalAiArtifactKind::Controlnet),
        "lora" => Ok(LocalAiArtifactKind::Lora),
        "auxiliary" | "aux" => Ok(LocalAiArtifactKind::Auxiliary),
        other => Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_KIND_INVALID",
            format!("artifact kind 不受支持: {other}"),
        )),
    }
}

pub(super) fn assert_required_artifact_manifest_fields(
    manifest: &ImportedArtifactManifest,
) -> Result<(), String> {
    if manifest.schema_version.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_SCHEMA_VERSION_MISSING",
            "artifact manifest.schemaVersion 不能为空",
        ));
    }
    if manifest.artifact_id.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_ID_MISSING",
            "artifact manifest.artifactId 不能为空",
        ));
    }
    let _ = normalize_artifact_kind(&manifest.kind)?;
    if manifest.engine.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_ENGINE_MISSING",
            "artifact manifest.engine 不能为空",
        ));
    }
    if manifest.entry.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_ENTRY_MISSING",
            "artifact manifest.entry 不能为空",
        ));
    }
    if !manifest.files.is_empty() {
        let entry = manifest.entry.trim();
        if !manifest.files.iter().any(|item| item.trim() == entry) {
            return Err(err(
                "LOCAL_AI_IMPORT_ARTIFACT_ENTRY_NOT_IN_FILES",
                "artifact manifest.entry 必须存在于 manifest.files",
            ));
        }
    }
    if manifest.license.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_LICENSE_MISSING",
            "artifact manifest.license 不能为空",
        ));
    }
    if manifest.source.repo.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_SOURCE_REPO_MISSING",
            "artifact manifest.source.repo 不能为空",
        ));
    }
    if manifest.source.revision.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_SOURCE_REVISION_MISSING",
            "artifact manifest.source.revision 不能为空",
        ));
    }
    if manifest.hashes.is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_ARTIFACT_HASHES_MISSING",
            "artifact manifest.hashes 不能为空",
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

pub(crate) fn validate_import_manifest_path(
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

pub(crate) fn validate_import_artifact_manifest_path(
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

pub(crate) fn parse_and_validate_manifest(path: &Path) -> Result<ImportedModelManifest, String> {
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

pub(crate) fn parse_and_validate_artifact_manifest(
    path: &Path,
) -> Result<ImportedArtifactManifest, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_READ_FAILED",
            format!("读取 artifact manifest 失败 ({}): {error}", path.display()),
        )
    })?;
    let manifest = serde_json::from_str::<ImportedArtifactManifest>(&raw).map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_PARSE_FAILED",
            format!("解析 artifact manifest JSON 失败: {error}"),
        )
    })?;
    assert_required_artifact_manifest_fields(&manifest)?;
    let model_like_manifest = ImportedModelManifest {
        schema_version: manifest.schema_version.clone(),
        model_id: manifest.artifact_id.clone(),
        logical_model_id: default_logical_model_id(manifest.artifact_id.as_str()),
        capabilities: vec!["image".to_string()],
        engine: manifest.engine.clone(),
        entry: manifest.entry.clone(),
        files: manifest.files.clone(),
        license: manifest.license.clone(),
        source: super::super::types::ImportedModelSource {
            repo: manifest.source.repo.clone(),
            revision: manifest.source.revision.clone(),
        },
        hashes: manifest.hashes.clone(),
        artifact_roles: vec!["companion".to_string()],
        preferred_engine: Some(normalize_local_engine(
            manifest.engine.as_str(),
            &["image".to_string()],
        )),
        fallback_engines: default_fallback_engines_for_engine(
            manifest.engine.as_str(),
            &["image".to_string()],
        ),
        engine_config: None,
    };
    assert_manifest_hashes(&model_like_manifest, path)?;
    Ok(manifest)
}
