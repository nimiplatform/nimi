use super::*;

fn avatar_asset_kind_prefix(kind: AgentCenterAvatarBackendKind) -> Result<&'static str, String> {
    match kind {
        AgentCenterAvatarBackendKind::Live2d => Ok("live2d"),
        AgentCenterAvatarBackendKind::Vrm => Ok("vrm"),
        AgentCenterAvatarBackendKind::Future => {
            Err("future avatar backend cannot import a local package".to_string())
        }
    }
}

fn avatar_asset_kind_from_id(local_asset_id: &str) -> Result<AgentCenterAvatarBackendKind, String> {
    validate_local_asset_id(local_asset_id, "localAssetId")?;
    if local_asset_id.starts_with("live2d_") {
        return Ok(AgentCenterAvatarBackendKind::Live2d);
    }
    if local_asset_id.starts_with("vrm_") {
        return Ok(AgentCenterAvatarBackendKind::Vrm);
    }
    Err("localAssetId must start with live2d_ or vrm_".to_string())
}

fn capability_profile_ref_for_asset(
    kind: AgentCenterAvatarBackendKind,
    local_asset_id: &str,
) -> Result<String, String> {
    let prefix = avatar_asset_kind_prefix(kind)?;
    let Some(suffix) = local_asset_id.strip_prefix(&format!("{prefix}_")) else {
        return Err("localAssetId prefix must match backend kind".to_string());
    };
    let profile_ref = format!("avatar_profile_{prefix}_{suffix}");
    validate_normalized_id(&profile_ref, "backendCapabilityProfileRef")
}

fn read_avatar_asset_manifest(asset_dir: &Path) -> Result<AvatarAssetManifest, String> {
    let manifest_path = asset_dir.join(MANIFEST_FILE_NAME);
    let raw = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "failed to read avatar asset manifest ({}): {error}",
            manifest_path.display()
        )
    })?;
    serde_json::from_str::<AvatarAssetManifest>(&raw).map_err(|error| {
        format!(
            "failed to parse avatar asset manifest ({}): {error}",
            manifest_path.display()
        )
    })
}

fn avatar_asset_record_from_dir(
    account_id: &str,
    scope: &LocalAgentScope,
    kind: AgentCenterAvatarBackendKind,
    local_asset_id: &str,
    selected_local_asset_id: Option<&str>,
) -> Result<DesktopAgentCenterAvatarAssetRecord, String> {
    let asset_dir = avatar_asset_dir(account_id, &scope.local_agent_ref, kind, local_asset_id)?;
    let profile_ref = capability_profile_ref_for_asset(kind, local_asset_id)?;
    let validation = validate_avatar_asset_manifest(&asset_dir, local_asset_id, kind, &profile_ref);
    write_avatar_asset_validation_sidecar(&asset_dir, &validation)?;
    let manifest = read_avatar_asset_manifest(&asset_dir)?;
    Ok(DesktopAgentCenterAvatarAssetRecord {
        local_asset_id: local_asset_id.to_string(),
        backend_kind: kind,
        display_name: manifest.display_name,
        source_label: manifest.import.source_label,
        backend_capability_profile_ref: profile_ref,
        asset_bytes: manifest.files.iter().map(|file| file.bytes).sum(),
        file_count: manifest.files.len(),
        imported_at: manifest.import.imported_at,
        selected: selected_local_asset_id == Some(local_asset_id),
        validation,
    })
}

