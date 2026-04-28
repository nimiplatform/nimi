use super::{
    avatar_runtime_env_pairs, build_avatar_close_handoff_uri, build_avatar_handoff_uri,
    confirm_dialog, ConfirmDialogPayload, DesktopAvatarCloseHandoffPayload,
    DesktopAvatarLaunchHandoffPayload, DesktopAvatarScopedBindingProjection,
    DESKTOP_RUNTIME_APP_ID,
};
use crate::test_support::test_guard;
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

fn scoped_binding(anchor_id: &str) -> DesktopAvatarScopedBindingProjection {
    DesktopAvatarScopedBindingProjection {
        binding_id: "binding-1".to_string(),
        binding_handle: Some("binding:binding-1".to_string()),
        runtime_app_id: DESKTOP_RUNTIME_APP_ID.to_string(),
        app_instance_id: "nimi.desktop.local-first-party".to_string(),
        window_id: "desktop-agent-chat".to_string(),
        avatar_instance_id: "instance-1".to_string(),
        agent_id: "agent-1".to_string(),
        conversation_anchor_id: anchor_id.to_string(),
        world_id: Some("world-1".to_string()),
        purpose: "avatar.interaction.consume".to_string(),
        scopes: vec![
            "runtime.agent.turn.read".to_string(),
            "runtime.agent.turn.write".to_string(),
            "runtime.agent.presentation.read".to_string(),
            "runtime.agent.state.read".to_string(),
        ],
        issued_at: Some("2026-04-28T00:00:00.000Z".to_string()),
        expires_at: Some("2026-04-28T01:00:00.000Z".to_string()),
        state: "active".to_string(),
        reason_code: "action_executed".to_string(),
    }
}

fn launch_payload(conversation_anchor_id: &str) -> DesktopAvatarLaunchHandoffPayload {
    DesktopAvatarLaunchHandoffPayload {
        agent_id: "agent-1".to_string(),
        avatar_package_kind: "live2d".to_string(),
        avatar_package_id: "live2d_ab12cd34ef56".to_string(),
        avatar_package_schema_version: Some(1),
        avatar_instance_id: "instance-1".to_string(),
        conversation_anchor_id: conversation_anchor_id.to_string(),
        launched_by: Some(DESKTOP_RUNTIME_APP_ID.to_string()),
        runtime_app_id: Some(DESKTOP_RUNTIME_APP_ID.to_string()),
        source_surface: Some("desktop-agent-chat".to_string()),
        world_id: Some("world-1".to_string()),
        scoped_binding: scoped_binding(conversation_anchor_id),
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
fn avatar_handoff_uri_includes_existing_anchor_context_without_identity_leak() {
    let uri = build_avatar_handoff_uri(&launch_payload("anchor-1")).expect("valid handoff uri");

    assert!(uri.starts_with("nimi-avatar://launch?"));
    assert!(uri.contains("agent_id=agent-1"));
    assert!(uri.contains("avatar_package_kind=live2d"));
    assert!(uri.contains("avatar_package_id=live2d_ab12cd34ef56"));
    assert!(uri.contains("avatar_package_schema_version=1"));
    assert!(uri.contains("avatar_instance_id=instance-1"));
    assert!(uri.contains("conversation_anchor_id=anchor-1"));
    assert!(uri.contains("runtime_app_id=nimi.desktop"));
    assert!(uri.contains("binding_id=binding-1"));
    assert!(uri.contains("binding_app_instance_id=nimi.desktop.local-first-party"));
    assert!(uri.contains("binding_window_id=desktop-agent-chat"));
    assert!(uri.contains("binding_purpose=avatar.interaction.consume"));
    assert!(!uri.contains("anchor_mode=open_new"));
    assert!(!uri.contains("subject_user_id"));
    assert!(!uri.contains("agent_center_account_id"));
    assert!(!uri.contains("account_id"));
    assert!(!uri.contains("user_id"));
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
        "NIMI_RUNTIME_BRIDGE_DEBUG",
    ];
    let saved: Vec<(&str, Option<String>)> = keys
        .iter()
        .map(|key| (*key, std::env::var(key).ok()))
        .collect();
    let fixture_dir = make_temp_dir("avatar-runtime-env");
    let fixture_path = fixture_dir.join("fixture.json");
    fs::write(&fixture_path, "{}").expect("write fixture");
    std::env::remove_var("NIMI_E2E_FIXTURE_PATH");
    std::env::set_var("NIMI_REALM_URL", "http://127.0.0.1:50803");
    std::env::set_var(
        "NIMI_REALM_JWKS_URL",
        "http://127.0.0.1:50803/api/auth/jwks",
    );
    std::env::set_var(
        "NIMI_REALM_REVOCATION_URL",
        "http://127.0.0.1:50803/api/auth/revocation",
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
    std::env::set_var("NIMI_RUNTIME_BRIDGE_DEBUG", "1");

    let pairs = avatar_runtime_env_pairs().expect("avatar env pairs");

    for (key, value) in saved {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    assert!(pairs.contains(&("NIMI_WORLD_ID", "world-e2e-1".to_string())));
    assert!(pairs.contains(&("NIMI_AGENT_ID", "agent-e2e-alpha".to_string())));
    assert!(pairs.contains(&(
        "NIMI_E2E_PROFILE",
        "chat.live2d-avatar-product-smoke".to_string()
    )));
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
    assert!(!pairs.iter().any(|(key, _)| key.starts_with("NIMI_REALM")));
    assert!(!pairs.iter().any(|(key, _)| key.contains("AUTH_SESSION")));
    assert!(!pairs.iter().any(|(key, _)| key.contains("ACCESS_TOKEN")));
    let _ = fs::remove_dir_all(fixture_dir);
}

#[test]
fn avatar_handoff_uri_rejects_missing_anchor_for_existing_mode() {
    let error = build_avatar_handoff_uri(&launch_payload(" "))
        .expect_err("missing anchor should fail");

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
