use super::*;

pub(super) fn select_imported_live2d_adapter_manifest(
    account_id: &str,
    scope: &LocalAgentScope,
    local_asset_id: &str,
    manifest_ref: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    if config.modules.avatar_asset.backend_kind != AgentCenterAvatarBackendKind::Live2d
        || config.modules.avatar_asset.local_avatar_asset_ref.as_deref() != Some(local_asset_id)
    {
        return Err(
            "external Live2D adapter manifest requires matching runtime-projected Live2D asset evidence".to_string(),
        );
    }
    config.modules.avatar_asset.live2d_adapter_manifest_source =
        AgentCenterLive2dAdapterManifestSource::ExternalSidecarManifest;
    config.modules.avatar_asset.live2d_adapter_manifest_ref = Some(manifest_ref.to_string());
    config.modules.avatar_asset.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
        source: AgentCenterAvatarConfigProvenanceSource::ImportValidation,
        evidence_ref: manifest_ref.to_string(),
    };
    desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
        config,
    })?;
    Ok(())
}

pub(super) fn select_imported_background(
    account_id: &str,
    scope: &LocalAgentScope,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    config.modules.appearance.background_asset_id = Some(background_asset_id.to_string());
    desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
        config,
    })?;
    Ok(())
}

pub(super) fn clear_selected_background(
    account_id: &str,
    scope: &LocalAgentScope,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    if config.modules.appearance.background_asset_id.as_deref() == Some(background_asset_id) {
        config.modules.appearance.background_asset_id = None;
        desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        })?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_background_import(
    payload: DesktopAgentCenterBackgroundImportPayload,
) -> Result<DesktopAgentCenterBackgroundImportResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_background_import", move || {
        desktop_agent_center_background_import_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_background_import_blocking(
    payload: DesktopAgentCenterBackgroundImportPayload,
) -> Result<DesktopAgentCenterBackgroundImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve background source ({}): {error}",
            source_path.display()
        )
    })?;
    let metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("failed to read background source metadata: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("background source path must not be a symlink".to_string());
    }
    if !metadata.is_file() {
        return Err("background source must be an image file".to_string());
    }
    let mime = background_mime_for_path(&source)?;
    let source_bytes = fs::read(&source).map_err(|error| {
        format!(
            "failed to read background source ({}): {error}",
            source.display()
        )
    })?;
    let bytes = u64::try_from(source_bytes.len()).unwrap_or(u64::MAX);
    if bytes == 0 || bytes > MAX_BACKGROUND_BYTES {
        return Err("background source is outside the fixed byte cap".to_string());
    }
    let (pixel_width, pixel_height) = background_dimensions(&source_bytes, &mime)?;
    let sha256 = {
        let mut hasher = Sha256::new();
        hasher.update(&source_bytes);
        format!("{:x}", hasher.finalize())
    };
    let background_asset_id = format!("bg_{}", &sha256[..12]);
    validate_background_id(&background_asset_id, "backgroundAssetId")?;
    let final_dir = background_dir(&account_id, &scope.local_agent_ref, &background_asset_id)?;
    let selected = payload.select.unwrap_or(true);

    if final_dir.exists() {
        let validation = validate_background_manifest(&final_dir, &background_asset_id);
        write_background_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterBackgroundValidationStatus::Valid {
            return Err(format!(
                "background id collision exists but is not valid: {background_asset_id}"
            ));
        }
        if selected {
            select_imported_background(&account_id, &scope, &background_asset_id)?;
        }
        let _ = record_resource_operation(
            &account_id,
            &scope.local_agent_ref,
            "background_import_reuse",
            "background",
            &background_asset_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(DesktopAgentCenterBackgroundImportResult {
            background_asset_id,
            selected,
            validation,
        });
    }

    let staging_dir = agent_center_dir(&account_id, &scope.local_agent_ref)?
        .join("modules")
        .join("appearance")
        .join("staging")
        .join(format!(
            "{}_{}",
            background_asset_id,
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
    remove_dir_if_exists(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|error| {
        format!(
            "failed to create background staging directory ({}): {error}",
            staging_dir.display()
        )
    })?;

    let import_result = (|| {
        let extension = extension_for(&source.to_string_lossy());
        let image_file = format!("image.{extension}");
        fs::write(staging_dir.join(&image_file), &source_bytes).map_err(|error| {
            format!(
                "failed to copy background image into staging ({}): {error}",
                staging_dir.display()
            )
        })?;
        let display_name = safe_display_name(payload.display_name, &source)?;
        let manifest = BackgroundManifest {
            manifest_version: 1,
            background_asset_id: background_asset_id.clone(),
            display_name,
            image_file,
            mime,
            bytes,
            pixel_width,
            pixel_height,
            limits: BackgroundManifestLimits {
                max_bytes: MAX_BACKGROUND_BYTES,
                max_pixel_width: MAX_BACKGROUND_PIXELS,
                max_pixel_height: MAX_BACKGROUND_PIXELS,
            },
            sha256,
            imported_at: checked_at(),
            source_label: source_label_for(&source),
        };
        write_json_pretty(&staging_dir.join(MANIFEST_FILE_NAME), &manifest)?;
        let staging_validation = validate_background_manifest(&staging_dir, &background_asset_id);
        if staging_validation.status != AgentCenterBackgroundValidationStatus::Valid {
            return Err(format!(
                "staged background failed validation: {:?}",
                staging_validation.errors
            ));
        }
        let parent = final_dir
            .parent()
            .ok_or_else(|| "background final path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create background final directory ({}): {error}",
                parent.display()
            )
        })?;
        fs::rename(&staging_dir, &final_dir).map_err(|error| {
            format!(
                "failed to finalize background import ({} -> {}): {error}",
                staging_dir.display(),
                final_dir.display()
            )
        })?;
        let validation = validate_background_manifest(&final_dir, &background_asset_id);
        write_background_validation_sidecar(&final_dir, &validation)?;
        if validation.status != AgentCenterBackgroundValidationStatus::Valid {
            return Err(format!(
                "final background failed validation: {:?}",
                validation.errors
            ));
        }
        Ok::<_, String>(validation)
    })();

    let validation = match import_result {
        Ok(validation) => validation,
        Err(error) => {
            remove_dir_if_exists(&staging_dir);
            if final_dir.exists() {
                let validation = validate_background_manifest(&final_dir, &background_asset_id);
                if validation.status != AgentCenterBackgroundValidationStatus::Valid {
                    remove_dir_if_exists(&final_dir);
                }
            }
            return Err(error);
        }
    };

    if selected {
        select_imported_background(&account_id, &scope, &background_asset_id)?;
    }
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "background_import",
        "background",
        &background_asset_id,
        "completed",
        "user_imported",
    )?;

    Ok(DesktopAgentCenterBackgroundImportResult {
        background_asset_id,
        selected,
        validation,
    })
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_live2d_adapter_manifest_import(
    payload: DesktopAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<DesktopAgentCenterLive2dAdapterManifestImportResult, String> {
    run_agent_center_resource_blocking(
        "desktop_agent_center_live2d_adapter_manifest_import",
        move || desktop_agent_center_live2d_adapter_manifest_import_blocking(payload),
    )
    .await
}

pub(crate) fn desktop_agent_center_live2d_adapter_manifest_import_blocking(
    payload: DesktopAgentCenterLive2dAdapterManifestImportPayload,
) -> Result<DesktopAgentCenterLive2dAdapterManifestImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
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
