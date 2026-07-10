use super::*;

pub(super) fn validate_background_manifest(
    background_root: &Path,
    expected_background_asset_id: &str,
) -> StandardAgentCenterBackgroundValidationResult {
    let manifest_path = background_root.join(MANIFEST_FILE_NAME);
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return background_validation_result(
                expected_background_asset_id,
                StandardAgentCenterBackgroundValidationStatus::AssetMissing,
                vec![error(
                    "background_missing",
                    &format!("Background manifest is missing: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    let manifest = match serde_json::from_str::<BackgroundManifest>(&raw) {
        Ok(manifest) => manifest,
        Err(source) => {
            return background_validation_result(
                expected_background_asset_id,
                StandardAgentCenterBackgroundValidationStatus::InvalidManifest,
                vec![error(
                    "background_manifest_invalid",
                    &format!("Background manifest is malformed: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

    let mut errors = Vec::<StandardAgentCenterValidationIssue>::new();
    if manifest.manifest_version != 1 {
        errors.push(error(
            "background_manifest_invalid",
            "manifest_version must be 1.",
            Some("manifest_version".to_string()),
        ));
    }
    if manifest.background_asset_id != expected_background_asset_id {
        errors.push(error(
            "background_manifest_invalid",
            "background_asset_id must match the selected asset.",
            Some("background_asset_id".to_string()),
        ));
    }
    if let Err(message) =
        validate_background_id(&manifest.background_asset_id, "background_asset_id")
    {
        errors.push(error(
            "background_manifest_invalid",
            &message,
            Some("background_asset_id".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.display_name, "display_name", 80) {
        errors.push(issue);
    }
    if let Err(issue) = validate_display_text(&manifest.source_label, "source_label", 120) {
        errors.push(issue);
    }
    if Path::new(&manifest.source_label).is_absolute() {
        errors.push(error(
            "background_manifest_invalid",
            "source_label must not store an absolute path.",
            Some("source_label".to_string()),
        ));
    }
    if let Err(message) = validate_utc_timestamp(&manifest.imported_at, "imported_at") {
        errors.push(error(
            "background_manifest_invalid",
            &message,
            Some("imported_at".to_string()),
        ));
    }
    if !allowed_background_mime(&manifest.mime) {
        errors.push(error(
            "unsupported_mime",
            "Background MIME must be image/png, image/jpeg, or image/webp.",
            Some("mime".to_string()),
        ));
    }
    match background_mime_for_path(Path::new(&manifest.image_file)) {
        Ok(path_mime) if path_mime == manifest.mime => {}
        _ => errors.push(error(
            "unsupported_mime",
            "Background MIME must match the admitted image file extension.",
            Some(manifest.image_file.clone()),
        )),
    }
    if extension_for(&manifest.image_file) == "svg" {
        errors.push(error(
            "unsupported_mime",
            "SVG backgrounds are not admitted.",
            Some(manifest.image_file.clone()),
        ));
    }
    if !is_safe_relative_path(&manifest.image_file) {
        errors.push(error(
            "path_rejected",
            "image_file must be background-relative.",
            Some("image_file".to_string()),
        ));
    }
    if manifest.limits.max_bytes != MAX_BACKGROUND_BYTES
        || manifest.limits.max_pixel_width != MAX_BACKGROUND_PIXELS
        || manifest.limits.max_pixel_height != MAX_BACKGROUND_PIXELS
    {
        errors.push(error(
            "background_manifest_invalid",
            "limits must match the fixed background caps.",
            Some("limits".to_string()),
        ));
    }
    if manifest.bytes == 0 || manifest.bytes > MAX_BACKGROUND_BYTES {
        errors.push(error(
            "background_too_large",
            "Background image is outside the fixed byte cap.",
            Some("bytes".to_string()),
        ));
    }
    if manifest.pixel_width == 0
        || manifest.pixel_height == 0
        || manifest.pixel_width > MAX_BACKGROUND_PIXELS
        || manifest.pixel_height > MAX_BACKGROUND_PIXELS
    {
        errors.push(error(
            "background_pixels_rejected",
            "Background image dimensions are outside the fixed pixel cap.",
            Some("pixel_width".to_string()),
        ));
    }
    if !is_digest(&manifest.sha256) {
        errors.push(error(
            "background_manifest_invalid",
            "sha256 must be a lowercase sha256 digest.",
            Some("sha256".to_string()),
        ));
    }
    match resolve_under_root(background_root, &manifest.image_file) {
        Ok(path) => match fs::read(&path) {
            Ok(image_bytes) => {
                let actual_bytes = u64::try_from(image_bytes.len()).unwrap_or(u64::MAX);
                let mut hasher = Sha256::new();
                hasher.update(&image_bytes);
                let actual_sha256 = format!("{:x}", hasher.finalize());
                if actual_bytes != manifest.bytes {
                    errors.push(error(
                        "file_size_mismatch",
                        "Background image size differs from manifest.",
                        Some(manifest.image_file.clone()),
                    ));
                }
                if actual_sha256 != manifest.sha256 {
                    errors.push(error(
                        "content_digest_mismatch",
                        "Background image digest differs from manifest.",
                        Some(manifest.image_file.clone()),
                    ));
                }
                match background_dimensions(&image_bytes, &manifest.mime) {
                    Ok((width, height))
                        if width == manifest.pixel_width && height == manifest.pixel_height => {}
                    Ok(_) => errors.push(error(
                        "background_pixels_rejected",
                        "Decoded background dimensions differ from manifest.",
                        Some(manifest.image_file.clone()),
                    )),
                    Err(message) => errors.push(error(
                        "background_decode_failed",
                        &message,
                        Some(manifest.image_file.clone()),
                    )),
                }
            }
            Err(source) => errors.push(error(
                "missing_image",
                &format!("Background image cannot be read: {source}"),
                Some(manifest.image_file.clone()),
            )),
        },
        Err(mut issue) => {
            if issue.code == "missing_required_file" {
                issue.code = "missing_image".to_string();
            }
            errors.push(issue);
        }
    }

    if errors.is_empty() {
        background_validation_result(
            expected_background_asset_id,
            StandardAgentCenterBackgroundValidationStatus::Valid,
            vec![],
            vec![],
        )
    } else {
        let status = status_for_background_errors(&errors);
        background_validation_result(expected_background_asset_id, status, errors, vec![])
    }
}

pub(super) fn validate_avatar_asset_manifest(
    asset_root: &Path,
    expected_local_asset_id: &str,
) -> StandardAgentCenterAvatarAssetValidationResult {
    let manifest_path = asset_root.join(MANIFEST_FILE_NAME);
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return avatar_asset_validation_result(
                expected_local_asset_id,
                StandardAgentCenterAvatarAssetValidationStatus::AssetMissing,
                vec![error(
                    "avatar_asset_missing",
                    &format!("Avatar asset manifest is missing: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    let manifest = match serde_json::from_str::<AvatarAssetManifest>(&raw) {
        Ok(manifest) => manifest,
        Err(source) => {
            return avatar_asset_validation_result(
                expected_local_asset_id,
                StandardAgentCenterAvatarAssetValidationStatus::InvalidManifest,
                vec![error(
                    "avatar_asset_manifest_invalid",
                    &format!("Avatar asset manifest is malformed: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

    let mut errors = Vec::<StandardAgentCenterValidationIssue>::new();
    let mut warnings = Vec::<StandardAgentCenterValidationIssue>::new();
    if manifest.manifest_version != 1 {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "manifest_version must be 1.",
            Some("manifest_version".to_string()),
        ));
    }
    if manifest.local_asset_id != expected_local_asset_id {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "local_asset_id must match the selected asset.",
            Some("local_asset_id".to_string()),
        ));
    }
    if let Err(message) = validate_local_asset_id(&manifest.local_asset_id, "local_asset_id") {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            &message,
            Some("local_asset_id".to_string()),
        ));
    }
    if manifest.kind != "live2d" && manifest.kind != "vrm" {
        errors.push(error(
            "unsupported_kind",
            "Avatar asset kind must be live2d or vrm.",
            Some("kind".to_string()),
        ));
    }
    if !manifest
        .local_asset_id
        .starts_with(&format!("{}_", manifest.kind))
    {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "local_asset_id prefix must match kind.",
            Some("local_asset_id".to_string()),
        ));
    }
    if manifest.loader_min_version != "1.0.0" {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "loader_min_version must be 1.0.0.",
            Some("loader_min_version".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.display_name, "display_name", 80) {
        errors.push(issue);
    }
    if manifest.limits.max_manifest_bytes != MAX_AVATAR_ASSET_MANIFEST_BYTES
        || manifest.limits.max_asset_bytes != MAX_AVATAR_ASSET_BYTES
        || manifest.limits.max_file_bytes != MAX_AVATAR_ASSET_FILE_BYTES
        || manifest.limits.max_file_count != MAX_AVATAR_ASSET_FILE_COUNT
    {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "limits must match the fixed Avatar asset caps.",
            Some("limits".to_string()),
        ));
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_AVATAR_ASSET_FILE_COUNT {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "files must be non-empty and stay within the fixed file-count cap.",
            Some("files".to_string()),
        ));
    }
    if !is_safe_relative_path(&manifest.entry_file) || !manifest.entry_file.starts_with("files/") {
        errors.push(error(
            "path_rejected",
            "entry_file must point under files/.",
            Some("entry_file".to_string()),
        ));
    }
    match manifest.kind.as_str() {
        "live2d" if !manifest.entry_file.ends_with(".model3.json") => errors.push(error(
            "avatar_asset_manifest_invalid",
            "Live2D entry_file must be a .model3.json file under files/.",
            Some("entry_file".to_string()),
        )),
        "vrm" if !manifest.entry_file.ends_with(".vrm") => errors.push(error(
            "avatar_asset_manifest_invalid",
            "VRM entry_file must be a .vrm file under files/.",
            Some("entry_file".to_string()),
        )),
        _ => {}
    }
    if !manifest
        .required_files
        .iter()
        .any(|path| path == &manifest.entry_file)
    {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "required_files must include entry_file.",
            Some("required_files".to_string()),
        ));
    }
    if !manifest.content_digest.starts_with("sha256:")
        || !is_digest(manifest.content_digest.trim_start_matches("sha256:"))
    {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "content_digest must be a sha256 digest ref.",
            Some("content_digest".to_string()),
        ));
    }
    if let Err(message) = validate_utc_timestamp(&manifest.import.imported_at, "imported_at") {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            &message,
            Some("import.imported_at".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.import.source_label, "source_label", 120) {
        errors.push(issue);
    }
    if Path::new(&manifest.import.source_label).is_absolute() {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "source_label must not store an absolute path.",
            Some("import.source_label".to_string()),
        ));
    }

    let mut total_bytes = 0_u64;
    let mut saw_entry = false;
    for file in &manifest.files {
        if !is_safe_relative_path(&file.path) || !file.path.starts_with("files/") {
            errors.push(error(
                "path_rejected",
                "Avatar asset file path must stay under files/.",
                Some(file.path.clone()),
            ));
            continue;
        }
        if !is_digest(&file.sha256) {
            errors.push(error(
                "avatar_asset_manifest_invalid",
                "file sha256 must be a lowercase sha256 digest.",
                Some(file.path.clone()),
            ));
        }
        if file.bytes == 0 || file.bytes > MAX_AVATAR_ASSET_FILE_BYTES {
            errors.push(error(
                "avatar_asset_file_too_large",
                "Avatar asset file is outside the fixed byte cap.",
                Some(file.path.clone()),
            ));
        }
        total_bytes = total_bytes.saturating_add(file.bytes);
        match resolve_under_root(asset_root, &file.path).and_then(|path| sha256_file(&path)) {
            Ok((actual_bytes, actual_sha256)) => {
                if actual_bytes != file.bytes {
                    errors.push(error(
                        "file_size_mismatch",
                        "Avatar asset file size differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
                if actual_sha256 != file.sha256 {
                    errors.push(error(
                        "content_digest_mismatch",
                        "Avatar asset file digest differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
            }
            Err(issue) => errors.push(issue),
        }
        if file.path == manifest.entry_file {
            saw_entry = true;
            match manifest.kind.as_str() {
                "live2d" if file.mime != "application/json" => errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "Live2D entry_file must be application/json.",
                    Some(file.path.clone()),
                )),
                "vrm" if file.mime != "model/vrm" => errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "VRM entry_file must be model/vrm.",
                    Some(file.path.clone()),
                )),
                _ => {}
            }
        }
    }
    if !saw_entry {
        errors.push(error(
            "missing_required_file",
            "Avatar asset files must describe entry_file.",
            Some(manifest.entry_file.clone()),
        ));
    }
    if total_bytes == 0 || total_bytes > MAX_AVATAR_ASSET_BYTES {
        errors.push(error(
            "avatar_asset_too_large",
            "Avatar asset package is outside the fixed byte cap.",
            Some("files".to_string()),
        ));
    }
    if manifest.kind == "live2d" {
        validate_live2d_model3_structure(asset_root, &manifest, &mut errors, &mut warnings);
    } else if manifest.kind == "vrm" {
        match resolve_under_root(asset_root, &manifest.entry_file).and_then(|path| {
            fs::read(&path).map_err(|source| {
                error(
                    "missing_required_file",
                    &format!("VRM entry file cannot be read: {source}"),
                    Some(manifest.entry_file.clone()),
                )
            })
        }) {
            Ok(bytes) => {
                if let Err(message) = validate_vrm_glb(&bytes) {
                    errors.push(error(
                        "avatar_asset_manifest_invalid",
                        &message,
                        Some(manifest.entry_file.clone()),
                    ));
                }
            }
            Err(issue) => errors.push(issue),
        }
    }

    if errors.is_empty() {
        avatar_asset_validation_result(
            expected_local_asset_id,
            StandardAgentCenterAvatarAssetValidationStatus::Valid,
            vec![],
            warnings,
        )
    } else {
        let status = status_for_avatar_asset_errors(&errors);
        avatar_asset_validation_result(expected_local_asset_id, status, errors, warnings)
    }
}

pub(crate) fn standard_agent_center_avatar_asset_validate_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAvatarAssetValidatePayload,
) -> AgentCenterHostResult<StandardAgentCenterAvatarAssetValidationResult> {
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
    let kind = if payload.avatar_asset_ref.starts_with("live2d_") {
        "live2d"
    } else {
        "vrm"
    };
    let dir = avatar_asset_dir(
        roots,
        &account_id,
        &scope.local_agent_ref,
        kind,
        &payload.avatar_asset_ref,
    )
    .map_err(AgentCenterHostError::InvalidPath)?;
    if !managed_custody_directory_exists(roots, &dir).map_err(AgentCenterHostError::InvalidPath)? {
        return Err(AgentCenterHostError::NotFound(format!(
            "Avatar asset was not found: {}",
            payload.avatar_asset_ref
        )));
    }
    let result = validate_avatar_asset_manifest(&dir, &payload.avatar_asset_ref);
    write_avatar_asset_validation_sidecar(&dir, &result)
        .map_err(AgentCenterHostError::HostInternal)?;
    Ok(result)
}

pub(crate) fn standard_agent_center_background_validate_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundValidatePayload,
) -> AgentCenterHostResult<StandardAgentCenterBackgroundValidationResult> {
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
    validate_background_id(&payload.background_asset_ref, "backgroundAssetRef")
        .map_err(AgentCenterHostError::InvalidPayload)?;
    let dir = background_dir(
        roots,
        &account_id,
        &scope.local_agent_ref,
        &payload.background_asset_ref,
    )
    .map_err(AgentCenterHostError::InvalidPath)?;
    if !managed_custody_directory_exists(roots, &dir).map_err(AgentCenterHostError::InvalidPath)? {
        return Err(AgentCenterHostError::NotFound(format!(
            "Background asset was not found: {}",
            payload.background_asset_ref
        )));
    }
    let result = validate_background_manifest(&dir, &payload.background_asset_ref);
    write_background_validation_sidecar(&dir, &result)
        .map_err(AgentCenterHostError::HostInternal)?;
    Ok(result)
}

pub(crate) fn standard_agent_center_background_asset_get_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundValidatePayload,
) -> AgentCenterHostResult<StandardAgentCenterBackgroundAssetResult> {
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
    validate_background_id(&payload.background_asset_ref, "backgroundAssetRef")
        .map_err(AgentCenterHostError::InvalidPayload)?;
    let dir = background_dir(
        roots,
        &account_id,
        &scope.local_agent_ref,
        &payload.background_asset_ref,
    )
    .map_err(AgentCenterHostError::InvalidPath)?;
    if !managed_custody_directory_exists(roots, &dir).map_err(AgentCenterHostError::InvalidPath)? {
        return Err(AgentCenterHostError::NotFound(format!(
            "Background asset was not found: {}",
            payload.background_asset_ref
        )));
    }
    let validation = validate_background_manifest(&dir, &payload.background_asset_ref);
    write_background_validation_sidecar(&dir, &validation)
        .map_err(AgentCenterHostError::HostInternal)?;
    if validation.status != StandardAgentCenterBackgroundValidationStatus::Valid {
        return Ok(StandardAgentCenterBackgroundAssetResult {
            background_asset_id: payload.background_asset_ref,
            file_url: String::new(),
            validation,
        });
    }
    let raw = fs::read_to_string(dir.join(MANIFEST_FILE_NAME)).map_err(|error| {
        AgentCenterHostError::HostInternal(format!("failed to read background manifest: {error}"))
    })?;
    let manifest = serde_json::from_str::<BackgroundManifest>(&raw).map_err(|error| {
        AgentCenterHostError::HostInternal(format!("failed to parse background manifest: {error}"))
    })?;
    let image_path = resolve_under_root(&dir, &manifest.image_file)
        .map_err(|issue| AgentCenterHostError::InvalidPath(issue.message))?;
    Ok(StandardAgentCenterBackgroundAssetResult {
        background_asset_id: payload.background_asset_ref,
        file_url: image_path.display().to_string(),
        validation,
    })
}
