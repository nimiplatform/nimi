use super::*;
use nimi_shell_tauri::agent_center_avatar_asset::agent_center_path_segment;
use std::fs;
use std::path::{Path, PathBuf};

// Wave 4 — `compute_constrained_window_position` covers
// window-bounds-policy.yaml `visible_area` rule (K-NAV-SHELL-010):
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

#[test]
fn manual_drag_target_uses_origin_plus_total_delta() {
    let result = compute_manual_drag_window_position((1200, 800), (64, -32));
    assert_eq!(result, PhysicalPosition::new(1264, 768));
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

#[path = "main_agent_center_tests.rs"]
mod main_agent_center_tests;