fn select_imported_avatar_asset(
    account_id: &str,
    scope: &LocalAgentScope,
    kind: AgentCenterAvatarBackendKind,
    local_asset_id: &str,
    capability_profile_ref: &str,
    evidence_ref: &str,
    embedded_live2d_adapter_manifest: bool,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    config.modules.avatar_asset.local_avatar_asset_ref = Some(local_asset_id.to_string());
    config.modules.avatar_asset.backend_kind = kind;
    config.modules.avatar_asset.backend_capability_profile_ref =
        Some(capability_profile_ref.to_string());
    config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
    config.modules.avatar_asset.live2d_adapter_manifest_source =
        if kind == AgentCenterAvatarBackendKind::Live2d && embedded_live2d_adapter_manifest {
            AgentCenterLive2dAdapterManifestSource::EmbeddedCreatorManifest
        } else {
            AgentCenterLive2dAdapterManifestSource::None
        };
    config.modules.avatar_asset.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
        source: AgentCenterAvatarConfigProvenanceSource::ImportValidation,
        evidence_ref: evidence_ref.to_string(),
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

fn select_existing_avatar_asset(
    account_id: &str,
    scope: &LocalAgentScope,
    local_asset_id: &str,
) -> Result<AgentCenterLocalConfig, String> {
    let kind = avatar_asset_kind_from_id(local_asset_id)?;
    let profile_ref = capability_profile_ref_for_asset(kind, local_asset_id)?;
    let asset_dir = avatar_asset_dir(account_id, &scope.local_agent_ref, kind, local_asset_id)?;
    if !asset_dir.exists() {
        return Err("selected local Avatar asset directory is missing".to_string());
    }
    let validation = validate_avatar_asset_manifest(&asset_dir, local_asset_id, kind, &profile_ref);
    write_avatar_asset_validation_sidecar(&asset_dir, &validation)?;
    if validation.status != AgentCenterAvatarAssetValidationStatus::Valid {
        return Err(format!(
            "selected local Avatar asset is not valid: {:?}",
            validation.status
        ));
    }
    let manifest = read_avatar_asset_manifest(&asset_dir)?;
    let embedded_live2d_adapter_manifest = kind == AgentCenterAvatarBackendKind::Live2d
        && manifest
            .files
            .iter()
            .any(|file| file.path == "files/nimi/live2d-adapter.json");
    select_imported_avatar_asset(
        account_id,
        scope,
        kind,
        local_asset_id,
        &profile_ref,
        local_asset_id,
        embedded_live2d_adapter_manifest,
    )?;
    record_resource_operation(
        account_id,
        &scope.local_agent_ref,
        "avatar_asset_select",
        "avatar_asset",
        local_asset_id,
        "completed",
        "user_selected_existing",
    )?;
    desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })
}

