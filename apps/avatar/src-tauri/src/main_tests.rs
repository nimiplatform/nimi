use super::*;
use crate::agent_center_avatar_package::agent_center_path_segment;
use std::fs;
use std::path::{Path, PathBuf};

// Wave 4 — `compute_constrained_window_position` covers
// window-bounds-policy.yaml `visible_area` rule (NAV-SHELL-005-EDGE):
// at least `min_visible_ratio` of the window must remain inside the active
// monitor's work area.

#[test]
fn constrain_keeps_window_inside_when_fully_visible() {
    let result =
        compute_constrained_window_position((100, 100), (400, 600), (0, 0), (1920, 1080), 0.2);
    assert_eq!(result, (100, 100));
}

#[test]
fn constrain_pulls_window_back_when_dragged_off_right_edge() {
    // Window 400 wide; monitor 1920. min_visible = 80px (20%).
    // max_x = 0 + 1920 - 80 = 1840. Drag to x=2500 → clamp to 1840.
    let result =
        compute_constrained_window_position((2500, 100), (400, 600), (0, 0), (1920, 1080), 0.2);
    assert_eq!(result.0, 1840);
}

#[test]
fn constrain_pulls_window_back_when_dragged_off_left_edge() {
    // min_x = 0 - 400 + 80 = -320. Drag to x=-1000 → clamp to -320.
    let result =
        compute_constrained_window_position((-1000, 100), (400, 600), (0, 0), (1920, 1080), 0.2);
    assert_eq!(result.0, -320);
}

#[test]
fn constrain_clamps_vertical_axis_independently() {
    // min_visible_height = 600 * 0.2 = 120
    // max_y = 0 + 1080 - 120 = 960
    let result =
        compute_constrained_window_position((100, 5000), (400, 600), (0, 0), (1920, 1080), 0.2);
    assert_eq!(result.1, 960);
}

#[test]
fn constrain_handles_secondary_monitor_with_negative_origin() {
    // Secondary monitor sitting to the left of primary, position (-1920, 0).
    // min_x = -1920 - 400 + 80 = -2240. max_x = -1920 + 1920 - 80 = -80.
    let result =
        compute_constrained_window_position((-3000, 50), (400, 600), (-1920, 0), (1920, 1080), 0.2);
    assert_eq!(result.0, -2240);
}

#[test]
fn constrain_falls_back_to_default_ratio_when_input_is_non_finite() {
    // Non-finite ratio defaults to 0.2 → same result as the off-right test.
    let result = compute_constrained_window_position(
        (2500, 100),
        (400, 600),
        (0, 0),
        (1920, 1080),
        f64::NAN,
    );
    assert_eq!(result.0, 1840);
}

#[test]
fn constrain_clamps_ratio_to_05_minimum() {
    // Asking for 0.01 ratio is clamped up to 0.05 (5% min visible per policy).
    // min_visible_width = 400 * 0.05 = 20. max_x = 1920 - 20 = 1900.
    let result =
        compute_constrained_window_position((5000, 100), (400, 600), (0, 0), (1920, 1080), 0.01);
    assert_eq!(result.0, 1900);
}

#[test]
fn cursor_client_position_converts_physical_screen_to_css_client_coords() {
    let result = compute_avatar_cursor_client_position(
        PhysicalPosition::new(2500.0, 840.0),
        PhysicalPosition::new(2100, 240),
        2.0,
    );
    assert_eq!(
        result,
        AvatarCursorClientPosition {
            screen_x: 2500.0,
            screen_y: 840.0,
            client_x: 200.0,
            client_y: 300.0,
            scale_factor: 2.0,
        },
    );
}

#[test]
fn cursor_client_position_falls_back_to_unit_scale_for_invalid_scale() {
    let result = compute_avatar_cursor_client_position(
        PhysicalPosition::new(250.0, 360.0),
        PhysicalPosition::new(100, 60),
        0.0,
    );
    assert_eq!(result.client_x, 150.0);
    assert_eq!(result.client_y, 300.0);
    assert_eq!(result.scale_factor, 1.0);
}

// Wave 4 chunk 4-D — explicit VRM nominal-bounds coverage.
// Per `.nimi/spec/avatar/kernel/tables/window-bounds-policy.yaml`
// `backends.vrm.nominal_bounds_default`, the VRM baseline window is
// 360 × 720 (taller, narrower than Live2D's 400 × 600). The constraint
// math is generic over (width, height); these tests document that the
// VRM baseline is admitted by the same `compute_constrained_window_position`
// helper without special-casing.

#[test]
fn vrm_nominal_bounds_constrain_within_visible_area() {
    // VRM 360 × 720 baseline + 1080p primary monitor + 0.2 ratio.
    // min_visible_width  = ceil(360 * 0.2) = 72
    // max_x              = 0 + 1920 - 72   = 1848
    // Window dragged near right edge at x=1900 → clamp to 1848.
    let result =
        compute_constrained_window_position((1900, 100), (360, 720), (0, 0), (1920, 1080), 0.2);
    assert_eq!(
        result.0, 1848,
        "VRM 360-wide baseline must clamp to 1848 (max_x with 20% visible ratio)",
    );
    // y=100 keeps the entire window vertically inside [0,1080], so y is
    // unmodified. min_visible_height = ceil(720 * 0.2) = 144;
    // [min_y=-576, max_y=936] → 100 is in range.
    assert_eq!(
        result.1, 100,
        "Y stays unchanged when window is fully within vertical bounds",
    );
}

