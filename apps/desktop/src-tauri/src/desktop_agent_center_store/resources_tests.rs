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

fn write_valid_live2d_package(home: &Path) -> PathBuf {
    let dir = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56");
    let files_dir = dir.join("files");
    fs::create_dir_all(&files_dir).expect("files dir");
    let model_bytes = br#"{"Version":3}"#;
    fs::write(files_dir.join("model.model3.json"), model_bytes).expect("model");
    let model_sha = sha256_hex(model_bytes);
    let manifest = json!({
        "manifest_version": 1,
        "package_version": "1.0.0",
        "package_id": "live2d_ab12cd34ef56",
        "kind": "live2d",
        "loader_min_version": "1.0.0",
        "display_name": "Lantern Room Avatar",
        "display_name_i18n": {},
        "entry_file": "files/model.model3.json",
        "required_files": ["files/model.model3.json"],
        "content_digest": format!("sha256:{model_sha}"),
        "files": [{
            "path": "files/model.model3.json",
            "sha256": model_sha,
            "bytes": model_bytes.len(),
            "mime": "application/json"
        }],
        "limits": {
            "max_manifest_bytes": 262144,
            "max_package_bytes": 524288000,
            "max_file_bytes": 104857600,
            "max_file_count": 2048
        },
        "capabilities": {
            "expressions": ["neutral"],
            "motions": ["idle"],
            "physics": false
        },
        "import": {
            "imported_at": "2026-04-27T00:00:00Z",
            "source_label": "local import",
            "source_fingerprint": format!("sha256:{model_sha}")
        }
    });
    fs::write(
        dir.join(MANIFEST_FILE_NAME),
        serde_json::to_string_pretty(&manifest).expect("manifest json"),
    )
    .expect("manifest");
    dir
}

fn write_valid_background(home: &Path) -> PathBuf {
    let dir = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/appearance/backgrounds/bg_ab12cd34ef56");
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

fn write_live2d_import_source(home: &Path) -> PathBuf {
    let dir = home.join("source-live2d");
    fs::create_dir_all(dir.join("textures")).expect("source dirs");
    fs::write(dir.join("model.model3.json"), br#"{"Version":3}"#).expect("model");
    fs::write(dir.join("textures/texture_00.png"), b"png-bytes").expect("texture");
    dir
}

fn write_live2d_import_source_with_third_party_extras(home: &Path) -> PathBuf {
    let dir = write_live2d_import_source(home);
    fs::write(dir.join(".DS_Store"), b"finder").expect("ds store");
    fs::write(dir.join("textures/._texture_00.png"), b"appledouble").expect("appledouble");
    fs::create_dir_all(dir.join("__MACOSX")).expect("macosx dir");
    fs::write(dir.join("__MACOSX/metadata.bin"), b"metadata").expect("macosx file");
    fs::write(dir.join("ReadMe.txt"), b"usage notes").expect("readme");
    fs::write(dir.join("LICENSE.md"), b"license").expect("license");
    fs::write(dir.join("textures/notes.txt"), b"texture notes").expect("notes");
    fs::write(dir.join("third-party-extension.bytes"), b"opaque").expect("opaque extension");
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

fn operation_log_path(home: &Path) -> PathBuf {
    home.join(
            ".nimi/data/accounts/account_1/agents/agent_1/agent-center/operations/agent-center-local-resources.jsonl",
        )
}

fn account_operation_log_path(home: &Path) -> PathBuf {
    home.join(".nimi/data/accounts/account_1/operations/agent-center-local-resources.jsonl")
}

fn agent_center_marker(home: &Path, agent_id: &str) -> PathBuf {
    agent_center_marker_for_account(home, "account_1", agent_id)
}

fn agent_center_marker_for_account(home: &Path, account_id: &str, agent_id: &str) -> PathBuf {
    let dir = home
        .join(".nimi/data/accounts")
        .join(local_scope_path_segment(account_id))
        .join("agents")
        .join(local_scope_path_segment(agent_id))
        .join("agent-center");
    fs::create_dir_all(dir.join("modules/appearance")).expect("agent-center dir");
    fs::write(dir.join("modules/appearance/marker.txt"), b"local").expect("marker");
    dir
}

#[test]
fn validates_package_and_writes_sidecar() {
    let home = temp_home("valid");
    with_env(&[("HOME", home.to_str())], || {
        let dir = write_valid_live2d_package(&home);
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
            AgentCenterAvatarPackageValidationStatus::Valid
        );
        assert!(dir.join(VALIDATION_FILE_NAME).exists());
    });
}

#[test]
fn imports_live2d_package_transactionally_and_selects_it() {
    let home = temp_home("import-live2d");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_live2d_import_source(&home);
        let result = desktop_agent_center_avatar_package_import(
            DesktopAgentCenterAvatarPackageImportPayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Imported Avatar".to_string()),
                select: Some(true),
            },
        )
        .expect("import live2d package");

        assert!(result.package_id.starts_with("live2d_"));
        assert_eq!(
            result.validation.status,
            AgentCenterAvatarPackageValidationStatus::Valid
        );
        let package_root = package_dir(
            "account_1",
            "agent_1",
            AgentCenterAvatarPackageKind::Live2d,
            &result.package_id,
        )
        .expect("package dir");
        assert!(package_root.join(MANIFEST_FILE_NAME).exists());
        assert!(package_root.join(VALIDATION_FILE_NAME).exists());
        assert!(package_root.join("files/model.model3.json").exists());
        assert!(package_root.join("files/textures/texture_00.png").exists());

        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .expect("config");
        assert_eq!(
            config
                .modules
                .avatar_package
                .selected_package
                .expect("selected")
                .package_id,
            result.package_id
        );
        let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
        assert!(operations.contains("\"operation_type\":\"package_import\""));
        assert!(operations.contains("\"resource_kind\":\"avatar_package\""));
    });
}

