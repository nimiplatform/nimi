use super::*;

#[test]
fn removes_agent_local_resources_by_quarantining_agent_center_tree() {
    let home = temp_home("remove-agent-tree");
    with_env(&[("HOME", home.to_str())], || {
        let agent_center = agent_center_marker(&home, &local_agent_ref());

        let result = desktop_agent_center_agent_local_resources_remove_blocking(
            DesktopAgentCenterAgentLocalResourcesRemovePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
            },
        )
        .expect("remove agent local resources");

        assert_eq!(result.resource_kind, "agent_local_resources");
        assert_eq!(result.resource_id, local_agent_ref());
        assert!(result.quarantined);
        assert!(!agent_center.exists());
        let quarantine_root =
            home.join(".nimi/data/accounts/account_1/quarantine/agent_local_resources");
        let quarantined = quarantine_root
            .read_dir()
            .expect("agent quarantine dir")
            .next()
            .expect("quarantined agent tree")
            .expect("quarantine entry")
            .path();
        assert!(quarantined.join("modules/appearance/marker.txt").exists());
        let operations =
            fs::read_to_string(quarantined.join("operations/agent-center-local-resources.jsonl"))
                .expect("quarantined operation log");
        assert!(operations.contains("\"operation_type\":\"agent_local_resources_quarantine\""));
        assert!(operations.contains("\"reason_code\":\"agent_removed\""));
    });
}

#[test]
fn removes_account_local_resources_by_quarantining_each_agent_center_tree() {
    let home = temp_home("remove-account-tree");
    with_env(&[("HOME", home.to_str())], || {
        let agent_one = agent_center_marker(&home, &local_agent_ref());
        let agent_two = agent_center_marker(&home, &local_agent_ref_two());

        let result = desktop_agent_center_account_local_resources_remove_blocking(
            DesktopAgentCenterAccountLocalResourcesRemovePayload {
                account_id: "account_1".to_string(),
            },
        )
        .expect("remove account local resources");

        assert_eq!(result.resource_kind, "account_local_resources");
        assert_eq!(result.resource_id, "account_1");
        assert!(result.quarantined);
        assert!(!agent_one.exists());
        assert!(!agent_two.exists());
        let quarantine_root =
            home.join(".nimi/data/accounts/account_1/quarantine/agent_local_resources");
        let quarantined_count = quarantine_root
            .read_dir()
            .expect("account quarantine dir")
            .filter_map(Result::ok)
            .count();
        assert_eq!(quarantined_count, 2);
        let account_operations =
            fs::read_to_string(account_operation_log_path(&home)).expect("account log");
        assert!(account_operations
            .contains("\"operation_type\":\"account_local_resources_quarantine\""));
        assert!(account_operations.contains("\"reason_code\":\"account_removed\""));
    });
}

#[test]
fn removes_account_local_resources_for_opaque_account_ids() {
    let home = temp_home("remove-opaque-account-tree");
    with_env(&[("HOME", home.to_str())], || {
        let account_id = "account:abc.def+1";
        let account_segment = local_scope_path_segment(account_id);
        let opaque_local_agent_ref = "local-agent:owner_1:agent:abc.def+1";
        let agent_center =
            agent_center_marker_for_account(&home, account_id, opaque_local_agent_ref);

        let result = desktop_agent_center_account_local_resources_remove_blocking(
            DesktopAgentCenterAccountLocalResourcesRemovePayload {
                account_id: account_id.to_string(),
            },
        )
        .expect("remove opaque account local resources");

        assert_eq!(result.resource_kind, "account_local_resources");
        assert_eq!(result.resource_id, account_id);
        assert!(result.quarantined);
        assert!(!agent_center.exists());
        let quarantine_root = home
            .join(".nimi/data/accounts")
            .join(account_segment)
            .join("quarantine/agent_local_resources");
        let quarantined_count = quarantine_root
            .read_dir()
            .expect("opaque account quarantine dir")
            .filter_map(Result::ok)
            .count();
        assert_eq!(quarantined_count, 1);
    });
}

#[test]
fn import_rejects_svg_background_before_staging() {
    let home = temp_home("import-background-svg");
    with_env(&[("HOME", home.to_str())], || {
        let source = home.join("source-background.svg");
        fs::write(&source, b"<svg></svg>").expect("svg");
        let err = desktop_agent_center_background_import_blocking(
            DesktopAgentCenterBackgroundImportPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                source_path: source.to_string_lossy().to_string(),
                display_name: None,
                select: Some(true),
            },
        )
        .expect_err("svg rejected");
        assert!(err.contains("SVG"));
        assert!(!home
            .join(".nimi/data/accounts/account_1/agents")
            .join(local_scope_path_segment(&local_agent_ref()))
            .join("agent-center/modules/appearance/staging")
            .exists());
    });
}

#[test]
fn validates_background_and_writes_sidecar() {
    let home = temp_home("background");
    with_env(&[("HOME", home.to_str())], || {
        let dir = write_valid_background(&home);
        let result = desktop_agent_center_background_validate_blocking(
            DesktopAgentCenterBackgroundValidatePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                background_asset_id: "bg_ab12cd34ef56".to_string(),
            },
        )
        .expect("validate background");
        assert_eq!(result.status, AgentCenterBackgroundValidationStatus::Valid);
        assert!(dir.join(VALIDATION_FILE_NAME).exists());
    });
}

#[test]
fn rejects_svg_background_manifest() {
    let home = temp_home("background-svg");
    with_env(&[("HOME", home.to_str())], || {
        let dir = write_valid_background(&home);
        let mut value: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(MANIFEST_FILE_NAME)).expect("read manifest"),
        )
        .expect("manifest");
        value["image_file"] = json!("image.svg");
        value["mime"] = json!("image/svg+xml");
        fs::write(dir.join("image.svg"), b"<svg></svg>").expect("svg");
        fs::write(dir.join(MANIFEST_FILE_NAME), value.to_string()).expect("write manifest");
        let result = desktop_agent_center_background_validate_blocking(
            DesktopAgentCenterBackgroundValidatePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                background_asset_id: "bg_ab12cd34ef56".to_string(),
            },
        )
        .expect("validate background");
        assert_eq!(
            result.status,
            AgentCenterBackgroundValidationStatus::UnsupportedMime
        );
    });
}
