use std::path::{Path, PathBuf};

use super::{
    bridge_error, read_non_empty_env, runtime_binary, DEFAULT_RUNTIME_BRIDGE_MODE,
    RUNTIME_BRIDGE_MODE_ENV,
};
use crate::runtime_bridge::runtime_last_error_hook;

#[derive(Debug, Clone)]
pub(super) struct RuntimeCliCommandSpec {
    pub(super) program: String,
    pub(super) args: Vec<String>,
    pub(super) current_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RuntimeBridgeMode {
    Runtime,
    Release,
}

fn runtime_dev_root_dir() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime");
        if root.exists() {
            return Some(root);
        }
    }

    #[cfg(not(debug_assertions))]
    {
        return None;
    }

    None
}

fn is_executable_available(name: &str) -> bool {
    if name.contains(std::path::MAIN_SEPARATOR) || name.contains('/') || name.contains('\\') {
        return Path::new(name).exists();
    }

    let Some(raw_path) = std::env::var_os("PATH") else {
        return false;
    };

    for dir in std::env::split_paths(&raw_path) {
        let candidate = dir.join(name);
        if candidate.exists() {
            return true;
        }

        #[cfg(windows)]
        {
            const WINDOWS_EXTENSIONS: [&str; 4] = [".exe", ".cmd", ".bat", ".com"];
            for extension in WINDOWS_EXTENSIONS {
                let candidate = dir.join(format!("{name}{extension}"));
                if candidate.exists() {
                    return true;
                }
            }
        }
    }

    false
}

pub(super) fn runtime_bridge_mode_label(mode: RuntimeBridgeMode) -> &'static str {
    match mode {
        RuntimeBridgeMode::Runtime => "RUNTIME",
        RuntimeBridgeMode::Release => "RELEASE",
    }
}

fn parse_runtime_bridge_mode(raw: &str) -> Option<RuntimeBridgeMode> {
    let normalized = raw.trim().to_ascii_uppercase();
    match normalized.as_str() {
        "RUNTIME" => Some(RuntimeBridgeMode::Runtime),
        "RELEASE" => Some(RuntimeBridgeMode::Release),
        _ => None,
    }
}

fn runtime_bridge_mode() -> Result<RuntimeBridgeMode, String> {
    let raw = read_non_empty_env(RUNTIME_BRIDGE_MODE_ENV)
        .unwrap_or_else(|| DEFAULT_RUNTIME_BRIDGE_MODE.to_string());
    parse_runtime_bridge_mode(raw.as_str()).ok_or_else(|| {
        bridge_error(
            "RUNTIME_BRIDGE_MODE_INVALID",
            format!(
                "{} must be RUNTIME or RELEASE, received: {}",
                RUNTIME_BRIDGE_MODE_ENV, raw
            )
            .as_str(),
        )
    })
}

pub(super) fn runtime_bridge_mode_for_status() -> (RuntimeBridgeMode, Option<String>) {
    match runtime_bridge_mode() {
        Ok(mode) => (mode, None),
        Err(error) => (RuntimeBridgeMode::Release, Some(error)),
    }
}

pub(super) fn runtime_bridge_availability_error() -> Option<String> {
    let mode = match runtime_bridge_mode() {
        Ok(value) => value,
        Err(error) => return Some(error),
    };
    match mode {
        RuntimeBridgeMode::Runtime => {
            if !is_executable_available("go") {
                return Some(bridge_error(
                    "RUNTIME_BRIDGE_RUNTIME_GO_NOT_FOUND",
                    "runtime mode requires `go` in PATH",
                ));
            }
            if runtime_dev_root_dir().is_none() {
                return Some(bridge_error(
                    "RUNTIME_BRIDGE_RUNTIME_ROOT_NOT_FOUND",
                    "runtime mode requires ./runtime directory in workspace",
                ));
            }
            None
        }
        RuntimeBridgeMode::Release => {
            let binary = runtime_binary();
            if binary.trim().is_empty() {
                return Some(runtime_last_error_hook().unwrap_or_else(|| {
                    bridge_error(
                        "RUNTIME_BRIDGE_BUNDLED_RUNTIME_UNAVAILABLE",
                        "release mode requires a bundled runtime staged under ~/.nimi/runtime",
                    )
                }));
            }
            if !is_executable_available(binary.as_str()) {
                return Some(bridge_error(
                    "RUNTIME_BRIDGE_BUNDLED_RUNTIME_MISSING",
                    format!("bundled runtime binary is missing: {binary}").as_str(),
                ));
            }
            None
        }
    }
}

pub(super) fn runtime_cli_command_spec(args: &[&str]) -> Result<RuntimeCliCommandSpec, String> {
    let mode = runtime_bridge_mode()?;
    match mode {
        RuntimeBridgeMode::Runtime => {
            if !is_executable_available("go") {
                return Err(bridge_error(
                    "RUNTIME_BRIDGE_RUNTIME_GO_NOT_FOUND",
                    "runtime mode requires `go` in PATH",
                ));
            }
            let runtime_dir = runtime_dev_root_dir().ok_or_else(|| {
                bridge_error(
                    "RUNTIME_BRIDGE_RUNTIME_ROOT_NOT_FOUND",
                    "runtime mode requires ./runtime directory in workspace",
                )
            })?;
            let mut resolved_args = vec!["run".to_string(), "./cmd/nimi".to_string()];
            resolved_args.extend(args.iter().map(|value| (*value).to_string()));
            Ok(RuntimeCliCommandSpec {
                program: "go".to_string(),
                args: resolved_args,
                current_dir: Some(runtime_dir),
            })
        }
        RuntimeBridgeMode::Release => {
            let binary = runtime_binary();
            if binary.trim().is_empty() {
                return Err(bridge_error(
                    "RUNTIME_BRIDGE_BUNDLED_RUNTIME_UNAVAILABLE",
                    runtime_last_error_hook()
                        .unwrap_or_else(|| {
                            "release mode requires a bundled runtime staged under ~/.nimi/runtime"
                                .to_string()
                        })
                        .as_str(),
                ));
            }
            if !is_executable_available(binary.as_str()) {
                return Err(bridge_error(
                    "RUNTIME_BRIDGE_BUNDLED_RUNTIME_MISSING",
                    format!("bundled runtime binary is missing: {binary}").as_str(),
                ));
            }
            Ok(RuntimeCliCommandSpec {
                program: binary,
                args: args.iter().map(|value| (*value).to_string()).collect(),
                current_dir: None,
            })
        }
    }
}