#[test]
fn imports_live2d_package_as_whole_folder_when_model3_entry_exists() {
    let home = temp_home("import-live2d-whole-folder");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_live2d_import_source_with_third_party_extras(&home);
        let result = desktop_agent_center_avatar_package_import(
            DesktopAgentCenterAvatarPackageImportPayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Imported Avatar".to_string()),
                select: Some(true),
            },
        )
        .expect("import complete live2d folder");

        assert_eq!(
            result.validation.status,
            AgentCenterAvatarPackageValidationStatus::Valid
        );
        let package_root = package_dir(
            "account_1",
            "agent_1",
            AgentCenterAvatarPackageKind::Live2d,
            &result.package_id,
        )
        .expect("package dir");
        assert!(package_root.join("files/model.model3.json").exists());
        assert!(package_root.join("files/textures/texture_00.png").exists());
        assert!(package_root.join("files/.DS_Store").exists());
        assert!(package_root
            .join("files/textures/._texture_00.png")
            .exists());
        assert!(package_root.join("files/__MACOSX/metadata.bin").exists());
        assert!(package_root.join("files/ReadMe.txt").exists());
        assert!(package_root.join("files/LICENSE.md").exists());
        assert!(package_root.join("files/textures/notes.txt").exists());
        assert!(package_root
            .join("files/third-party-extension.bytes")
            .exists());
    });
}

#[test]
fn imports_live2d_package_for_runtime_scoped_agent_id() {
    let home = temp_home("import-live2d-runtime-agent-id");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_live2d_import_source(&home);
        let result = desktop_agent_center_avatar_package_import(
            DesktopAgentCenterAvatarPackageImportPayload {
                account_id: "account_1".to_string(),
                agent_id: "~agent_1_tffk".to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Runtime Agent Avatar".to_string()),
                select: Some(true),
            },
        )
        .expect("import live2d package for runtime scoped agent");

        assert_eq!(
            result.validation.status,
            AgentCenterAvatarPackageValidationStatus::Valid
        );
        let package_root = package_dir(
            "account_1",
            "~agent_1_tffk",
            AgentCenterAvatarPackageKind::Live2d,
            &result.package_id,
        )
        .expect("package dir");
        assert!(package_root.join(MANIFEST_FILE_NAME).exists());

        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            agent_id: "~agent_1_tffk".to_string(),
        })
        .expect("runtime scoped config");
        assert_eq!(config.agent_id, "~agent_1_tffk");
        assert_eq!(
            config
                .modules
                .avatar_package
                .selected_package
                .expect("selected")
                .package_id,
            result.package_id
        );
    });
}

#[test]
fn imports_live2d_package_for_opaque_runtime_agent_id() {
    let home = temp_home("import-live2d-opaque-agent-id");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_live2d_import_source(&home);
        let agent_id = "agent:abc.def+1";
        let result = desktop_agent_center_avatar_package_import(
            DesktopAgentCenterAvatarPackageImportPayload {
                account_id: "account_1".to_string(),
                agent_id: agent_id.to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Opaque Agent Avatar".to_string()),
                select: Some(true),
            },
        )
        .expect("import live2d package for opaque runtime agent");

        assert_eq!(
            result.validation.status,
            AgentCenterAvatarPackageValidationStatus::Valid
        );
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            agent_id: agent_id.to_string(),
        })
        .expect("opaque runtime agent config");
        assert_eq!(config.agent_id, agent_id);
        assert_eq!(
            config
                .modules
                .avatar_package
                .selected_package
                .expect("selected")
                .package_id,
            result.package_id
        );
    });
}

