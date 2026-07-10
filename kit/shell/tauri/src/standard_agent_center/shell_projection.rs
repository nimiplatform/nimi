use super::*;

fn avatar_validation_status_for_shell(
    status: StandardAgentCenterAvatarAssetValidationStatus,
) -> &'static str {
    match status {
        StandardAgentCenterAvatarAssetValidationStatus::Valid => "valid",
        _ => "invalid",
    }
}

fn background_validation_status_for_shell(
    status: StandardAgentCenterBackgroundValidationStatus,
) -> &'static str {
    match status {
        StandardAgentCenterBackgroundValidationStatus::Valid => "valid",
        _ => "invalid",
    }
}

fn validation_message(
    errors: &[StandardAgentCenterValidationIssue],
    warnings: &[StandardAgentCenterValidationIssue],
) -> Option<String> {
    errors
        .first()
        .or_else(|| warnings.first())
        .map(|issue| issue.message.clone())
}

fn validation_issue_rows(
    errors: &[StandardAgentCenterValidationIssue],
    warnings: &[StandardAgentCenterValidationIssue],
) -> Vec<String> {
    errors
        .iter()
        .chain(warnings.iter())
        .map(|issue| {
            if issue.code.trim().is_empty() {
                issue.message.clone()
            } else {
                format!("{}: {}", issue.code, issue.message)
            }
        })
        .collect()
}

pub(crate) fn avatar_asset_import_result(
    result: StandardAgentCenterAvatarAssetImportResult,
) -> serde_json::Value {
    serde_json::json!({
        "avatarAssetRef": result.local_asset_id,
        "backendKind": avatar_backend_kind_label(result.backend_kind),
        "validationStatus": avatar_validation_status_for_shell(result.validation.status),
        "validationMessage": validation_message(&result.validation.errors, &result.validation.warnings),
        "backendCapabilityProfileRef": result.backend_capability_profile_ref,
    })
}

pub(crate) fn avatar_asset_validate_result(
    result: StandardAgentCenterAvatarAssetValidationResult,
) -> Result<serde_json::Value, String> {
    let avatar_asset_ref = result.local_asset_id;
    let backend_kind = avatar_backend_kind_for_asset_ref(&avatar_asset_ref)?;
    Ok(serde_json::json!({
        "avatarAssetRef": avatar_asset_ref.clone(),
        "backendKind": avatar_backend_kind_label(backend_kind),
        "validationStatus": avatar_validation_status_for_shell(result.status),
        "validationMessage": validation_message(&result.errors, &result.warnings),
        "backendCapabilityProfileRef": backend_capability_profile_ref_for(
            avatar_backend_kind_label(backend_kind),
            &avatar_asset_ref,
        ),
        "validationIssueRows": validation_issue_rows(&result.errors, &result.warnings),
    }))
}

pub(crate) fn avatar_preview_result(
    avatar_asset_ref: String,
    backend_kind: StandardAgentCenterAvatarBackendKind,
    validation: StandardAgentCenterAvatarAssetValidationResult,
) -> serde_json::Value {
    serde_json::json!({
        "avatarAssetRef": avatar_asset_ref,
        "backendKind": avatar_backend_kind_label(backend_kind),
        "previewArtifactRef": format!(
            "agent-center-preview:{}:{}",
            avatar_backend_kind_label(backend_kind),
            validation.local_asset_id,
        ),
        "validationStatus": avatar_validation_status_for_shell(validation.status),
        "validationMessage": validation_message(&validation.errors, &validation.warnings),
        "warnings": validation.warnings.iter().map(|issue| issue.message.clone()).collect::<Vec<_>>(),
    })
}

pub(crate) fn live2d_adapter_import_result(
    result: StandardAgentCenterLive2dAdapterManifestImportResult,
) -> serde_json::Value {
    serde_json::json!({
        "avatarAssetRef": result.local_asset_id,
        "live2dAdapterManifestRef": result.manifest_ref,
        "live2dAdapterManifestSource": "external_sidecar_manifest",
    })
}

pub(crate) fn background_import_result(
    result: StandardAgentCenterBackgroundImportResult,
) -> serde_json::Value {
    serde_json::json!({
        "backgroundAssetRef": result.background_asset_id,
        "validationStatus": background_validation_status_for_shell(result.validation.status),
        "validationMessage": validation_message(&result.validation.errors, &result.validation.warnings),
    })
}

pub(crate) fn background_get_result(
    result: StandardAgentCenterBackgroundAssetResult,
) -> serde_json::Value {
    serde_json::json!({
        "backgroundAssetRef": result.background_asset_id,
        "url": result.file_url,
        "validationStatus": background_validation_status_for_shell(result.validation.status),
        "validationMessage": validation_message(&result.validation.errors, &result.validation.warnings),
    })
}

pub(crate) fn background_validate_result(
    result: StandardAgentCenterBackgroundValidationResult,
) -> serde_json::Value {
    serde_json::json!({
        "backgroundAssetRef": result.background_asset_id,
        "validationStatus": background_validation_status_for_shell(result.status),
        "validationMessage": validation_message(&result.errors, &result.warnings),
    })
}

pub(crate) fn resource_removal_result(
    result: StandardAgentCenterLocalResourceRemoveResult,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "removed": result.quarantined,
    });
    if let Some(record) = payload.as_object_mut() {
        match result.resource_kind.as_str() {
            "background" => {
                record.insert(
                    "backgroundAssetRef".to_string(),
                    serde_json::Value::String(result.resource_id),
                );
            }
            "avatar_asset" => {
                record.insert(
                    "avatarAssetRef".to_string(),
                    serde_json::Value::String(result.resource_id),
                );
            }
            "live2d_adapter_manifest" => {
                record.insert(
                    "live2dAdapterManifestRef".to_string(),
                    serde_json::Value::String(result.resource_id),
                );
            }
            _ => {}
        }
    }
    payload
}
