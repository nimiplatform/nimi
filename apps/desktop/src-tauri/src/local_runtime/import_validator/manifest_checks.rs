use std::path::{Path, PathBuf};

use super::{err, ASSET_MANIFEST_FILE_NAME};

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
