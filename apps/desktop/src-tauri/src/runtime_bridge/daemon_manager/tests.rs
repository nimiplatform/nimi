use super::{
    config_get, config_set, grpc_addr, runtime_cli_command_spec, runtime_config_path, start,
    status, stop, DEFAULT_GRPC_ADDR,
};
use crate::desktop_release::{reset_test_state, set_test_release_version};
use crate::test_support::{test_guard, with_env};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn make_temp_dir(prefix: &str) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "nimi-desktop-runtime-bridge-{}-{}-{}",
        prefix,
        std::process::id(),
        now
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[cfg(unix)]
fn write_executable(path: &PathBuf, content: &str) {
    use std::os::unix::fs::PermissionsExt;

    fs::write(path, content).expect("write script");
    let mut permissions = fs::metadata(path).expect("metadata").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).expect("chmod script");
}

#[test]
fn runtime_config_path_defaults_to_new_location() {
    let _guard = test_guard();
    let home = make_temp_dir("path-default");
    with_env(
        &[("HOME", home.to_str()), ("NIMI_RUNTIME_CONFIG_PATH", None)],
        || {
            std::env::remove_var("NIMI_RUNTIME_CONFIG_PATH");
            let path = runtime_config_path().expect("runtime config path");
            assert_eq!(path, home.join(".nimi/config.json"));
        },
    );
    let _ = fs::remove_dir_all(home);
}

#[test]
fn runtime_config_path_prefers_env_override() {
    let _guard = test_guard();
    let home = make_temp_dir("path-env");
    let custom = home.join("custom/config.json");
    with_env(
        &[
            ("HOME", home.to_str()),
            ("NIMI_RUNTIME_CONFIG_PATH", custom.to_str()),
        ],
        || {
            let path = runtime_config_path().expect("runtime config path");
            assert_eq!(path, custom);
        },
    );
    let _ = fs::remove_dir_all(home);
}

