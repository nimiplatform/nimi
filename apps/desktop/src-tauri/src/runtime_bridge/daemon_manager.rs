use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use super::channel_pool::invalidate_channel;
use super::error_map::bridge_error;
mod cli;
mod daemon_command;
mod helpers;
#[cfg(test)]
mod tests;
use cli::{probe_runtime_version, run_runtime_cli_json};
use daemon_command::{
    runtime_bridge_availability_error, runtime_bridge_mode_for_status, runtime_bridge_mode_label,
    runtime_cli_command_spec,
};
pub(crate) use helpers::grpc_addr;
#[cfg(test)]
pub(crate) use helpers::runtime_config_path;
use helpers::{probe_running, read_non_empty_env, wait_until_running};

const DEFAULT_GRPC_ADDR: &str = "127.0.0.1:46371";
const DEFAULT_RUNTIME_BRIDGE_MODE: &str = "RELEASE";
const RUNTIME_BRIDGE_MODE_ENV: &str = "NIMI_RUNTIME_BRIDGE_MODE";

static DAEMON_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static DAEMON_LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static DAEMON_DEBUG_LOG_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn daemon_debug_log_path_store() -> &'static Mutex<Option<String>> {
    DAEMON_DEBUG_LOG_PATH.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDaemonStatus {
    pub running: bool,
    pub managed: bool,
    pub launch_mode: String,
    pub grpc_addr: String,
    pub pid: Option<u32>,
    pub version: Option<String>,
    pub last_error: Option<String>,
    pub debug_log_path: Option<String>,
}

fn daemon_child() -> &'static Mutex<Option<Child>> {
    DAEMON_CHILD.get_or_init(|| Mutex::new(None))
}

fn daemon_last_error() -> &'static Mutex<Option<String>> {
    DAEMON_LAST_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_last_error(value: Option<String>) {
    let mut guard = daemon_last_error()
        .lock()
        .expect("runtime daemon last-error lock poisoned");
    *guard = value;
}

fn read_last_error() -> Option<String> {
    daemon_last_error()
        .lock()
        .expect("runtime daemon last-error lock poisoned")
        .clone()
}

fn runtime_binary() -> String {
    runtime_binary_test_override()
        .or_else(|| {
            crate::desktop_release::staged_runtime_binary_path()
                .map(|path| path.display().to_string())
        })
        .unwrap_or_default()
}

#[cfg(test)]
fn runtime_binary_test_override() -> Option<String> {
    std::env::var("NIMI_RUNTIME_BINARY")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[cfg(not(test))]
fn runtime_binary_test_override() -> Option<String> {
    None
}

pub fn status() -> RuntimeBridgeDaemonStatus {
    let mut pid = None;
    let managed = {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                    false
                }
                Ok(None) => {
                    pid = Some(child.id());
                    true
                }
                Err(_) => {
                    pid = Some(child.id());
                    true
                }
            }
        } else {
            false
        }
    };

    let (mode, mode_error) = runtime_bridge_mode_for_status();
    let has_mode_error = mode_error.is_some();
    let addr = grpc_addr();
    let running = probe_running(addr.as_str());
    let mut last_error = read_last_error();
    if let Some(error) = mode_error {
        last_error = Some(error);
    } else if !running && last_error.is_none() {
        last_error = runtime_bridge_availability_error();
    }
    if running && last_error.is_some() && !has_mode_error {
        set_last_error(None);
        last_error = None;
    }

    let version = match probe_runtime_version(mode) {
        Ok(value) => Some(value),
        Err(error) => {
            last_error = Some(error);
            None
        }
    };

    RuntimeBridgeDaemonStatus {
        running,
        managed,
        launch_mode: runtime_bridge_mode_label(mode).to_string(),
        grpc_addr: addr,
        pid,
        version,
        last_error,
        debug_log_path: daemon_debug_log_path_store()
            .lock()
            .expect("debug log path lock poisoned")
            .clone(),
    }
}

fn debug_log_path() -> Option<PathBuf> {
    if read_non_empty_env("NIMI_RUNTIME_BRIDGE_DEBUG").as_deref() != Some("1") {
        return None;
    }
    Some(std::env::temp_dir().join(format!("nimi-daemon-{}.log", std::process::id())))
}

pub fn start() -> Result<RuntimeBridgeDaemonStatus, String> {
    let current = status();
    if current.running {
        set_last_error(None);
        return Ok(current);
    }

    let grpc = grpc_addr();
    let spec = runtime_cli_command_spec(&["serve"]).inspect_err(|error| {
        set_last_error(Some(error.clone()));
    })?;
    let mut command = Command::new(spec.program.as_str());
    command.args(spec.args);
    if let Some(current_dir) = spec.current_dir {
        command.current_dir(current_dir);
    }
    let log_path = debug_log_path();
    if let Some(ref path) = log_path {
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| bridge_error("RUNTIME_BRIDGE_DAEMON_LOG_OPEN_FAILED", &e.to_string()))?;
        let stderr_file = log_file
            .try_clone()
            .map_err(|e| bridge_error("RUNTIME_BRIDGE_DAEMON_LOG_CLONE_FAILED", &e.to_string()))?;
        command
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(stderr_file))
            .stdin(Stdio::null());
    } else {
        command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
    }

    let child = command.spawn().map_err(|error| {
        let message = error.to_string();
        set_last_error(Some(message.clone()));
        bridge_error("RUNTIME_BRIDGE_DAEMON_START_FAILED", message.as_str())
    })?;

    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        *guard = Some(child);
    }
    {
        let mut guard = daemon_debug_log_path_store()
            .lock()
            .expect("debug log path lock poisoned");
        *guard = log_path
            .as_ref()
            .and_then(|p| p.to_str().map(|s| s.to_string()));
    }
    invalidate_channel();

    let ready = wait_until_running(grpc.as_str());
    if ready {
        set_last_error(None);
        return Ok(status());
    }

    let message = format!("runtime daemon did not become ready at {}", grpc);
    set_last_error(Some(message.clone()));

    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }

    Err(bridge_error(
        "RUNTIME_BRIDGE_DAEMON_START_TIMEOUT",
        message.as_str(),
    ))
}

pub fn stop() -> Result<RuntimeBridgeDaemonStatus, String> {
    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
    invalidate_channel();
    set_last_error(None);

    Ok(status())
}

pub fn restart() -> Result<RuntimeBridgeDaemonStatus, String> {
    let _ = stop()?;
    start()
}

pub fn config_get() -> Result<Value, String> {
    run_runtime_cli_json(&["config", "get", "--json"], None)
}

pub fn config_set(payload: &str) -> Result<Value, String> {
    run_runtime_cli_json(&["config", "set", "--stdin", "--json"], Some(payload))
}
