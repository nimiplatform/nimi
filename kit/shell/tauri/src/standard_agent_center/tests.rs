use super::*;

fn parse_standard_error(error: String) -> serde_json::Value {
    serde_json::from_str(&error).expect("standard Agent Center error envelope")
}

fn avatar_validate_payload(
    avatar_asset_ref: &str,
) -> StandardAgentCenterAvatarAssetValidatePayload {
    StandardAgentCenterAvatarAssetValidatePayload {
        host_scope: "local-agent".to_string(),
        account_id: "account_1".to_string(),
        owner_user_id: "owner_1".to_string(),
        runtime_source_ref: "runtime-source:local".to_string(),
        local_agent_ref: "local-agent:ren".to_string(),
        avatar_asset_ref: avatar_asset_ref.to_string(),
    }
}

fn background_payload(background_asset_ref: &str) -> StandardAgentCenterBackgroundValidatePayload {
    StandardAgentCenterBackgroundValidatePayload {
        host_scope: "local-agent".to_string(),
        account_id: "account_1".to_string(),
        owner_user_id: "owner_1".to_string(),
        runtime_source_ref: "runtime-source:local".to_string(),
        local_agent_ref: "local-agent:ren".to_string(),
        background_asset_ref: background_asset_ref.to_string(),
    }
}

fn assert_error_code(error: String, code: &str, reason_code: &str) -> serde_json::Value {
    let envelope = parse_standard_error(error);
    assert_eq!(envelope["code"], code);
    assert_eq!(envelope["reasonCode"], reason_code);
    envelope
}

fn glb_with_json(value: serde_json::Value) -> Vec<u8> {
    let mut json = serde_json::to_vec(&value).expect("GLB JSON fixture");
    while json.len() % 4 != 0 {
        json.push(b' ');
    }
    let total_length = 20 + json.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend_from_slice(b"glTF");
    bytes.extend_from_slice(&2_u32.to_le_bytes());
    bytes.extend_from_slice(&(u32::try_from(total_length).unwrap()).to_le_bytes());
    bytes.extend_from_slice(&(u32::try_from(json.len()).unwrap()).to_le_bytes());
    bytes.extend_from_slice(&0x4e4f534a_u32.to_le_bytes());
    bytes.extend_from_slice(&json);
    bytes
}

#[cfg(unix)]
fn create_directory_symlink(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).expect("create managed directory symlink fixture");
}

#[cfg(windows)]
fn create_directory_symlink(target: &Path, link: &Path) {
    std::os::windows::fs::symlink_dir(target, link)
        .expect("create managed directory symlink fixture");
}

#[test]
fn binary_content_admission_rejects_header_only_images_and_incomplete_vrm() {
    use base64::Engine;

    let png = vec![
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52, 0, 0,
        0, 1, 0, 0, 0, 1,
    ];
    let jpeg = vec![0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 1, 0, 1, 0];
    let mut webp = vec![0_u8; 30];
    webp[0..4].copy_from_slice(b"RIFF");
    webp[8..16].copy_from_slice(b"WEBPVP8X");
    assert!(background_dimensions(&png, "image/png").is_err());
    assert!(background_dimensions(&jpeg, "image/jpeg").is_err());
    assert!(background_dimensions(&webp, "image/webp").is_err());

    for (mime, encoded) in [
        (
            "image/png",
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        ),
        (
            "image/jpeg",
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwGiiimI//2Q==",
        ),
        (
            "image/webp",
            "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v0gUAA=",
        ),
    ] {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid one-pixel image fixture");
        assert_eq!(background_dimensions(&bytes, mime), Ok((1, 1)), "{mime}");
        assert!(background_dimensions(&bytes[..bytes.len() - 2], mime).is_err());
    }

    assert!(validate_vrm_glb(&glb_with_json(serde_json::json!({
        "extensionsUsed": ["VRMC_vrm"],
        "extensions": { "VRMC_vrm": { "specVersion": "1.0" } }
    })))
    .is_err());
    assert!(validate_vrm_glb(&glb_with_json(serde_json::json!({
        "asset": { "version": "2.0" },
        "extensionsUsed": ["VRMC_vrm"],
        "extensions": { "VRMC_vrm": {} }
    })))
    .is_err());
    assert!(validate_vrm_glb(&glb_with_json(serde_json::json!({
        "asset": { "version": "2.0" },
        "extensionsUsed": ["VRMC_vrm"],
        "extensions": { "VRMC_vrm": { "specVersion": "1.0" } }
    })))
    .is_ok());
}

