use super::*;
use base64::Engine;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

const ONE_PIXEL_PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

fn temp_root(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!("nimi-agent-center-{label}-{nonce}"))
}

fn parse_standard_error(error: String) -> serde_json::Value {
    serde_json::from_str(&error).expect("standard Agent Center error envelope")
}

fn write_live2d_zip(path: &Path) {
    let file = fs::File::create(path).expect("Live2D zip fixture");
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    archive
        .start_file("ren/ren.model3.json", options)
        .expect("model3 entry");
    archive
        .write_all(br#"{"Version":3}"#)
        .expect("model3 bytes");
    archive.finish().expect("finish Live2D zip");
}

#[test]
fn shared_payload_fixture_matrix_covers_identity_free_material_selection() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../capabilities/test/agent-center-payload-fixtures.json"
    ))
    .expect("shared Agent Center payload fixtures");
    let rows = fixtures.as_array().expect("fixture rows");
    assert_eq!(rows.len(), 2);
    for fixture in rows {
        let command = fixture["command"].as_str().expect("fixture command");
        crate::capabilities::agent_center::parse_agent_center_payload_for_command(
            command,
            Some(fixture["valid"].clone()),
        )
        .expect("valid shared payload fixture");
        for (index, invalid) in fixture["invalid"]
            .as_array()
            .expect("invalid fixture rows")
            .iter()
            .enumerate()
        {
            let error = crate::capabilities::agent_center::parse_agent_center_payload_for_command(
                command,
                Some(invalid.clone()),
            )
            .expect_err("invalid raw command payload must fail");
            let envelope = parse_standard_error(error);
            assert_eq!(envelope["code"], "invalid-payload", "{command} {index}");
            assert_eq!(
                envelope["reasonCode"], "tauri-agent-center-payload-invalid",
                "{command} {index}"
            );
        }
    }
}

#[test]
fn raw_command_parser_rejects_missing_non_object_and_retired_commands() {
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
        assert_eq!(
            parse_standard_error(error)["reasonCode"],
            "tauri-agent-center-payload-invalid"
        );
    }
    let retired = crate::capabilities::agent_center::parse_agent_center_payload_for_command(
        "nimi.shell.agentCenter.avatarAssetValidate",
        Some(serde_json::json!({})),
    )
    .expect_err("retired command must remain unavailable");
    assert_eq!(
        parse_standard_error(retired)["reasonCode"],
        "tauri-agent-center-payload-invalid"
    );
}

#[test]
fn avatar_material_payload_is_identity_free_and_rejects_sideband() {
    let valid = serde_json::json!({ "backendKind": "live2d" });
    assert!(
        serde_json::from_value::<StandardAgentCenterAvatarMaterialSelectPayload>(valid).is_ok()
    );
    assert!(
        serde_json::from_value::<StandardAgentCenterAvatarMaterialSelectPayload>(
            serde_json::json!({
                "backendKind": "live2d",
                "sourcePath": "fixtures/picked-live2d.zip"
            })
        )
        .is_err()
    );
}

