use super::*;

pub(super) fn select_imported_background(
    account_id: &str,
    scope: &LocalAgentScope,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    config.modules.appearance.background_asset_id = Some(background_asset_id.to_string());
    desktop_agent_center_config_put_blocking(
        account_id,
        DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        },
    )?;
    Ok(())
}

pub(super) fn clear_selected_background(
    account_id: &str,
    scope: &LocalAgentScope,
    background_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            realm_agent_id: scope.realm_agent_id.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    if config.modules.appearance.background_asset_id.as_deref() == Some(background_asset_id) {
        config.modules.appearance.background_asset_id = None;
        desktop_agent_center_config_put_blocking(
            account_id,
            DesktopAgentCenterConfigPutPayload {
                account_id: account_id.to_string(),
                owner_user_id: scope.owner_user_id.clone(),
                realm_agent_id: scope.realm_agent_id.clone(),
                local_agent_ref: scope.local_agent_ref.clone(),
                config,
            },
        )?;
    }
    Ok(())
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