#[test]
fn live2d_sidecar_custody_is_scoped_by_avatar_asset_and_finalized_atomically() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-sidecar-scope-{nonce}"));
    let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root.join("data"));
    let mut sources = Vec::new();
    for (name, variant) in [("avatar-a", "first"), ("avatar-b", "second")] {
        let source = root.join(name);
        fs::create_dir_all(&source).expect("Live2D source directory");
        fs::write(source.join("model.moc3"), format!("MOC3{variant}")).expect("Live2D MOC fixture");
        fs::write(source.join("texture.png"), b"fixture texture").expect("Live2D texture fixture");
        fs::write(
            source.join("model.model3.json"),
            br#"{"Version":3,"FileReferences":{"Moc":"model.moc3","Textures":["texture.png"]}}"#,
        )
        .expect("Live2D model fixture");
        sources.push(fs::canonicalize(source).expect("canonical Live2D source"));
    }
    let sidecar = root.join("adapter.json");
    fs::write(
        &sidecar,
        br#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .expect("Live2D adapter fixture");
    let canonical_sidecar = fs::canonicalize(sidecar).expect("canonical sidecar source");
    crate::standard_file_dialog::register_file_dialog_selected_paths(&[
        sources[0].clone(),
        sources[1].clone(),
        canonical_sidecar.clone(),
    ])
    .expect("register selected Agent Center sources");

    let mut asset_refs = Vec::new();
    for source in &sources {
        let imported = standard_agent_center_avatar_asset_import_blocking(
            &roots,
            StandardAgentCenterAvatarAssetImportPayload {
                host_scope: "local-agent".to_string(),
                account_id: "account_1".to_string(),
                owner_user_id: "owner_1".to_string(),
                runtime_source_ref: "runtime-source:local".to_string(),
                local_agent_ref: "local-agent:ren".to_string(),
                backend_kind: StandardAgentCenterAvatarBackendKind::Live2d,
                source_path: source.display().to_string(),
            },
        )
        .expect("valid Live2D import");
        asset_refs.push(imported.local_asset_id);
    }
    assert_ne!(asset_refs[0], asset_refs[1]);

    let mut manifest_ref = None;
    for asset_ref in &asset_refs {
        let imported = standard_agent_center_live2d_adapter_manifest_import_blocking(
            &roots,
            StandardAgentCenterLive2dAdapterManifestImportPayload {
                host_scope: "local-agent".to_string(),
                account_id: "account_1".to_string(),
                owner_user_id: "owner_1".to_string(),
                runtime_source_ref: "runtime-source:local".to_string(),
                local_agent_ref: "local-agent:ren".to_string(),
                avatar_asset_ref: asset_ref.clone(),
                source_path: canonical_sidecar.display().to_string(),
            },
        )
        .expect("asset-scoped sidecar import");
        manifest_ref.get_or_insert(imported.manifest_ref.clone());
        assert_eq!(manifest_ref.as_ref(), Some(&imported.manifest_ref));
        let custody_dir = live2d_adapter_manifest_dir(
            &roots,
            "account_1",
            "local-agent:ren",
            asset_ref,
            &imported.manifest_ref,
        )
        .expect("asset-scoped sidecar path");
        let custody: Live2dAdapterManifestCustody = serde_json::from_slice(
            &fs::read(custody_dir.join(LIVE2D_ADAPTER_CUSTODY_FILE_NAME))
                .expect("sidecar custody record"),
        )
        .expect("valid sidecar custody record");
        assert_eq!(custody.local_asset_id, *asset_ref);
        assert_eq!(
            fs::read_dir(&custody_dir)
                .expect("sidecar custody directory")
                .count(),
            2
        );
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn live2d_sidecar_import_rejects_unvalidated_avatar_custody() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-sidecar-avatar-{nonce}"));
    let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root.join("data"));
    let sidecar = root.join("adapter.json");
    fs::create_dir_all(&root).expect("sidecar test root");
    fs::write(
        &sidecar,
        br#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .expect("Live2D adapter fixture");
    let canonical_sidecar = fs::canonicalize(sidecar).expect("canonical sidecar source");
    crate::standard_file_dialog::register_file_dialog_selected_paths(&[canonical_sidecar.clone()])
        .expect("register selected sidecar source");

    let payload_for = |account_id: &str, avatar_asset_ref: &str| {
        StandardAgentCenterLive2dAdapterManifestImportPayload {
            host_scope: "local-agent".to_string(),
            account_id: account_id.to_string(),
            owner_user_id: "owner_1".to_string(),
            runtime_source_ref: "runtime-source:local".to_string(),
            local_agent_ref: "local-agent:ren".to_string(),
            avatar_asset_ref: avatar_asset_ref.to_string(),
            source_path: canonical_sidecar.display().to_string(),
        }
    };

    let empty_ref = "live2d_aaaaaaaaaaaa";
    let empty_dir = avatar_asset_dir(&roots, "account_1", "local-agent:ren", "live2d", empty_ref)
        .expect("empty avatar custody path");
    fs::create_dir_all(&empty_dir).expect("empty avatar custody fixture");
    assert!(matches!(
        standard_agent_center_live2d_adapter_manifest_import_blocking(
            &roots,
            payload_for("account_1", empty_ref),
        ),
        Err(AgentCenterHostError::InvalidPayload(_))
    ));
    assert!(matches!(
        standard_agent_center_live2d_adapter_manifest_import_blocking(
            &roots,
            payload_for("account_2", empty_ref),
        ),
        Err(AgentCenterHostError::NotFound(_))
    ));

    let damaged_ref = "live2d_bbbbbbbbbbbb";
    let damaged_dir = avatar_asset_dir(
        &roots,
        "account_1",
        "local-agent:ren",
        "live2d",
        damaged_ref,
    )
    .expect("damaged avatar custody path");
    fs::create_dir_all(&damaged_dir).expect("damaged avatar custody fixture");
    fs::write(damaged_dir.join(MANIFEST_FILE_NAME), b"not-json")
        .expect("damaged avatar manifest fixture");
    assert!(matches!(
        standard_agent_center_live2d_adapter_manifest_import_blocking(
            &roots,
            payload_for("account_1", damaged_ref),
        ),
        Err(AgentCenterHostError::InvalidPayload(_))
    ));

    let symlink_ref = "live2d_cccccccccccc";
    let symlink_dir = avatar_asset_dir(
        &roots,
        "account_1",
        "local-agent:ren",
        "live2d",
        symlink_ref,
    )
    .expect("symlink avatar custody path");
    let outside = root.join("outside-avatar");
    fs::create_dir_all(&outside).expect("outside avatar target");
    create_directory_symlink(&outside, &symlink_dir);
    assert!(matches!(
        standard_agent_center_live2d_adapter_manifest_import_blocking(
            &roots,
            payload_for("account_1", symlink_ref),
        ),
        Err(AgentCenterHostError::InvalidPath(_))
    ));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn shared_payload_fixture_matrix_is_rejected_by_the_raw_command_parser() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../capabilities/test/agent-center-payload-fixtures.json"
    ))
    .expect("shared Agent Center payload fixtures");
    for fixture in fixtures.as_array().expect("fixture rows") {
        let command = fixture["command"].as_str().expect("fixture command");
        crate::capabilities::agent_center::parse_agent_center_payload_for_command(
            command,
            Some(fixture["valid"].clone()),
        )
        .expect("valid shared payload fixture");
        for case in ["unknown", "missing", "wrong"] {
            let error = crate::capabilities::agent_center::parse_agent_center_payload_for_command(
                command,
                Some(fixture[case].clone()),
            )
            .expect_err("invalid raw command payload must fail");
            let envelope = parse_standard_error(error);
            assert_eq!(envelope["code"], "invalid-payload", "{command} {case}");
            assert_eq!(
                envelope["reasonCode"], "tauri-agent-center-payload-invalid",
                "{command} {case}"
            );
        }
    }
}

