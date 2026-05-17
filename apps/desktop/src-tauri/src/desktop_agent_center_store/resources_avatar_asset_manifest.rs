use super::*;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AvatarAssetManifest {
    pub(crate) manifest_version: u8,
    pub(crate) asset_version: String,
    pub(crate) local_asset_id: String,
    pub(crate) kind: String,
    pub(crate) loader_min_version: String,
    pub(crate) display_name: String,
    pub(crate) display_name_i18n: serde_json::Map<String, serde_json::Value>,
    pub(crate) entry_file: String,
    pub(crate) required_files: Vec<String>,
    pub(crate) content_digest: String,
    pub(crate) files: Vec<AvatarAssetManifestFile>,
    pub(crate) limits: AvatarAssetManifestLimits,
    pub(crate) capabilities: serde_json::Value,
    pub(crate) import: AvatarAssetManifestImport,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AvatarAssetManifestFile {
    pub(crate) path: String,
    pub(crate) sha256: String,
    pub(crate) bytes: u64,
    pub(crate) mime: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AvatarAssetManifestLimits {
    pub(crate) max_manifest_bytes: u64,
    pub(crate) max_asset_bytes: u64,
    pub(crate) max_file_bytes: u64,
    pub(crate) max_file_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AvatarAssetManifestImport {
    pub(crate) imported_at: String,
    pub(crate) source_label: String,
    pub(crate) source_fingerprint: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AvatarCapabilityProfile {
    pub(crate) schema_version: u8,
    pub(crate) profile_ref: String,
    pub(crate) local_asset_id: String,
    pub(crate) backend_kind: String,
    pub(crate) evidence_ref: String,
    pub(crate) file_count: usize,
    pub(crate) asset_bytes: u64,
    pub(crate) generated_motion_supported: bool,
    pub(crate) embedded_live2d_adapter_manifest: bool,
    pub(crate) imported_at: String,
}

pub(super) fn avatar_backend_kind_label(
    kind: AgentCenterAvatarBackendKind,
) -> Result<&'static str, String> {
    match kind {
        AgentCenterAvatarBackendKind::Live2d => Ok("live2d"),
        AgentCenterAvatarBackendKind::Vrm => Ok("vrm"),
        AgentCenterAvatarBackendKind::Future => {
            Err("future avatar backend cannot import a local package".to_string())
        }
    }
}

pub(super) fn avatar_asset_validation_result(
    local_asset_id: Option<String>,
    backend_kind: Option<AgentCenterAvatarBackendKind>,
    backend_capability_profile_ref: Option<String>,
    status: AgentCenterAvatarAssetValidationStatus,
    errors: Vec<AgentCenterValidationIssue>,
    warnings: Vec<AgentCenterValidationIssue>,
) -> AgentCenterAvatarAssetValidationResult {
    AgentCenterAvatarAssetValidationResult {
        schema_version: VALIDATION_SCHEMA_VERSION,
        local_asset_id,
        backend_kind,
        backend_capability_profile_ref,
        checked_at: checked_at(),
        status,
        errors,
        warnings,
    }
}

fn status_for_avatar_asset_errors(
    errors: &[AgentCenterValidationIssue],
) -> AgentCenterAvatarAssetValidationStatus {
    if errors.iter().any(|entry| entry.code == "selection_missing") {
        return AgentCenterAvatarAssetValidationStatus::SelectionMissing;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "unsupported_backend")
    {
        return AgentCenterAvatarAssetValidationStatus::UnsupportedBackend;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "avatar_asset_missing")
    {
        return AgentCenterAvatarAssetValidationStatus::AssetMissing;
    }
    if errors.iter().any(|entry| entry.code == "path_rejected") {
        return AgentCenterAvatarAssetValidationStatus::PathRejected;
    }
    if errors.iter().any(|entry| entry.code == "permission_denied") {
        return AgentCenterAvatarAssetValidationStatus::PermissionDenied;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "missing_entry" || entry.code == "missing_required_file")
    {
        return AgentCenterAvatarAssetValidationStatus::MissingEntry;
    }
    if errors
        .iter()
        .any(|entry| entry.code == "content_digest_mismatch")
    {
        return AgentCenterAvatarAssetValidationStatus::DigestMismatch;
    }
    AgentCenterAvatarAssetValidationStatus::InvalidManifest
}

pub(super) fn write_avatar_asset_validation_sidecar(
    asset_dir: &Path,
    result: &AgentCenterAvatarAssetValidationResult,
) -> Result<(), String> {
    if !asset_dir.exists() {
        return Ok(());
    }
    let raw = serde_json::to_string_pretty(result)
        .map_err(|error| format!("failed to serialize avatar asset validation sidecar: {error}"))?;
    fs::write(asset_dir.join(VALIDATION_FILE_NAME), raw)
        .map_err(|error| format!("failed to write avatar asset validation sidecar: {error}"))
}

pub(super) fn validate_avatar_asset_manifest(
    asset_root: &Path,
    expected_local_asset_id: &str,
    expected_kind: AgentCenterAvatarBackendKind,
    expected_capability_profile_ref: &str,
) -> AgentCenterAvatarAssetValidationResult {
    let mut errors = Vec::<AgentCenterValidationIssue>::new();
    let kind_label = match avatar_backend_kind_label(expected_kind) {
        Ok(label) => label,
        Err(message) => {
            return avatar_asset_validation_result(
                Some(expected_local_asset_id.to_string()),
                Some(expected_kind),
                Some(expected_capability_profile_ref.to_string()),
                AgentCenterAvatarAssetValidationStatus::UnsupportedBackend,
                vec![error(
                    "unsupported_backend",
                    &message,
                    Some("backend_kind".to_string()),
                )],
                vec![],
            );
        }
    };
    let manifest_path = asset_root.join(MANIFEST_FILE_NAME);
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(source) => {
            return avatar_asset_validation_result(
                Some(expected_local_asset_id.to_string()),
                Some(expected_kind),
                Some(expected_capability_profile_ref.to_string()),
                AgentCenterAvatarAssetValidationStatus::AssetMissing,
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
                Some(expected_local_asset_id.to_string()),
                Some(expected_kind),
                Some(expected_capability_profile_ref.to_string()),
                AgentCenterAvatarAssetValidationStatus::InvalidManifest,
                vec![error(
                    "avatar_asset_manifest_invalid",
                    &format!("Avatar asset manifest is malformed: {source}"),
                    Some(MANIFEST_FILE_NAME.to_string()),
                )],
                vec![],
            );
        }
    };

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
            "local_asset_id must match the selected local asset.",
            Some("local_asset_id".to_string()),
        ));
    }
    if manifest.kind != kind_label {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "kind must match the selected backend kind.",
            Some("kind".to_string()),
        ));
    }
    if let Err(message) = validate_local_asset_id(&manifest.local_asset_id, "local_asset_id") {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            &message,
            Some("local_asset_id".to_string()),
        ));
    }
    if let Err(issue) = validate_display_text(&manifest.display_name, "display_name", 80) {
        errors.push(issue);
    }
    if let Err(issue) = validate_display_text(&manifest.import.source_label, "source_label", 120) {
        errors.push(issue);
    }
    if Path::new(&manifest.import.source_label).is_absolute() {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "source_label must not store an absolute path.",
            Some("source_label".to_string()),
        ));
    }
    if let Err(message) = validate_utc_timestamp(&manifest.import.imported_at, "imported_at") {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            &message,
            Some("imported_at".to_string()),
        ));
    }
    if !is_digest(&manifest.content_digest) {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "content_digest must be a lowercase sha256 digest.",
            Some("content_digest".to_string()),
        ));
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_AVATAR_ASSET_FILE_COUNT {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "files must be non-empty and remain within the fixed file count cap.",
            Some("files".to_string()),
        ));
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
    if !is_safe_relative_path(&manifest.entry_file)
        || !manifest.entry_file.starts_with("files/")
        || match expected_kind {
            AgentCenterAvatarBackendKind::Live2d => !manifest.entry_file.ends_with(".model3.json"),
            AgentCenterAvatarBackendKind::Vrm => extension_for(&manifest.entry_file) != "vrm",
            AgentCenterAvatarBackendKind::Future => true,
        }
    {
        errors.push(error(
            "missing_entry",
            "entry_file must be a backend-specific file inside the local Avatar asset.",
            Some("entry_file".to_string()),
        ));
    }
    let entry_declared = manifest
        .files
        .iter()
        .any(|file| file.path == manifest.entry_file);
    if !entry_declared {
        errors.push(error(
            "missing_entry",
            "entry_file must be declared in files.",
            Some(manifest.entry_file.clone()),
        ));
    }

    let mut content_digest = Sha256::new();
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
                "avatar_asset_file_rejected",
                "Avatar asset file is outside the fixed byte cap.",
                Some(file.path.clone()),
            ));
        }
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
            Err(mut issue) => {
                if issue.code == "missing_required_file" {
                    issue.code = "missing_entry".to_string();
                }
                errors.push(issue);
            }
        }
        content_digest.update(file.path.as_bytes());
        content_digest.update([0]);
        content_digest.update(file.sha256.as_bytes());
        content_digest.update([0]);
        content_digest.update(file.bytes.to_string().as_bytes());
        content_digest.update([0]);
    }
    let actual_content_digest = format!("{:x}", content_digest.finalize());
    if manifest.content_digest != actual_content_digest {
        errors.push(error(
            "content_digest_mismatch",
            "Avatar asset content digest differs from manifest file list.",
            Some("content_digest".to_string()),
        ));
    }

    let profile_path = asset_root.join(CAPABILITY_PROFILE_FILE_NAME);
    match fs::read_to_string(&profile_path)
        .map_err(|source| {
            error(
                "missing_required_file",
                &format!("Avatar capability profile is missing: {source}"),
                Some(CAPABILITY_PROFILE_FILE_NAME.to_string()),
            )
        })
        .and_then(|raw| {
            serde_json::from_str::<AvatarCapabilityProfile>(&raw).map_err(|source| {
                error(
                    "avatar_asset_manifest_invalid",
                    &format!("Avatar capability profile is malformed: {source}"),
                    Some(CAPABILITY_PROFILE_FILE_NAME.to_string()),
                )
            })
        }) {
        Ok(profile) => {
            if profile.schema_version != 1 {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile schema_version must be 1.",
                    Some("capability-profile.schema_version".to_string()),
                ));
            }
            if profile.profile_ref != expected_capability_profile_ref {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile ref must match selected backend evidence.",
                    Some("capability-profile.profile_ref".to_string()),
                ));
            }
            if profile.local_asset_id != expected_local_asset_id {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile local_asset_id must match selected asset.",
                    Some("capability-profile.local_asset_id".to_string()),
                ));
            }
            if profile.backend_kind != kind_label {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "capability profile backend_kind must match selected backend.",
                    Some("capability-profile.backend_kind".to_string()),
                ));
            }
        }
        Err(mut issue) => {
            if issue.code == "missing_required_file" {
                issue.code = "missing_entry".to_string();
            }
            errors.push(issue);
        }
    }

    if errors.is_empty() {
        avatar_asset_validation_result(
            Some(expected_local_asset_id.to_string()),
            Some(expected_kind),
            Some(expected_capability_profile_ref.to_string()),
            AgentCenterAvatarAssetValidationStatus::Valid,
            vec![],
            vec![],
        )
    } else {
        let status = status_for_avatar_asset_errors(&errors);
        avatar_asset_validation_result(
            Some(expected_local_asset_id.to_string()),
            Some(expected_kind),
            Some(expected_capability_profile_ref.to_string()),
            status,
            errors,
            vec![],
        )
    }
}
