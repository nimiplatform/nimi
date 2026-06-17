use crate::agent_center_avatar_asset::{
    agent_center_path_segment, nimi_avatar_resolve_agent_center_avatar_asset,
    nimi_avatar_resolve_local_avatar_asset, AgentCenterAvatarAssetResolvePayload,
    LocalAvatarAssetResolvePayload,
};
use crate::runtime_bridge::{set_runtime_bridge_host_hooks, RuntimeBridgeHostHooks};
use crate::test_support::test_guard;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Once};
use std::time::{SystemTime, UNIX_EPOCH};

const TEST_DATA_ROOT_ENV: &str = "NIMI_AGENT_CENTER_AVATAR_TEST_DATA_ROOT";

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    std::env::temp_dir().join(format!("nimi-shell-avatar-asset-{prefix}-{unique}"))
}

fn install_data_root_hook() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = set_runtime_bridge_host_hooks(RuntimeBridgeHostHooks {
            resolve_nimi_data_dir: Some(Arc::new(|| {
                std::env::var_os(TEST_DATA_ROOT_ENV)
                    .map(PathBuf::from)
                    .ok_or_else(|| {
                        "test data-root hook requires NIMI_AGENT_CENTER_AVATAR_TEST_DATA_ROOT"
                            .to_string()
                    })
            })),
            ..Default::default()
        });
    });
}

async fn with_admitted_data_root<R, F, Fut>(home: &Path, run: F) -> R
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = R>,
{
    install_data_root_hook();
    let data_root = home.join(".nimi").join("data");
    let previous_data_root = std::env::var(TEST_DATA_ROOT_ENV).ok();
    std::env::set_var(TEST_DATA_ROOT_ENV, &data_root);
    let result = run().await;
    match previous_data_root {
        Some(value) => std::env::set_var(TEST_DATA_ROOT_ENV, value),
        None => std::env::remove_var(TEST_DATA_ROOT_ENV),
    }
    result
}

async fn without_admitted_data_root<R, F, Fut>(run: F) -> R
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = R>,
{
    install_data_root_hook();
    let previous_data_root = std::env::var(TEST_DATA_ROOT_ENV).ok();
    std::env::remove_var(TEST_DATA_ROOT_ENV);
    let result = run().await;
    match previous_data_root {
        Some(value) => std::env::set_var(TEST_DATA_ROOT_ENV, value),
        None => std::env::remove_var(TEST_DATA_ROOT_ENV),
    }
    result
}

fn local_agent_ref(owner_user_id: &str, realm_agent_id: &str) -> String {
    format!("local-agent:{owner_user_id}:{realm_agent_id}")
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
    kind: &str,
    local_asset_id: &str,
) -> AgentCenterAvatarAssetResolvePayload {
    let local_agent_ref = local_agent_ref(owner_user_id, realm_agent_id);
    AgentCenterAvatarAssetResolvePayload {
        account_id: account_id.to_string(),
        owner_user_id: owner_user_id.to_string(),
        realm_agent_id: realm_agent_id.to_string(),
        local_agent_ref: local_agent_ref.clone(),
        backend_kind: kind.to_string(),
        local_avatar_asset_ref: local_asset_id.to_string(),
        backend_capability_profile_ref: format!("avatar.backend_profile/{kind}/basic"),
        materialization_ref: materialization_ref(
            account_id,
            &local_agent_ref,
            kind,
            local_asset_id,
        ),
    }
}

