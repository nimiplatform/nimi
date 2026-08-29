use super::*;
use serde_json::json;

fn owner_user_id() -> &'static str {
    "owner_1"
}

fn runtime_source_ref() -> &'static str {
    "agent_1"
}

fn local_agent_ref_for(owner_user_id: &str, runtime_source_ref: &str) -> String {
    format!("local-agent:test-{owner_user_id}-{runtime_source_ref}")
}

fn local_agent_ref() -> String {
    local_agent_ref_for(owner_user_id(), runtime_source_ref())
}

fn agent_handle() -> String {
    format!("agent_ref_{}", "a".repeat(43))
}

fn agent_center_root(data_root: &Path, _account_id: &str, _local_agent_ref: &str) -> PathBuf {
    data_root.join("avatar-assets")
}

struct TestAvatarDataRootBinding {
    previous: Option<std::ffi::OsString>,
}

impl TestAvatarDataRootBinding {
    fn install(data_root: &Path) -> Self {
        let app_data_root = data_root.join("apps").join("nimi.avatar").join("data");
        fs::create_dir_all(&app_data_root).unwrap();
        let previous = std::env::var_os("NIMI_APP_DATA_ROOT");
        std::env::set_var("NIMI_APP_DATA_ROOT", app_data_root);
        Self { previous }
    }
}

impl Drop for TestAvatarDataRootBinding {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("NIMI_APP_DATA_ROOT", value),
            None => std::env::remove_var("NIMI_APP_DATA_ROOT"),
        }
    }
}

fn resolve_payload(
    _account_id: &str,
    _owner_user_id: &str,
    _runtime_source_ref: &str,
) -> AgentCenterAvatarAssetResolvePayload {
    resolve_payload_with_package("", "", "", "live2d", "live2d_ab12cd34ef56")
}

fn resolve_payload_with_package(
    _account_id: &str,
    _owner_user_id: &str,
    _runtime_source_ref: &str,
    backend_kind: &str,
    local_avatar_asset_ref: &str,
) -> AgentCenterAvatarAssetResolvePayload {
    AgentCenterAvatarAssetResolvePayload {
        agent_handle: "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string(),
        backend_kind: backend_kind.to_string(),
        avatar_asset_ref: local_avatar_asset_ref.to_string(),
    }
}

async fn resolve_materialized_avatar_fixture(
    payload: AgentCenterAvatarAssetResolvePayload,
) -> Result<nimi_shell_tauri::capabilities::avatar::AgentCenterAvatarAssetResolveResult, String> {
    let data_root = crate::avatar_paths::resolve_avatar_nimi_data_dir()?;
    let manifest_path = data_root
        .join("avatar-assets/packages")
        .join(&payload.backend_kind)
        .join(&payload.avatar_asset_ref)
        .join("manifest.json");
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(manifest_path)
            .map_err(|error| format!("fixture manifest read failed: {error}"))?,
    )
    .map_err(|error| format!("fixture manifest decode failed: {error}"))?;
    let digest = manifest["content_digest"]
        .as_str()
        .and_then(|value| value.strip_prefix("sha256:"))
        .ok_or_else(|| "fixture content digest missing".to_string())?;
    nimi_shell_tauri::capabilities::avatar::resolve_verified_agent_center_avatar_materialization(
        &payload.backend_kind,
        &payload.avatar_asset_ref,
        digest,
    )
    .await
}

fn write_agent_center_live2d_package_for_local_agent(
    data_root: &Path,
    local_agent_ref: &str,
    entry_content: &str,
) -> PathBuf {
    write_agent_center_live2d_package_for_account_agent(
        data_root,
        "account_1",
        owner_user_id(),
        runtime_source_ref(),
        local_agent_ref,
        entry_content,
    )
}

fn write_agent_center_live2d_package_for_account_agent(
    data_root: &Path,
    account_id: &str,
    owner_user_id: &str,
    runtime_source_ref: &str,
    local_agent_ref: &str,
    entry_content: &str,
) -> PathBuf {
    let package_dir = agent_center_root(data_root, account_id, local_agent_ref)
        .join("packages/live2d/live2d_ab12cd34ef56");
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
    let _ = (owner_user_id, runtime_source_ref);
    package_dir
}

