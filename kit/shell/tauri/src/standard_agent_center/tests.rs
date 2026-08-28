use super::*;
use base64::Engine;
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

#[test]
fn shared_payload_fixture_matrix_covers_only_identity_free_material_selection() {
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
fn avatar_material_payload_rejects_raw_identity_sideband() {
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
async fn identity_free_material_selection_returns_bytes_without_host_product_state() {
    let root = temp_root("material-selection");
    fs::create_dir_all(&root).expect("material selection temp dir");
    let avatar = root.join("avatar.zip");
    let background = root.join("background.png");
    fs::write(&avatar, b"runtime-validates-this-package").expect("avatar material");
    fs::write(
        &background,
        base64::engine::general_purpose::STANDARD
            .decode(ONE_PIXEL_PNG)
            .expect("background material"),
    )
    .expect("background material file");
    let avatar = fs::canonicalize(avatar).expect("canonical avatar material");
    let background = fs::canonicalize(background).expect("canonical background material");

    let avatar_result =
        crate::capabilities::agent_center::agent_center_avatar_asset_import_with_selected_path(
            Some(serde_json::json!({ "backendKind": "live2d" })),
            Some(avatar),
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
    assert_eq!(
        fs::read_dir(&root).expect("selection root").count(),
        2,
        "Host selection must not create durable Agent-scoped product state",
    );

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