fn write_avatar_asset_package(
    home: &Path,
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
    kind: &str,
    local_asset_id: &str,
    entry_file: &str,
    entry_mime: &str,
    entry_bytes: &[u8],
) -> PathBuf {
    let local_agent_ref = local_agent_ref(owner_user_id, realm_agent_id);
    let package_dir = agent_center_root(home, account_id, &local_agent_ref)
        .join("modules/avatar_asset/packages")
        .join(kind)
        .join(local_asset_id);
    let entry_path = package_dir.join(entry_file);
    fs::create_dir_all(entry_path.parent().expect("entry parent")).expect("create files");
    fs::write(&entry_path, entry_bytes).expect("entry bytes");
    let digest = {
        let mut hasher = Sha256::new();
        hasher.update(entry_bytes);
        format!("{:x}", hasher.finalize())
    };
    let manifest = json!({
        "manifest_version": 1,
        "asset_version": "1.0.0",
        "local_asset_id": local_asset_id,
        "kind": kind,
        "loader_min_version": "1.0.0",
        "display_name": "Avatar",
        "display_name_i18n": {},
        "entry_file": entry_file,
        "required_files": [entry_file],
        "content_digest": format!("sha256:{digest}"),
        "files": [{
            "path": entry_file,
            "sha256": digest,
            "bytes": entry_bytes.len(),
            "mime": entry_mime
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
            "source_label": "fixture",
            "source_fingerprint": format!("sha256:{digest}")
        }
    });
    fs::write(
        package_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).expect("manifest json"),
    )
    .expect("manifest");
    package_dir
}

fn write_local_avatar_asset_config(
    home: &Path,
    account_id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
    kind: &str,
    local_asset_id: &str,
) {
    let local_agent_ref = local_agent_ref(owner_user_id, realm_agent_id);
    let config_path = agent_center_root(home, account_id, &local_agent_ref).join("config.json");
    fs::create_dir_all(config_path.parent().expect("config parent")).expect("config dir");
    let config = json!({
        "schema_version": 1,
        "config_kind": "agent_center_local_config",
        "account_id": account_id,
        "owner_user_id": owner_user_id,
        "realm_agent_id": realm_agent_id,
        "local_agent_ref": local_agent_ref,
        "modules": {
            "appearance": { "schema_version": 1 },
            "avatar_asset": {
                "schema_version": 1,
                "conversation_anchor_scope": "current_anchor",
                "local_avatar_asset_ref": local_asset_id,
                "live2d_adapter_manifest_source": "embedded_creator_manifest",
                "live2d_adapter_manifest_ref": null,
                "avatar_instance_policy": "reuse_active_instance",
                "backend_kind": kind,
                "backend_capability_profile_ref": format!("avatar.backend_profile/{kind}/basic"),
                "generated_motion_provider_policy": "require_profile_support",
                "launch_mode": "manual",
                "debug_profile": "strict_backend_evidence",
                "updated_at": "2026-05-17T00:00:00Z",
                "provenance": { "source": "test" }
            },
            "local_history": { "schema_version": 1 },
            "voice": {
                "schema_version": 1,
                "avatar_autoplay": false
            },
            "ui": { "schema_version": 1 }
        }
    });
    fs::write(
        config_path,
        serde_json::to_string_pretty(&config).expect("config json"),
    )
    .expect("config");
}

