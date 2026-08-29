use crate::agent_center_avatar_asset::{
    materialize_agent_center_avatar_asset, resolve_agent_center_avatar_asset_with_formal_reader,
    resolve_verified_agent_center_avatar_materialization, AgentCenterAvatarAssetResolvePayload,
};
use crate::runtime_bridge::{with_runtime_bridge_host_hooks_async, RuntimeBridgeHostHooks};
use crate::test_support::test_guard;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    std::env::temp_dir().join(format!("nimi-shell-avatar-asset-{prefix}-{unique}"))
}

async fn with_admitted_data_root<R, F, Fut>(fixture_root: &Path, run: F) -> R
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = R>,
{
    let data_root = fixture_root.join("data-root");
    with_runtime_bridge_host_hooks_async(
        RuntimeBridgeHostHooks {
            resolve_nimi_data_dir: Some(Arc::new(move || Ok(data_root.clone()))),
            ..Default::default()
        },
        run,
    )
    .await
}

fn package_root(fixture_root: &Path, kind: &str, asset_ref: &str) -> PathBuf {
    fixture_root
        .join("data-root/avatar-assets")
        .join("packages")
        .join(kind)
        .join(asset_ref)
}

fn sha256_hex(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

fn resolve_payload(kind: &str, avatar_asset_ref: &str) -> AgentCenterAvatarAssetResolvePayload {
    AgentCenterAvatarAssetResolvePayload {
        agent_handle: "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string(),
        backend_kind: kind.to_string(),
        avatar_asset_ref: avatar_asset_ref.to_string(),
    }
}

fn write_package(
    root: &Path,
    kind: &str,
    asset_ref: &str,
    entry_file: &str,
    entry_mime: &str,
    entry_bytes: &[u8],
) -> PathBuf {
    let package = package_root(root, kind, asset_ref);
    let entry = package.join(entry_file);
    fs::create_dir_all(entry.parent().expect("entry parent")).expect("create entry parent");
    fs::write(&entry, entry_bytes).expect("entry bytes");
    let digest = {
        let mut hasher = Sha256::new();
        hasher.update(entry_bytes);
        format!("{:x}", hasher.finalize())
    };
    let manifest = json!({
        "manifest_version": 1,
        "asset_version": "1.0.0",
        "local_asset_id": asset_ref,
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
            "imported_at": "2026-08-28T00:00:00Z",
            "source_label": "fixture",
            "source_fingerprint": format!("sha256:{digest}")
        }
    });
    fs::write(
        package.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).expect("manifest json"),
    )
    .expect("manifest");
    package
}

async fn resolve_materialized_fixture(
    root: &Path,
    payload: AgentCenterAvatarAssetResolvePayload,
) -> Result<crate::agent_center_avatar_asset::AgentCenterAvatarAssetResolveResult, String> {
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(
            package_root(root, &payload.backend_kind, &payload.avatar_asset_ref)
                .join("manifest.json"),
        )
        .map_err(|error| format!("fixture manifest read failed: {error}"))?,
    )
    .map_err(|error| format!("fixture manifest decode failed: {error}"))?;
    let digest = manifest["content_digest"]
        .as_str()
        .and_then(|value| value.strip_prefix("sha256:"))
        .ok_or_else(|| "fixture content digest missing".to_string())?;
    resolve_verified_agent_center_avatar_materialization(
        &payload.backend_kind,
        &payload.avatar_asset_ref,
        digest,
    )
    .await
}

