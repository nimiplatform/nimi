use super::*;
use crate::test_support::with_product_data_home;
use std::fs;
use std::path::PathBuf;

fn temp_home(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nimi-agent-center-{prefix}-{}", now_nanos()));
    fs::create_dir_all(&dir).expect("create temp home");
    dir
}

fn owner_user_id() -> String {
    "owner_1".to_string()
}

fn realm_agent_id() -> String {
    "agent_1".to_string()
}

fn local_agent_ref() -> String {
    "local-agent:owner_1:agent_1".to_string()
}

fn scope_payload() -> DesktopAgentCenterConfigScopePayload {
    DesktopAgentCenterConfigScopePayload {
        account_id: "account_1".to_string(),
        owner_user_id: owner_user_id(),
        realm_agent_id: realm_agent_id(),
        local_agent_ref: local_agent_ref(),
    }
}

fn valid_config() -> AgentCenterLocalConfig {
    let (_account_id, scope) = scope_from_payload(&scope_payload()).expect("scope");
    let mut config = default_config("account_1", &scope);
    config.modules.avatar_asset.local_avatar_asset_ref = Some("live2d_ab12cd34ef56".to_string());
    config.modules.avatar_asset.backend_kind = AgentCenterAvatarBackendKind::Live2d;
    config
}

#[test]
fn local_agent_scope_requires_exact_derived_ref() {
    assert!(
        validate_local_agent_scope("owner_1", "agent_1", "local-agent:owner_1:agent_1").is_ok()
    );
    assert!(validate_local_agent_scope("owner_1", "agent_1", "agent_1").is_err());
    assert!(
        validate_local_agent_scope("owner_1", "agent_1", "local-agent:owner_2:agent_1").is_err()
    );
    assert!(
        validate_local_agent_scope("owner_1", "agent_1", "local-agent:owner_1:agent_2").is_err()
    );
    assert!(validate_local_agent_scope("owner_1", "agent_1", "agent:abc.def+1").is_err());
}

#[test]
fn missing_config_returns_default_without_creating_file() {
    let home = temp_home("default");
    with_product_data_home(&home, || {
        let config = desktop_agent_center_config_get_blocking("account_1", scope_payload())
            .expect("default config");
        assert_eq!(config.config_kind, AGENT_CENTER_CONFIG_KIND);
        assert_eq!(config.account_id, "account_1");
        assert_eq!(config.owner_user_id, owner_user_id());
        assert_eq!(config.realm_agent_id, realm_agent_id());
        assert_eq!(config.local_agent_ref, local_agent_ref());
        assert!(config.modules.avatar_asset.local_avatar_asset_ref.is_none());
        assert!(config.modules.avatar_asset.live2d_calibration_ref.is_none());
        assert!(!home
            .join(format!(
                ".nimi/data/accounts/account_1/agents/{}/agent-center/config.json",
                local_scope_path_segment(&local_agent_ref())
            ))
            .exists());
    });
}

#[test]
fn put_persists_and_get_reads_valid_config() {
    let home = temp_home("persist");
    with_product_data_home(&home, || {
        let config = valid_config();
        desktop_agent_center_config_put_blocking(
            "account_1",
            DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                config,
            },
        )
        .expect("put config");
        let loaded = desktop_agent_center_config_get_blocking("account_1", scope_payload())
            .expect("get config");
        assert_eq!(loaded.account_id, "account_1");
        assert_eq!(loaded.owner_user_id, owner_user_id());
        assert_eq!(loaded.realm_agent_id, realm_agent_id());
        assert_eq!(loaded.local_agent_ref, local_agent_ref());
        assert_eq!(
            loaded
                .modules
                .avatar_asset
                .local_avatar_asset_ref
                .as_deref(),
            Some("live2d_ab12cd34ef56")
        );
    });
}

#[test]
fn put_accepts_opaque_live2d_calibration_ref() {
    let home = temp_home("live2d-calibration-ref");
    with_product_data_home(&home, || {
        let mut config = valid_config();
        config.modules.avatar_asset.live2d_calibration_ref =
            Some("live2d_calibration_ab12cd34ef56".to_string());
        desktop_agent_center_config_put_blocking(
            "account_1",
            DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                config,
            },
        )
        .expect("calibration ref accepted");
        let loaded = desktop_agent_center_config_get_blocking("account_1", scope_payload())
            .expect("get config");
        assert_eq!(
            loaded
                .modules
                .avatar_asset
                .live2d_calibration_ref
                .as_deref(),
            Some("live2d_calibration_ab12cd34ef56")
        );
    });
}

