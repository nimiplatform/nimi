use super::*;

pub(crate) fn standard_agent_center_background_remove_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterBackgroundRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    validate_local_agent_host_scope(&payload.host_scope)?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.runtime_source_ref,
        &payload.local_agent_ref,
    )?;
    validate_background_id(&payload.background_asset_ref, "backgroundAssetRef")?;
    let source = background_dir(
        roots,
        &account_id,
        &scope.local_agent_ref,
        &payload.background_asset_ref,
    )?;
    let destination = quarantine_path(
        roots,
        &account_id,
        &scope.local_agent_ref,
        "background",
        &payload.background_asset_ref,
    )?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                roots,
                &account_id,
                &scope.local_agent_ref,
                "background_quarantine",
                "background",
                &payload.background_asset_ref,
                "failed",
                "user_removed",
            );
            return Err(error);
        }
    };
    let operation_id = record_resource_operation(
        roots,
        &account_id,
        &scope.local_agent_ref,
        "background_quarantine",
        "background",
        &payload.background_asset_ref,
        "completed",
        if quarantined {
            "user_removed"
        } else {
            "already_missing"
        },
    )?;
    Ok(StandardAgentCenterLocalResourceRemoveResult {
        resource_kind: "background".to_string(),
        resource_id: payload.background_asset_ref,
        quarantined,
        operation_id,
        status: "completed".to_string(),
    })
}

pub(crate) fn standard_agent_center_agent_local_resources_remove_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAgentLocalResourcesRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    validate_local_agent_host_scope(&payload.host_scope)?;
    let scope = validate_local_agent_scope(
        &payload.owner_user_id,
        &payload.runtime_source_ref,
        &payload.local_agent_ref,
    )?;
    quarantine_agent_center_tree(roots, &account_id, &scope.local_agent_ref, "agent_removed")
}

pub(crate) fn standard_agent_center_account_local_resources_remove_blocking(
    roots: &crate::runtime_app_storage::StandardAppStorageRoots,
    payload: StandardAgentCenterAccountLocalResourcesRemovePayload,
) -> Result<StandardAgentCenterLocalResourceRemoveResult, String> {
    let account_id = validate_normalized_id(&payload.account_id, "accountId")?;
    let account_root = account_dir(roots, &account_id)?;
    let agents_root = account_root.join("agents");
    if !agents_root.exists() {
        let operation_id = record_account_resource_operation(
            roots,
            &account_id,
            "account_local_resources_quarantine",
            "account_local_resources",
            &account_id,
            "completed",
            "already_missing",
        )?;
        return Ok(StandardAgentCenterLocalResourceRemoveResult {
            resource_kind: "account_local_resources".to_string(),
            resource_id: account_id,
            quarantined: false,
            operation_id,
            status: "completed".to_string(),
        });
    }

    let mut quarantined_any = false;
    for entry in fs::read_dir(&agents_root).map_err(|error| {
        format!(
            "failed to read Agent Center account agents directory ({}): {error}",
            agents_root.display()
        )
    })? {
        let entry = entry
            .map_err(|error| format!("failed to read Agent Center account agent entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            format!(
                "failed to inspect Agent Center account agent entry ({}): {error}",
                path.display()
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Agent Center account agent entry must not be a symlink ({})",
                path.display()
            ));
        }
        if !metadata.is_dir() {
            continue;
        }
        let Some(local_agent_ref_segment) = path.file_name().and_then(|value| value.to_str())
        else {
            return Err(format!(
                "Agent Center account agent entry has invalid name ({})",
                path.display()
            ));
        };
        let local_agent_ref =
            validate_normalized_id(local_agent_ref_segment, "localAgentRefPathSegment")?;
        let result =
            quarantine_agent_center_tree(roots, &account_id, &local_agent_ref, "account_removed")?;
        quarantined_any = quarantined_any || result.quarantined;
    }

    let operation_id = record_account_resource_operation(
        roots,
        &account_id,
        "account_local_resources_quarantine",
        "account_local_resources",
        &account_id,
        "completed",
        if quarantined_any {
            "account_removed"
        } else {
            "already_missing"
        },
    )?;
    Ok(StandardAgentCenterLocalResourceRemoveResult {
        resource_kind: "account_local_resources".to_string(),
        resource_id: account_id,
        quarantined: quarantined_any,
        operation_id,
        status: "completed".to_string(),
    })
}
