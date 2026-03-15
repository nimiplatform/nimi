use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

mod manifest;
mod runtime_paths;
mod runtime_stage;
#[cfg(test)]
use manifest::validate_release_manifest;
use manifest::{read_manifest, resolve_resource_path};
#[cfg(test)]
use runtime_paths::current_runtime_state_path;
use runtime_stage::stage_runtime_archive;
#[cfg(test)]
use runtime_stage::{cleanup_old_versions, runtime_version_dir, sha256_hex};
const RELEASE_MANIFEST_FILE: &str = "desktop-release-manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopReleaseInfo {
    pub desktop_version: String,
    pub runtime_version: String,
    pub channel: String,
    pub commit: String,
    pub built_at: String,
    pub runtime_ready: bool,
    pub runtime_staged_path: Option<String>,
    pub runtime_last_error: Option<String>,
    #[serde(default)]
    pub updater_available: bool,
    #[serde(default)]
    pub updater_unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopReleaseManifest {
    pub desktop_version: String,
    pub runtime_version: String,
    pub channel: String,
    pub commit: String,
    pub runtime_archive_path: String,
    pub runtime_sha256: String,
    pub runtime_binary_path: String,
    pub built_at: String,
}

#[derive(Debug, Clone, Default)]
struct DesktopReleaseState {
    manifest: Option<DesktopReleaseManifest>,
    staged_binary_path: Option<PathBuf>,
    runtime_reported_version: Option<String>,
    runtime_last_error: Option<String>,
}

fn release_state() -> &'static Mutex<DesktopReleaseState> {
    static STATE: OnceLock<Mutex<DesktopReleaseState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(DesktopReleaseState::default()))
}

fn bridge_error(code: &str, message: &str) -> String {
    format!("{code}: {message}")
}

fn now_iso_string() -> String {
    let now = chrono::Utc::now();
    now.to_rfc3339()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

fn update_release_state(
    manifest: Option<DesktopReleaseManifest>,
    staged_binary_path: Option<PathBuf>,
    runtime_reported_version: Option<String>,
    runtime_last_error: Option<String>,
) {
    let mut guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    if manifest.is_some() {
        guard.manifest = manifest;
    }
    guard.staged_binary_path = staged_binary_path;
    guard.runtime_reported_version = runtime_reported_version;
    guard.runtime_last_error = runtime_last_error;
}

fn build_release_info(
    manifest: &DesktopReleaseManifest,
    staged_binary_path: Option<&PathBuf>,
    runtime_last_error: Option<String>,
) -> DesktopReleaseInfo {
    DesktopReleaseInfo {
        desktop_version: manifest.desktop_version.clone(),
        runtime_version: manifest.runtime_version.clone(),
        channel: manifest.channel.clone(),
        commit: manifest.commit.clone(),
        built_at: manifest.built_at.clone(),
        runtime_ready: staged_binary_path.is_some(),
        runtime_staged_path: staged_binary_path.map(|path| path.display().to_string()),
        runtime_last_error,
        updater_available: crate::desktop_updates::updater_available(),
        updater_unavailable_reason: crate::desktop_updates::updater_unavailable_reason(),
    }
}

fn set_runtime_error(message: String) {
    let manifest = {
        release_state()
            .lock()
            .expect("desktop release state lock poisoned")
            .manifest
            .clone()
    };
    update_release_state(manifest, None, None, Some(message));
}

pub fn record_initialize_error(message: String) {
    set_runtime_error(message);
}

pub fn initialize(app: &AppHandle) -> Result<DesktopReleaseInfo, String> {
    let manifest = read_manifest(app)?;
    update_release_state(Some(manifest.clone()), None, None, None);
    let runtime_result = if std::env::var("NIMI_RUNTIME_BRIDGE_MODE")
        .ok()
        .map(|value| value.trim().eq_ignore_ascii_case("runtime"))
        .unwrap_or(false)
    {
        Ok(None)
    } else if manifest.runtime_archive_path.trim().is_empty() {
        Err(bridge_error(
            "DESKTOP_RUNTIME_ARCHIVE_MISSING",
            "desktop release manifest is missing runtime archive path",
        ))
    } else {
        let archive_path = resolve_resource_path(app, manifest.runtime_archive_path.as_str())?;
        stage_runtime_archive(&manifest, archive_path.as_path()).map(Some)
    };

    match runtime_result {
        Ok(staged_runtime) => {
            let (staged_binary_path, runtime_reported_version) = match staged_runtime {
                Some((path, version)) => (Some(path), Some(version)),
                None => (None, None),
            };
            update_release_state(
                Some(manifest.clone()),
                staged_binary_path.clone(),
                runtime_reported_version,
                None,
            );
            Ok(build_release_info(
                &manifest,
                staged_binary_path.as_ref(),
                None,
            ))
        }
        Err(error) => {
            set_runtime_error(error.clone());
            Err(error)
        }
    }
}

pub fn release_info() -> Result<DesktopReleaseInfo, String> {
    let guard = release_state()
        .lock()
        .expect("desktop release state lock poisoned");
    if let Some(error) = &guard.runtime_last_error {
        return Err(error.clone());
    }
    if let Some(manifest) = &guard.manifest {
        return Ok(build_release_info(
            manifest,
            guard.staged_binary_path.as_ref(),
            guard.runtime_last_error.clone(),
        ));
    }
    Err(bridge_error(
        "DESKTOP_RELEASE_INFO_UNAVAILABLE",
        "desktop release metadata is unavailable",
    ))
}

pub fn staged_runtime_binary_path() -> Option<PathBuf> {
    release_state()
        .lock()
        .expect("desktop release state lock poisoned")
        .staged_binary_path
        .clone()
}

pub fn runtime_last_error() -> Option<String> {
    release_state()
        .lock()
        .expect("desktop release state lock poisoned")
        .runtime_last_error
        .clone()
}

pub fn current_release_version() -> Option<String> {
    release_state()
        .lock()
        .expect("desktop release state lock poisoned")
        .manifest
        .as_ref()
        .map(|manifest| manifest.desktop_version.clone())
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
        runtime_version: version.to_string(),
        channel: "stable".to_string(),
        commit: "test".to_string(),
        runtime_archive_path: "runtime/test/nimi-runtime.zip".to_string(),
        runtime_sha256: "sha256".to_string(),
        runtime_binary_path: "bin/nimi".to_string(),
        built_at: "2026-03-15T00:00:00Z".to_string(),
    });
    guard.runtime_last_error = None;
}