#[test]
fn put_rejects_malformed_live2d_calibration_ref() {
    let home = temp_home("live2d-calibration-ref-shape");
    with_product_data_home(&home, || {
        let mut config = valid_config();
        config.modules.avatar_asset.live2d_calibration_ref =
            Some("live2d_calibration_nothex".to_string());
        let err = desktop_agent_center_config_put_blocking(
            "account_1",
            DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                config,
            },
        )
        .expect_err("malformed calibration ref rejected");
        assert!(err.contains(
            "modules.avatar_asset.live2d_calibration_ref must end with 12 lowercase hex characters"
        ));
    });
}

#[test]
fn put_rejects_live2d_calibration_ref_for_non_live2d_backend() {
    let home = temp_home("live2d-calibration-ref-backend");
    with_product_data_home(&home, || {
        let mut config = valid_config();
        config.modules.avatar_asset.local_avatar_asset_ref = Some("vrm_ab12cd34ef56".to_string());
        config.modules.avatar_asset.backend_kind = AgentCenterAvatarBackendKind::Vrm;
        config.modules.avatar_asset.live2d_calibration_ref =
            Some("live2d_calibration_ab12cd34ef56".to_string());
        let err = desktop_agent_center_config_put_blocking(
            "account_1",
            DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                config,
            },
        )
        .expect_err("backend-mismatched calibration ref rejected");
        assert!(err.contains("live2d_calibration_ref requires live2d backend"));
    });
}

#[test]
fn put_rejects_avatar_backend_kind_mismatch_for_selected_local_asset() {
    let home = temp_home("avatar-backend-mismatch");
    with_product_data_home(&home, || {
        let mut config = valid_config();
        config.modules.avatar_asset.local_avatar_asset_ref =
            Some("live2d_ab12cd34ef56".to_string());
        config.modules.avatar_asset.backend_kind = AgentCenterAvatarBackendKind::Vrm;
        let err = desktop_agent_center_config_put_blocking(
            "account_1",
            DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                config,
            },
        )
        .expect_err("backend mismatch rejected");
        assert!(err.contains("backend_kind must match local Avatar asset id prefix"));
    });
}

#[test]
fn put_rejects_malformed_avatar_asset_ref() {
    let home = temp_home("avatar-asset-ref-shape");
    with_product_data_home(&home, || {
        let mut config = valid_config();
        config.modules.avatar_asset.local_avatar_asset_ref = Some("live2d_nothex".to_string());
        config.modules.avatar_asset.backend_kind = AgentCenterAvatarBackendKind::Live2d;
        let err = desktop_agent_center_config_put_blocking(
            "account_1",
            DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                config,
            },
        )
        .expect_err("malformed local Avatar asset ref rejected");
        assert!(err.contains(
            "modules.avatar_asset.local_avatar_asset_ref must end with 12 lowercase hex characters"
        ));
    });
}

#[test]
fn config_put_payload_rejects_forbidden_launch_context_fields() {
    let payload = serde_json::json!({
        "accountId": "account_1",
        "ownerUserId": owner_user_id(),
        "realmAgentId": realm_agent_id(),
        "localAgentRef": local_agent_ref(),
        "packagePath": "/tmp/avatar.vrm",
        "config": valid_config(),
    });

    let err = serde_json::from_value::<DesktopAgentCenterConfigPutPayload>(payload)
        .expect_err("unknown launch context field rejected at payload boundary");
    assert!(err.to_string().contains("packagePath") || err.to_string().contains("unknown field"));
}

#[test]
fn put_rejects_scope_mismatch() {
    let home = temp_home("scope");
    with_product_data_home(&home, || {
        let err = desktop_agent_center_config_put_blocking(
            "account_1",
            DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: "agent_2".to_string(),
                local_agent_ref: local_agent_ref(),
                config: valid_config(),
            },
        )
        .expect_err("scope mismatch");
        assert!(err.contains("localAgentRef"));
    });
}