#[test]
fn raw_command_parser_rejects_missing_and_non_object_whole_payloads() {
    for payload in [
        None,
        Some(serde_json::Value::Null),
        Some(serde_json::json!([])),
    ] {
        let error = crate::capabilities::agent_center::parse_agent_center_payload_for_command(
            "nimi.shell.agentCenter.avatarAssetImport",
            payload,
        )
        .expect_err("raw payload must fail closed");
        let envelope = parse_standard_error(error);
        assert_eq!(envelope["code"], "invalid-payload");
        assert_eq!(envelope["reasonCode"], "tauri-agent-center-payload-invalid");
    }
}

#[test]
fn avatar_import_payload_accepts_renderer_shell_contract_fields() {
    let payload = serde_json::json!({
        "hostScope": "local-agent",
        "accountId": "account-1",
        "ownerUserId": "owner-1",
        "runtimeSourceRef": "runtime-source:local",
        "localAgentRef": "local-agent:ren",
        "backendKind": "live2d",
        "sourcePath": "fixtures/picked-live2d"
    });

    assert!(serde_json::from_value::<StandardAgentCenterAvatarAssetImportPayload>(payload).is_ok());
}

#[test]
fn account_cleanup_payload_requires_explicit_account_scope() {
    let valid = serde_json::json!({
        "hostScope": "account",
        "accountId": "account-1",
    });
    let wrong_scope = serde_json::json!({
        "hostScope": "local-agent",
        "accountId": "account-1",
    });
    let missing_account = serde_json::json!({
        "hostScope": "account",
    });

    let payload =
        serde_json::from_value::<StandardAgentCenterAccountLocalResourcesRemovePayload>(valid)
            .expect("canonical account cleanup payload");
    assert!(validate_account_host_scope(&payload.host_scope).is_ok());
    let wrong = serde_json::from_value::<StandardAgentCenterAccountLocalResourcesRemovePayload>(
        wrong_scope,
    )
    .expect("shape is valid before semantic scope validation");
    assert!(validate_account_host_scope(&wrong.host_scope).is_err());
    assert!(
        serde_json::from_value::<StandardAgentCenterAccountLocalResourcesRemovePayload>(
            missing_account
        )
        .is_err()
    );
}