#[test]
fn grpc_addr_reads_flat_runtime_config_schema() {
    let _guard = test_guard();
    let home = make_temp_dir("grpc-flat-schema");
    with_env(
        &[
            ("HOME", home.to_str()),
            ("NIMI_RUNTIME_CONFIG_PATH", None),
            ("NIMI_RUNTIME_GRPC_ADDR", None),
        ],
        || {
            std::env::remove_var("NIMI_RUNTIME_CONFIG_PATH");
            std::env::remove_var("NIMI_RUNTIME_GRPC_ADDR");
            let path = runtime_config_path().expect("runtime config path");
            fs::create_dir_all(path.parent().expect("config parent"))
                .expect("create config parent");
            fs::write(path, r#"{"schemaVersion":1,"grpcAddr":"127.0.0.1:50001"}"#)
                .expect("write config");
            assert_eq!(grpc_addr(), "127.0.0.1:50001");
        },
    );
    let _ = fs::remove_dir_all(home);
}

#[test]
fn grpc_addr_ignores_legacy_nested_runtime_schema() {
    let _guard = test_guard();
    let home = make_temp_dir("grpc-legacy-nested");
    with_env(
        &[
            ("HOME", home.to_str()),
            ("NIMI_RUNTIME_CONFIG_PATH", None),
            ("NIMI_RUNTIME_GRPC_ADDR", None),
        ],
        || {
            std::env::remove_var("NIMI_RUNTIME_CONFIG_PATH");
            std::env::remove_var("NIMI_RUNTIME_GRPC_ADDR");
            let path = runtime_config_path().expect("runtime config path");
            fs::create_dir_all(path.parent().expect("config parent"))
                .expect("create config parent");
            fs::write(
                path,
                r#"{"schemaVersion":1,"runtime":{"grpcAddr":"127.0.0.1:59999"}}"#,
            )
            .expect("write config");
            assert_eq!(grpc_addr(), DEFAULT_GRPC_ADDR);
        },
    );
    let _ = fs::remove_dir_all(home);
}

#[test]
fn start_failure_sets_status_last_error() {
    let _guard = test_guard();
    let _ = stop();
    with_env(
        &[
            (
                "NIMI_RUNTIME_BINARY",
                Some("/__nimi_runtime_missing_binary__"),
            ),
            ("NIMI_RUNTIME_GRPC_ADDR", Some("127.0.0.1:46379")),
        ],
        || {
            let result = start();
            let error = result.err().unwrap_or_default();
            assert!(error.contains("RUNTIME_BRIDGE_BUNDLED_RUNTIME_MISSING"));

            let snapshot = status();
            assert!(snapshot.last_error.is_some());
        },
    );

    let _ = stop();
    let snapshot = status();
    assert_ne!(
        snapshot.last_error.as_deref(),
        Some("RUNTIME_BRIDGE_BUNDLED_RUNTIME_MISSING")
    );
}

#[cfg(unix)]
#[test]
fn config_cli_bridge_invokes_nimi_binary_and_parses_json() {
    let _guard = test_guard();
    let dir = make_temp_dir("config-cli-success");
    let script_path = dir.join("nimi-fake.sh");
    let captured_stdin = dir.join("captured-stdin.json");
    let config_path = dir.join("config.json");
    let script = format!(
        r#"#!/bin/sh
if [ "$1" = "config" ] && [ "$2" = "get" ]; then
  printf '%s\n' '{{"path":"{}","config":{{"schemaVersion":1}}}}'
  exit 0
fi
if [ "$1" = "config" ] && [ "$2" = "set" ]; then
  cat > "{}"
  printf '%s\n' '{{"path":"{}","reasonCode":"CONFIG_RESTART_REQUIRED"}}'
  exit 0
fi
echo "unexpected args:$*" >&2
exit 7
"#,
        config_path.display(),
        captured_stdin.display(),
        config_path.display()
    );
    write_executable(&script_path, script.as_str());

    with_env(&[("NIMI_RUNTIME_BINARY", script_path.to_str())], || {
        let get_payload = config_get().expect("config get");
        assert_eq!(get_payload["path"], config_path.display().to_string());

        let payload = r#"{"schemaVersion":1,"grpcAddr":"127.0.0.1:50001"}"#;
        let set_payload = config_set(payload).expect("config set");
        assert_eq!(set_payload["reasonCode"], "CONFIG_RESTART_REQUIRED");

        let captured = fs::read_to_string(&captured_stdin).expect("read captured stdin");
        assert_eq!(captured, payload);
    });
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn config_cli_bridge_surfaces_cli_failure() {
    let _guard = test_guard();
    let dir = make_temp_dir("config-cli-fail");
    let script_path = dir.join("nimi-fail.sh");
    let script = r#"#!/bin/sh
echo "config failed from fake cli" >&2
exit 9
"#;
    write_executable(&script_path, script);

    with_env(&[("NIMI_RUNTIME_BINARY", script_path.to_str())], || {
        let err = config_set(r#"{"schemaVersion":1}"#)
            .err()
            .unwrap_or_default();
        assert!(err.contains("RUNTIME_BRIDGE_CONFIG_CLI_FAILED"));
        assert!(err.contains("config failed from fake cli"));
    });
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn runtime_cli_command_spec_uses_runtime_mode_branch() {
    let _guard = test_guard();
    let dir = make_temp_dir("runtime-cli-fallback-path");
    let fake_go = dir.join("go");
    write_executable(&fake_go, "#!/bin/sh\nexit 0\n");
    with_env(
        &[
            ("PATH", dir.to_str()),
            ("NIMI_RUNTIME_BINARY", None),
            ("NIMI_RUNTIME_BRIDGE_MODE", Some("RUNTIME")),
        ],
        || {
            let spec = runtime_cli_command_spec(&["config", "get", "--json"]).expect("spec");
            assert_eq!(spec.program, "go");
            assert_eq!(spec.args[0], "run");
            assert_eq!(spec.args[1], "./cmd/nimi");
            assert_eq!(spec.args[2], "config");
            assert_eq!(spec.args[3], "get");
            assert_eq!(spec.args[4], "--json");
            let current_dir = spec.current_dir.expect("current dir");
            assert!(current_dir.ends_with("runtime"));
        },
    );

    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn runtime_dev_root_dir_is_debug_only() {
    let _guard = test_guard();

    #[cfg(debug_assertions)]
    {
        let spec = runtime_cli_command_spec(&["version", "--json"]);
        if let Ok(spec) = spec {
            let current_dir = spec.current_dir.expect("runtime mode debug current dir");
            assert!(current_dir.ends_with("runtime"));
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let error = runtime_cli_command_spec(&["version", "--json"])
            .err()
            .unwrap_or_default();
        assert!(error.contains("RUNTIME_BRIDGE_RUNTIME_ROOT_NOT_FOUND"));
    }
}

#[test]
fn runtime_cli_command_spec_rejects_invalid_mode() {
    let _guard = test_guard();
    with_env(&[("NIMI_RUNTIME_BRIDGE_MODE", Some("invalid"))], || {
        let error = runtime_cli_command_spec(&["config", "get", "--json"])
            .err()
            .unwrap_or_default();
        assert!(error.contains("RUNTIME_BRIDGE_MODE_INVALID"));
        assert!(error.contains("NIMI_RUNTIME_BRIDGE_MODE"));
    });
}

#[test]
fn status_includes_launch_mode() {
    let _guard = test_guard();
    with_env(&[("NIMI_RUNTIME_BRIDGE_MODE", Some("RUNTIME"))], || {
        let snapshot = status();
        assert_eq!(snapshot.launch_mode, "RUNTIME");
    });
    with_env(&[("NIMI_RUNTIME_BRIDGE_MODE", Some("RELEASE"))], || {
        let snapshot = status();
        assert_eq!(snapshot.launch_mode, "RELEASE");
    });
}

#[cfg(unix)]
#[test]
fn status_uses_runtime_cli_truth_for_release_mode_version() {
    let _guard = test_guard();
    reset_test_state();
    set_test_release_version("0.9.1");
    let dir = make_temp_dir("runtime-version-cli");
    let fake_nimi = dir.join("nimi");
    write_executable(
        &fake_nimi,
        r#"#!/bin/sh
if [ "$1" = "version" ] && [ "$2" = "--json" ]; then
  printf '%s\n' '{"nimi":"0.9.1"}'
  exit 0
fi
exit 7
"#,
    );

    with_env(
        &[
            ("NIMI_RUNTIME_BINARY", fake_nimi.to_str()),
            ("NIMI_RUNTIME_BRIDGE_MODE", Some("RELEASE")),
        ],
        || {
            let snapshot = status();
            assert_eq!(snapshot.version.as_deref(), Some("0.9.1"));
            assert!(snapshot.last_error.is_none());
        },
    );
    let _ = fs::remove_dir_all(dir);
    reset_test_state();
}

#[cfg(unix)]
#[test]
fn status_surfaces_runtime_version_mismatch_error() {
    let _guard = test_guard();
    reset_test_state();
    set_test_release_version("0.9.1");
    let dir = make_temp_dir("runtime-version-mismatch");
    let fake_nimi = dir.join("nimi");
    write_executable(
        &fake_nimi,
        r#"#!/bin/sh
if [ "$1" = "version" ] && [ "$2" = "--json" ]; then
  printf '%s\n' '{"nimi":"0.9.2"}'
  exit 0
fi
exit 7
"#,
    );

    with_env(
        &[
            ("NIMI_RUNTIME_BINARY", fake_nimi.to_str()),
            ("NIMI_RUNTIME_BRIDGE_MODE", Some("RELEASE")),
        ],
        || {
            let snapshot = status();
            assert!(snapshot.version.is_none());
            assert!(snapshot
                .last_error
                .as_deref()
                .unwrap_or_default()
                .contains("RUNTIME_BRIDGE_VERSION_MISMATCH"));
        },
    );
    let _ = fs::remove_dir_all(dir);
    reset_test_state();
}

#[cfg(unix)]
#[test]
fn runtime_cli_command_spec_release_mode_uses_binary_branch() {
    let _guard = test_guard();
    let dir = make_temp_dir("runtime-cli-release-path");
    let fake_nimi = dir.join("nimi");
    write_executable(&fake_nimi, "#!/bin/sh\nexit 0\n");
    with_env(
        &[
            ("NIMI_RUNTIME_BINARY", fake_nimi.to_str()),
            ("NIMI_RUNTIME_BRIDGE_MODE", Some("RELEASE")),
        ],
        || {
            let spec = runtime_cli_command_spec(&["config", "get", "--json"]).expect("spec");
            assert_eq!(spec.program, fake_nimi.display().to_string());
            assert_eq!(spec.args[0], "config");
            assert_eq!(spec.args[1], "get");
            assert_eq!(spec.args[2], "--json");
            assert!(spec.current_dir.is_none());
        },
    );

    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn runtime_cli_command_spec_release_mode_requires_binary() {
    let _guard = test_guard();
    let dir = make_temp_dir("runtime-cli-release-missing-binary");
    with_env(
        &[
            ("PATH", dir.to_str()),
            ("NIMI_RUNTIME_BINARY", None),
            ("NIMI_RUNTIME_BRIDGE_MODE", Some("RELEASE")),
        ],
        || {
            let error = runtime_cli_command_spec(&["config", "get", "--json"])
                .err()
                .unwrap_or_default();
            assert!(error.contains("RUNTIME_BRIDGE_BUNDLED_RUNTIME_UNAVAILABLE"));
        },
    );

    let _ = fs::remove_dir_all(dir);
}
