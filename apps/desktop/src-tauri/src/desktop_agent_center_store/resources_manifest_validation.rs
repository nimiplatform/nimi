use super::*;

pub(super) fn validate_manifest(
    package_root: &Path,
    expected_kind: AgentCenterAvatarPackageKind,
    expected_package_id: &str,
) -> AgentCenterAvatarPackageValidationResult {
    let manifest_path = package_root.join(MANIFEST_FILE_NAME);
    let manifest_metadata = match fs::metadata(&manifest_path) {
        Ok(metadata) => metadata,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::PackageMissing,
                vec![error(
                    "manifest_not_found",
                    &format!("Package manifest is missing: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    if manifest_metadata.len() > MAX_MANIFEST_BYTES {
        return validation_result(
            expected_package_id,
            AgentCenterAvatarPackageValidationStatus::InvalidManifest,
            vec![error(
                "manifest_too_large",
                "Package manifest is over the fixed size cap.",
                Some(MANIFEST_FILE_NAME.to_string()),
            )],
            vec![],
        );
    }
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::PermissionDenied,
                vec![error(
                    "permission_denied",
                    &format!("Package manifest cannot be read: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    let manifest_value = match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => value,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::InvalidManifest,
                vec![error(
                    "manifest_invalid",
                    &format!("Package manifest is malformed JSON: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };
    if manifest_value.get("validation").is_some() {
        return validation_result(
            expected_package_id,
            AgentCenterAvatarPackageValidationStatus::InvalidManifest,
            vec![error(
                "manifest_embeds_validation",
                "Package manifest must not embed validation status.",
                Some(MANIFEST_FILE_NAME.to_string()),
            )],
            vec![],
        );
    }
    let manifest = match serde_json::from_value::<AvatarPackageManifest>(manifest_value) {
        Ok(manifest) => manifest,
        Err(source) => {
            return validation_result(
                expected_package_id,
                AgentCenterAvatarPackageValidationStatus::InvalidManifest,
                vec![error(
                    "manifest_invalid",
                    &format!("Package manifest does not match schema: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

    let mut errors = Vec::<AgentCenterValidationIssue>::new();
    if manifest.manifest_version != AVATAR_PACKAGE_MANIFEST_VERSION {
        errors.push(error(
            "manifest_invalid",
            "manifest_version must be 1.",
            Some("manifest_version".to_string()),
        ));
    }
    if manifest.package_id != expected_package_id {
        errors.push(error(
            "manifest_invalid",
            "package_id must match the selected package.",
            Some("package_id".to_string()),
        ));
    }
    if manifest.kind != expected_kind {
        errors.push(error(
            "unsupported_kind",
            "kind must match the selected package kind.",
            Some("kind".to_string()),
        ));
    }
    if let Err(message) = validate_package_id(&manifest.package_id, "package_id") {
        errors.push(error(
            "manifest_invalid",
            &message,
            Some("package_id".to_string()),
        ));
    }
    if !is_semver(&manifest.package_version) {
        errors.push(error(
            "manifest_invalid",
            "package_version must be semver.",
            Some("package_version".to_string()),
        ));
    }
    if !is_semver(&manifest.loader_min_version) {
        errors.push(error(
            "manifest_invalid",
            "loader_min_version must be semver.",
            Some("loader_min_version".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.display_name, "display_name", 80) {
        errors.push(issue);
    }
    for (locale, value) in &manifest.display_name_i18n {
        match value.as_str() {
            Some(text) => {
                if let Err(issue) =
                    validate_display_text(text, &format!("display_name_i18n.{locale}"), 80)
                {
                    errors.push(issue);
                }
            }
            None => errors.push(error(
                "manifest_invalid",
                "display_name_i18n values must be strings.",
                Some(format!("display_name_i18n.{locale}")),
            )),
        }
    }
    if let Err(issue) =
        validate_display_text(&manifest.import.source_label, "import.source_label", 120)
    {
        errors.push(issue);
    }
    if Path::new(&manifest.import.source_label).is_absolute() {
        errors.push(error(
            "manifest_invalid",
            "import.source_label must not store an absolute path.",
            Some("import.source_label".to_string()),
        ));
    }
    if let Err(message) = validate_utc_timestamp(&manifest.import.imported_at, "import.imported_at")
    {
        errors.push(error(
            "manifest_invalid",
            &message,
            Some("import.imported_at".to_string()),
        ));
    }
    if !is_prefixed_digest(&manifest.import.source_fingerprint) {
        errors.push(error(
            "manifest_invalid",
            "import.source_fingerprint must be a sha256 digest.",
            Some("import.source_fingerprint".to_string()),
        ));
    }
    if !is_prefixed_digest(&manifest.content_digest) {
        errors.push(error(
            "manifest_invalid",
            "content_digest must be a sha256 digest.",
            Some("content_digest".to_string()),
        ));
    }
    if manifest.limits.max_manifest_bytes != MAX_MANIFEST_BYTES
        || manifest.limits.max_package_bytes != MAX_PACKAGE_BYTES
        || manifest.limits.max_file_bytes != MAX_FILE_BYTES
        || manifest.limits.max_file_count != MAX_FILE_COUNT
    {
        errors.push(error(
            "manifest_invalid",
            "limits must match the fixed cutover caps.",
            Some("limits".to_string()),
        ));
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_FILE_COUNT {
        errors.push(error(
            "manifest_invalid",
            "files must be non-empty and stay within the fixed file-count cap.",
            Some("files".to_string()),
        ));
    }
    if !is_safe_relative_path(&manifest.entry_file) {
        errors.push(error(
            "path_rejected",
            "entry_file must be package-relative.",
            Some("entry_file".to_string()),
        ));
    }
    let _ = &manifest.capabilities;

    let mut known_paths = HashSet::<String>::new();
    let mut package_bytes = 0_u64;
    for file in &manifest.files {
        if !known_paths.insert(file.path.clone()) {
            errors.push(error(
                "manifest_invalid",
                "Package manifest file paths must be unique.",
                Some(file.path.clone()),
            ));
        }
        if !is_safe_relative_path(&file.path) {
            errors.push(error(
                "path_rejected",
                "Package file path must be package-relative.",
                Some(file.path.clone()),
            ));
            continue;
        }
        if !is_digest(&file.sha256) {
            errors.push(error(
                "manifest_invalid",
                "files[].sha256 must be a lowercase sha256 digest.",
                Some(file.path.clone()),
            ));
        }
        if file.bytes == 0 || file.bytes > MAX_FILE_BYTES {
            errors.push(error(
                "file_size_rejected",
                "Package file size is outside the fixed cap.",
                Some(file.path.clone()),
            ));
        }
        if file.mime.trim().is_empty() {
            errors.push(error(
                "manifest_invalid",
                "files[].mime is required.",
                Some(file.path.clone()),
            ));
        }
        package_bytes = package_bytes.saturating_add(file.bytes);
        match resolve_under_root(package_root, &file.path).and_then(|path| sha256_file(&path)) {
            Ok((actual_bytes, actual_sha256)) => {
                if actual_bytes != file.bytes {
                    errors.push(error(
                        "file_size_mismatch",
                        "Package file size differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
                if actual_sha256 != file.sha256 {
                    errors.push(error(
                        "content_digest_mismatch",
                        "Package file digest differs from manifest.",
                        Some(file.path.clone()),
                    ));
                }
            }
            Err(issue) => errors.push(issue),
        }
    }
    if package_bytes > MAX_PACKAGE_BYTES {
        errors.push(error(
            "package_too_large",
            "Package byte total is over the fixed cap.",
            Some("files".to_string()),
        ));
    }
    if !known_paths.contains(&manifest.entry_file) {
        errors.push(error(
            "missing_required_file",
            "entry_file must appear in files.",
            Some(manifest.entry_file.clone()),
        ));
    }
    for required in &manifest.required_files {
        if !is_safe_relative_path(required) {
            errors.push(error(
                "path_rejected",
                "required_files entries must be package-relative.",
                Some(required.clone()),
            ));
            continue;
        }
        if !known_paths.contains(required) {
            errors.push(error(
                "missing_required_file",
                "required file must appear in files.",
                Some(required.clone()),
            ));
        }
    }

    if errors.is_empty() {
        validation_result(
            expected_package_id,
            AgentCenterAvatarPackageValidationStatus::Valid,
            vec![],
            vec![],
        )
    } else {
        let status = status_for_errors(&errors);
        validation_result(expected_package_id, status, errors, vec![])
    }
}

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
pub(crate) fn desktop_agent_center_avatar_package_validate(
    payload: DesktopAgentCenterAvatarPackageValidatePayload,
) -> Result<AgentCenterAvatarPackageValidationResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let agent_id = validate_normalized_id(&payload.agent_id, "agentId")?;
    validate_package_id(&payload.package_id, "packageId")?;
    let expected_prefix = package_kind_dir(payload.kind);
    if !payload.package_id.starts_with(expected_prefix) {
        return Err("packageId must match kind".to_string());
    }
    let dir = package_dir(&account_id, &agent_id, payload.kind, &payload.package_id)?;
    if !dir.exists() {
        return Ok(validation_result(
            &payload.package_id,
            AgentCenterAvatarPackageValidationStatus::PackageMissing,
            vec![error(
                "package_missing",
                "Selected package directory is missing.",
                Some(payload.package_id.clone()),
            )],
            vec![],
        ));
    }
    let result = validate_manifest(&dir, payload.kind, &payload.package_id);
    write_validation_sidecar(&dir, &result)?;
    Ok(result)
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
pub(crate) fn desktop_agent_center_avatar_package_pick_source(
    payload: DesktopAgentCenterAvatarPackagePickSourcePayload,
) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir()
        .or_else(|| crate::desktop_paths::resolve_nimi_data_dir().ok())
        .unwrap_or_else(env::temp_dir);
    let dialog = rfd::FileDialog::new().set_directory(&start_dir);
    let selected = match payload.kind {
        AgentCenterAvatarPackageKind::Live2d => dialog
            .set_title("Select Live2D package folder")
            .pick_folder(),
        AgentCenterAvatarPackageKind::Vrm => dialog
            .set_title("Select VRM avatar package")
            .add_filter("VRM", &["vrm"])
            .add_filter("All Files", &["*"])
            .pick_file(),
    };
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
