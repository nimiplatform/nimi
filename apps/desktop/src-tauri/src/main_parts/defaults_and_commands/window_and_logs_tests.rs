use super::{
    avatar_runtime_env_pairs, build_avatar_close_handoff_uri, build_avatar_handoff_uri,
    confirm_dialog, require_fresh_inferred_avatar_target, ConfirmDialogPayload,
    DesktopAvatarCloseHandoffPayload, DesktopAvatarLaunchHandoffPayload,
};
use crate::test_support::test_guard;
use std::time::Duration;
use std::{fs, path::PathBuf};

fn make_temp_dir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nimi-desktop-confirm-dialog-{}-{}",
        prefix,
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn launch_payload() -> DesktopAvatarLaunchHandoffPayload {
    DesktopAvatarLaunchHandoffPayload {
        agent_id: "local-agent:owner-1:agent-1".to_string(),
        avatar_instance_id: Some("instance-1".to_string()),
        launch_source: Some("desktop-agent-chat".to_string()),
    }
}

#[test]
fn confirm_dialog_uses_desktop_e2e_override_sequence() {
    let _guard = test_guard();
    let temp = make_temp_dir("fixture");
    let fixture_path = temp.join("fixture.json");
    fs::write(
        &fixture_path,
        r#"{
  "tauriFixture": {
    "confirmDialog": {
      "responses": [
        { "confirmed": false },
        { "confirmed": true }
      ]
    }
  }
}"#,
    )
    .expect("write fixture");

    let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
    std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());

    let first = confirm_dialog(ConfirmDialogPayload {
        title: "Upgrade to Standard memory".to_string(),
        description: "Bind canonical memory?".to_string(),
        level: Some("warning".to_string()),
    });
    let second = confirm_dialog(ConfirmDialogPayload {
        title: "Upgrade to Standard memory".to_string(),
        description: "Bind canonical memory?".to_string(),
        level: Some("warning".to_string()),
    });
    let third = confirm_dialog(ConfirmDialogPayload {
        title: "Upgrade to Standard memory".to_string(),
        description: "Bind canonical memory?".to_string(),
        level: Some("warning".to_string()),
    });

    match previous {
        Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
        None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
    }

    assert!(!first.confirmed);
    assert!(second.confirmed);
    assert!(third.confirmed);
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn avatar_handoff_uri_includes_only_minimal_launch_intent() {
    let uri = build_avatar_handoff_uri(&launch_payload()).expect("valid handoff uri");

    assert!(uri.starts_with("nimi-avatar://launch?"));
    let parsed = url::Url::parse(uri.as_str()).expect("parse handoff uri");
    let query: std::collections::BTreeMap<String, String> =
        parsed.query_pairs().into_owned().collect();
    assert_eq!(
        query.get("agent_id").map(String::as_str),
        Some("local-agent:owner-1:agent-1")
    );
    assert_eq!(
        query.get("avatar_instance_id").map(String::as_str),
        Some("instance-1")
    );
    assert_eq!(
        query.get("launch_source").map(String::as_str),
        Some("desktop-agent-chat")
    );
    assert_eq!(
        query.keys().cloned().collect::<Vec<_>>(),
        vec![
            "agent_id".to_string(),
            "avatar_instance_id".to_string(),
            "launch_source".to_string(),
        ]
    );
    assert!(!uri.contains("owner_user_id"));
    assert!(!uri.contains("realm_agent_id"));
    assert!(!uri.contains("local_agent_ref"));
    assert!(!uri.contains("conversation_anchor_id"));
    assert!(!uri.contains("runtime_app_id"));
    assert!(!uri.contains("world_id"));
    assert!(!uri.contains("binding_id"));
    assert!(!uri.contains("binding_app_instance_id"));
    assert!(!uri.contains("binding_window_id"));
    assert!(!uri.contains("binding_purpose"));
    assert!(!uri.contains("anchor_mode=open_new"));
    assert!(!uri.contains("subject_user_id"));
    assert!(!uri.contains("agent_center_account_id"));
    assert!(!uri.contains("account_id"));
    assert!(!uri.contains("access_token"));
    assert!(!uri.contains("refresh_token"));
    assert!(!uri.contains("jwt"));
    assert!(!uri.contains("realm_base_url"));
    assert!(!uri.contains("manifest_path"));
    assert!(!uri.contains("package_path"));
}

