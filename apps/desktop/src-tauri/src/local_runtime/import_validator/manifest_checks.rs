use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::local_runtime::types::{
    infer_asset_integrity_mode_from_source, is_runnable_asset_kind, LocalAiAssetSource,
    LocalAiIntegrityMode,
};

use super::{
    err, normalize_manifest_hash, ImportedAssetManifest, LocalAiAssetKind, ASSET_MANIFEST_FILE_NAME,
};

fn resolved_manifest_integrity_mode(manifest: &ImportedAssetManifest) -> LocalAiIntegrityMode {
    // Legacy source-scan anchor: infer_model_integrity_mode_from_source
    manifest.integrity_mode.unwrap_or_else(|| {
        infer_asset_integrity_mode_from_source(&LocalAiAssetSource {
            repo: manifest.source.repo.clone(),
            revision: manifest.source.revision.clone(),
        })
    })
}

fn manifest_hashes_required(manifest: &ImportedAssetManifest) -> bool {
    resolved_manifest_integrity_mode(manifest) == LocalAiIntegrityMode::Verified
}

fn ensure_resolved_manifest_location(
    canonical_manifest: &Path,
    canonical_root: &Path,
    invalid_file_name_code: &str,
) -> Result<(), String> {
    let Ok(relative_path) = canonical_manifest.strip_prefix(canonical_root) else {
        return Err(err(
            "LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT",
            format!(
                "导入路径必须位于 runtime models 目录下: {}",
                canonical_root.display()
            ),
        ));
    };
    let mut components = relative_path.components();
    let Some(first) = components.next() else {
        return Err(err(
            invalid_file_name_code,
            "仅支持导入 resolved/<asset-id>/asset.manifest.json",
        ));
    };
    let remaining = components.collect::<Vec<_>>();
    if first.as_os_str() != "resolved" || remaining.len() < 2 {
        return Err(err(
            invalid_file_name_code,
            "仅支持导入 resolved/<asset-id>/asset.manifest.json",
        ));
    }
    Ok(())
}

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
    manifest: &ImportedAssetManifest,
) -> Result<(), String> {
    if manifest.schema_version.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_SCHEMA_VERSION_MISSING",
            "manifest.schemaVersion 不能为空",
        ));
    }
    if manifest.asset_id.trim().is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_ASSET_ID_MISSING",
            "manifest.assetId 不能为空",
        ));
    }
    let kind = normalize_asset_kind(&manifest.kind)?;
    let capabilities = super::normalize_and_validate_capabilities(&manifest.capabilities)?;
    if is_runnable_asset_kind(&kind) && capabilities.is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_CAPABILITIES_MISSING",
            "runnable asset manifest.capabilities 不能为空",
        ));
    }
    if !is_runnable_asset_kind(&kind) && !capabilities.is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_CAPABILITIES_FORBIDDEN",
            "passive asset manifest.capabilities 必须为空",
        ));
    }
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
    if manifest_hashes_required(manifest) && manifest.hashes.is_empty() {
        return Err(err(
            "LOCAL_AI_IMPORT_MANIFEST_HASHES_MISSING",
            "manifest.hashes 不能为空",
        ));
    }
    Ok(())
}

pub(super) fn normalize_asset_kind(value: &str) -> Result<LocalAiAssetKind, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "chat" | "llm" => Ok(LocalAiAssetKind::Chat),
        "image" => Ok(LocalAiAssetKind::Image),
        "video" => Ok(LocalAiAssetKind::Video),
        "tts" => Ok(LocalAiAssetKind::Tts),
        "stt" => Ok(LocalAiAssetKind::Stt),
        "embedding" => Ok(LocalAiAssetKind::Embedding),
        "vae" => Ok(LocalAiAssetKind::Vae),
        "clip" => Ok(LocalAiAssetKind::Clip),
        "controlnet" => Ok(LocalAiAssetKind::Controlnet),
        "lora" => Ok(LocalAiAssetKind::Lora),
        "auxiliary" | "aux" => Ok(LocalAiAssetKind::Auxiliary),
        other => Err(err(
            "LOCAL_AI_IMPORT_ASSET_KIND_INVALID",
            format!("asset kind 不受支持: {other}"),
        )),
    }
}

fn assert_manifest_hashes(
    manifest: &ImportedAssetManifest,
    manifest_path: &Path,
) -> Result<(), String> {
    if !manifest_hashes_required(manifest) {
        return Ok(());
    }
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

fn validate_import_asset_manifest_path_impl(
    manifest_path: &str,
    runtime_models_root: &Path,
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
    if file_name != ASSET_MANIFEST_FILE_NAME {
        return Err(err(
            invalid_file_name_code,
            "仅支持导入 resolved/<asset-id>/asset.manifest.json",
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

    ensure_resolved_manifest_location(
        canonical_manifest.as_path(),
        canonical_root.as_path(),
        invalid_file_name_code,
    )?;

    Ok(canonical_manifest)
}

pub(crate) fn validate_import_asset_manifest_path(
    manifest_path: &str,
    runtime_models_root: &Path,
) -> Result<PathBuf, String> {
    validate_import_asset_manifest_path_impl(
        manifest_path,
        runtime_models_root,
        "LOCAL_AI_IMPORT_ASSET_MANIFEST_FILE_NAME_INVALID",
    )
}

#[cfg(test)]
pub(crate) fn parse_and_validate_manifest(path: &Path) -> Result<ImportedAssetManifest, String> {
    parse_and_validate_asset_manifest(path)
}

pub(crate) fn parse_and_validate_asset_manifest(
    path: &Path,
) -> Result<ImportedAssetManifest, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_READ_FAILED",
            format!("读取 artifact manifest 失败 ({}): {error}", path.display()),
        )
    })?;
    let manifest = serde_json::from_str::<ImportedAssetManifest>(&raw).map_err(|error| {
        err(
            "LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_PARSE_FAILED",
            format!("解析 artifact manifest JSON 失败: {error}"),
        )
    })?;
    assert_required_manifest_fields(&manifest)?;
    assert_manifest_hashes(&manifest, path)?;
    Ok(manifest)
}
