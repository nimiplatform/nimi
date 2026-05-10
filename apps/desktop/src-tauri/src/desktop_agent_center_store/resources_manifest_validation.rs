use super::*;

pub(super) fn validate_background_manifest(
    background_root: &Path,
    expected_background_asset_id: &str,
) -> AgentCenterBackgroundValidationResult {
    let manifest_path = background_root.join(MANIFEST_FILE_NAME);
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return background_validation_result(
                expected_background_asset_id,
                AgentCenterBackgroundValidationStatus::AssetMissing,
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
                AgentCenterBackgroundValidationStatus::InvalidManifest,
                vec![error(
                    "background_manifest_invalid",
                    &format!("Background manifest is malformed: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

    let mut errors = Vec::<AgentCenterValidationIssue>::new();
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
    match resolve_under_root(background_root, &manifest.image_file)
        .and_then(|path| sha256_file(&path))
    {
        Ok((actual_bytes, actual_sha256)) => {
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
        }
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
            AgentCenterBackgroundValidationStatus::Valid,
            vec![],
            vec![],
        )
    } else {
        let status = status_for_background_errors(&errors);
        background_validation_result(expected_background_asset_id, status, errors, vec![])
    }
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_validate(
    payload: DesktopAgentCenterBackgroundValidatePayload,
) -> Result<AgentCenterBackgroundValidationResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_background_id(&payload.background_asset_id, "backgroundAssetId")?;
    let dir = background_dir(&account_id, &agent_id, &payload.background_asset_id)?;
    if !dir.exists() {
        return Ok(background_validation_result(
            &payload.background_asset_id,
            AgentCenterBackgroundValidationStatus::AssetMissing,
            vec![error(
                "background_missing",
                "Selected background directory is missing.",
                Some(payload.background_asset_id.clone()),
            )],
            vec![],
        ));
    }
    let result = validate_background_manifest(&dir, &payload.background_asset_id);
    write_background_validation_sidecar(&dir, &result)?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_asset_get(
    payload: DesktopAgentCenterBackgroundValidatePayload,
) -> Result<DesktopAgentCenterBackgroundAssetResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_background_id(&payload.background_asset_id, "backgroundAssetId")?;
    let dir = background_dir(&account_id, &agent_id, &payload.background_asset_id)?;
    let validation = if dir.exists() {
        validate_background_manifest(&dir, &payload.background_asset_id)
    } else {
        background_validation_result(
            &payload.background_asset_id,
            AgentCenterBackgroundValidationStatus::AssetMissing,
            vec![error(
                "background_missing",
                "Selected background directory is missing.",
                Some(payload.background_asset_id.clone()),
            )],
            vec![],
        )
    };
    write_background_validation_sidecar(&dir, &validation)?;
    if validation.status != AgentCenterBackgroundValidationStatus::Valid {
        return Ok(DesktopAgentCenterBackgroundAssetResult {
            background_asset_id: payload.background_asset_id,
            file_url: String::new(),
            validation,
        });
    }
    let raw = fs::read_to_string(dir.join(MANIFEST_FILE_NAME))
        .map_err(|error| format!("failed to read background manifest: {error}"))?;
    let manifest = serde_json::from_str::<BackgroundManifest>(&raw)
        .map_err(|error| format!("failed to parse background manifest: {error}"))?;
    let image_path =
        resolve_under_root(&dir, &manifest.image_file).map_err(|issue| issue.message)?;
    Ok(DesktopAgentCenterBackgroundAssetResult {
        background_asset_id: payload.background_asset_id,
        file_url: file_url_from_path(&image_path)?,
        validation,
    })
}

#[tauri::command]
pub(crate) fn desktop_agent_center_live2d_adapter_manifest_pick_source(
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select Live2D adapter manifest")
        .add_filter("JSON", &["json"])
        .add_filter("All Files", &["*"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn desktop_agent_center_background_pick_source() -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select background image")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}
