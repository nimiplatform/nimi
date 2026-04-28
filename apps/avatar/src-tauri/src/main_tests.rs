use super::*;
use crate::agent_center_avatar_package::agent_center_path_segment;

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    std::env::temp_dir().join(format!("nimi-avatar-{name}-{suffix}"))
}

#[test]
fn scan_handler_dir_returns_only_public_js_files_sorted() {
    let root = unique_temp_dir("scan-handlers");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("zeta.js"), "export default {}").unwrap();
    fs::write(root.join("alpha.js"), "export default {}").unwrap();
    fs::write(root.join("_private.js"), "export default {}").unwrap();
    fs::write(root.join("notes.txt"), "ignore").unwrap();
    fs::create_dir_all(root.join("nested.js")).unwrap();

    let entries = scan_handler_dir(&root);

    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.file_stem.as_str())
            .collect::<Vec<_>>(),
        vec!["alpha", "zeta"]
    );
    assert!(entries
        .iter()
        .all(|entry| entry.absolute_path.ends_with(".js")));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn resolve_runtime_dir_accepts_package_root_or_runtime_dir_only() {
    let root = unique_temp_dir("runtime-dir");
    let runtime = root.join("runtime");
    fs::create_dir_all(&runtime).unwrap();

    assert_eq!(resolve_runtime_dir(&root).unwrap(), runtime);
    assert_eq!(resolve_runtime_dir(&root.join("runtime")).unwrap(), runtime);
    assert!(resolve_runtime_dir(&root.join("missing")).is_err());

    let _ = fs::remove_dir_all(&root);
}

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
    package_dir
}

fn write_agent_center_live2d_package(home: &Path, entry_content: &str) -> PathBuf {
    write_agent_center_live2d_package_for_agent(home, "agent_1", entry_content)
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
            agent_id: "agent_1".to_string(),
            avatar_package_kind: "live2d".to_string(),
            avatar_package_id: "live2d_ab12cd34ef56".to_string(),
            avatar_package_schema_version: 1,
        })
        .await
        .expect("resolve package manifest");

    assert_eq!(manifest.model_id, "ren");
    assert!(manifest.model3_json_path.ends_with("files/ren.model3.json"));
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
            agent_id: "~agent_1_tffk".to_string(),
            avatar_package_kind: "live2d".to_string(),
            avatar_package_id: "live2d_ab12cd34ef56".to_string(),
            avatar_package_schema_version: 1,
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
            agent_id: agent_id.to_string(),
            avatar_package_kind: "live2d".to_string(),
            avatar_package_id: "live2d_ab12cd34ef56".to_string(),
            avatar_package_schema_version: 1,
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
async fn resolve_agent_center_avatar_package_uses_non_account_descriptor() {
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
            agent_id: "agent_1".to_string(),
            avatar_package_kind: "live2d".to_string(),
            avatar_package_id: "live2d_ab12cd34ef56".to_string(),
            avatar_package_schema_version: 1,
        })
        .await
        .expect("resolve package manifest without account identity");

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
async fn resolve_agent_center_avatar_package_rejects_vrm_and_digest_mismatch() {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-invalid");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    write_agent_center_live2d_package(&home, r#"{"Version":3}"#);

    let vrm_error =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            agent_id: "agent_1".to_string(),
            avatar_package_kind: "vrm".to_string(),
            avatar_package_id: "vrm_ab12cd34ef56".to_string(),
            avatar_package_schema_version: 1,
        })
        .await
        .expect_err("vrm loader is unavailable");
    assert!(vrm_error.contains("Live2D"));

    let entry = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56/files/ren.model3.json");
    fs::write(entry, r#"{"Version":4}"#).unwrap();
    let digest_error =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            agent_id: "agent_1".to_string(),
            avatar_package_kind: "live2d".to_string(),
            avatar_package_id: "live2d_ab12cd34ef56".to_string(),
            avatar_package_schema_version: 1,
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