#[test]
fn get_projects_scoped_identity_into_pre_cutover_config() {
    let home = temp_home("identity-projection");
    with_product_data_home(&home, || {
        let dir = home.join(format!(
            ".nimi/data/accounts/account_1/agents/{}/agent-center",
            local_scope_path_segment(&local_agent_ref())
        ));
        fs::create_dir_all(&dir).expect("dir");
        fs::write(
            dir.join(CONFIG_FILE_NAME),
            r#"{
              "schema_version": 1,
              "config_kind": "agent_center_local_config",
              "modules": {
                "appearance": {"schema_version": 1, "background_asset_id": null, "motion": "system"},
                "avatar_asset": {
                  "schema_version": 1,
                  "conversation_anchor_scope": "current_anchor",
                  "local_avatar_asset_ref": "live2d_ab12cd34ef56",
                  "live2d_adapter_manifest_source": "none",
                  "live2d_adapter_manifest_ref": null,
                  "avatar_instance_policy": "reuse_active_instance",
                  "backend_kind": "live2d",
                  "backend_capability_profile_ref": "avatar.backend_profile:live2d:live2d_ab12cd34ef56:import_validated",
                  "generated_motion_provider_policy": "require_profile_support",
                  "launch_mode": "manual",
                  "debug_profile": "standard",
                  "updated_at": "2026-04-27T00:00:00Z",
                  "provenance": {"source": "runtime_projection", "evidence_ref": "agent-center-avatar-config-default"}
                },
                "local_history": {"schema_version": 1, "last_cleared_at": null},
                "ui": {"schema_version": 1, "last_section": "overview"}
              }
            }"#,
        )
        .expect("write config");

        let loaded = desktop_agent_center_config_get_blocking("account_1", scope_payload())
            .expect("projected config");

        assert_eq!(loaded.account_id, "account_1");
        assert_eq!(loaded.owner_user_id, owner_user_id());
        assert_eq!(loaded.realm_agent_id, realm_agent_id());
        assert_eq!(loaded.local_agent_ref, local_agent_ref());
        let persisted = fs::read_to_string(dir.join(CONFIG_FILE_NAME)).expect("persisted");
        assert!(persisted.contains(r#""account_id": "account_1""#));
        assert!(persisted.contains(r#""local_agent_ref": "local-agent:owner_1:agent_1""#));
    });
}

#[test]
fn get_rejects_unknown_fields_in_stored_json() {
    let home = temp_home("unknown");
    with_product_data_home(&home, || {
        let dir = home.join(format!(
            ".nimi/data/accounts/account_1/agents/{}/agent-center",
            local_scope_path_segment(&local_agent_ref())
        ));
        fs::create_dir_all(&dir).expect("dir");
        fs::write(
            dir.join(CONFIG_FILE_NAME),
            r#"{
              "schema_version": 1,
              "config_kind": "agent_center_local_config",
              "account_id": "account_1",
              "owner_user_id": "owner_1",
              "realm_agent_id": "agent_1",
              "local_agent_ref": "local-agent:owner_1:agent_1",
              "runtime_profile": "forbidden",
              "modules": {
                "appearance": {"schema_version": 1, "background_asset_id": null, "motion": "system"},
                "avatar_asset": {
                  "schema_version": 1,
                  "selected_package": null,
                  "conversation_anchor_scope": "current_anchor",
                  "local_avatar_asset_ref": null,
                  "live2d_adapter_manifest_source": "none",
                  "live2d_adapter_manifest_ref": null,
                  "avatar_instance_policy": "reuse_active_instance",
                  "backend_kind": "live2d",
                  "backend_capability_profile_ref": null,
                  "generated_motion_provider_policy": "require_profile_support",
                  "launch_mode": "manual",
                  "debug_profile": "standard",
                  "updated_at": "2026-04-27T00:00:00Z",
                  "provenance": {"source": "runtime_projection", "evidence_ref": "agent-center-avatar-config-default"},
                  "last_validated_at": null
                },
                "local_history": {"schema_version": 1, "last_cleared_at": null},
                "ui": {"schema_version": 1, "last_section": "overview"}
              }
            }"#,
        )
        .expect("write corrupt config");
        let err = desktop_agent_center_config_get_blocking("account_1", scope_payload())
            .expect_err("unknown field rejected");
        assert!(err.contains("runtime_profile") || err.contains("unknown field"));
    });
}