#[tokio::test(flavor = "current_thread")]
async fn resolves_identity_free_live2d_without_directory_scan_or_identity_sideband() {
    let _guard = test_guard();
    let root = unique_temp_dir("handle-live2d");
    fs::create_dir_all(&root).expect("root");
    let package = write_package(
        &root,
        "live2d",
        "live2d_ab12cd34ef56",
        "files/ren.model3.json",
        "application/json",
        br#"{"Version":3}"#,
    );

    let resolved = with_admitted_data_root(&root, || async {
        resolve_materialized_fixture(&root, resolve_payload("live2d", "live2d_ab12cd34ef56")).await
    })
    .await
    .expect("resolve identity-free Live2D");

    assert_eq!(resolved.manifest.kind, "live2d");
    assert_eq!(resolved.manifest.model_id, "ren");
    assert_eq!(
        resolved.materialization_ref,
        "avatar-materialization:live2d:live2d_ab12cd34ef56"
    );
    assert_eq!(
        resolved.manifest.runtime_dir,
        package
            .join("files")
            .canonicalize()
            .expect("runtime directory")
            .display()
            .to_string()
    );
    let _ = fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_identity_free_entry_digest_mismatch() {
    let _guard = test_guard();
    let root = unique_temp_dir("handle-digest");
    fs::create_dir_all(&root).expect("root");
    let package = write_package(
        &root,
        "vrm",
        "vrm_ab12cd34ef56",
        "files/avatar.vrm",
        "model/vrm",
        b"vrm-original",
    );
    fs::write(package.join("files/avatar.vrm"), b"vrm-mutated").expect("mutate VRM");

    let error = with_admitted_data_root(&root, || async {
        resolve_materialized_fixture(&root, resolve_payload("vrm", "vrm_ab12cd34ef56")).await
    })
    .await
    .expect_err("digest mismatch");
    assert!(error.contains("differs from manifest"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn resolve_payload_rejects_raw_identity_and_parallel_materialization_fields() {
    let base = json!({
        "agentHandle": "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "backendKind": "vrm",
        "avatarAssetRef": "vrm_ab12cd34ef56"
    });
    assert!(serde_json::from_value::<AgentCenterAvatarAssetResolvePayload>(base.clone()).is_ok());
    for field in [
        "accountId",
        "ownerUserId",
        "runtimeSourceRef",
        "localAgentRef",
        "backendCapabilityProfileRef",
        "materializationRef",
    ] {
        let mut value = base.clone();
        value[field] = json!("forbidden");
        assert!(serde_json::from_value::<AgentCenterAvatarAssetResolvePayload>(value).is_err());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_resolution_without_admitted_data_root() {
    let _guard = test_guard();
    let error = with_runtime_bridge_host_hooks_async(
        RuntimeBridgeHostHooks {
            resolve_nimi_data_dir: Some(Arc::new(|| Err("data-root-unavailable".to_string()))),
            ..Default::default()
        },
        || async {
            resolve_verified_agent_center_avatar_materialization(
                "vrm",
                "vrm_ab12cd34ef56",
                &"a".repeat(64),
            )
            .await
        },
    )
    .await
    .expect_err("missing data root");
    assert!(error.contains("data-root-unavailable"));
}

#[tokio::test(flavor = "current_thread")]
async fn formal_read_materializes_verified_vrm_content() {
    let _guard = test_guard();
    let root = unique_temp_dir("formal-read-success");
    fs::create_dir_all(&root).expect("root");
    let content = b"formal-vrm-content".to_vec();
    let digest = sha256_hex(&content);
    let asset_ref = format!("vrm_{}", &digest[..12]);

    let resolved = with_admitted_data_root(&root, || {
        let content = content.clone();
        let digest = digest.clone();
        let asset_ref = asset_ref.clone();
        async move {
            resolve_agent_center_avatar_asset_with_formal_reader(
                resolve_payload("vrm", &asset_ref),
                move |agent_handle, requested_ref| {
                    let content = content.clone();
                    let digest = digest.clone();
                    let asset_ref = asset_ref.clone();
                    async move {
                        assert_eq!(
                            agent_handle,
                            "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                        );
                        assert_eq!(requested_ref, asset_ref);
                        Ok(json!({
                            "assetRef": asset_ref,
                            "role": "avatar",
                            "backendKind": "vrm",
                            "fileName": "avatar.vrm",
                            "mediaType": "model/gltf-binary",
                            "content": content,
                            "sha256": digest,
                        }))
                    }
                },
            )
            .await
        }
    })
    .await
    .expect("formal read materialization");

    assert_eq!(resolved.manifest.kind, "vrm");
    assert!(Path::new(
        resolved
            .manifest
            .vrm_file_path
            .as_deref()
            .expect("materialized VRM path")
    )
    .is_file());
    let _ = fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn formal_read_errors_fail_closed_even_when_materialization_is_cached() {
    let _guard = test_guard();
    let root = unique_temp_dir("formal-read-errors");
    fs::create_dir_all(&root).expect("root");
    let content = b"cached-vrm-content".to_vec();
    let digest = sha256_hex(&content);
    let asset_ref = format!("vrm_{}", &digest[..12]);

    with_admitted_data_root(&root, || {
        let content = content.clone();
        let digest = digest.clone();
        let asset_ref = asset_ref.clone();
        async move {
            materialize_agent_center_avatar_asset("vrm", "avatar.vrm", &content, &digest)
                .expect("seed cached materialization");
            for reason in ["runtime-service-unavailable", "runtime-permission-denied"] {
                let error = resolve_agent_center_avatar_asset_with_formal_reader(
                    resolve_payload("vrm", &asset_ref),
                    |_agent_handle, _asset_ref| async move { Err(reason.to_string()) },
                )
                .await
                .expect_err("formal read failure must not use cached materialization");
                assert_eq!(error, reason);
            }
        }
    })
    .await;
    let _ = fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn formal_read_rejects_cached_materialization_with_different_full_digest() {
    let _guard = test_guard();
    let root = unique_temp_dir("formal-read-cache-mismatch");
    fs::create_dir_all(&root).expect("root");
    let content = b"current-formal-vrm".to_vec();
    let digest = sha256_hex(&content);
    let asset_ref = format!("vrm_{}", &digest[..12]);
    write_package(
        &root,
        "vrm",
        &asset_ref,
        "files/avatar.vrm",
        "model/vrm",
        b"different-cached-vrm",
    );

    let error = with_admitted_data_root(&root, || {
        let content = content.clone();
        let digest = digest.clone();
        let asset_ref = asset_ref.clone();
        async move {
            resolve_agent_center_avatar_asset_with_formal_reader(
                resolve_payload("vrm", &asset_ref),
                move |_agent_handle, _requested_ref| async move {
                    Ok(json!({
                        "assetRef": asset_ref,
                        "role": "avatar",
                        "backendKind": "vrm",
                        "fileName": "avatar.vrm",
                        "mediaType": "model/gltf-binary",
                        "content": content,
                        "sha256": digest,
                    }))
                },
            )
            .await
        }
    })
    .await
    .expect_err("inconsistent cached materialization");
    assert!(error.contains("does not match the formal presentation asset"));
    let _ = fs::remove_dir_all(root);
}