#[test]
fn removes_selected_avatar_package_by_clearing_config_and_quarantining_directory() {
    let home = temp_home("remove-package");
    with_env(&[("HOME", home.to_str())], || {
        let package_root = write_valid_live2d_package(&home);
        select_imported_avatar_package(
            "account_1",
            "agent_1",
            AgentCenterAvatarPackageKind::Live2d,
            "live2d_ab12cd34ef56",
            "2026-04-27T00:00:00Z",
        )
        .expect("select package");
        let old_quarantine = home.join(format!(
                ".nimi/data/accounts/account_1/agents/agent_1/agent-center/quarantine/avatar_package/live2d_deadbeef0000_{}",
                (Utc::now() - Duration::days(8))
                    .timestamp_nanos_opt()
                    .unwrap_or(0)
            ));
        fs::create_dir_all(&old_quarantine).expect("old quarantine");

        let result = desktop_agent_center_avatar_package_remove(
            DesktopAgentCenterAvatarPackageRemovePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                kind: AgentCenterAvatarPackageKind::Live2d,
                package_id: "live2d_ab12cd34ef56".to_string(),
            },
        )
        .expect("remove package");

        assert!(result.quarantined);
        assert!(!package_root.exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .expect("config");
        assert!(config.modules.avatar_package.selected_package.is_none());
        assert!(home
                .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/quarantine/avatar_package")
                .read_dir()
                .expect("quarantine dir")
                .next()
                .is_some());
        assert!(!old_quarantine.exists());
        let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
        assert!(operations.contains("\"operation_type\":\"package_quarantine\""));
        assert!(operations.contains("\"reason_code\":\"user_removed\""));
    });
}

#[test]
fn import_rejects_symlink_source_without_staging_residue() {
    let home = temp_home("import-symlink");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_live2d_import_source(&home);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                source.join("model.model3.json"),
                source.join("linked.model3.json"),
            )
            .expect("symlink");
            let err = desktop_agent_center_avatar_package_import(
                DesktopAgentCenterAvatarPackageImportPayload {
                    account_id: "account_1".to_string(),
                    agent_id: "agent_1".to_string(),
                    kind: AgentCenterAvatarPackageKind::Live2d,
                    source_path: source.to_string_lossy().to_string(),
                    display_name: None,
                    select: Some(false),
                },
            )
            .expect_err("symlink rejected");
            assert!(err.contains("symlink"));
            assert!(!home
                    .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/staging")
                    .exists());
        }
    });
}

#[test]
fn imports_background_transactionally_and_selects_it() {
    let home = temp_home("import-background");
    with_env(&[("HOME", home.to_str())], || {
        let source = write_background_import_source(&home);
        let result =
            desktop_agent_center_background_import(DesktopAgentCenterBackgroundImportPayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                source_path: source.to_string_lossy().to_string(),
                display_name: Some("Imported Background".to_string()),
                select: Some(true),
            })
            .expect("import background");

        assert!(result.background_asset_id.starts_with("bg_"));
        assert_eq!(
            result.validation.status,
            AgentCenterBackgroundValidationStatus::Valid
        );
        let dir = background_dir("account_1", "agent_1", &result.background_asset_id)
            .expect("background dir");
        assert!(dir.join(MANIFEST_FILE_NAME).exists());
        assert!(dir.join(VALIDATION_FILE_NAME).exists());
        assert!(dir.join("image.png").exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .expect("config");
        assert_eq!(
            config.modules.appearance.background_asset_id.as_deref(),
            Some(result.background_asset_id.as_str())
        );
        let asset = desktop_agent_center_background_asset_get(
            DesktopAgentCenterBackgroundValidatePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
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
fn removes_selected_background_by_clearing_config_and_quarantining_directory() {
    let home = temp_home("remove-background");
    with_env(&[("HOME", home.to_str())], || {
        let background_root = write_valid_background(&home);
        select_imported_background("account_1", "agent_1", "bg_ab12cd34ef56")
            .expect("select background");

        let result =
            desktop_agent_center_background_remove(DesktopAgentCenterBackgroundRemovePayload {
                account_id: "account_1".to_string(),
                agent_id: "agent_1".to_string(),
                background_asset_id: "bg_ab12cd34ef56".to_string(),
            })
            .expect("remove background");

        assert!(result.quarantined);
        assert!(!background_root.exists());
        let config = desktop_agent_center_config_get(DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .expect("config");
        assert!(config.modules.appearance.background_asset_id.is_none());
        assert!(home
            .join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/quarantine/background")
            .read_dir()
            .expect("quarantine dir")
            .next()
            .is_some());
        let operations = fs::read_to_string(operation_log_path(&home)).expect("operation log");
        assert!(operations.contains("\"operation_type\":\"background_quarantine\""));
        assert!(operations.contains("\"reason_code\":\"user_removed\""));
    });
}

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
