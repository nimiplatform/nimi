use super::*;
use crate::test_support::with_env;
use serde_json::json;

fn temp_home(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nimi-agent-center-resource-{prefix}-{}",
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    fs::create_dir_all(&dir).expect("create temp home");
    dir
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
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

fn owner_user_id_two() -> String {
    "owner_2".to_string()
}

fn local_agent_ref_two() -> String {
    "local-agent:owner_2:agent_1".to_string()
}

fn local_scope() -> LocalAgentScope {
    validate_local_agent_scope(&owner_user_id(), &realm_agent_id(), &local_agent_ref())
        .expect("local scope")
}

fn second_owner_scope() -> LocalAgentScope {
    validate_local_agent_scope(
        &owner_user_id_two(),
        &realm_agent_id(),
        &local_agent_ref_two(),
    )
    .expect("second owner scope")
}

fn write_valid_background(home: &Path) -> PathBuf {
    let dir = home
        .join(".nimi/data/accounts/account_1/agents")
        .join(local_scope_path_segment(&local_agent_ref()))
        .join("agent-center/modules/appearance/backgrounds/bg_ab12cd34ef56");
    fs::create_dir_all(&dir).expect("background dir");
    let image_bytes = b"webp-bytes";
    fs::write(dir.join("image.webp"), image_bytes).expect("image");
    let image_sha = sha256_hex(image_bytes);
    let manifest = json!({
        "manifest_version": 1,
        "background_asset_id": "bg_ab12cd34ef56",
        "display_name": "Quiet room",
        "image_file": "image.webp",
        "mime": "image/webp",
        "bytes": image_bytes.len(),
        "pixel_width": 1920,
        "pixel_height": 1080,
        "limits": {
            "max_bytes": 20971520,
            "max_pixel_width": 8192,
            "max_pixel_height": 8192
        },
        "sha256": image_sha,
        "imported_at": "2026-04-27T00:00:00Z",
        "source_label": "local import"
    });
    fs::write(
        dir.join(MANIFEST_FILE_NAME),
        serde_json::to_string_pretty(&manifest).expect("manifest json"),
    )
    .expect("manifest");
    dir
}

fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::from(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".as_slice());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    bytes
}

fn write_background_import_source(home: &Path) -> PathBuf {
    let path = home.join("source-background.png");
    fs::write(&path, png_bytes(1920, 1080)).expect("background source");
    path
}

fn write_live2d_avatar_source(home: &Path) -> PathBuf {
    let dir = home.join("live2d-source");
    fs::create_dir_all(dir.join("textures")).expect("live2d textures");
    fs::create_dir_all(dir.join("nimi")).expect("live2d adapter dir");
    fs::write(
        dir.join("ren.model3.json"),
        br#"{"Version":3,"FileReferences":{"Moc":"ren.moc3","Textures":["textures/ren.png"]}}"#,
    )
    .expect("model3");
    fs::write(dir.join("ren.moc3"), b"moc3-bytes").expect("moc3");
    fs::write(dir.join("textures/ren.png"), png_bytes(64, 64)).expect("texture");
    fs::write(
        dir.join("nimi/live2d-adapter.json"),
        br#"{"schema_version":1,"adapter_kind":"live2d_creator_sidecar"}"#,
    )
    .expect("adapter");
    dir
}

fn write_vrm_avatar_source(home: &Path) -> PathBuf {
    let path = home.join("ren.vrm");
    fs::write(&path, b"vrm-bytes").expect("vrm source");
    let presets = home.join("vrm-motion-presets");
    fs::create_dir_all(&presets).expect("vrm presets");
    fs::write(presets.join("idle_subtle.vrma"), b"vrma-bytes").expect("vrma");
    path
}

fn operation_log_path(home: &Path) -> PathBuf {
    home.join(".nimi/data/accounts/account_1/agents")
        .join(local_scope_path_segment(&local_agent_ref()))
        .join("agent-center/operations/agent-center-local-resources.jsonl")
}

fn account_operation_log_path(home: &Path) -> PathBuf {
    home.join(".nimi/data/accounts/account_1/operations/agent-center-local-resources.jsonl")
}

fn agent_center_marker(home: &Path, local_agent_ref: &str) -> PathBuf {
    agent_center_marker_for_account(home, "account_1", local_agent_ref)
}

fn agent_center_marker_for_account(
    home: &Path,
    account_id: &str,
    local_agent_ref: &str,
) -> PathBuf {
    let dir = home
        .join(".nimi/data/accounts")
        .join(local_scope_path_segment(account_id))
        .join("agents")
        .join(local_scope_path_segment(local_agent_ref))
        .join("agent-center");
    fs::create_dir_all(dir.join("modules/appearance")).expect("agent-center dir");
    fs::write(dir.join("modules/appearance/marker.txt"), b"local").expect("marker");
    dir
}

#[test]
fn imports_live2d_avatar_asset_transactionally_and_selects_it() {
    let home = temp_home("import-live2d-avatar");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_live2d_avatar_source(&home);
        let result = desktop_agent_center_avatar_asset_import_blocking(
            DesktopAgentCenterAvatarAssetImportPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                kind: AgentCenterAvatarBackendKind::Live2d,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Ren Live2D".to_string()),
                select: Some(true),
            },
        )
        .expect("import live2d avatar asset");

        assert!(result.local_asset_id.starts_with("live2d_"));
        assert_eq!(result.backend_kind, AgentCenterAvatarBackendKind::Live2d);
        assert!(result
            .backend_capability_profile_ref
            .starts_with("avatar_profile_live2d_"));
        assert_eq!(result.file_count, 4);
        let dir = avatar_asset_dir(
            "account_1",
            &local_agent_ref(),
            AgentCenterAvatarBackendKind::Live2d,
            &result.local_asset_id,
        )
        .expect("avatar asset dir");
        assert!(dir.join(MANIFEST_FILE_NAME).exists());
        assert!(dir.join(CAPABILITY_PROFILE_FILE_NAME).exists());
        assert!(dir.join("files/ren.model3.json").exists());
        assert!(dir.join("files/nimi/live2d-adapter.json").exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            owner_user_id: owner_user_id(),
            realm_agent_id: realm_agent_id(),
            local_agent_ref: local_agent_ref(),
        })
        .expect("config");
        assert_eq!(
            config
                .modules
                .avatar_asset
                .local_avatar_asset_ref
                .as_deref(),
            Some(result.local_asset_id.as_str())
        );
        assert_eq!(
            config
                .modules
                .avatar_asset
                .backend_capability_profile_ref
                .as_deref(),
            Some(result.backend_capability_profile_ref.as_str())
        );
        assert_eq!(
            config.modules.avatar_asset.live2d_adapter_manifest_source,
            AgentCenterLive2dAdapterManifestSource::EmbeddedCreatorManifest
        );
        let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
        assert!(operations.contains("\"operation_type\":\"avatar_asset_import\""));
        assert!(operations.contains("\"resource_kind\":\"avatar_asset\""));
        let validation = desktop_agent_center_avatar_asset_validate_blocking(
            DesktopAgentCenterAvatarAssetValidatePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
            },
        )
        .expect("validate imported live2d avatar asset");
        assert_eq!(
            validation.status,
            AgentCenterAvatarAssetValidationStatus::Valid
        );
        assert_eq!(
            validation.local_asset_id.as_deref(),
            Some(result.local_asset_id.as_str())
        );
        assert!(dir.join(VALIDATION_FILE_NAME).exists());
    });
}