#[tokio::test]
async fn identity_free_material_selection_returns_bytes_and_durable_resolver_custody() {
    let root = temp_root("material-selection");
    fs::create_dir_all(&root).expect("material selection temp dir");
    let avatar = root.join("avatar.vrm");
    let data_root = root.join("data-root");
    let background = root.join("background.png");
    fs::write(&avatar, b"vrm-material").expect("avatar material");
    fs::write(
        &background,
        base64::engine::general_purpose::STANDARD
            .decode(ONE_PIXEL_PNG)
            .expect("background material"),
    )
    .expect("background material file");
    let avatar = fs::canonicalize(avatar).expect("canonical avatar material");
    let background = fs::canonicalize(background).expect("canonical background material");

    let avatar_result = crate::runtime_bridge::with_runtime_bridge_host_hooks_async(
        crate::runtime_bridge::RuntimeBridgeHostHooks {
            resolve_nimi_data_dir: Some(std::sync::Arc::new({
                let data_root = data_root.clone();
                move || Ok(data_root.clone())
            })),
            ..Default::default()
        },
        || async {
            crate::capabilities::agent_center::agent_center_avatar_asset_import_with_selected_path(
                Some(serde_json::json!({ "backendKind": "vrm" })),
                Some(avatar),
            )
            .await
        },
    )
    .await
    .expect("identity-free avatar material selection");
    assert_eq!(avatar_result["role"], "avatar");
    assert_eq!(
        avatar_result["sha256"].as_str().unwrap_or_default().len(),
        64
    );

    let background_result =
        crate::capabilities::agent_center::agent_center_background_import_with_selected_path(
            Some(serde_json::json!({})),
            Some(background),
        )
        .await
        .expect("identity-free background material selection");
    assert_eq!(background_result["role"], "background");
    assert_eq!(background_result["mediaType"], "image/png");
    assert_eq!(
        background_result["sha256"]
            .as_str()
            .unwrap_or_default()
            .len(),
        64
    );
    let asset_ref = format!(
        "vrm_{}",
        &avatar_result["sha256"].as_str().expect("avatar digest")[..12]
    );
    assert!(data_root
        .join("avatar-assets")
        .join("packages/vrm")
        .join(asset_ref)
        .join("manifest.json")
        .is_file());

    assert_eq!(
        avatar_result
            .as_object()
            .expect("projection")
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>(),
        [
            "backendKind",
            "content",
            "custodyRef",
            "fileName",
            "mediaType",
            "role",
            "sha256"
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    );
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn native_selection_cancellation_returns_null_without_path_state() {
    let avatar =
        crate::capabilities::agent_center::agent_center_avatar_asset_import_with_selected_path(
            Some(serde_json::json!({ "backendKind": "vrm" })),
            None,
        )
        .await
        .expect("avatar cancellation");
    let background =
        crate::capabilities::agent_center::agent_center_background_import_with_selected_path(
            Some(serde_json::json!({})),
            None,
        )
        .await
        .expect("background cancellation");
    assert!(avatar.is_null());
    assert!(background.is_null());
}

#[tokio::test]
async fn live2d_import_materializes_and_resolves_by_asset_ref_and_kind() {
    let root = temp_root("live2d-import-resolve");
    fs::create_dir_all(&root).expect("Live2D import root");
    let selected = root.join("ren.zip");
    let data_root = root.join("data-root");
    write_live2d_zip(&selected);
    let selected = fs::canonicalize(selected).expect("canonical Live2D zip");
    let resolved = crate::runtime_bridge::with_runtime_bridge_host_hooks_async(
        crate::runtime_bridge::RuntimeBridgeHostHooks {
            resolve_nimi_data_dir: Some(std::sync::Arc::new({
                let data_root = data_root.clone();
                move || Ok(data_root.clone())
            })),
            ..Default::default()
        },
        || async {
            let imported =
                crate::capabilities::agent_center::agent_center_avatar_asset_import_with_selected_path(
                    Some(serde_json::json!({
                        "backendKind": "live2d",
                    })),
                    Some(selected),
                )
                .await?;
            let digest = imported["sha256"]
                .as_str()
                .ok_or_else(|| "import digest missing".to_string())?;
            let asset_ref = format!("live2d_{}", &digest[..12]);
            crate::agent_center_avatar_asset::resolve_agent_center_avatar_asset_with_formal_reader(
                crate::agent_center_avatar_asset::AgentCenterAvatarAssetResolvePayload {
                    agent_handle: "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string(),
                    backend_kind: "live2d".to_string(),
                    avatar_asset_ref: asset_ref.clone(),
                },
                move |_agent_handle, _requested_ref| async move {
                    Ok(serde_json::json!({
                        "assetRef": asset_ref,
                        "role": imported["role"],
                        "backendKind": imported["backendKind"],
                        "fileName": imported["fileName"],
                        "mediaType": imported["mediaType"],
                        "content": imported["content"],
                        "sha256": imported["sha256"],
                    }))
                },
            )
            .await
        },
    )
    .await
    .expect("imported Live2D resolution");

    assert_eq!(resolved.manifest.kind, "live2d");
    assert_eq!(resolved.manifest.model_id, "ren");
    assert!(resolved
        .materialization_ref
        .starts_with("avatar-materialization:live2d:"));
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn background_selection_rejects_oversize_and_malformed_material() {
    let root = temp_root("background-failures");
    fs::create_dir_all(&root).expect("background failure root");
    let oversize = root.join("oversize.png");
    let file = fs::File::create(&oversize).expect("oversize background fixture");
    file.set_len(MAX_BACKGROUND_BYTES + 1)
        .expect("sparse oversize background fixture");
    drop(file);
    let malformed = root.join("malformed.png");
    fs::write(&malformed, b"not-a-png").expect("malformed background fixture");
    let oversize = fs::canonicalize(oversize).expect("canonical oversize background");
    let malformed = fs::canonicalize(malformed).expect("canonical malformed background");
    for source in [oversize, malformed] {
        let error =
            crate::capabilities::agent_center::agent_center_background_import_with_selected_path(
                Some(serde_json::json!({})),
                Some(source),
            )
            .await
            .expect_err("invalid background must fail closed");
        let envelope = parse_standard_error(error);
        assert_eq!(envelope["code"], "invalid-payload");
        assert_eq!(envelope["reasonCode"], "tauri-agent-center-payload-invalid");
    }
    let _ = fs::remove_dir_all(root);
}
