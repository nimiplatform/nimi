use super::*;

pub(crate) fn standard_agent_center_live2d_adapter_manifest_import_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterLive2dAdapterManifestImportPayload,
) -> AgentCenterHostResult<StandardAgentCenterLive2dAdapterManifestImportResult> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")
        .map_err(AgentCenterHostError::InvalidPayload)?;
    validate_local_agent_host_scope(&payload.host_scope)
        .map_err(AgentCenterHostError::InvalidPayload)?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.runtime_source_ref,
        &payload.local_agent_ref,
    )
    .map_err(AgentCenterHostError::InvalidPayload)?;
    validate_local_asset_id(&payload.avatar_asset_ref, "avatarAssetRef")
        .map_err(AgentCenterHostError::InvalidPayload)?;
    if !payload.avatar_asset_ref.starts_with("live2d_") {
        return Err(AgentCenterHostError::InvalidPayload(
            "avatarAssetRef must reference a Live2D asset".to_string(),
        ));
    }
    let avatar_dir = avatar_asset_dir(
        roots,
        &account_id,
        &scope.local_agent_ref,
        "live2d",
        &payload.avatar_asset_ref,
    )
    .map_err(AgentCenterHostError::InvalidPath)?;
    if !managed_custody_directory_exists(roots, &avatar_dir)
        .map_err(AgentCenterHostError::InvalidPath)?
    {
        return Err(AgentCenterHostError::NotFound(format!(
            "Avatar asset was not found: {}",
            payload.avatar_asset_ref
        )));
    }
    let avatar_validation = validate_avatar_asset_manifest(&avatar_dir, &payload.avatar_asset_ref);
    if avatar_validation.status != StandardAgentCenterAvatarAssetValidationStatus::Valid {
        return Err(AgentCenterHostError::InvalidPayload(format!(
            "Avatar asset failed validation before Live2D adapter import: {:?}",
            avatar_validation.status
        )));
    }
    let source_path = PathBuf::from(&payload.source_path);
    let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
        AgentCenterHostError::InvalidPath(format!(
            "failed to read Live2D adapter manifest metadata ({}): {error}",
            source_path.display()
        ))
    })?;
    if metadata.file_type().is_symlink() {
        return Err(AgentCenterHostError::InvalidPath(
            "Live2D adapter manifest source path must not be a symlink".to_string(),
        ));
    }
    let source = fs::canonicalize(&source_path).map_err(|error| {
        AgentCenterHostError::InvalidPath(format!(
            "failed to resolve Live2D adapter manifest source ({}): {error}",
            source_path.display()
        ))
    })?;
    require_file_dialog_selected_source(&source, "agent_center_live2d_adapter_import")
        .map_err(AgentCenterHostError::StandardEnvelope)?;
    if !metadata.is_file() || extension_for(&source.to_string_lossy()) != "json" {
        return Err(AgentCenterHostError::InvalidPayload(
            "Live2D adapter manifest source must be a .json file".to_string(),
        ));
    }
    let bytes = metadata.len();
    if bytes == 0 || bytes > MAX_LIVE2D_ADAPTER_MANIFEST_BYTES {
        return Err(AgentCenterHostError::InvalidPayload(
            "Live2D adapter manifest is outside the fixed byte cap".to_string(),
        ));
    }
    let raw = fs::read(&source).map_err(|error| {
        AgentCenterHostError::HostInternal(format!(
            "failed to read Live2D adapter manifest source ({}): {error}",
            source.display()
        ))
    })?;
    let value: serde_json::Value = serde_json::from_slice(&raw).map_err(|error| {
        AgentCenterHostError::InvalidPayload(format!(
            "Live2D adapter manifest JSON is invalid: {error}"
        ))
    })?;
    let object = value.as_object().ok_or_else(|| {
        AgentCenterHostError::InvalidPayload(
            "Live2D adapter manifest must be a JSON object".to_string(),
        )
    })?;
    if object
        .get("manifest_kind")
        .and_then(serde_json::Value::as_str)
        != Some("nimi.avatar.live2d.adapter")
    {
        return Err(AgentCenterHostError::InvalidPayload(
            "Live2D adapter manifest_kind must be nimi.avatar.live2d.adapter".to_string(),
        ));
    }
    if object
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err(AgentCenterHostError::InvalidPayload(
            "Live2D adapter manifest schema_version must be 1".to_string(),
        ));
    }

    let mut hasher = Sha256::new();
    hasher.update(&raw);
    let sha256 = format!("{:x}", hasher.finalize());
    let manifest_ref = format!("live2d_adapter_{}", &sha256[..12]);
    validate_live2d_adapter_manifest_ref(&manifest_ref, "live2dAdapterManifestRef")
        .map_err(AgentCenterHostError::InvalidPayload)?;
    let final_dir = live2d_adapter_manifest_dir(
        roots,
        &account_id,
        &scope.local_agent_ref,
        &payload.avatar_asset_ref,
        &manifest_ref,
    )
    .map_err(AgentCenterHostError::InvalidPath)?;
    let new_custody = Live2dAdapterManifestCustody {
        custody_version: 1,
        manifest_ref: manifest_ref.clone(),
        local_asset_id: payload.avatar_asset_ref.clone(),
        manifest_kind: "nimi.avatar.live2d.adapter".to_string(),
        schema_version: 1,
        sha256: sha256.clone(),
        bytes,
        imported_at: checked_at(),
        source_label: source_label_for(&source),
    };
    let final_exists = managed_custody_directory_exists(roots, &final_dir)
        .map_err(AgentCenterHostError::InvalidPath)?;
    let custody = if final_exists {
        validate_live2d_adapter_custody(&final_dir, &raw, &new_custody)?
    } else {
        let adapter_root = final_dir.parent().and_then(Path::parent).ok_or_else(|| {
            AgentCenterHostError::InvalidPath(
                "Live2D adapter custody root has no parent".to_string(),
            )
        })?;
        let staging_dir = adapter_root.join("staging").join(format!(
            "{}_{}_{}",
            payload.avatar_asset_ref,
            manifest_ref,
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        match managed_custody_directory_exists(roots, &staging_dir) {
            Ok(true) => remove_dir_if_exists(&staging_dir),
            Ok(false) => {}
            Err(error) => return Err(AgentCenterHostError::InvalidPath(error)),
        }
        fs::create_dir_all(&staging_dir).map_err(|error| {
            AgentCenterHostError::HostInternal(format!(
                "failed to create Live2D adapter staging directory ({}): {error}",
                staging_dir.display()
            ))
        })?;
        if !managed_custody_directory_exists(roots, &staging_dir)
            .map_err(AgentCenterHostError::InvalidPath)?
        {
            return Err(AgentCenterHostError::InvalidPath(
                "Live2D adapter staging directory was not created".to_string(),
            ));
        }
        let mut finalized = false;
        let admission = (|| -> AgentCenterHostResult<Live2dAdapterManifestCustody> {
            fs::write(staging_dir.join(LIVE2D_ADAPTER_FILE_NAME), &raw).map_err(|error| {
                AgentCenterHostError::HostInternal(format!(
                    "failed to write Live2D adapter staging manifest ({}): {error}",
                    staging_dir.display()
                ))
            })?;
            write_json_pretty(
                &staging_dir.join(LIVE2D_ADAPTER_CUSTODY_FILE_NAME),
                &new_custody,
            )
            .map_err(AgentCenterHostError::HostInternal)?;
            validate_live2d_adapter_custody(&staging_dir, &raw, &new_custody)?;
            let parent = final_dir.parent().ok_or_else(|| {
                AgentCenterHostError::InvalidPath(
                    "Live2D adapter final directory has no parent".to_string(),
                )
            })?;
            let _ = managed_custody_directory_exists(roots, parent)
                .map_err(AgentCenterHostError::InvalidPath)?;
            fs::create_dir_all(parent).map_err(|error| {
                AgentCenterHostError::HostInternal(format!(
                    "failed to create Live2D adapter asset custody directory ({}): {error}",
                    parent.display()
                ))
            })?;
            if !managed_custody_directory_exists(roots, parent)
                .map_err(AgentCenterHostError::InvalidPath)?
            {
                return Err(AgentCenterHostError::InvalidPath(
                    "Live2D adapter asset custody directory was not created".to_string(),
                ));
            }
            fs::rename(&staging_dir, &final_dir).map_err(|error| {
                AgentCenterHostError::HostInternal(format!(
                    "failed to finalize Live2D adapter custody ({}): {error}",
                    final_dir.display()
                ))
            })?;
            finalized = true;
            validate_live2d_adapter_custody(&final_dir, &raw, &new_custody)
        })();
        if admission.is_err() {
            remove_dir_if_exists(&staging_dir);
            if finalized {
                remove_dir_if_exists(&final_dir);
            }
        }
        admission?
    };

    let _ = record_resource_operation(
        roots,
        &account_id,
        &scope.local_agent_ref,
        "live2d_adapter_manifest_import",
        "avatar_asset",
        &manifest_ref,
        "completed",
        "user_imported",
    )
    .map_err(AgentCenterHostError::HostInternal)?;

    Ok(StandardAgentCenterLive2dAdapterManifestImportResult {
        manifest_ref,
        local_asset_id: payload.avatar_asset_ref,
        sha256,
        bytes,
        imported_at: custody.imported_at,
    })
}

fn validate_live2d_adapter_custody(
    dir: &Path,
    source_bytes: &[u8],
    expected: &Live2dAdapterManifestCustody,
) -> AgentCenterHostResult<Live2dAdapterManifestCustody> {
    let metadata = fs::symlink_metadata(dir).map_err(|error| {
        AgentCenterHostError::InvalidPath(format!(
            "failed to inspect Live2D adapter custody directory ({}): {error}",
            dir.display()
        ))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AgentCenterHostError::InvalidPath(
            "Live2D adapter custody must be a real directory".to_string(),
        ));
    }
    let mut entries = fs::read_dir(dir)
        .map_err(|error| {
            AgentCenterHostError::HostInternal(format!(
                "failed to read Live2D adapter custody directory ({}): {error}",
                dir.display()
            ))
        })?
        .map(|entry| entry.map(|value| value.file_name()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AgentCenterHostError::HostInternal(error.to_string()))?;
    entries.sort();
    if entries
        != vec![
            std::ffi::OsString::from(LIVE2D_ADAPTER_CUSTODY_FILE_NAME),
            std::ffi::OsString::from(LIVE2D_ADAPTER_FILE_NAME),
        ]
    {
        return Err(AgentCenterHostError::InvalidPayload(
            "Live2D adapter custody must contain exactly the manifest and custody record"
                .to_string(),
        ));
    }
    for name in [LIVE2D_ADAPTER_FILE_NAME, LIVE2D_ADAPTER_CUSTODY_FILE_NAME] {
        let path = dir.join(name);
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            AgentCenterHostError::InvalidPath(format!(
                "failed to inspect Live2D adapter custody file ({}): {error}",
                path.display()
            ))
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(AgentCenterHostError::InvalidPath(
                "Live2D adapter custody files must be real files".to_string(),
            ));
        }
    }
    let actual_manifest = fs::read(dir.join(LIVE2D_ADAPTER_FILE_NAME)).map_err(|error| {
        AgentCenterHostError::HostInternal(format!(
            "failed to read Live2D adapter custody manifest: {error}"
        ))
    })?;
    let custody: Live2dAdapterManifestCustody = serde_json::from_slice(
        &fs::read(dir.join(LIVE2D_ADAPTER_CUSTODY_FILE_NAME)).map_err(|error| {
            AgentCenterHostError::HostInternal(format!(
                "failed to read Live2D adapter custody record: {error}"
            ))
        })?,
    )
    .map_err(|error| {
        AgentCenterHostError::InvalidPayload(format!(
            "Live2D adapter custody record is invalid: {error}"
        ))
    })?;
    let authority_matches = custody.custody_version == expected.custody_version
        && custody.manifest_ref == expected.manifest_ref
        && custody.local_asset_id == expected.local_asset_id
        && custody.manifest_kind == expected.manifest_kind
        && custody.schema_version == expected.schema_version
        && custody.sha256 == expected.sha256
        && custody.bytes == expected.bytes;
    if actual_manifest != source_bytes
        || !authority_matches
        || validate_utc_timestamp(&custody.imported_at, "imported_at").is_err()
        || validate_display_text(&custody.source_label, "source_label", 120).is_err()
        || Path::new(&custody.source_label).is_absolute()
    {
        return Err(AgentCenterHostError::InvalidPayload(
            "Live2D adapter custody does not match exact content and asset scope".to_string(),
        ));
    }
    Ok(custody)
}