#[test]
fn avatar_runtime_env_pairs_forward_runtime_defaults_without_realm_or_token() {
    let _guard = test_guard();
    let keys = [
        "NIMI_E2E_FIXTURE_PATH",
        "NIMI_REALM_URL",
        "NIMI_REALM_JWKS_URL",
        "NIMI_REALM_REVOCATION_URL",
        "NIMI_REALM_JWT_ISSUER",
        "NIMI_REALM_JWT_AUDIENCE",
        "NIMI_WORLD_ID",
        "NIMI_AGENT_ID",
        "NIMI_ACCESS_TOKEN",
        "NIMI_E2E_AUTH_SESSION_STORAGE",
        "NIMI_E2E_AUTH_SESSION_MASTER_KEY",
        "NIMI_E2E_PROFILE",
        "NIMI_RUNTIME_CONFIG_PATH",
        "NIMI_RUNTIME_GRPC_ADDR",
        "NIMI_RUNTIME_HTTP_ADDR",
        "NIMI_RUNTIME_LOCAL_STATE_PATH",
        "NIMI_RUNTIME_LOCK_PATH",
        "NIMI_RUNTIME_BRIDGE_MODE",
        "NIMI_RUNTIME_BRIDGE_DEBUG",
        "NIMI_E2E_BACKEND_LOG_PATH",
        "NIMI_DATA_ROOT",
        "NIMI_LOCAL_PROVIDER_ENDPOINT",
        "NIMI_LOCAL_PROVIDER_MODEL",
        "NIMI_LOCAL_OPENAI_ENDPOINT",
        "NIMI_CONNECTOR_ID",
        "NIMI_PROVIDER",
    ];
    let saved: Vec<(&str, Option<String>)> = keys
        .iter()
        .map(|key| (*key, std::env::var(key).ok()))
        .collect();
    let fixture_dir = make_temp_dir("avatar-runtime-env");
    let selected_data_root = fixture_dir.join("selected-nimi-data");
    let fixture_path = fixture_dir.join("fixture.json");
    fs::write(
        &fixture_path,
        format!(
            r#"{{
  "tauriFixture": {{
    "productControlRecord": {{
      "schemaVersion": 1,
      "installId": "e2e-ready-install",
      "productVersion": "0.1.0",
      "state": "ready_for_use",
      "dataRoot": {{
        "path": "{}",
        "status": "ready",
        "selectedAt": "2026-03-15T00:00:00.000Z",
        "verifiedAt": "2026-03-15T00:00:00.000Z",
        "selectedAtUnixMs": 1773532800000,
        "verifiedAtUnixMs": 1773532800000
      }},
      "firstRun": {{
        "installLevel": "minimal",
        "aiProfileAlias": "minimal",
        "completed": true,
        "completedAt": "2026-03-15T00:00:00.000Z",
        "initializationPlanId": "e2e-first-run-plan",
        "baselineProfileRef": "ai-profile:minimal",
        "baselineCommitId": "e2e-fixture",
        "accountDefaultProfileRef": "account-default:e2e",
        "builtInAiConfigRefs": ["ai-config:nimi-chat:e2e"],
        "runtimeBaselineRef": "runtime-baseline:e2e",
        "executionEvidenceRef": "e2e-ready-entry"
      }},
      "pointers": {{
        "runtimeConfigPath": "/tmp/nimi-e2e-runtime/config.json"
      }},
      "repair": {{
        "required": false,
        "reason": null
      }}
    }}
  }}
}}"#,
            selected_data_root.display()
        ),
    )
    .expect("write fixture");
    std::env::remove_var("NIMI_E2E_FIXTURE_PATH");
    std::env::set_var("NIMI_REALM_URL", "http://127.0.0.1:50803");
    std::env::set_var(
        "NIMI_REALM_JWKS_URL",
        "http://127.0.0.1:50803/api/auth/jwks",
    );
    std::env::set_var(
        "NIMI_REALM_REVOCATION_URL",
        "http://127.0.0.1:50803/api/auth/sessions/introspect",
    );
    std::env::set_var("NIMI_REALM_JWT_ISSUER", "http://127.0.0.1:50803");
    std::env::set_var("NIMI_REALM_JWT_AUDIENCE", "nimi-runtime");
    std::env::set_var("NIMI_WORLD_ID", "world-e2e-1");
    std::env::set_var("NIMI_AGENT_ID", "agent-e2e-alpha");
    std::env::set_var("NIMI_ACCESS_TOKEN", "must-not-forward");
    std::env::set_var("NIMI_E2E_AUTH_SESSION_STORAGE", "encrypted-file");
    std::env::set_var("NIMI_E2E_AUTH_SESSION_MASTER_KEY", "master-key");
    std::env::set_var("NIMI_E2E_PROFILE", "chat.live2d-avatar-product-smoke");
    std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
    std::env::set_var(
        "NIMI_RUNTIME_CONFIG_PATH",
        fixture_dir.join("runtime-config.json").as_os_str(),
    );
    std::env::set_var("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:51801");
    std::env::set_var("NIMI_RUNTIME_HTTP_ADDR", "127.0.0.1:51802");
    std::env::set_var(
        "NIMI_RUNTIME_LOCAL_STATE_PATH",
        fixture_dir.join("runtime-state.json").as_os_str(),
    );
    std::env::set_var(
        "NIMI_RUNTIME_LOCK_PATH",
        fixture_dir.join("runtime.lock").as_os_str(),
    );
    std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RELEASE");
    std::env::set_var("NIMI_RUNTIME_BRIDGE_DEBUG", "1");
    std::env::set_var("NIMI_DATA_ROOT", "/tmp/must-not-forward-raw-env");
    std::env::set_var("NIMI_LOCAL_PROVIDER_ENDPOINT", "http://127.0.0.1:1234/v1");
    std::env::set_var("NIMI_LOCAL_PROVIDER_MODEL", "legacy-model");
    std::env::set_var("NIMI_LOCAL_OPENAI_ENDPOINT", "http://localhost:1234/v1");
    std::env::set_var("NIMI_CONNECTOR_ID", "legacy-connector");
    std::env::set_var("NIMI_PROVIDER", "legacy-provider");
    std::env::set_var(
        "NIMI_E2E_BACKEND_LOG_PATH",
        fixture_dir.join("backend.log").as_os_str(),
    );

    let pairs = avatar_runtime_env_pairs().expect("avatar env pairs");

    for (key, value) in saved {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    assert!(pairs.contains(&("NIMI_WORLD_ID", "world-e2e-1".to_string())));
    assert!(pairs.contains(&("NIMI_AGENT_ID", "agent-e2e-alpha".to_string())));
    assert!(!pairs.iter().any(|(key, _)| *key == "NIMI_E2E_PROFILE"));
    assert!(pairs.contains(&(
        "NIMI_E2E_FIXTURE_PATH",
        fixture_path.to_string_lossy().to_string()
    )));
    assert!(pairs.contains(&(
        "NIMI_RUNTIME_CONFIG_PATH",
        fixture_dir
            .join("runtime-config.json")
            .to_string_lossy()
            .to_string()
    )));
    assert!(pairs.contains(&("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:51801".to_string())));
    assert!(pairs.contains(&("NIMI_RUNTIME_HTTP_ADDR", "127.0.0.1:51802".to_string())));
    assert!(pairs.contains(&(
        "NIMI_RUNTIME_LOCAL_STATE_PATH",
        fixture_dir
            .join("runtime-state.json")
            .to_string_lossy()
            .to_string()
    )));
    assert!(pairs.contains(&(
        "NIMI_RUNTIME_LOCK_PATH",
        fixture_dir
            .join("runtime.lock")
            .to_string_lossy()
            .to_string()
    )));
    assert!(pairs.contains(&("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME".to_string())));
    assert!(!pairs.contains(&("NIMI_RUNTIME_BRIDGE_MODE", "RELEASE".to_string())));
    assert!(pairs.contains(&(
        "NIMI_DATA_ROOT",
        selected_data_root.to_string_lossy().to_string()
    )));
    assert!(!pairs.contains(&(
        "NIMI_DATA_ROOT",
        "/tmp/must-not-forward-raw-env".to_string()
    )));
    assert!(pairs.contains(&(
        "NIMI_E2E_BACKEND_LOG_PATH",
        fixture_dir
            .join("backend.log")
            .to_string_lossy()
            .to_string()
    )));
    assert!(!pairs.iter().any(|(key, _)| key.starts_with("NIMI_REALM")));
    assert!(!pairs.iter().any(|(key, _)| key.contains("AUTH_SESSION")));
    assert!(!pairs.iter().any(|(key, _)| key.contains("ACCESS_TOKEN")));
    for retired_route_key in [
        "NIMI_LOCAL_PROVIDER_ENDPOINT",
        "NIMI_LOCAL_PROVIDER_MODEL",
        "NIMI_LOCAL_OPENAI_ENDPOINT",
        "NIMI_CONNECTOR_ID",
        "NIMI_PROVIDER",
    ] {
        assert!(
            !pairs.iter().any(|(key, _)| *key == retired_route_key),
            "Avatar handoff must not forward retired route env {retired_route_key}"
        );
    }
    let _ = fs::remove_dir_all(fixture_dir);
}

