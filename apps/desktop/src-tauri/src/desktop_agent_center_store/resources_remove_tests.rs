use super::*;

#[test]
fn removes_agent_local_resources_by_quarantining_agent_center_tree() {
    let home = temp_home("remove-agent-tree");
    with_env(&[("HOME", home.to_str())], || {
        let agent_center = agent_center_marker(&home, "agent_1");

        let result = desktop_agent_center_agent_local_resources_remove(
            DesktopAgentCenterAgentLocalResourcesRemovePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
            },
        )
        .expect("remove agent local resources");

        assert_eq!(result.resource_kind, "agent_local_resources");
        assert_eq!(result.resource_id, "agent_1");
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
        let agent_one = agent_center_marker(&home, "agent_1");
        let agent_two = agent_center_marker(&home, "agent_2");

        let result = desktop_agent_center_account_local_resources_remove(
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
        let agent_center = agent_center_marker_for_account(&home, account_id, "agent:abc.def+1");

        let result = desktop_agent_center_account_local_resources_remove(
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
        let err =
            desktop_agent_center_background_import(DesktopAgentCenterBackgroundImportPayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                source_path: source.to_string_lossy().to_string(),
                display_name: None,
                select: Some(true),
            })
            .expect_err("svg rejected");
        assert!(err.contains("SVG"));
        assert!(!home
                .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/appearance/staging")
                .exists());
    });
}

#[test]
fn rejects_manifest_that_embeds_validation_status() {
    let home = temp_home("embedded-validation");
    with_env(&[("HOME", home.to_str())], || {
        let dir = write_valid_live2d_package(&home);
        let mut value: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(MANIFEST_FILE_NAME)).expect("read manifest"),
        )
        .expect("manifest");
        value["validation"] = json!({"status": "valid"});
        fs::write(dir.join(MANIFEST_FILE_NAME), value.to_string()).expect("write manifest");
        let result = desktop_agent_center_avatar_package_validate(
            DesktopAgentCenterAvatarPackageValidatePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                package_id: "live2d_ab12cd34ef56".to_string(),
            },
        )
        .expect("validate package");
        assert_eq!(
            result.status,
            AgentCenterAvatarPackageValidationStatus::InvalidManifest
        );
        assert!(result
            .errors
            .iter()
            .any(|entry| entry.code == "manifest_embeds_validation"));
    });
}

#[test]
fn rejects_digest_mismatch() {
    let home = temp_home("digest");
    with_env(&[("HOME", home.to_str())], || {
        let dir = write_valid_live2d_package(&home);
        fs::write(dir.join("files/model.model3.json"), b"changed").expect("change file");
        let result = desktop_agent_center_avatar_package_validate(
            DesktopAgentCenterAvatarPackageValidatePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                package_id: "live2d_ab12cd34ef56".to_string(),
            },
        )
        .expect("validate package");
        assert!(result
            .errors
            .iter()
            .any(|entry| entry.code == "content_digest_mismatch"));
    });
}

#[test]
fn rejects_parent_traversal_path() {
    let home = temp_home("traversal");
    with_env(&[("HOME", home.to_str())], || {
        let dir = write_valid_live2d_package(&home);
        let mut value: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(MANIFEST_FILE_NAME)).expect("read manifest"),
        )
        .expect("manifest");
        value["files"][0]["path"] = json!("../escape.json");
        fs::write(dir.join(MANIFEST_FILE_NAME), value.to_string()).expect("write manifest");
        let result = desktop_agent_center_avatar_package_validate(
            DesktopAgentCenterAvatarPackageValidatePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                package_id: "live2d_ab12cd34ef56".to_string(),
            },
        )
        .expect("validate package");
        assert_eq!(
            result.status,
            AgentCenterAvatarPackageValidationStatus::PathRejected
        );
    });
}

#[test]
fn validates_background_and_writes_sidecar() {
    let home = temp_home("background");
    with_env(&[("HOME", home.to_str())], || {
        let dir = write_valid_background(&home);
        let result =
            desktop_agent_center_background_validate(DesktopAgentCenterBackgroundValidatePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                background_asset_id: "bg_ab12cd34ef56".to_string(),
            })
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
        let result =
            desktop_agent_center_background_validate(DesktopAgentCenterBackgroundValidatePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                background_asset_id: "bg_ab12cd34ef56".to_string(),
            })
            .expect("validate background");
        assert_eq!(
            result.status,
            AgentCenterBackgroundValidationStatus::UnsupportedMime
        );
    });
}
