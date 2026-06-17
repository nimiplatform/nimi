use super::*;

pub(crate) fn desktop_agent_center_live2d_adapter_manifest_import_blocking(
    payload: DesktopAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<DesktopAgentCenterLive2dAdapterManifestImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.runtime_source_ref,
        &payload.local_agent_ref,
    )?;
    validate_local_asset_id(&payload.local_asset_id, "localAssetId")?;
    if !payload.local_asset_id.starts_with("live2d_") {
        return Err("localAssetId must reference a Live2D asset".to_string());
    }
    let source_path = PathBuf::from(&payload.source_path);
    let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
        format!(
            "failed to read Live2D adapter manifest metadata ({}): {error}",
            source_path.display()
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err("Live2D adapter manifest source path must not be a symlink".to_string());
    }
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve Live2D adapter manifest source ({}): {error}",
            source_path.display()
        )
    })?;
    if !metadata.is_file() || extension_for(&source.to_string_lossy()) != "json" {
        return Err("Live2D adapter manifest source must be a .json file".to_string());
    }
    let bytes = metadata.len();
    if bytes == 0 || bytes > MAX_LIVE2D_ADAPTER_MANIFEST_BYTES {
        return Err("Live2D adapter manifest is outside the fixed byte cap".to_string());
    }
    let raw = fs::read(&source).map_err(|error| {
        format!(
            "failed to read Live2D adapter manifest source ({}): {error}",
            source.display()
        )
    })?;
    let value: serde_json::Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Live2D adapter manifest JSON is invalid: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Live2D adapter manifest must be a JSON object".to_string())?;
    if object
        .get("manifest_kind")
        .and_then(serde_json::Value::as_str)
        != Some("nimi.avatar.live2d.adapter")
    {
        return Err("Live2D adapter manifest_kind must be nimi.avatar.live2d.adapter".to_string());
    }
    if object
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err("Live2D adapter manifest schema_version must be 1".to_string());
    }

    let mut hasher = Sha256::new();
    hasher.update(&raw);
    let sha256 = format!("{:x}", hasher.finalize());
    let manifest_ref = format!("live2d_adapter_{}", &sha256[..12]);
    validate_live2d_adapter_manifest_ref(&manifest_ref, "live2dAdapterManifestRef")?;
    let final_dir =
        live2d_adapter_manifest_dir(&account_id, &scope.local_agent_ref, &manifest_ref)?;
    let selected = payload.select.unwrap_or(true);
    let imported_at = checked_at();

    if !final_dir.exists() {
        fs::create_dir_all(&final_dir).map_err(|error| {
            format!(
                "failed to create Live2D adapter manifest directory ({}): {error}",
                final_dir.display()
            )
        })?;
        fs::write(final_dir.join(LIVE2D_ADAPTER_FILE_NAME), &raw).map_err(|error| {
            format!(
                "failed to write Live2D adapter manifest custody file ({}): {error}",
                final_dir.display()
            )
        })?;
    }
    let custody = Live2dAdapterManifestCustody {
        custody_version: 1,
        manifest_ref: manifest_ref.clone(),
        local_asset_id: payload.local_asset_id.clone(),
        manifest_kind: "nimi.avatar.live2d.adapter".to_string(),
        schema_version: 1,
        sha256: sha256.clone(),
        bytes,
        imported_at: imported_at.clone(),
        source_label: source_label_for(&source),
    };
    write_json_pretty(&final_dir.join(LIVE2D_ADAPTER_CUSTODY_FILE_NAME), &custody)?;

    if selected {
        select_imported_live2d_adapter_manifest(
            &account_id,
            &scope,
            &payload.local_asset_id,
            &manifest_ref,
        )?;
    }
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "live2d_adapter_manifest_import",
        "avatar_asset",
        &manifest_ref,
        "completed",
        "user_imported",
    )?;

    Ok(DesktopAgentCenterLive2dAdapterManifestImportResult {
        manifest_ref,
        local_asset_id: payload.local_asset_id,
        selected,
        sha256,
        bytes,
        imported_at,
    })
}
