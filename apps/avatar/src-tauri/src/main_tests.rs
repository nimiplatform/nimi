use super::*;
use std::fs;
use std::path::{Path, PathBuf};

// Window-control geometry math (visible-area constraint, manual-drag target)
// is migrated to the kit standard `nimi_shell_tauri::standard_floating_window`
// module and unit-tested there; Avatar no longer re-tests it. The cursor
// hit-testing helper below stays app-owned.

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
fn avatar_manages_standard_storage_slot_for_kit_bridge_commands() {
    let main_source = include_str!("main.rs");
    assert!(
        main_source.contains("StandardAppStorageRootSlot::empty()"),
        "Avatar Tauri must manage the standard app storage slot so kit standard storage/file commands fail closed",
    );
    assert!(
        main_source.contains("RuntimeBridgeLocalAppHost::platform_default()"),
        "Avatar Tauri must use the common formal Local App session host",
    );
    assert!(
        main_source.contains("nimi_shell_tauri_local_app_standard_shell_handler!"),
        "Avatar Tauri must register the common formal Local App operation family",
    );
    assert!(
        !main_source.contains("nimi_shell_tauri_runtime_bridge_handler!["),
        "Avatar Tauri must not expose the retired raw Runtime bridge command family",
    );
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