#[test]
fn avatar_asset_validation_fails_closed_when_entry_file_is_missing() {
    let home = temp_home("validate-avatar-missing-entry");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_vrm_avatar_source(&home);
        let imported = desktop_agent_center_avatar_asset_import_blocking(
            DesktopAgentCenterAvatarAssetImportPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                kind: AgentCenterAvatarBackendKind::Vrm,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Ren VRM".to_string()),
                select: Some(true),
            },
        )
        .expect("import vrm avatar asset");
        let dir = avatar_asset_dir(
            "account_1",
            &local_agent_ref(),
            AgentCenterAvatarBackendKind::Vrm,
            &imported.local_asset_id,
        )
        .expect("avatar asset dir");
        fs::remove_file(dir.join("files/ren.vrm")).expect("remove entry file");

        let validation = desktop_agent_center_avatar_asset_validate_blocking(
            DesktopAgentCenterAvatarAssetValidatePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
            },
        )
        .expect("validate tampered avatar asset");

        assert_eq!(
            validation.status,
            AgentCenterAvatarAssetValidationStatus::MissingEntry
        );
        assert!(validation
            .errors
            .iter()
            .any(|entry| entry.code == "missing_entry"));
    });
}

#[test]
fn imports_vrm_avatar_asset_transactionally_and_selects_it() {
    let home = temp_home("import-vrm-avatar");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_vrm_avatar_source(&home);
        let result = desktop_agent_center_avatar_asset_import_blocking(
            DesktopAgentCenterAvatarAssetImportPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                kind: AgentCenterAvatarBackendKind::Vrm,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Ren VRM".to_string()),
                select: Some(true),
            },
        )
        .expect("import vrm avatar asset");

        assert!(result.local_asset_id.starts_with("vrm_"));
        assert_eq!(result.backend_kind, AgentCenterAvatarBackendKind::Vrm);
        assert!(result
            .backend_capability_profile_ref
            .starts_with("avatar_profile_vrm_"));
        let dir = avatar_asset_dir(
            "account_1",
            &local_agent_ref(),
            AgentCenterAvatarBackendKind::Vrm,
            &result.local_asset_id,
        )
        .expect("avatar asset dir");
        assert!(dir.join(MANIFEST_FILE_NAME).exists());
        assert!(dir.join(CAPABILITY_PROFILE_FILE_NAME).exists());
        assert!(dir.join("files/ren.vrm").exists());
        assert!(dir
            .join("files/vrm-motion-presets/idle_subtle.vrma")
            .exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            owner_user_id: owner_user_id(),
            realm_agent_id: realm_agent_id(),
            local_agent_ref: local_agent_ref(),
        })
        .expect("config");
        assert_eq!(
            config
                .modules
                .avatar_asset
                .local_avatar_asset_ref
                .as_deref(),
            Some(result.local_asset_id.as_str())
        );
        assert_eq!(
            config.modules.avatar_asset.live2d_adapter_manifest_source,
            AgentCenterLive2dAdapterManifestSource::None
        );
    });
}