#[test]
fn inferred_avatar_target_rejects_source_newer_than_binary() {
    let temp = make_temp_dir("avatar-target-stale");
    let repo = temp.join("repo");
    let binary = repo
        .join("apps")
        .join("avatar")
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("nimiplatform-avatar");
    fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary parent");
    fs::write(&binary, "old avatar binary").expect("write binary");
    std::thread::sleep(Duration::from_millis(50));
    let source = repo
        .join("apps")
        .join("avatar")
        .join("src-tauri")
        .join("src")
        .join("agent_center_avatar_asset.rs");
    fs::create_dir_all(source.parent().expect("source parent")).expect("create source parent");
    fs::write(&source, "fn main() {}").expect("write source");

    let error = require_fresh_inferred_avatar_target(&repo, &binary)
        .expect_err("stale repo-local Avatar target must fail");

    assert!(error.contains("repo-local Avatar target is older than Avatar source"));
    assert!(error.contains("pnpm build:avatar"));
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn inferred_avatar_target_accepts_binary_newer_than_source() {
    let temp = make_temp_dir("avatar-target-fresh");
    let repo = temp.join("repo");
    let source = repo
        .join("apps")
        .join("avatar")
        .join("src-tauri")
        .join("src")
        .join("agent_center_avatar_asset.rs");
    fs::create_dir_all(source.parent().expect("source parent")).expect("create source parent");
    fs::write(&source, "fn main() {}").expect("write source");
    std::thread::sleep(Duration::from_millis(50));
    let binary = repo
        .join("apps")
        .join("avatar")
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("nimiplatform-avatar");
    fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary parent");
    fs::write(&binary, "fresh avatar binary").expect("write binary");

    require_fresh_inferred_avatar_target(&repo, &binary).expect("fresh target should pass");
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn avatar_handoff_uri_rejects_missing_agent_id() {
    let error = build_avatar_handoff_uri(&DesktopAvatarLaunchHandoffPayload {
        agent_id: " ".to_string(),
        avatar_instance_id: Some("instance-1".to_string()),
        launch_source: None,
    })
    .expect_err("missing agent should fail");

    let payload: serde_json::Value =
        serde_json::from_str(error.as_str()).expect("structured error json");
    assert_eq!(
        payload
            .get("reasonCode")
            .and_then(serde_json::Value::as_str),
        Some("DESKTOP_AVATAR_HANDOFF_INVALID"),
    );
}

#[test]
fn avatar_handoff_uri_rejects_bare_agent_id() {
    let error = build_avatar_handoff_uri(&DesktopAvatarLaunchHandoffPayload {
        agent_id: "agent-1".to_string(),
        avatar_instance_id: Some("instance-1".to_string()),
        launch_source: None,
    })
    .expect_err("bare agent id should fail");

    let payload: serde_json::Value =
        serde_json::from_str(error.as_str()).expect("structured error json");
    assert_eq!(
        payload
            .get("reasonCode")
            .and_then(serde_json::Value::as_str),
        Some("DESKTOP_AVATAR_HANDOFF_INVALID"),
    );
    assert!(payload
        .get("message")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .contains("local-agent ref"));
}

#[test]
fn avatar_launch_payload_rejects_old_authority_fields() {
    let payload = serde_json::json!({
        "agentId": "local-agent:owner-1:agent-1",
        "ownerUserId": "owner-1",
        "realmAgentId": "agent-1",
        "localAgentRef": "local-agent:owner-1:agent-1",
        "conversationAnchorId": "anchor-1",
        "avatarInstanceId": "instance-1"
    });
    let error = serde_json::from_value::<DesktopAvatarLaunchHandoffPayload>(payload)
        .expect_err("old launch authority fields must fail closed");
    assert!(error.to_string().contains("unknown field"));
}

#[test]
fn avatar_close_handoff_uri_includes_instance_context() {
    let uri = build_avatar_close_handoff_uri(&DesktopAvatarCloseHandoffPayload {
        avatar_instance_id: "instance-1".to_string(),
        closed_by: Some("desktop".to_string()),
        source_surface: Some("desktop-agent-chat".to_string()),
    })
    .expect("valid close uri");

    assert!(uri.starts_with("nimi-avatar://close?"));
    assert!(uri.contains("avatar_instance_id=instance-1"));
    assert!(uri.contains("closed_by=desktop"));
    assert!(uri.contains("source_surface=desktop-agent-chat"));
}

#[test]
fn avatar_close_handoff_uri_rejects_missing_instance_id() {
    let error = build_avatar_close_handoff_uri(&DesktopAvatarCloseHandoffPayload {
        avatar_instance_id: "   ".to_string(),
        closed_by: None,
        source_surface: None,
    })
    .expect_err("missing instance should fail");

    let payload: serde_json::Value =
        serde_json::from_str(error.as_str()).expect("structured error json");
    assert_eq!(
        payload
            .get("reasonCode")
            .and_then(serde_json::Value::as_str),
        Some("DESKTOP_AVATAR_HANDOFF_INVALID"),
    );
}
