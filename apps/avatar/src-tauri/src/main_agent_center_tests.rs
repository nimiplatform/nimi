use super::*;
use nimi_shell_tauri::agent_center_avatar_asset::LocalAvatarAssetResolvePayload;

fn owner_user_id() -> &'static str {
    "owner_1"
}

fn realm_agent_id() -> &'static str {
    "agent_1"
}

fn local_agent_ref_for(owner_user_id: &str, realm_agent_id: &str) -> String {
    format!("local-agent:{owner_user_id}:{realm_agent_id}")
}

fn local_agent_ref() -> String {
    local_agent_ref_for(owner_user_id(), realm_agent_id())
}

fn agent_center_root(home: &Path, account_id: &str, local_agent_ref: &str) -> PathBuf {
    home.join(".nimi/data/accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(local_agent_ref))
        .join("agent-center")
}

fn materialization_ref(
    account_id: &str,
    local_agent_ref: &str,
    kind: &str,
    local_asset_id: &str,
) -> String {
    format!(
        "agent-center-avatar-asset:{}:{}:{kind}:{local_asset_id}",
        agent_center_path_segment(account_id),
        agent_center_path_segment(local_agent_ref),
    )
}

fn resolve_payload(
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
) -> AgentCenterAvatarAssetResolvePayload {
    resolve_payload_with_package(
        account_id,
        owner_user_id,
        realm_agent_id,
        "live2d",
        "live2d_ab12cd34ef56",
    )
}

fn resolve_payload_with_package(
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
    backend_kind: &str,
    local_avatar_asset_ref: &str,
) -> AgentCenterAvatarAssetResolvePayload {
    let local_agent_ref = local_agent_ref_for(owner_user_id, realm_agent_id);
    AgentCenterAvatarAssetResolvePayload {
        account_id: account_id.to_string(),
        owner_user_id: owner_user_id.to_string(),
        realm_agent_id: realm_agent_id.to_string(),
        local_agent_ref: local_agent_ref.clone(),
        backend_kind: backend_kind.to_string(),
        local_avatar_asset_ref: local_avatar_asset_ref.to_string(),
        backend_capability_profile_ref: format!("avatar.backend_profile/{backend_kind}/basic"),
        materialization_ref: materialization_ref(
            account_id,
            &local_agent_ref,
            backend_kind,
            local_avatar_asset_ref,
        ),
    }
}

fn write_agent_center_live2d_package_for_local_agent(
    home: &Path,
    local_agent_ref: &str,
    entry_content: &str,
) -> PathBuf {
    write_agent_center_live2d_package_for_account_agent(
        home,
        "account_1",
        owner_user_id(),
        realm_agent_id(),
        local_agent_ref,
        entry_content,
    )
}

fn write_agent_center_live2d_package_for_account_agent(
    home: &Path,
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
    entry_content: &str,
) -> PathBuf {
    let package_dir = agent_center_root(home, account_id, local_agent_ref)
        .join("modules/avatar_asset/packages/live2d/live2d_ab12cd34ef56");
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
        "asset_version": "1.0.0",
        "local_asset_id": "live2d_ab12cd34ef56",
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
            "max_asset_bytes": 524288000,
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
    let _ = (owner_user_id, realm_agent_id);
    package_dir
}

fn write_agent_center_live2d_package(home: &Path, entry_content: &str) -> PathBuf {
    write_agent_center_live2d_package_for_local_agent(home, &local_agent_ref(), entry_content)
}

fn write_agent_center_local_avatar_asset_config(
    home: &Path,
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
    backend_kind: &str,
    local_avatar_asset_ref: &str,
) {
    write_agent_center_local_avatar_asset_config_with_calibration_ref(
        home,
        account_id,
        owner_user_id,
        realm_agent_id,
        local_agent_ref,
        backend_kind,
        local_avatar_asset_ref,
        None,
    )
}

fn write_agent_center_local_avatar_asset_config_with_calibration_ref(
    home: &Path,
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
    backend_kind: &str,
    local_avatar_asset_ref: &str,
    live2d_calibration_ref: Option<&str>,
) {
    let config_path = agent_center_root(home, account_id, local_agent_ref).join("config.json");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    let config = json!({
        "schema_version": 1,
        "config_kind": "agent_center_local_config",
        "account_id": account_id,
        "owner_user_id": owner_user_id,
        "realm_agent_id": realm_agent_id,
        "local_agent_ref": local_agent_ref,
        "modules": {
            "appearance": {
                "schema_version": 1,
                "background_asset_id": null,
                "motion": "system"
            },
            "avatar_asset": {
                "schema_version": 1,
                "conversation_anchor_scope": "current_anchor",
                "local_avatar_asset_ref": local_avatar_asset_ref,
                "live2d_calibration_ref": live2d_calibration_ref,
                "live2d_adapter_manifest_source": "embedded_creator_manifest",
                "live2d_adapter_manifest_ref": null,
                "avatar_instance_policy": "reuse_active_instance",
                "backend_kind": backend_kind,
                "backend_capability_profile_ref": format!("avatar.backend_profile/{backend_kind}/basic"),
                "generated_motion_provider_policy": "require_profile_support",
                "launch_mode": "manual",
                "debug_profile": "strict_backend_evidence",
                "updated_at": "2026-05-17T00:00:00Z",
                "provenance": {
                    "source": "import_validation",
                    "evidence_ref": "test-fixture"
                }
            },
            "local_history": {
                "schema_version": 1,
                "last_cleared_at": null
            },
            "ui": {
                "schema_version": 1,
                "last_section": "overview"
            }
        }
    });
    fs::write(config_path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
}

fn write_agent_center_vrm_package(home: &Path, entry_content: &[u8]) -> PathBuf {
    let package_dir = home
        .join(".nimi/data/accounts")
        .join(agent_center_path_segment("account_1"))
        .join("agents")
        .join(agent_center_path_segment(&local_agent_ref()))
        .join("agent-center/modules/avatar_asset/packages/vrm/vrm_ab12cd34ef56");
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
        "asset_version": "1.0.0",
        "local_asset_id": "vrm_ab12cd34ef56",
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
            "max_asset_bytes": 524288000,
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
    package_dir
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_local_avatar_asset_accepts_current_agent_center_config_modules() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("local-avatar-asset-config");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let local_agent_ref = local_agent_ref();
    write_agent_center_live2d_package_for_account_agent(
        &home,
        owner_user_id(),
        owner_user_id(),
        realm_agent_id(),
        &local_agent_ref,
        r#"{"Version":3}"#,
    );
    write_agent_center_local_avatar_asset_config(
        &home,
        owner_user_id(),
        owner_user_id(),
        realm_agent_id(),
        &local_agent_ref,
        "live2d",
        "live2d_ab12cd34ef56",
    );

    let manifest = nimi_avatar_resolve_local_avatar_asset(LocalAvatarAssetResolvePayload {
        account_id: owner_user_id().to_string(),
        owner_user_id: owner_user_id().to_string(),
        realm_agent_id: realm_agent_id().to_string(),
        local_agent_ref,
    })
    .await
    .expect("resolve local avatar asset from current Agent Center config");

    assert_eq!(manifest.kind, "live2d");
    assert_eq!(manifest.model_id, "ren");
    assert_eq!(manifest.live2d_calibration_ref, None);

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_local_avatar_asset_projects_live2d_calibration_ref() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("local-avatar-asset-calibration-ref");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let local_agent_ref = local_agent_ref();
    write_agent_center_live2d_package_for_account_agent(
        &home,
        owner_user_id(),
        owner_user_id(),
        realm_agent_id(),
        &local_agent_ref,
        r#"{"Version":3}"#,
    );
    write_agent_center_local_avatar_asset_config_with_calibration_ref(
        &home,
        owner_user_id(),
        owner_user_id(),
        realm_agent_id(),
        &local_agent_ref,
        "live2d",
        "live2d_ab12cd34ef56",
        Some("live2d_calibration_ab12cd34ef56"),
    );

    let manifest = nimi_avatar_resolve_local_avatar_asset(LocalAvatarAssetResolvePayload {
        account_id: owner_user_id().to_string(),
        owner_user_id: owner_user_id().to_string(),
        realm_agent_id: realm_agent_id().to_string(),
        local_agent_ref,
    })
    .await
    .expect("resolve local avatar asset with calibration ref");

    assert_eq!(
        manifest.live2d_calibration_ref.as_deref(),
        Some("live2d_calibration_ab12cd34ef56")
    );

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_local_avatar_asset_rejects_invalid_live2d_calibration_ref() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("local-avatar-asset-calibration-ref-invalid");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let local_agent_ref = local_agent_ref();
    write_agent_center_live2d_package_for_account_agent(
        &home,
        owner_user_id(),
        owner_user_id(),
        realm_agent_id(),
        &local_agent_ref,
        r#"{"Version":3}"#,
    );
    write_agent_center_local_avatar_asset_config_with_calibration_ref(
        &home,
        owner_user_id(),
        owner_user_id(),
        realm_agent_id(),
        &local_agent_ref,
        "live2d",
        "live2d_ab12cd34ef56",
        Some("live2d_calibration_ABCDEF123456"),
    );

    let error = nimi_avatar_resolve_local_avatar_asset(LocalAvatarAssetResolvePayload {
        account_id: owner_user_id().to_string(),
        owner_user_id: owner_user_id().to_string(),
        realm_agent_id: realm_agent_id().to_string(),
        local_agent_ref,
    })
    .await
    .expect_err("reject invalid calibration ref");

    assert!(error
        .contains("live2d_calibration_ref must use a 12-character lowercase hex digest suffix"));

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn normalize_avatar_launch_instance_id_writes_generated_id_when_omitted() {
    let mut context = AvatarLaunchContext {
        agent_id: realm_agent_id().to_string(),
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
        agent_id: realm_agent_id().to_string(),
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
async fn resolve_agent_center_avatar_asset_returns_live2d_model_manifest() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let package_dir = write_agent_center_live2d_package(&home, r#"{"Version":3}"#);

    let manifest = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
        "account_1",
        owner_user_id(),
        realm_agent_id(),
    ))
    .await
    .expect("resolve asset manifest");

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
    assert_eq!(manifest.live2d_calibration_ref, None);

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_rejects_local_config_external_live2d_adapter_sidecar() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-live2d-external-adapter");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    write_agent_center_live2d_package(&home, r#"{"Version":3}"#);
    let manifest_ref = "live2d_adapter_ab12cd34ef56";
    let sidecar_dir = agent_center_root(&home, "account_1", &local_agent_ref())
        .join("modules/avatar_asset/adapter_manifests")
        .join(manifest_ref);
    fs::create_dir_all(&sidecar_dir).unwrap();
    let sidecar_path = sidecar_dir.join("live2d-adapter.json");
    fs::write(
        &sidecar_path,
        r#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .unwrap();
    let manifest = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
        "account_1",
        owner_user_id(),
        realm_agent_id(),
    ))
    .await
    .expect("resolve asset manifest");

    assert_eq!(manifest.adapter_manifest_path, None);
    assert!(
        nimi_avatar_read_text_file(sidecar_path.display().to_string())
            .await
            .is_err()
    );
    let unselected_dir = agent_center_root(&home, "account_1", &local_agent_ref())
        .join("modules/avatar_asset/adapter_manifests/live2d_adapter_ffffffffffff");
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
async fn resolve_agent_center_avatar_asset_uses_explicit_embedded_live2d_adapter_manifest() {
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
    let manifest = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
        "account_1",
        owner_user_id(),
        realm_agent_id(),
    ))
    .await
    .expect("resolve asset manifest");

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
async fn resolve_agent_center_avatar_asset_accepts_runtime_scoped_realm_agent_id() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-runtime-agent");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let runtime_scoped_realm_agent_id = "~agent_1_tffk";
    let runtime_scoped_local_agent_ref =
        local_agent_ref_for(owner_user_id(), runtime_scoped_realm_agent_id);
    let package_dir = write_agent_center_live2d_package_for_account_agent(
        &home,
        "account_1",
        owner_user_id(),
        runtime_scoped_realm_agent_id,
        &runtime_scoped_local_agent_ref,
        r#"{"Version":3}"#,
    );

    let manifest = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
        "account_1",
        owner_user_id(),
        runtime_scoped_realm_agent_id,
    ))
    .await
    .expect("resolve runtime scoped asset manifest");

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
async fn resolve_agent_center_avatar_asset_accepts_opaque_realm_agent_id() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-opaque-agent");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let opaque_realm_agent_id = "agent.abc.def+1";
    let opaque_local_agent_ref = local_agent_ref_for(owner_user_id(), opaque_realm_agent_id);
    let package_dir = write_agent_center_live2d_package_for_account_agent(
        &home,
        "account_1",
        owner_user_id(),
        opaque_realm_agent_id,
        &opaque_local_agent_ref,
        r#"{"Version":3}"#,
    );

    let manifest = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
        "account_1",
        owner_user_id(),
        opaque_realm_agent_id,
    ))
    .await
    .expect("resolve opaque runtime scoped asset manifest");

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
async fn resolve_agent_center_avatar_asset_uses_runtime_account_projection_scope() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-opaque-account");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let account_id = "account:abc.def+1";
    let package_dir = write_agent_center_live2d_package_for_account_agent(
        &home,
        account_id,
        owner_user_id(),
        realm_agent_id(),
        &local_agent_ref(),
        r#"{"Version":3}"#,
    );

    let manifest = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
        account_id,
        owner_user_id(),
        realm_agent_id(),
    ))
    .await
    .expect("resolve asset manifest with Runtime account projection");

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
async fn resolve_agent_center_avatar_asset_returns_vrm_model_manifest_and_rejects_digest_mismatch()
{
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-invalid");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let vrm_package_dir = write_agent_center_vrm_package(&home, b"vrm-bytes");

    let vrm_manifest = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload_with_package(
        "account_1",
        owner_user_id(),
        realm_agent_id(),
        "vrm",
        "vrm_ab12cd34ef56",
    ))
    .await
    .expect("resolve VRM asset manifest");
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
    let entry = agent_center_root(&home, "account_1", &local_agent_ref())
        .join("modules/avatar_asset/packages/live2d/live2d_ab12cd34ef56/files/ren.model3.json");
    fs::write(entry, r#"{"Version":4}"#).unwrap();
    let digest_error = nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
        "account_1",
        owner_user_id(),
        realm_agent_id(),
    ))
    .await
    .expect_err("digest mismatch should fail closed");
    assert!(digest_error.contains("differs from manifest"));

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let _ = fs::remove_dir_all(&home);
}