fn write_agent_center_live2d_package(data_root: &Path, entry_content: &str) -> PathBuf {
    write_agent_center_live2d_package_for_local_agent(data_root, &local_agent_ref(), entry_content)
}

fn write_agent_center_vrm_package(data_root: &Path, entry_content: &[u8]) -> PathBuf {
    let package_dir = data_root
        .join("avatar-assets")
        .join("packages/vrm/vrm_ab12cd34ef56");
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

#[test]
fn normalize_avatar_launch_instance_id_writes_generated_id_when_omitted() {
    let mut context = AvatarLaunchContext {
        agent_handle: format!("agent_ref_{}", "a".repeat(43)),
        conversation_anchor_id: "anchor-1".to_string(),
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
        agent_handle: format!("agent_ref_{}", "a".repeat(43)),
        conversation_anchor_id: "anchor-1".to_string(),
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
fn avatar_visual_path_allows_only_agent_center_package_files_under_data_root() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("visual-path-scope");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let package_dir = write_agent_center_live2d_package(&data_root, r#"{"Version":3}"#);
    let allowed = package_dir.join("files/ren.model3.json");
    let auth_dir = data_root.join("auth");
    fs::create_dir_all(&auth_dir).unwrap();
    let auth_file = auth_dir.join("session.json");
    fs::write(&auth_file, "{}").unwrap();
    let broad_file = data_root.join("config.json");
    fs::write(&broad_file, "{}").unwrap();
    let outside_file = unique_temp_dir("visual-path-outside").with_extension("json");
    fs::write(&outside_file, "{}").unwrap();

    assert!(validated_avatar_visual_path(&allowed).is_ok());
    assert!(validated_avatar_visual_path(&auth_file).is_err());
    assert!(validated_avatar_visual_path(&broad_file).is_err());
    assert!(validated_avatar_visual_path(&outside_file).is_err());

    let _ = fs::remove_file(outside_file);
    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn avatar_file_commands_reject_files_outside_agent_center_package() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("visual-command-scope");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let package_dir = write_agent_center_live2d_package(&data_root, r#"{"Version":3}"#);
    let allowed = package_dir.join("files/ren.model3.json");
    let auth_dir = data_root.join("auth");
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

    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_returns_live2d_model_manifest() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("agent-center-package");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let package_dir = write_agent_center_live2d_package(&data_root, r#"{"Version":3}"#);

    let manifest = resolve_materialized_avatar_fixture(resolve_payload(
        "account_1",
        owner_user_id(),
        runtime_source_ref(),
    ))
    .await
    .expect("resolve asset manifest")
    .manifest;

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

    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_rejects_local_config_external_live2d_adapter_sidecar() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("agent-center-live2d-external-adapter");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    write_agent_center_live2d_package(&data_root, r#"{"Version":3}"#);
    let manifest_ref = "live2d_adapter_ab12cd34ef56";
    let sidecar_dir = agent_center_root(&data_root, "account_1", &local_agent_ref())
        .join("modules/avatar_asset/adapter_manifests")
        .join(manifest_ref);
    fs::create_dir_all(&sidecar_dir).unwrap();
    let sidecar_path = sidecar_dir.join("live2d-adapter.json");
    fs::write(
        &sidecar_path,
        r#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .unwrap();
    let manifest = resolve_materialized_avatar_fixture(resolve_payload(
        "account_1",
        owner_user_id(),
        runtime_source_ref(),
    ))
    .await
    .expect("resolve asset manifest")
    .manifest;

    assert_eq!(manifest.adapter_manifest_path, None);
    assert!(
        nimi_avatar_read_text_file(sidecar_path.display().to_string())
            .await
            .is_err()
    );
    let unselected_dir = agent_center_root(&data_root, "account_1", &local_agent_ref())
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

    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_uses_explicit_embedded_live2d_adapter_manifest() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("agent-center-live2d-embedded-adapter");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let package_dir = write_agent_center_live2d_package(&data_root, r#"{"Version":3}"#);
    let embedded_dir = package_dir.join("files/nimi");
    fs::create_dir_all(&embedded_dir).unwrap();
    let embedded_path = embedded_dir.join("live2d-adapter.json");
    fs::write(
        &embedded_path,
        r#"{"manifest_kind":"nimi.avatar.live2d.adapter","schema_version":1}"#,
    )
    .unwrap();
    let manifest = resolve_materialized_avatar_fixture(resolve_payload(
        "account_1",
        owner_user_id(),
        runtime_source_ref(),
    ))
    .await
    .expect("resolve asset manifest")
    .manifest;

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

    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_accepts_runtime_scoped_runtime_source_ref() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("agent-center-package-runtime-agent");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let runtime_scoped_runtime_source_ref = "~agent_1_tffk";
    let runtime_scoped_local_agent_ref =
        local_agent_ref_for(owner_user_id(), runtime_scoped_runtime_source_ref);
    let package_dir = write_agent_center_live2d_package_for_account_agent(
        &data_root,
        "account_1",
        owner_user_id(),
        runtime_scoped_runtime_source_ref,
        &runtime_scoped_local_agent_ref,
        r#"{"Version":3}"#,
    );

    let manifest = resolve_materialized_avatar_fixture(resolve_payload(
        "account_1",
        owner_user_id(),
        runtime_scoped_runtime_source_ref,
    ))
    .await
    .expect("resolve runtime scoped asset manifest")
    .manifest;

    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_accepts_opaque_runtime_source_ref() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("agent-center-package-opaque-agent");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let opaque_runtime_source_ref = "agent.abc.def+1";
    let opaque_local_agent_ref = local_agent_ref_for(owner_user_id(), opaque_runtime_source_ref);
    let package_dir = write_agent_center_live2d_package_for_account_agent(
        &data_root,
        "account_1",
        owner_user_id(),
        opaque_runtime_source_ref,
        &opaque_local_agent_ref,
        r#"{"Version":3}"#,
    );

    let manifest = resolve_materialized_avatar_fixture(resolve_payload(
        "account_1",
        owner_user_id(),
        opaque_runtime_source_ref,
    ))
    .await
    .expect("resolve opaque runtime scoped asset manifest")
    .manifest;

    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_uses_runtime_account_projection_scope() {
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("agent-center-package-opaque-account");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let account_id = "account:abc.def+1";
    let package_dir = write_agent_center_live2d_package_for_account_agent(
        &data_root,
        account_id,
        owner_user_id(),
        runtime_source_ref(),
        &local_agent_ref(),
        r#"{"Version":3}"#,
    );

    let manifest = resolve_materialized_avatar_fixture(resolve_payload(
        account_id,
        owner_user_id(),
        runtime_source_ref(),
    ))
    .await
    .expect("resolve asset manifest with Runtime account projection")
    .manifest;

    assert_eq!(
        manifest.runtime_dir,
        package_dir
            .join("files")
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    let _ = fs::remove_dir_all(&data_root);
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_agent_center_avatar_asset_returns_vrm_model_manifest_and_rejects_digest_mismatch()
{
    let _guard = test_env_guard();
    let data_root = unique_temp_dir("agent-center-package-invalid");
    let _binding = TestAvatarDataRootBinding::install(&data_root);
    let vrm_package_dir = write_agent_center_vrm_package(&data_root, b"vrm-bytes");

    let vrm_manifest = resolve_materialized_avatar_fixture(resolve_payload_with_package(
        "account_1",
        owner_user_id(),
        runtime_source_ref(),
        "vrm",
        "vrm_ab12cd34ef56",
    ))
    .await
    .expect("resolve VRM asset manifest")
    .manifest;
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

    write_agent_center_live2d_package(&data_root, r#"{"Version":3}"#);
    let entry = agent_center_root(&data_root, "account_1", &local_agent_ref())
        .join("packages/live2d/live2d_ab12cd34ef56/files/ren.model3.json");
    fs::write(entry, r#"{"Version":4}"#).unwrap();
    let digest_error = resolve_materialized_avatar_fixture(resolve_payload(
        "account_1",
        owner_user_id(),
        runtime_source_ref(),
    ))
    .await
    .expect_err("digest mismatch should fail closed");
    assert!(digest_error.contains("differs from manifest"));

    let _ = fs::remove_dir_all(&data_root);
}