fn clear_selected_avatar_asset(
    account_id: &str,
    scope: &LocalAgentScope,
    local_asset_id: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    if config
        .modules
        .avatar_asset
        .local_avatar_asset_ref
        .as_deref()
        == Some(local_asset_id)
    {
        config.modules.avatar_asset.local_avatar_asset_ref = None;
        config.modules.avatar_asset.backend_capability_profile_ref = None;
        config.modules.avatar_asset.live2d_adapter_manifest_source =
            AgentCenterLive2dAdapterManifestSource::None;
        config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
        config.modules.avatar_asset.updated_at =
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
            source: AgentCenterAvatarConfigProvenanceSource::UserSelection,
            evidence_ref: "agent-center-avatar-asset-cleared".to_string(),
        };
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
pub(crate) async fn desktop_agent_center_avatar_asset_validate(
    payload: DesktopAgentCenterAvatarAssetValidatePayload,
) -> Result<AgentCenterAvatarAssetValidationResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_validate", move || {
        desktop_agent_center_avatar_asset_validate_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_validate_blocking(
    payload: DesktopAgentCenterAvatarAssetValidatePayload,
) -> Result<AgentCenterAvatarAssetValidationResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.clone(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    let avatar = config.modules.avatar_asset;
    let local_asset_id = match avatar.local_avatar_asset_ref {
        Some(value) => value,
        None => {
            return Ok(avatar_asset_validation_result(
                None,
                Some(avatar.backend_kind),
                avatar.backend_capability_profile_ref,
                AgentCenterAvatarAssetValidationStatus::SelectionMissing,
                vec![error(
                    "selection_missing",
                    "Select a local Avatar asset before launch.",
                    Some("modules.avatar_asset.local_avatar_asset_ref".to_string()),
                )],
                vec![],
            ));
        }
    };
    validate_local_asset_id(&local_asset_id, "localAssetId")?;
    let profile_ref = match avatar.backend_capability_profile_ref {
        Some(value) => value,
        None => {
            return Ok(avatar_asset_validation_result(
                Some(local_asset_id),
                Some(avatar.backend_kind),
                None,
                AgentCenterAvatarAssetValidationStatus::SelectionMissing,
                vec![error(
                    "selection_missing",
                    "Selected Avatar asset is missing backend capability evidence.",
                    Some("modules.avatar_asset.backend_capability_profile_ref".to_string()),
                )],
                vec![],
            ));
        }
    };
    validate_normalized_id(&profile_ref, "backendCapabilityProfileRef")?;
    if avatar.backend_kind == AgentCenterAvatarBackendKind::Future {
        return Ok(avatar_asset_validation_result(
            Some(local_asset_id),
            Some(avatar.backend_kind),
            Some(profile_ref),
            AgentCenterAvatarAssetValidationStatus::UnsupportedBackend,
            vec![error(
                "unsupported_backend",
                "Future Avatar backend cannot be launched from local assets yet.",
                Some("modules.avatar_asset.backend_kind".to_string()),
            )],
            vec![],
        ));
    }
    let asset_dir = avatar_asset_dir(
        &account_id,
        &scope.local_agent_ref,
        avatar.backend_kind,
        &local_asset_id,
    )?;
    if !asset_dir.exists() {
        return Ok(avatar_asset_validation_result(
            Some(local_asset_id),
            Some(avatar.backend_kind),
            Some(profile_ref),
            AgentCenterAvatarAssetValidationStatus::AssetMissing,
            vec![error(
                "avatar_asset_missing",
                "Selected local Avatar asset directory is missing.",
                Some(asset_dir.display().to_string()),
            )],
            vec![],
        ));
    }
    let result = validate_avatar_asset_manifest(
        &asset_dir,
        &local_asset_id,
        avatar.backend_kind,
        &profile_ref,
    );
    write_avatar_asset_validation_sidecar(&asset_dir, &result)?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_list(
    payload: DesktopAgentCenterConfigScopePayload,
) -> Result<DesktopAgentCenterAvatarAssetListResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_list", move || {
        desktop_agent_center_avatar_asset_list_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_list_blocking(
    payload: DesktopAgentCenterConfigScopePayload,
) -> Result<DesktopAgentCenterAvatarAssetListResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
        account_id: account_id.clone(),
        owner_user_id: scope.owner_user_id.clone(),
        realm_agent_id: scope.realm_agent_id.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
    })?;
    let selected_local_asset_id = config.modules.avatar_asset.local_avatar_asset_ref.clone();
    let packages_dir = agent_center_dir(&account_id, &scope.local_agent_ref)?
        .join("modules")
        .join("avatar_asset")
        .join("packages");
    let mut assets = Vec::new();
    for kind in [
        AgentCenterAvatarBackendKind::Live2d,
        AgentCenterAvatarBackendKind::Vrm,
    ] {
        let kind_segment = avatar_backend_kind_label(kind)?;
        let kind_dir = packages_dir.join(kind_segment);
        if !kind_dir.exists() {
            continue;
        }
        let entries = fs::read_dir(&kind_dir).map_err(|error| {
            format!(
                "failed to list local Avatar assets ({}): {error}",
                kind_dir.display()
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "failed to read local Avatar asset entry ({}): {error}",
                    kind_dir.display()
                )
            })?;
            let file_type = entry.file_type().map_err(|error| {
                format!(
                    "failed to inspect local Avatar asset entry ({}): {error}",
                    entry.path().display()
                )
            })?;
            if !file_type.is_dir() {
                continue;
            }
            let local_asset_id = entry.file_name().to_string_lossy().to_string();
            if validate_local_asset_id(&local_asset_id, "localAssetId").is_err()
                || !local_asset_id.starts_with(&format!("{kind_segment}_"))
            {
                continue;
            }
            let record = avatar_asset_record_from_dir(
                &account_id,
                &scope,
                kind,
                &local_asset_id,
                selected_local_asset_id.as_deref(),
            )?;
            assets.push(record);
        }
    }
    assets.sort_by(|left, right| {
        right
            .imported_at
            .cmp(&left.imported_at)
            .then_with(|| left.local_asset_id.cmp(&right.local_asset_id))
    });
    Ok(DesktopAgentCenterAvatarAssetListResult {
        selected_local_asset_id,
        assets,
    })
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_select(
    payload: DesktopAgentCenterAvatarAssetSelectPayload,
) -> Result<AgentCenterLocalConfig, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_select", move || {
        desktop_agent_center_avatar_asset_select_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_select_blocking(
    payload: DesktopAgentCenterAvatarAssetSelectPayload,
) -> Result<AgentCenterLocalConfig, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    select_existing_avatar_asset(&account_id, &scope, &payload.local_asset_id)
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_asset_pick_live2d_source(
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select Live2D model folder")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_center_avatar_asset_pick_vrm_source() -> Result<Option<String>, String>
{
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select VRM file")
        .add_filter("VRM", &["vrm"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_import(
    payload: DesktopAgentCenterAvatarAssetImportPayload,
) -> Result<DesktopAgentCenterAvatarAssetImportResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_import", move || {
        desktop_agent_center_avatar_asset_import_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_import_blocking(
    payload: DesktopAgentCenterAvatarAssetImportPayload,
) -> Result<DesktopAgentCenterAvatarAssetImportResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    let kind = payload.kind;
    let kind_label = avatar_backend_kind_label(kind)?;
    let source_path = PathBuf::from(&payload.source_path);
    let source = fs::canonicalize(&source_path).map_err(|error| {
        format!(
            "failed to resolve avatar asset source ({}): {error}",
            source_path.display()
        )
    })?;
    let (files, entry_file, asset_bytes) = collect_avatar_asset_files(kind, &source)?;
    let content_digest = avatar_asset_content_digest(&files);
    let prefix = avatar_asset_kind_prefix(kind)?;
    let local_asset_id = format!("{prefix}_{}", &content_digest[..12]);
    validate_local_asset_id(&local_asset_id, "localAssetId")?;
    let capability_profile_ref = format!("avatar_profile_{prefix}_{}", &content_digest[..12]);
    validate_normalized_id(&capability_profile_ref, "backendCapabilityProfileRef")?;
    let imported_at = checked_at();
    let selected = payload.select.unwrap_or(true);
    let display_name = safe_display_name(payload.display_name, &source)?;
    let embedded_live2d_adapter_manifest = kind == AgentCenterAvatarBackendKind::Live2d
        && files
            .iter()
            .any(|file| file.asset_path == "files/nimi/live2d-adapter.json");
    let generated_motion_supported = kind == AgentCenterAvatarBackendKind::Vrm
        && files
            .iter()
            .any(|file| file.asset_path.starts_with("files/vrm-motion-presets/"));
    let final_dir = avatar_asset_dir(&account_id, &scope.local_agent_ref, kind, &local_asset_id)?;

    if final_dir.exists() {
        if selected {
            select_imported_avatar_asset(
                &account_id,
                &scope,
                kind,
                &local_asset_id,
                &capability_profile_ref,
                &local_asset_id,
                embedded_live2d_adapter_manifest,
            )?;
        }
        let manifest_raw = fs::read(final_dir.join(MANIFEST_FILE_NAME))
            .map_err(|error| format!("failed to read existing avatar asset manifest: {error}"))?;
        let mut hasher = Sha256::new();
        hasher.update(&manifest_raw);
        let manifest_sha256 = format!("{:x}", hasher.finalize());
        let _ = record_resource_operation(
            &account_id,
            &scope.local_agent_ref,
            "avatar_asset_import_reuse",
            "avatar_asset",
            &local_asset_id,
            "completed",
            "content_already_imported",
        )?;
        return Ok(DesktopAgentCenterAvatarAssetImportResult {
            local_asset_id,
            backend_kind: kind,
            backend_capability_profile_ref: capability_profile_ref,
            selected,
            manifest_sha256,
            asset_bytes,
            file_count: files.len(),
            imported_at,
        });
    }

    let staging_dir = agent_center_dir(&account_id, &scope.local_agent_ref)?
        .join("modules")
        .join("avatar_asset")
        .join("staging")
        .join(format!(
            "{}_{}",
            local_asset_id,
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
    remove_dir_if_exists(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|error| {
        format!(
            "failed to create avatar asset staging directory ({}): {error}",
            staging_dir.display()
        )
    })?;

    let import_result = (|| {
        for file in &files {
            let target = staging_dir.join(&file.asset_path);
            let parent = target
                .parent()
                .ok_or_else(|| "avatar asset target path has no parent".to_string())?;
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create avatar asset file directory ({}): {error}",
                    parent.display()
                )
            })?;
            fs::copy(&file.source_path, &target).map_err(|error| {
                format!(
                    "failed to copy avatar asset file ({} -> {}): {error}",
                    file.source_path.display(),
                    target.display()
                )
            })?;
        }
        let manifest = AvatarAssetManifest {
            manifest_version: 1,
            asset_version: "1.0.0".to_string(),
            local_asset_id: local_asset_id.clone(),
            kind: kind_label.to_string(),
            loader_min_version: "1.0.0".to_string(),
            display_name,
            display_name_i18n: serde_json::Map::new(),
            entry_file: entry_file.clone(),
            required_files: vec![entry_file],
            content_digest: content_digest.clone(),
            files: files
                .iter()
                .map(|file| AvatarAssetManifestFile {
                    path: file.asset_path.clone(),
                    sha256: file.sha256.clone(),
                    bytes: file.bytes,
                    mime: file.mime.clone(),
                })
                .collect(),
            limits: AvatarAssetManifestLimits {
                max_manifest_bytes: MAX_AVATAR_ASSET_MANIFEST_BYTES,
                max_asset_bytes: MAX_AVATAR_ASSET_BYTES,
                max_file_bytes: MAX_AVATAR_ASSET_FILE_BYTES,
                max_file_count: MAX_AVATAR_ASSET_FILE_COUNT,
            },
            capabilities: serde_json::json!({
                "backend_kind": kind_label,
                "generated_motion_supported": generated_motion_supported,
                "embedded_live2d_adapter_manifest": embedded_live2d_adapter_manifest,
                "capability_profile_ref": capability_profile_ref,
            }),
            import: AvatarAssetManifestImport {
                imported_at: imported_at.clone(),
                source_label: source_label_for(&source),
                source_fingerprint: avatar_asset_source_fingerprint(&source, &content_digest),
            },
        };
        write_json_pretty(&staging_dir.join(MANIFEST_FILE_NAME), &manifest)?;
        let manifest_meta = fs::metadata(staging_dir.join(MANIFEST_FILE_NAME))
            .map_err(|error| format!("failed to inspect avatar asset manifest: {error}"))?;
        if manifest_meta.len() > MAX_AVATAR_ASSET_MANIFEST_BYTES {
            return Err("avatar asset manifest exceeds the fixed byte cap".to_string());
        }
        let profile = AvatarCapabilityProfile {
            schema_version: 1,
            profile_ref: capability_profile_ref.clone(),
            local_asset_id: local_asset_id.clone(),
            backend_kind: kind_label.to_string(),
            evidence_ref: local_asset_id.clone(),
            file_count: files.len(),
            asset_bytes,
            generated_motion_supported,
            embedded_live2d_adapter_manifest,
            imported_at: imported_at.clone(),
        };
        write_json_pretty(&staging_dir.join(CAPABILITY_PROFILE_FILE_NAME), &profile)?;
        let parent = final_dir
            .parent()
            .ok_or_else(|| "avatar asset final path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create avatar asset final directory ({}): {error}",
                parent.display()
            )
        })?;
        fs::rename(&staging_dir, &final_dir).map_err(|error| {
            format!(
                "failed to finalize avatar asset import ({} -> {}): {error}",
                staging_dir.display(),
                final_dir.display()
            )
        })?;
        Ok::<_, String>(())
    })();

    if let Err(error) = import_result {
        remove_dir_if_exists(&staging_dir);
        if final_dir.exists() {
            remove_dir_if_exists(&final_dir);
        }
        return Err(error);
    }

    if selected {
        select_imported_avatar_asset(
            &account_id,
            &scope,
            kind,
            &local_asset_id,
            &capability_profile_ref,
            &local_asset_id,
            embedded_live2d_adapter_manifest,
        )?;
    }
    let manifest_raw = fs::read(final_dir.join(MANIFEST_FILE_NAME))
        .map_err(|error| format!("failed to read avatar asset manifest: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&manifest_raw);
    let manifest_sha256 = format!("{:x}", hasher.finalize());
    let _ = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset_import",
        "avatar_asset",
        &local_asset_id,
        "completed",
        "user_imported",
    )?;
    Ok(DesktopAgentCenterAvatarAssetImportResult {
        local_asset_id,
        backend_kind: kind,
        backend_capability_profile_ref: capability_profile_ref,
        selected,
        manifest_sha256,
        asset_bytes,
        file_count: files.len(),
        imported_at,
    })
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_avatar_asset_remove(
    payload: DesktopAgentCenterAvatarAssetRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    run_agent_center_resource_blocking("desktop_agent_center_avatar_asset_remove", move || {
        desktop_agent_center_avatar_asset_remove_blocking(payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_avatar_asset_remove_blocking(
    payload: DesktopAgentCenterAvatarAssetRemovePayload,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.realm_agent_id,
        &payload.local_agent_ref,
    )?;
    validate_local_asset_id(&payload.local_asset_id, "localAssetId")?;
    let kind = if payload.local_asset_id.starts_with("live2d_") {
        AgentCenterAvatarBackendKind::Live2d
    } else {
        AgentCenterAvatarBackendKind::Vrm
    };
    clear_selected_avatar_asset(&account_id, &scope, &payload.local_asset_id)?;
    let source = avatar_asset_dir(
        &account_id,
        &scope.local_agent_ref,
        kind,
        &payload.local_asset_id,
    )?;
    let destination = quarantine_path(
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset",
        &payload.local_asset_id,
    )?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                &account_id,
                &scope.local_agent_ref,
                "avatar_asset_quarantine",
                "avatar_asset",
                &payload.local_asset_id,
                "failed",
                "user_removed",
            );
            return Err(error);
        }
    };
    let operation_id = record_resource_operation(
        &account_id,
        &scope.local_agent_ref,
        "avatar_asset_quarantine",
        "avatar_asset",
        &payload.local_asset_id,
        "completed",
        if quarantined {
            "user_removed"
        } else {
            "already_missing"
        },
    )?;
    Ok(DesktopAgentCenterLocalResourceRemoveResult {
        resource_kind: "avatar_asset".to_string(),
        resource_id: payload.local_asset_id,
        quarantined,
        operation_id,
        status: "completed".to_string(),
    })
}
