use super::*;

fn write_agent_center_live2d_package_for_agent(
    home: &Path,
    agent_id: &str,
    entry_content: &str,
) -> PathBuf {
    write_agent_center_live2d_package_for_account_agent(home, "account_1", agent_id, entry_content)
}

fn write_agent_center_live2d_package_for_account_agent(
    home: &Path,
    account_id: &str,
    agent_id: &str,
    entry_content: &str,
) -> PathBuf {
    let package_dir = home
        .join(".nimi/data/accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(agent_id))
        .join("agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56");
    let files_dir = package_dir.join("files");
    fs::create_dir_all(&files_dir).unwrap();
    let entry_path = files_dir.join("ren.model3.json");
    fs::write(&entry_path, entry_content).unwrap();
    let digest = {
        let mut hasher = Sha256::new();
        hasher.update(entry_content.as_bytes());
        format!("{:x}", hasher.finalize())
    };
    let manifest = json!({
        "manifest_version": 1,
        "package_version": "1.0.0",
        "package_id": "live2d_ab12cd34ef56",
        "kind": "live2d",
        "loader_min_version": "1.0.0",
        "display_name": "Ren",
        "display_name_i18n": {},
        "entry_file": "files/ren.model3.json",
        "required_files": ["files/ren.model3.json"],
        "content_digest": format!("sha256:{digest}"),
        "files": [{
            "path": "files/ren.model3.json",
            "sha256": digest,
            "bytes": entry_content.len(),
            "mime": "application/json"
        }],
        "limits": {
            "max_manifest_bytes": 262144,
            "max_package_bytes": 524288000,
            "max_file_bytes": 104857600,
            "max_file_count": 2048
        },
        "capabilities": {},
        "import": {
            "imported_at": "2026-04-27T00:00:00Z",
            "source_label": "ren",
            "source_fingerprint": format!("sha256:{digest}")
        }
    });
    fs::write(
        package_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
    write_agent_center_local_config(
        home,
        account_id,
        agent_id,
        Some(("live2d", "live2d_ab12cd34ef56")),
    );
    package_dir
}

fn write_agent_center_live2d_package(home: &Path, entry_content: &str) -> PathBuf {
    write_agent_center_live2d_package_for_agent(home, "agent_1", entry_content)
}

fn write_agent_center_vrm_package(home: &Path, entry_content: &[u8]) -> PathBuf {
    let package_dir = home
        .join(".nimi/data/accounts/account_1/agents/agent_1")
        .join("agent-center/modules/avatar_package/packages/vrm/vrm_ab12cd34ef56");
    let files_dir = package_dir.join("files");
    fs::create_dir_all(&files_dir).unwrap();
    let entry_path = files_dir.join("model.vrm");
    fs::write(&entry_path, entry_content).unwrap();
    let digest = {
        let mut hasher = Sha256::new();
        hasher.update(entry_content);
        format!("{:x}", hasher.finalize())
    };
    let manifest = json!({
        "manifest_version": 1,
        "package_version": "1.0.0",
        "package_id": "vrm_ab12cd34ef56",
        "kind": "vrm",
        "loader_min_version": "1.0.0",
        "display_name": "VRM",
        "display_name_i18n": {},
        "entry_file": "files/model.vrm",
        "required_files": ["files/model.vrm"],
        "content_digest": format!("sha256:{digest}"),
        "files": [{
            "path": "files/model.vrm",
            "sha256": digest,
            "bytes": entry_content.len(),
            "mime": "model/vrm"
        }],
        "limits": {
            "max_manifest_bytes": 262144,
            "max_package_bytes": 524288000,
            "max_file_bytes": 104857600,
            "max_file_count": 2048
        },
        "capabilities": {},
        "import": {
            "imported_at": "2026-04-27T00:00:00Z",
            "source_label": "model.vrm",
            "source_fingerprint": format!("sha256:{digest}")
        }
    });
    fs::write(
        package_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
    write_agent_center_local_config(
        home,
        "account_1",
        "agent_1",
        Some(("vrm", "vrm_ab12cd34ef56")),
    );
    package_dir
}

#[test]
fn normalize_avatar_launch_instance_id_writes_generated_id_when_omitted() {
    let mut context = AvatarLaunchContext {
        agent_id: "agent_1".to_string(),
        avatar_instance_id: None,
        launch_source: Some("desktop-agent-chat".to_string()),
    };

    let instance_id =
        normalize_avatar_launch_instance_id(&mut context, "avatar-generated".to_string());

    assert_eq!(instance_id, "avatar-generated");
    assert_eq!(
        context.avatar_instance_id.as_deref(),
        Some("avatar-generated")
    );
}

#[test]
fn normalize_avatar_launch_instance_id_preserves_explicit_id() {
    let mut context = AvatarLaunchContext {
        agent_id: "agent_1".to_string(),
        avatar_instance_id: Some("instance-explicit".to_string()),
        launch_source: None,
    };

    let instance_id =
        normalize_avatar_launch_instance_id(&mut context, "avatar-generated".to_string());

    assert_eq!(instance_id, "instance-explicit");
    assert_eq!(
        context.avatar_instance_id.as_deref(),
        Some("instance-explicit")
    );
}

fn write_agent_center_local_config(
    home: &Path,
    account_id: &str,
    agent_id: &str,
    selected_package: Option<(&str, &str)>,
) {
    write_agent_center_local_config_with_adapter_manifest(
        home,
        account_id,
        agent_id,
        selected_package,
        "none",
        None,
    );
}

fn write_agent_center_local_config_with_adapter_manifest(
    home: &Path,
    account_id: &str,
    agent_id: &str,
    selected_package: Option<(&str, &str)>,
    adapter_manifest_source: &str,
    adapter_manifest_ref: Option<&str>,
) {
    let config_dir = home
        .join(".nimi/data/accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(agent_id))
        .join("agent-center");
    fs::create_dir_all(&config_dir).unwrap();
    let selected_package = selected_package.map(|(kind, package_id)| {
        json!({
            "kind": kind,
            "package_id": package_id,
        })
    });
    let config = json!({
        "schema_version": 1,
        "config_kind": "agent_center_local_config",
        "account_id": account_id,
        "agent_id": agent_id,
        "modules": {
            "avatar_package": {
                "schema_version": 1,
                "selected_package": selected_package,
                "conversation_anchor_scope": "current_anchor",
                "avatar_package_ref": selected_package.as_ref().and_then(|value| value.get("package_id")).cloned(),
                "live2d_adapter_manifest_source": adapter_manifest_source,
                "live2d_adapter_manifest_ref": adapter_manifest_ref,
                "avatar_instance_policy": "reuse_active_instance",
                "backend_kind": selected_package.as_ref().and_then(|value| value.get("kind")).and_then(|value| value.as_str()).unwrap_or("live2d"),
                "backend_capability_profile_ref": null,
                "generated_motion_provider_policy": "require_profile_support",
                "launch_mode": "manual",
                "debug_profile": "standard",
                "updated_at": "2026-04-27T00:00:00Z",
                "provenance": {
                    "source": "import_validation",
                    "evidence_ref": selected_package.as_ref().and_then(|value| value.get("package_id")).and_then(|value| value.as_str()).unwrap_or("agent-center-avatar-config-default")
                },
                "last_validated_at": "2026-04-27T00:00:00Z",
            }
        }
    });
    fs::write(
        config_dir.join("config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
}

#[test]
fn avatar_visual_path_allows_only_agent_center_package_files_under_nimi() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("visual-path-scope");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let package_dir = write_agent_center_live2d_package(&home, r#"{"Version":3}"#);
    let allowed = package_dir.join("files/ren.model3.json");
    let auth_dir = home.join(".nimi/auth");
    fs::create_dir_all(&auth_dir).unwrap();
    let auth_file = auth_dir.join("session.json");
    fs::write(&auth_file, "{}").unwrap();
    let broad_file = home.join(".nimi/config.json");
    fs::write(&broad_file, "{}").unwrap();

    assert!(validated_avatar_visual_path(&allowed).is_ok());
    assert!(validated_avatar_visual_path(&auth_file).is_err());
    assert!(validated_avatar_visual_path(&broad_file).is_err());

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn avatar_file_commands_reject_nimi_auth_files() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("visual-command-scope");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let package_dir = write_agent_center_live2d_package(&home, r#"{"Version":3}"#);
    let allowed = package_dir.join("files/ren.model3.json");
    let auth_dir = home.join(".nimi/auth");
    fs::create_dir_all(&auth_dir).unwrap();
    let auth_file = auth_dir.join("session.json");
    fs::write(&auth_file, r#"{"refreshToken":"secret"}"#).unwrap();

    let allowed_text = nimi_avatar_read_text_file(allowed.display().to_string())
        .await
        .expect("read allowed package file");
    assert_eq!(allowed_text, r#"{"Version":3}"#);
    assert!(nimi_avatar_read_text_file(auth_file.display().to_string())
        .await
        .is_err());
    assert!(
        nimi_avatar_read_binary_file(auth_file.display().to_string())
            .await
            .is_err()
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_package_returns_live2d_model_manifest() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let package_dir = write_agent_center_live2d_package(&home, r#"{"Version":3}"#);

    let manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve package manifest");

    assert_eq!(manifest.model_id, "ren");
    let model3_path = PathBuf::from(manifest.model3_json_path.as_deref().unwrap());
    assert_eq!(
        model3_path.file_name().and_then(|value| value.to_str()),
        Some("ren.model3.json")
    );
    assert_eq!(
        model3_path
            .parent()
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str()),
        Some("files")
    );
    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_package_uses_explicit_external_live2d_adapter_sidecar() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-live2d-external-adapter");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let package_dir = write_agent_center_live2d_package(&home, r#"{"Version":3}"#);
    let embedded_dir = package_dir.join("files/nimi");
    fs::create_dir_all(&embedded_dir).unwrap();
    fs::write(
        embedded_dir.join("live2d-adapter.json"),
        r#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1,"adapter_id":"embedded"}"#,
    )
    .unwrap();
    let manifest_ref = "live2d_adapter_ab12cd34ef56";
    let sidecar_dir = home
        .join(".nimi/data/accounts/account_1/agents/agent_1")
        .join("agent-center/modules/avatar_package/adapter_manifests")
        .join(manifest_ref);
    fs::create_dir_all(&sidecar_dir).unwrap();
    let sidecar_path = sidecar_dir.join("live2d-adapter.json");
    fs::write(
        &sidecar_path,
        r#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .unwrap();
    write_agent_center_local_config_with_adapter_manifest(
        &home,
        "account_1",
        "agent_1",
        Some(("live2d", "live2d_ab12cd34ef56")),
        "external_sidecar_manifest",
        Some(manifest_ref),
    );

    let manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve package manifest");

    assert_eq!(
        manifest.adapter_manifest_path.as_deref(),
        Some(
            sidecar_path
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
                .as_str()
        )
    );
    let raw = nimi_avatar_read_text_file(manifest.adapter_manifest_path.unwrap())
        .await
        .expect("read external adapter sidecar through Avatar file gate");
    assert!(raw.contains("nimi.avatar.live2d.adapter"));
    let unselected_dir = home
        .join(".nimi/data/accounts/account_1/agents/agent_1")
        .join("agent-center/modules/avatar_package/adapter_manifests/live2d_adapter_ffffffffffff");
    fs::create_dir_all(&unselected_dir).unwrap();
    let unselected_path = unselected_dir.join("live2d-adapter.json");
    fs::write(
        &unselected_path,
        r#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .unwrap();
    assert!(
        nimi_avatar_read_text_file(unselected_path.display().to_string())
            .await
            .is_err()
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_package_uses_explicit_embedded_live2d_adapter_manifest() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-live2d-embedded-adapter");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let package_dir = write_agent_center_live2d_package(&home, r#"{"Version":3}"#);
    let embedded_dir = package_dir.join("files/nimi");
    fs::create_dir_all(&embedded_dir).unwrap();
    let embedded_path = embedded_dir.join("live2d-adapter.json");
    fs::write(
        &embedded_path,
        r#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .unwrap();
    write_agent_center_local_config_with_adapter_manifest(
        &home,
        "account_1",
        "agent_1",
        Some(("live2d", "live2d_ab12cd34ef56")),
        "embedded_creator_manifest",
        None,
    );

    let manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve package manifest");

    assert_eq!(
        manifest.adapter_manifest_path.as_deref(),
        Some(
            embedded_path
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
                .as_str()
        )
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_package_accepts_runtime_scoped_agent_id() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-runtime-agent");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let package_dir =
        write_agent_center_live2d_package_for_agent(&home, "~agent_1_tffk", r#"{"Version":3}"#);

    let manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "~agent_1_tffk".to_string(),
        })
        .await
        .expect("resolve runtime scoped package manifest");

    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_package_accepts_opaque_runtime_agent_id() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-opaque-agent");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let agent_id = "agent:abc.def+1";
    let package_dir =
        write_agent_center_live2d_package_for_agent(&home, agent_id, r#"{"Version":3}"#);

    let manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: agent_id.to_string(),
        })
        .await
        .expect("resolve opaque runtime scoped package manifest");

    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_package_uses_runtime_account_projection_scope() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-opaque-account");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let account_id = "account:abc.def+1";
    let package_dir = write_agent_center_live2d_package_for_account_agent(
        &home,
        account_id,
        "agent_1",
        r#"{"Version":3}"#,
    );

    let manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: account_id.to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve package manifest with Runtime account projection");

    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_package_returns_vrm_model_manifest_and_rejects_digest_mismatch(
) {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-invalid");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let vrm_package_dir = write_agent_center_vrm_package(&home, b"vrm-bytes");

    let vrm_manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve VRM package manifest");
    assert_eq!(vrm_manifest.kind, "vrm");
    assert_eq!(vrm_manifest.model_id, "model");
    let vrm_path = PathBuf::from(vrm_manifest.vrm_file_path.as_deref().unwrap());
    assert_eq!(
        vrm_path.file_name().and_then(|value| value.to_str()),
        Some("model.vrm")
    );
    assert_eq!(
        vrm_path
            .parent()
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str()),
        Some("files")
    );
    assert!(vrm_manifest.model3_json_path.is_none());
    assert!(vrm_package_dir.join("files/model.vrm").exists());

    write_agent_center_live2d_package(&home, r#"{"Version":3}"#);
    let entry = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56/files/ren.model3.json");
    write_agent_center_local_config(
        &home,
        "account_1",
        "agent_1",
        Some(("live2d", "live2d_ab12cd34ef56")),
    );
    fs::write(entry, r#"{"Version":4}"#).unwrap();
    let digest_error =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect_err("digest mismatch should fail closed");
    assert!(digest_error.contains("differs from manifest"));

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}