#[test]
fn removes_selected_avatar_asset_by_clearing_config_and_quarantining_directory() {
    let home = temp_home("remove-avatar-package");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_vrm_avatar_source(&home);
        let imported = desktop_agent_center_avatar_asset_import_blocking(
            DesktopAgentCenterAvatarAssetImportPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                kind: AgentCenterAvatarBackendKind::Vrm,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Ren VRM".to_string()),
                select: Some(true),
            },
        )
        .expect("import vrm avatar asset");
        let package_root = avatar_asset_dir(
            "account_1",
            &local_agent_ref(),
            AgentCenterAvatarBackendKind::Vrm,
            &imported.local_asset_id,
        )
        .expect("avatar asset dir");

        let result = desktop_agent_center_avatar_asset_remove_blocking(
            DesktopAgentCenterAvatarAssetRemovePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                local_asset_id: imported.local_asset_id.clone(),
            },
        )
        .expect("remove avatar asset");

        assert!(result.quarantined);
        assert!(!package_root.exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            owner_user_id: owner_user_id(),
            realm_agent_id: realm_agent_id(),
            local_agent_ref: local_agent_ref(),
        })
        .expect("config");
        assert!(config.modules.avatar_asset.local_avatar_asset_ref.is_none());
        assert!(config
            .modules
            .avatar_asset
            .backend_capability_profile_ref
            .is_none());
        assert!(home
            .join(".nimi/data/accounts/account_1/agents")
            .join(local_scope_path_segment(&local_agent_ref()))
            .join("agent-center/quarantine/avatar_asset")
            .read_dir()
            .expect("quarantine dir")
            .next()
            .is_some());
    });
}