#[tauri::command]
pub fn desktop_release_info_get() -> Result<DesktopReleaseInfo, String> {
    if let Some(override_info) = crate::desktop_e2e_fixture::desktop_release_info_override()? {
        return Ok(override_info);
    }
    release_info()
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_old_versions, current_runtime_state_path, release_info, reset_test_state,
        runtime_version_dir, sha256_hex, stage_runtime_archive, validate_release_manifest,
        DesktopReleaseManifest,
    };
    use crate::test_support::{test_guard, with_env};
    use serde_json::Value;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-desktop-release-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_runtime_zip(path: &Path, binary_relative_path: &str, content: &[u8]) {
        let file = fs::File::create(path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
        zip.start_file(binary_relative_path.replace('\\', "/"), options)
            .expect("start file");
        zip.write_all(content).expect("write zip entry");
        zip.finish().expect("finish zip");
    }

    fn test_binary_relative_path() -> &'static str {
        if cfg!(windows) {
            "bin/nimi.cmd"
        } else {
            "bin/nimi"
        }
    }

    fn runtime_probe_fixture(version: &str) -> Vec<u8> {
        if cfg!(windows) {
            format!(
                "@echo off\r\nif \"%1\"==\"version\" if \"%2\"==\"--json\" (\r\n  echo {{\"nimi\":\"{version}\"}}\r\n  exit /b 0\r\n)\r\nexit /b 9\r\n"
            )
            .into_bytes()
        } else {
            format!(
                "#!/bin/sh\nif [ \"$1\" = \"version\" ] && [ \"$2\" = \"--json\" ]; then\n  printf '%s\\n' '{{\"nimi\":\"{version}\"}}'\n  exit 0\nfi\nexit 9\n"
            )
            .into_bytes()
        }
    }

    fn test_manifest_with_sha(
        archive_path: &Path,
        runtime_version: &str,
        runtime_sha256: String,
    ) -> DesktopReleaseManifest {
        DesktopReleaseManifest {
            desktop_version: runtime_version.to_string(),
            runtime_version: runtime_version.to_string(),
            channel: "stable".to_string(),
            commit: "test".to_string(),
            runtime_archive_path: archive_path.display().to_string(),
            runtime_sha256,
            runtime_binary_path: test_binary_relative_path().to_string(),
            built_at: "2026-01-01T00:00:00.000Z".to_string(),
        }
    }

    fn test_manifest(archive_path: &Path, runtime_version: &str) -> DesktopReleaseManifest {
        test_manifest_with_sha(
            archive_path,
            runtime_version,
            sha256_hex(archive_path).expect("archive sha"),
        )
    }

    fn read_current_runtime_state_json() -> Value {
        let current_state =
            fs::read_to_string(current_runtime_state_path().expect("current state path"))
                .expect("read current state");
        serde_json::from_str::<Value>(&current_state).expect("parse current state")
    }

    #[test]
    fn validate_release_manifest_rejects_mismatched_versions() {
        let archive = PathBuf::from("runtime.zip");
        let mut manifest = test_manifest_with_sha(&archive, "9.9.9", "deadbeef".to_string());
        manifest.runtime_version = "9.9.8".to_string();

        let error = validate_release_manifest(&manifest)
            .err()
            .unwrap_or_default();
        assert!(error.contains("DESKTOP_RELEASE_VERSION_MISMATCH"));
    }

    #[test]
    fn validate_release_manifest_rejects_packaged_version_drift() {
        let archive = PathBuf::from("runtime.zip");
        let manifest = test_manifest_with_sha(&archive, "9.9.9", "deadbeef".to_string());

        let error = validate_release_manifest(&manifest)
            .err()
            .unwrap_or_default();
        assert!(error.contains("DESKTOP_RELEASE_VERSION_OUT_OF_SYNC"));
    }

    #[test]
    fn validate_release_manifest_accepts_current_package_version() {
        let archive = PathBuf::from("runtime.zip");
        let manifest =
            test_manifest_with_sha(&archive, env!("CARGO_PKG_VERSION"), "deadbeef".to_string());

        assert!(validate_release_manifest(&manifest).is_ok());
    }

    #[test]
    fn release_info_reports_updater_availability_fields() {
        reset_test_state();
        with_env(
            &[
                ("NIMI_DESKTOP_UPDATER_PUBLIC_KEY", Some("runtime-pubkey")),
                (
                    "NIMI_DESKTOP_UPDATER_ENDPOINT",
                    Some("https://install.nimi.xyz/desktop/latest.json"),
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
    fn stage_runtime_archive_extracts_runtime_and_writes_current_state() {
        let home = temp_home("extracts");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("1.2.3").as_slice(),
        );
        let manifest = test_manifest(&archive, "1.2.3");

        with_env(&[("HOME", home.to_str())], || {
            let (staged, version) =
                stage_runtime_archive(&manifest, &archive).expect("stage runtime");
            assert!(staged.exists());
            assert_eq!(version, "1.2.3");

            let current_state = read_current_runtime_state_json();
            assert_eq!(current_state["version"], "1.2.3");
            assert_eq!(current_state["binaryPath"], staged.display().to_string());
        });
    }

    #[test]
    fn stage_runtime_archive_reuses_existing_runtime_and_refreshes_current_state() {
        let home = temp_home("reuses");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("2.0.0").as_slice(),
        );
        let manifest = test_manifest(&archive, "2.0.0");

        with_env(&[("HOME", home.to_str())], || {
            let version_dir = runtime_version_dir("2.0.0").expect("version dir");
            fs::create_dir_all(version_dir.join("bin")).expect("create bin dir");
            let existing_binary = version_dir.join(test_binary_relative_path());
            fs::write(&existing_binary, runtime_probe_fixture("2.0.0"))
                .expect("write existing runtime");

            let (staged, version) =
                stage_runtime_archive(&manifest, &archive).expect("reuse runtime");
            assert_eq!(staged, existing_binary);
            assert_eq!(version, "2.0.0");

            let current_state = read_current_runtime_state_json();
            assert_eq!(current_state["version"], "2.0.0");
            assert_eq!(
                current_state["binaryPath"],
                existing_binary.display().to_string()
            );
        });
    }

    #[test]
    fn stage_runtime_archive_rejects_sha_mismatch() {
        let home = temp_home("sha-mismatch");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("3.0.0").as_slice(),
        );
        let mut manifest = test_manifest(&archive, "3.0.0");
        manifest.runtime_sha256 = "deadbeef".to_string();

        with_env(&[("HOME", home.to_str())], || {
            let error = stage_runtime_archive(&manifest, &archive)
                .err()
                .unwrap_or_default();
            assert!(error.contains("DESKTOP_RUNTIME_ARCHIVE_SHA_MISMATCH"));
        });
    }

    #[test]
    fn stage_runtime_archive_rejects_runtime_version_mismatch() {
        let home = temp_home("version-mismatch");
        let archive = home.join("runtime.zip");
        write_runtime_zip(
            &archive,
            test_binary_relative_path(),
            runtime_probe_fixture("4.0.1").as_slice(),
        );
        let manifest = test_manifest(&archive, "4.0.0");

        with_env(&[("HOME", home.to_str())], || {
            let error = stage_runtime_archive(&manifest, &archive)
                .err()
                .unwrap_or_default();
            assert!(error.contains("DESKTOP_RUNTIME_VERSION_REPORT_MISMATCH"));
        });
    }

    #[test]
    fn cleanup_old_versions_keeps_current_and_most_recent_previous() {
        let home = temp_home("cleanup");
        with_env(&[("HOME", home.to_str())], || {
            for version in ["1.0.0", "1.1.0", "1.2.0"] {
                let dir = runtime_version_dir(version).expect("version dir");
                fs::create_dir_all(&dir).expect("create version dir");
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            cleanup_old_versions("1.2.0").expect("cleanup old versions");

            assert!(!runtime_version_dir("1.0.0").expect("v1").exists());
            assert!(runtime_version_dir("1.1.0").expect("v2").exists());
            assert!(runtime_version_dir("1.2.0").expect("v3").exists());
        });
    }

    #[test]
    fn release_info_fails_close_after_initialize_error() {
        let _guard = test_guard();
        reset_test_state();
        super::record_initialize_error("DESKTOP_RUNTIME_ARCHIVE_MISSING: no archive".to_string());
        let error = release_info().err().unwrap_or_default();
        assert!(error.contains("DESKTOP_RUNTIME_ARCHIVE_MISSING"));
        reset_test_state();
    }
}