#[test]
fn avatar_validation_projection_returns_renderer_shell_contract_fields() {
    let projected = shell_projection::avatar_asset_validate_result(
        StandardAgentCenterAvatarAssetValidationResult {
            schema_version: 1,
            local_asset_id: "live2d_111111111111".to_string(),
            checked_at: "2026-01-01T00:00:00Z".to_string(),
            status: StandardAgentCenterAvatarAssetValidationStatus::Valid,
            errors: vec![],
            warnings: vec![],
        },
    )
    .expect("validated shell projection");

    assert_eq!(projected["avatarAssetRef"], "live2d_111111111111");
    assert_eq!(projected["backendKind"], "live2d");
    assert_eq!(projected["validationStatus"], "valid");
    assert!(projected.get("localAssetId").is_none());
    assert!(projected.get("validation").is_none());
}

#[test]
fn selected_source_rejection_uses_canonical_forbidden_renderer_access_code() {
    let error = require_file_dialog_selected_source(
        Path::new("/definitely/not/a/registered/source"),
        "agent_center_background_import",
    )
    .expect_err("unregistered source must fail");
    let envelope = parse_standard_error(error);
    assert_eq!(envelope["code"], "forbidden-renderer-access");
    assert_eq!(
        envelope["reasonCode"],
        "tauri-agent-center-source-not-from-file-dialog"
    );
    assert_eq!(envelope["source"], "tauri");
}