#[tokio::test(flavor = "current_thread")]
async fn resolves_agent_center_live2d_asset_with_canonical_runtime_dir() {
    let _guard = test_guard();
    let home = unique_temp_dir("live2d");
    fs::create_dir_all(&home).expect("home");
    let package_dir = write_avatar_asset_package(
        &home,
        "account_1",
        "owner_1",
        "agent_1",
        "live2d",
        "live2d_ab12cd34ef56",
        "files/ren.model3.json",
        "application/json",
        br#"{"Version":3}"#,
    );

    let manifest = with_admitted_data_root(&home, || async {
        nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
            "account_1",
            "owner_1",
            "agent_1",
            "live2d",
            "live2d_ab12cd34ef56",
        ))
        .await
    })
    .await
    .expect("resolve live2d package");

    assert_eq!(manifest.kind, "live2d");
    assert_eq!(manifest.model_id, "ren");
    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .expect("runtime dir")
            .display()
            .to_string()
    );

    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn resolves_local_avatar_asset_from_agent_center_config_selection() {
    let _guard = test_guard();
    let home = unique_temp_dir("local-config");
    fs::create_dir_all(&home).expect("home");
    write_avatar_asset_package(
        &home,
        "owner_1",
        "owner_1",
        "agent_1",
        "live2d",
        "live2d_ab12cd34ef56",
        "files/ren.model3.json",
        "application/json",
        br#"{"Version":3}"#,
    );
    write_local_avatar_asset_config(
        &home,
        "owner_1",
        "owner_1",
        "agent_1",
        "live2d",
        "live2d_ab12cd34ef56",
    );

    let manifest = with_admitted_data_root(&home, || async {
        nimi_avatar_resolve_local_avatar_asset(LocalAvatarAssetResolvePayload {
            account_id: "owner_1".to_string(),
            owner_user_id: "owner_1".to_string(),
            realm_agent_id: "agent_1".to_string(),
            local_agent_ref: local_agent_ref("owner_1", "agent_1"),
        })
        .await
    })
    .await
    .expect("resolve selected local avatar asset");

    assert_eq!(manifest.kind, "live2d");
    assert_eq!(manifest.model_id, "ren");

    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_digest_mismatch_before_projecting_runtime_manifest() {
    let _guard = test_guard();
    let home = unique_temp_dir("digest");
    fs::create_dir_all(&home).expect("home");
    let package_dir = write_avatar_asset_package(
        &home,
        "account_1",
        "owner_1",
        "agent_1",
        "live2d",
        "live2d_ab12cd34ef56",
        "files/ren.model3.json",
        "application/json",
        br#"{"Version":3}"#,
    );
    fs::write(
        package_dir.join("files/ren.model3.json"),
        br#"{"Version":4}"#,
    )
    .expect("mutate entry");

    let error = with_admitted_data_root(&home, || async {
        nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
            "account_1",
            "owner_1",
            "agent_1",
            "live2d",
            "live2d_ab12cd34ef56",
        ))
        .await
    })
    .await
    .expect_err("digest mismatch");

    assert!(error.contains("differs from manifest"));

    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_materialization_ref_that_does_not_match_scope() {
    let _guard = test_guard();
    let home = unique_temp_dir("materialization-ref");
    fs::create_dir_all(&home).expect("home");
    write_avatar_asset_package(
        &home,
        "account_1",
        "owner_1",
        "agent_1",
        "live2d",
        "live2d_ab12cd34ef56",
        "files/ren.model3.json",
        "application/json",
        br#"{"Version":3}"#,
    );
    let mut payload = resolve_payload(
        "account_1",
        "owner_1",
        "agent_1",
        "live2d",
        "live2d_ab12cd34ef56",
    );
    payload.materialization_ref =
        "agent-center-avatar-asset:wrong:wrong:live2d:live2d_ab12cd34ef56".to_string();

    let error = with_admitted_data_root(&home, || async {
        nimi_avatar_resolve_agent_center_avatar_asset(payload).await
    })
    .await
    .expect_err("materialization mismatch");

    assert!(error.contains("materialization_ref does not match"));

    let _ = fs::remove_dir_all(&home);
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_home_data_root_without_admitted_host_hook() {
    let _guard = test_guard();
    let home = unique_temp_dir("no-hook");
    fs::create_dir_all(&home).expect("home");
    write_avatar_asset_package(
        &home,
        "account_1",
        "owner_1",
        "agent_1",
        "live2d",
        "live2d_ab12cd34ef56",
        "files/ren.model3.json",
        "application/json",
        br#"{"Version":3}"#,
    );

    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let error = without_admitted_data_root(|| async {
        nimi_avatar_resolve_agent_center_avatar_asset(resolve_payload(
            "account_1",
            "owner_1",
            "agent_1",
            "live2d",
            "live2d_ab12cd34ef56",
        ))
        .await
    })
    .await
    .expect_err("missing admitted data-root hook");
    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }

    assert!(error.contains("requires NIMI_AGENT_CENTER_AVATAR_TEST_DATA_ROOT"));

    let _ = fs::remove_dir_all(&home);
}