#[test]
fn imports_background_transactionally_and_selects_it() {
    let home = temp_home("import-background");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_background_import_source(&home);
        let result = desktop_agent_center_background_import_blocking(
            DesktopAgentCenterBackgroundImportPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Imported Background".to_string()),
                select: Some(true),
            },
        )
        .expect("import background");

        assert!(result.background_asset_id.starts_with("bg_"));
        assert_eq!(
            result.validation.status,
            AgentCenterBackgroundValidationStatus::Valid
        );
        let dir = background_dir("account_1", &local_agent_ref(), &result.background_asset_id)
            .expect("background dir");
        assert!(dir.join(MANIFEST_FILE_NAME).exists());
        assert!(dir.join(VALIDATION_FILE_NAME).exists());
        assert!(dir.join("image.png").exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            owner_user_id: owner_user_id(),
            realm_agent_id: realm_agent_id(),
            local_agent_ref: local_agent_ref(),
        })
        .expect("config");
        assert_eq!(
            config.modules.appearance.background_asset_id.as_deref(),
            Some(result.background_asset_id.as_str())
        );
        let asset = desktop_agent_center_background_asset_get_blocking(
            DesktopAgentCenterBackgroundValidatePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                background_asset_id: result.background_asset_id,
            },
        )
        .expect("background asset");
        assert!(asset.file_url.starts_with("file://"));
        assert_eq!(
            asset.validation.status,
            AgentCenterBackgroundValidationStatus::Valid
        );
        let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
        assert!(operations.contains("\"operation_type\":\"background_import\""));
        assert!(operations.contains("\"resource_kind\":\"background\""));
    });
}

#[test]
fn same_realm_agent_id_does_not_share_agent_center_resources_across_owners() {
    let home = temp_home("owner-isolation");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_background_import_source(&home);
        let owner_one = desktop_agent_center_background_import_blocking(
            DesktopAgentCenterBackgroundImportPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Owner one".to_string()),
                select: Some(true),
            },
        )
        .expect("owner one import");

        let owner_two_config =
            desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id_two(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref_two(),
            })
            .expect("owner two config");

        assert!(owner_two_config
            .modules
            .appearance
            .background_asset_id
            .is_none());
        assert!(background_dir(
            "account_1",
            &local_agent_ref(),
            &owner_one.background_asset_id
        )
        .expect("owner one background")
        .exists());
        assert!(!background_dir(
            "account_1",
            &local_agent_ref_two(),
            &owner_one.background_asset_id
        )
        .expect("owner two background")
        .exists());
        let _ = second_owner_scope();
    });
}

#[test]
fn removes_selected_background_by_clearing_config_and_quarantining_directory() {
    let home = temp_home("remove-background");
    with_env(&[("HOME", home.to_str())], || {
        let background_root = write_valid_background(&home);
        select_imported_background("account_1", &local_scope(), "bg_ab12cd34ef56")
            .expect("select background");

        let result = desktop_agent_center_background_remove_blocking(
            DesktopAgentCenterBackgroundRemovePayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                background_asset_id: "bg_ab12cd34ef56".to_string(),
            },
        )
        .expect("remove background");

        assert!(result.quarantined);
        assert!(!background_root.exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            owner_user_id: owner_user_id(),
            realm_agent_id: realm_agent_id(),
            local_agent_ref: local_agent_ref(),
        })
        .expect("config");
        assert!(config.modules.appearance.background_asset_id.is_none());
        assert!(home
            .join(".nimi/data/accounts/account_1/agents")
            .join(local_scope_path_segment(&local_agent_ref()))
            .join("agent-center/quarantine/background")
            .read_dir()
            .expect("quarantine dir")
            .next()
            .is_some());
        let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
        assert!(operations.contains("\"operation_type\":\"background_quarantine\""));
        assert!(operations.contains("\"reason_code\":\"user_removed\""));
    });
}

#[path = "resources_remove_tests.rs"]
mod resources_remove_tests;