#[tokio::test]
async fn real_avatar_import_failures_preserve_typed_error_classification_through_commands() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-typed-errors-{nonce}"));
    let data_root = root.join("data");
    let empty_live2d = root.join("empty-live2d");
    fs::create_dir_all(&empty_live2d).expect("empty Live2D fixture");
    let canonical_empty = fs::canonicalize(&empty_live2d).expect("canonical empty fixture");
    crate::standard_file_dialog::register_file_dialog_selected_paths(&[canonical_empty.clone()])
        .expect("register selected source");
    let roots = crate::runtime_app_storage::test_standard_app_storage_roots(&data_root);

    let payload_for = |source_path: String| StandardAgentCenterAvatarAssetImportPayload {
        host_scope: "local-agent".to_string(),
        account_id: "account_1".to_string(),
        owner_user_id: "owner_1".to_string(),
        runtime_source_ref: "runtime-source:local".to_string(),
        local_agent_ref: "local-agent:ren".to_string(),
        backend_kind: StandardAgentCenterAvatarBackendKind::Live2d,
        source_path,
    };

    let empty_error = commands::avatar_asset_import(
        roots.clone(),
        payload_for(canonical_empty.display().to_string()),
    )
    .await
    .expect_err("empty Live2D source must fail");
    let empty_envelope = parse_standard_error(empty_error);
    assert_eq!(empty_envelope["code"], "invalid-payload");
    assert_eq!(
        empty_envelope["reasonCode"],
        "tauri-agent-center-payload-invalid"
    );
    assert_eq!(
        empty_envelope["details"]["cause"],
        "Live2D source folder contains no files"
    );

    let missing_error = commands::avatar_asset_import(
        roots,
        payload_for(root.join("missing-live2d").display().to_string()),
    )
    .await
    .expect_err("missing source path must fail");
    let missing_envelope = parse_standard_error(missing_error);
    assert_eq!(missing_envelope["code"], "invalid-path");
    assert_eq!(
        missing_envelope["reasonCode"],
        "tauri-agent-center-path-invalid"
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn real_byte_cap_failure_is_invalid_payload_through_background_import_command() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-byte-cap-{nonce}"));
    fs::create_dir_all(&root).expect("byte-cap fixture root");
    let source = root.join("oversize.png");
    let file = fs::File::create(&source).expect("oversize background fixture");
    file.set_len(MAX_BACKGROUND_BYTES + 1)
        .expect("sparse oversize background fixture");
    drop(file);
    let canonical_source = fs::canonicalize(&source).expect("canonical oversize fixture");
    crate::standard_file_dialog::register_file_dialog_selected_paths(&[canonical_source.clone()])
        .expect("register oversize selected source");
    let roots = crate::runtime_app_storage::test_standard_app_storage_roots(root.join("data"));
    let error = commands::background_import(
        roots,
        StandardAgentCenterBackgroundImportPayload {
            host_scope: "local-agent".to_string(),
            account_id: "account_1".to_string(),
            owner_user_id: "owner_1".to_string(),
            runtime_source_ref: "runtime-source:local".to_string(),
            local_agent_ref: "local-agent:ren".to_string(),
            source_path: canonical_source.display().to_string(),
        },
    )
    .await
    .expect_err("oversize background must fail");
    let envelope = assert_error_code(
        error,
        "invalid-payload",
        "tauri-agent-center-payload-invalid",
    );
    assert_eq!(
        envelope["details"]["cause"],
        "background source is outside the fixed byte cap"
    );
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn real_missing_managed_refs_are_not_found_through_command_wrappers() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-not-found-{nonce}"));
    let roots = crate::runtime_app_storage::test_standard_app_storage_roots(&root);
    let avatar_ref = "live2d_aaaaaaaaaaaa";
    let background_ref = "bg_bbbbbbbbbbbb";

    let errors = [
        commands::avatar_asset_validate(roots.clone(), avatar_validate_payload(avatar_ref))
            .await
            .expect_err("missing avatar validation must fail"),
        commands::background_validate(roots.clone(), background_payload(background_ref))
            .await
            .expect_err("missing background validation must fail"),
        commands::background_get_managed_asset(roots.clone(), background_payload(background_ref))
            .await
            .expect_err("missing background get must fail"),
        commands::background_remove(
            roots,
            StandardAgentCenterBackgroundRemovePayload {
                host_scope: "local-agent".to_string(),
                account_id: "account_1".to_string(),
                owner_user_id: "owner_1".to_string(),
                runtime_source_ref: "runtime-source:local".to_string(),
                local_agent_ref: "local-agent:ren".to_string(),
                background_asset_ref: background_ref.to_string(),
            },
        )
        .await
        .expect_err("missing background removal must fail"),
    ];
    for error in errors {
        assert_error_code(error, "not-found", "tauri-agent-center-resource-not-found");
    }
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn all_catalogued_agent_center_path_operations_emit_invalid_path_on_managed_symlinks() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-invalid-path-{nonce}"));

    let avatar_roots =
        crate::runtime_app_storage::test_standard_app_storage_roots(root.join("avatar"));
    let avatar_ref = "live2d_aaaaaaaaaaaa";
    let avatar_dir = avatar_asset_dir(
        &avatar_roots,
        "account_1",
        "local-agent:ren",
        "live2d",
        avatar_ref,
    )
    .expect("avatar managed path");
    let avatar_target = root.join("outside-avatar");
    fs::create_dir_all(avatar_dir.parent().unwrap()).expect("avatar managed parent");
    fs::create_dir_all(&avatar_target).expect("avatar symlink target");
    create_directory_symlink(&avatar_target, &avatar_dir);
    let avatar_errors = [
        commands::avatar_asset_validate(avatar_roots.clone(), avatar_validate_payload(avatar_ref))
            .await
            .expect_err("avatar validate symlink must fail"),
        commands::avatar_asset_resolve_preview(
            avatar_roots,
            StandardAgentCenterAvatarPreviewResolvePayload {
                host_scope: "local-agent".to_string(),
                account_id: "account_1".to_string(),
                owner_user_id: "owner_1".to_string(),
                runtime_source_ref: "runtime-source:local".to_string(),
                local_agent_ref: "local-agent:ren".to_string(),
                avatar_asset_ref: avatar_ref.to_string(),
                backend_kind: None,
            },
        )
        .await
        .expect_err("avatar preview symlink must fail"),
    ];
    for error in avatar_errors {
        assert_error_code(error, "invalid-path", "tauri-agent-center-path-invalid");
    }

    let background_roots =
        crate::runtime_app_storage::test_standard_app_storage_roots(root.join("background"));
    let background_ref = "bg_bbbbbbbbbbbb";
    let background_dir = background_dir(
        &background_roots,
        "account_1",
        "local-agent:ren",
        background_ref,
    )
    .expect("background managed path");
    let background_target = root.join("outside-background");
    fs::create_dir_all(background_dir.parent().unwrap()).expect("background managed parent");
    fs::create_dir_all(&background_target).expect("background symlink target");
    create_directory_symlink(&background_target, &background_dir);
    let background_errors = [
        commands::background_get_managed_asset(
            background_roots.clone(),
            background_payload(background_ref),
        )
        .await
        .expect_err("background get symlink must fail"),
        commands::background_validate(background_roots.clone(), background_payload(background_ref))
            .await
            .expect_err("background validate symlink must fail"),
        commands::background_remove(
            background_roots,
            StandardAgentCenterBackgroundRemovePayload {
                host_scope: "local-agent".to_string(),
                account_id: "account_1".to_string(),
                owner_user_id: "owner_1".to_string(),
                runtime_source_ref: "runtime-source:local".to_string(),
                local_agent_ref: "local-agent:ren".to_string(),
                background_asset_ref: background_ref.to_string(),
            },
        )
        .await
        .expect_err("background remove symlink must fail"),
    ];
    for error in background_errors {
        assert_error_code(error, "invalid-path", "tauri-agent-center-path-invalid");
    }

    let agent_roots =
        crate::runtime_app_storage::test_standard_app_storage_roots(root.join("agent"));
    let agent_dir =
        agent_center_dir(&agent_roots, "account_1", "local-agent:ren").expect("agent managed path");
    let agent_target = root.join("outside-agent");
    fs::create_dir_all(agent_dir.parent().unwrap()).expect("agent managed parent");
    fs::create_dir_all(&agent_target).expect("agent symlink target");
    create_directory_symlink(&agent_target, &agent_dir);
    let agent_error = commands::agent_resources_remove(
        agent_roots,
        StandardAgentCenterAgentLocalResourcesRemovePayload {
            host_scope: "local-agent".to_string(),
            account_id: "account_1".to_string(),
            owner_user_id: "owner_1".to_string(),
            runtime_source_ref: "runtime-source:local".to_string(),
            local_agent_ref: "local-agent:ren".to_string(),
        },
    )
    .await
    .expect_err("agent cleanup symlink must fail");
    assert_error_code(
        agent_error,
        "invalid-path",
        "tauri-agent-center-path-invalid",
    );

    let account_roots =
        crate::runtime_app_storage::test_standard_app_storage_roots(root.join("account"));
    let account_root = account_dir(&account_roots, "account_1").expect("account managed path");
    let agents_root = account_root.join("agents");
    let account_target = root.join("outside-account-agents");
    fs::create_dir_all(&account_root).expect("account managed parent");
    fs::create_dir_all(&account_target).expect("account agents symlink target");
    create_directory_symlink(&account_target, &agents_root);
    let account_error = commands::account_resources_remove(
        account_roots,
        StandardAgentCenterAccountLocalResourcesRemovePayload {
            host_scope: "account".to_string(),
            account_id: "account_1".to_string(),
        },
    )
    .await
    .expect_err("account cleanup symlink must fail");
    assert_error_code(
        account_error,
        "invalid-path",
        "tauri-agent-center-path-invalid",
    );
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn real_validation_sidecar_write_failure_is_host_internal_through_command_wrapper() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-host-io-{nonce}"));
    let roots = crate::runtime_app_storage::test_standard_app_storage_roots(&root);
    let avatar_ref = "live2d_cccccccccccc";
    let asset_dir = avatar_asset_dir(&roots, "account_1", "local-agent:ren", "live2d", avatar_ref)
        .expect("scoped avatar fixture path");
    fs::create_dir_all(asset_dir.join(VALIDATION_FILE_NAME))
        .expect("validation sidecar directory collision");

    let error = commands::avatar_asset_validate(roots, avatar_validate_payload(avatar_ref))
        .await
        .expect_err("validation sidecar write collision must fail");
    let envelope = assert_error_code(
        error,
        "host-internal-error",
        "tauri-agent-center-host-operation-failed",
    );
    assert!(envelope["details"]["cause"]
        .as_str()
        .is_some_and(|cause| cause.contains("failed to write Avatar asset validation sidecar")));
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn blocking_join_failure_uses_complete_standard_envelope() {
    let error = commands::run_agent_center_resource_blocking("agent_center_test_panic", || {
        panic!("simulated blocking worker panic");
        #[allow(unreachable_code)]
        Ok::<(), commands::AgentCenterHostError>(())
    })
    .await
    .expect_err("blocking panic must fail closed");
    let envelope = parse_standard_error(error);
    assert_eq!(envelope["code"], "host-internal-error");
    assert_eq!(
        envelope["reasonCode"],
        "tauri-agent-center-blocking-task-failed"
    );
    assert_eq!(envelope["source"], "tauri");
}
