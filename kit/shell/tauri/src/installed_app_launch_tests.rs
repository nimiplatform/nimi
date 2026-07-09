use crate::installed_app_launch::{
    build_installed_nimi_app_launch_binding_script,
    resolve_installed_nimi_app_launch_binding_from_values, InstalledNimiAppLaunchBindingInput,
};

fn input<'a>() -> InstalledNimiAppLaunchBindingInput<'a> {
    InstalledNimiAppLaunchBindingInput {
        app_id: "nimi.test-app",
        app_instance_id: "nimi.test-app.desktop-installed",
        device_id: "desktop-installed-app",
        launch_host_id: "tauri-installed-app-host",
        launch_nonce: "nonce-1",
        release_descriptor_ref: "nimi.test-app.bundled-with-nimi",
        realm_base_url: "https://realm.example.test/base",
    }
}

#[test]
fn resolves_binding_from_values_with_normalized_realm_url() {
    let binding = resolve_installed_nimi_app_launch_binding_from_values(input()).unwrap();

    assert_eq!(binding.app_id, "nimi.test-app");
    assert_eq!(binding.realm_base_url, "https://realm.example.test/base");
}

#[test]
fn rejects_missing_nonce_and_invalid_realm_url() {
    let mut missing_nonce = input();
    missing_nonce.launch_nonce = " ";
    assert!(
        resolve_installed_nimi_app_launch_binding_from_values(missing_nonce)
            .unwrap_err()
            .contains("launchNonce")
    );

    let mut bad_url = input();
    bad_url.realm_base_url = "not a url";
    assert!(
        resolve_installed_nimi_app_launch_binding_from_values(bad_url)
            .unwrap_err()
            .contains("realmBaseUrl")
    );
}

#[test]
fn builds_tauri_runtime_hook_launch_binding_script() {
    let binding = resolve_installed_nimi_app_launch_binding_from_values(input()).unwrap();
    let script = build_installed_nimi_app_launch_binding_script(&binding).unwrap();

    assert!(script.contains("window.__NIMI_TAURI_RUNTIME__"));
    assert!(script.contains("installedAppLaunchBinding"));
    assert!(script.contains("\"appId\":\"nimi.test-app\""));
    assert!(!script.contains("bindingSource"));
    assert!(!script.contains("auth"));
    assert!(!script.contains("oauth"));
    assert!(!script.contains("runtime-defaults"));
}
