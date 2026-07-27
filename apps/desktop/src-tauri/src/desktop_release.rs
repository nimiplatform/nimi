use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

mod manifest;
use manifest::read_manifest;
#[cfg(test)]
use manifest::validate_release_manifest;

const RELEASE_MANIFEST_FILE: &str = "desktop-release-manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopReleaseInfo {
    pub desktop_version: String,
    pub desktop_release_id: String,
    pub channel: String,
    pub commit: String,
    pub built_at: String,
    #[serde(default)]
    pub updater_available: bool,
    #[serde(default)]
    pub updater_unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopReleaseManifest {
    pub desktop_version: String,
    pub desktop_release_id: String,
    pub channel: String,
    pub commit: String,
    pub built_at: String,
}

#[derive(Debug, Clone, Default)]
struct DesktopReleaseState {
    manifest: Option<DesktopReleaseManifest>,
    initialization_error: Option<String>,
}

fn release_state() -> &'static Mutex<DesktopReleaseState> {
    static STATE: OnceLock<Mutex<DesktopReleaseState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(DesktopReleaseState::default()))
}

fn bridge_error(code: &str, message: &str) -> String {
    format!("{code}: {message}")
}

fn build_release_info(manifest: &DesktopReleaseManifest) -> DesktopReleaseInfo {
    DesktopReleaseInfo {
        desktop_version: manifest.desktop_version.clone(),
        desktop_release_id: manifest.desktop_release_id.clone(),
        channel: manifest.channel.clone(),
        commit: manifest.commit.clone(),
        built_at: manifest.built_at.clone(),
        updater_available: crate::desktop_updates::updater_available(),
        updater_unavailable_reason: crate::desktop_updates::updater_unavailable_reason(),
    }
}

pub fn record_initialize_error(message: String) {
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    guard.initialization_error = Some(message);
}

pub fn initialize(app: &AppHandle) -> Result<DesktopReleaseInfo, String> {
    let manifest = read_manifest(app)?;
    let info = build_release_info(&manifest);
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    guard.manifest = Some(manifest);
    guard.initialization_error = None;
    Ok(info)
}

pub fn release_info() -> Result<DesktopReleaseInfo, String> {
    let guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    if let Some(error) = &guard.initialization_error {
        return Err(error.clone());
    }
    guard
        .manifest
        .as_ref()
        .map(build_release_info)
        .ok_or_else(|| {
            bridge_error(
                "DESKTOP_RELEASE_INFO_UNAVAILABLE",
                "Desktop release metadata is unavailable",
            )
        })
}

#[cfg(test)]
pub(crate) fn reset_test_state() {
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    *guard = DesktopReleaseState::default();
}

#[cfg(test)]
pub(crate) fn set_test_release_version(version: &str) {
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    guard.manifest = Some(DesktopReleaseManifest {
        desktop_version: version.to_string(),
        desktop_release_id: format!("{version}+test"),
        channel: "stable".to_string(),
        commit: "test".to_string(),
        built_at: "2026-03-15T00:00:00Z".to_string(),
    });
    guard.initialization_error = None;
}

#[tauri::command]
pub fn desktop_release_info_get() -> Result<DesktopReleaseInfo, String> {
    release_info()
}

#[cfg(test)]
mod tests {
    use super::{
        release_info, reset_test_state, validate_release_manifest, DesktopReleaseManifest,
    };
    use crate::test_support::{test_guard, with_env};

    fn manifest(version: &str) -> DesktopReleaseManifest {
        DesktopReleaseManifest {
            desktop_version: version.to_string(),
            desktop_release_id: format!("{version}+test"),
            channel: "stable".to_string(),
            commit: "test".to_string(),
            built_at: "2026-03-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn validate_release_manifest_rejects_packaged_version_drift() {
        let error = validate_release_manifest(&manifest("9.9.9"))
            .expect_err("mismatched packaged version must fail");
        assert!(error.contains("DESKTOP_RELEASE_VERSION_OUT_OF_SYNC"));
    }

    #[test]
    fn validate_release_manifest_rejects_path_like_release_id() {
        let mut input = manifest(env!("CARGO_PKG_VERSION"));
        input.desktop_release_id = "../runtime".to_string();
        let error = validate_release_manifest(&input).expect_err("path-like release id must fail");
        assert!(error.contains("DESKTOP_RELEASE_ID_INVALID"));
    }

    #[test]
    fn validate_release_manifest_accepts_desktop_only_metadata() {
        assert!(validate_release_manifest(&manifest(env!("CARGO_PKG_VERSION"))).is_ok());
    }

    #[test]
    fn release_info_reports_updater_availability_fields() {
        reset_test_state();
        with_env(
            &[
                ("NIMI_DESKTOP_UPDATER_PUBLIC_KEY", Some("runtime-pubkey")),
                (
                    "NIMI_DESKTOP_UPDATER_ENDPOINT",
                    Some("https://install.nimi.ai/desktop/latest.json"),
                ),
            ],
            || {
                super::set_test_release_version("0.1.0");
                let info = release_info().expect("release info");
                assert!(info.updater_available);
                assert_eq!(info.updater_unavailable_reason, None);
            },
        );
    }

    #[test]
    fn release_info_reports_updater_unavailable_reason() {
        reset_test_state();
        with_env(&[("NIMI_DESKTOP_UPDATER_PUBLIC_KEY", None)], || {
            super::set_test_release_version("0.1.0");
            let info = release_info().expect("release info");
            assert!(!info.updater_available);
            assert!(info
                .updater_unavailable_reason
                .unwrap_or_default()
                .contains("DESKTOP_UPDATER_UNAVAILABLE"));
        });
    }

    #[test]
    fn release_info_fails_closed_after_initialize_error() {
        let _guard = test_guard();
        reset_test_state();
        super::record_initialize_error("DESKTOP_RELEASE_MANIFEST_INVALID: test".to_string());
        let error = release_info().expect_err("initialization error must fail closed");
        assert!(error.contains("DESKTOP_RELEASE_MANIFEST_INVALID"));
        reset_test_state();
    }
}