#[test]
fn vrm_nominal_bounds_off_left_edge_clamped_to_min_x() {
    // min_x = 0 - 360 + ceil(360*0.2)=72 → -288. Drag to x=-1000 → clamp to -288.
    let result =
        compute_constrained_window_position((-1000, 100), (360, 720), (0, 0), (1920, 1080), 0.2);
    assert_eq!(result.0, -288);
}

#[test]
fn vrm_nominal_bounds_off_bottom_edge_clamped_to_max_y() {
    // VRM is taller (720); min_visible_height = ceil(720*0.2) = 144.
    // max_y = 0 + 1080 - 144 = 936. Drag to y=5000 → clamp to 936.
    let result =
        compute_constrained_window_position((100, 5000), (360, 720), (0, 0), (1920, 1080), 0.2);
    assert_eq!(result.1, 936);
}

#[test]
fn vrm_and_live2d_baselines_both_uncontrained_at_origin() {
    // Both VRM (360×720) and Live2D (400×600) at origin on a 1080p monitor
    // are fully on-screen; the helper must return their position unchanged.
    // Documents that `compute_constrained_window_position` handles both
    // policy baselines identically without backend-specific branching.
    let monitor_position = (0, 0);
    let monitor_size = (1920, 1080);
    let ratio = 0.2;

    let vrm_constrained = compute_constrained_window_position(
        (0, 0),
        (360, 720),
        monitor_position,
        monitor_size,
        ratio,
    );
    let live2d_constrained = compute_constrained_window_position(
        (0, 0),
        (400, 600),
        monitor_position,
        monitor_size,
        ratio,
    );

    assert_eq!(vrm_constrained, (0, 0));
    assert_eq!(live2d_constrained, (0, 0));
}

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
    write_agent_center_local_config(
        home,
        account_id,
        agent_id,
        Some(("live2d", "live2d_ab12cd34ef56")),
    );
    package_dir
}

fn write_agent_center_live2d_package(home: &Path, entry_content: &str) -> PathBuf {
    write_agent_center_live2d_package_for_agent(home, "agent_1", entry_content)
}

fn write_agent_center_vrm_package(home: &Path, entry_content: &[u8]) -> PathBuf {
    let package_dir = home
        .join(".nimi/data/accounts/account_1/agents/agent_1")
        .join("agent-center/modules/avatar_package/packages/vrm/vrm_ab12cd34ef56");
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
        "package_version": "1.0.0",
        "package_id": "vrm_ab12cd34ef56",
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
            "max_package_bytes": 524288000,
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
    write_agent_center_local_config(
        home,
        "account_1",
        "agent_1",
        Some(("vrm", "vrm_ab12cd34ef56")),
    );
    package_dir
}

#[test]
fn normalize_avatar_launch_instance_id_writes_generated_id_when_omitted() {
    let mut context = AvatarLaunchContext {
        agent_id: "agent_1".to_string(),
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
        agent_id: "agent_1".to_string(),
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

fn write_agent_center_local_config(
    home: &Path,
    account_id: &str,
    agent_id: &str,
    selected_package: Option<(&str, &str)>,
) {
    let config_dir = home
        .join(".nimi/data/accounts")
        .join(agent_center_path_segment(account_id))
        .join("agents")
        .join(agent_center_path_segment(agent_id))
        .join("agent-center");
    fs::create_dir_all(&config_dir).unwrap();
    let selected_package = selected_package.map(|(kind, package_id)| {
        json!({
            "kind": kind,
            "package_id": package_id,
        })
    });
    let config = json!({
        "schema_version": 1,
        "config_kind": "agent_center_local_config",
        "account_id": account_id,
        "agent_id": agent_id,
        "modules": {
            "avatar_package": {
                "schema_version": 1,
                "selected_package": selected_package,
                "last_validated_at": "2026-04-27T00:00:00Z",
                "last_launch_package_id": null
            }
        }
    });
    fs::write(
        config_dir.join("config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
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
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve package manifest");

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
            account_id: "account_1".to_string(),
            agent_id: "~agent_1_tffk".to_string(),
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
            account_id: "account_1".to_string(),
            agent_id: agent_id.to_string(),
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
async fn resolve_agent_center_avatar_package_uses_runtime_account_projection_scope() {
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
            account_id: account_id.to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve package manifest with Runtime account projection");

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
async fn resolve_agent_center_avatar_package_returns_vrm_model_manifest_and_rejects_digest_mismatch(
) {
    let _guard = test_env_guard();
    let home = unique_temp_dir("agent-center-package-invalid");
    fs::create_dir_all(&home).unwrap();
    let previous_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &home);
    let vrm_package_dir = write_agent_center_vrm_package(&home, b"vrm-bytes");

    let vrm_manifest =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
        })
        .await
        .expect("resolve VRM package manifest");
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
    let entry = home.join(".nimi/data/accounts/account_1/agents/agent_1/agent-center/modules/avatar_package/packages/live2d/live2d_ab12cd34ef56/files/ren.model3.json");
    write_agent_center_local_config(
        &home,
        "account_1",
        "agent_1",
        Some(("live2d", "live2d_ab12cd34ef56")),
    );
    fs::write(entry, r#"{"Version":4}"#).unwrap();
    let digest_error =
        nimi_avatar_resolve_agent_center_avatar_package(AgentCenterAvatarPackageResolvePayload {
            account_id: "account_1".to_string(),
            agent_id: "agent_1".to_string(),
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
