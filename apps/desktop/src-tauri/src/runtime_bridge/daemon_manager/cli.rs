use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

use super::daemon_command::{self, runtime_cli_command_spec};
use super::{bridge_error, read_last_error, set_last_error};

pub(super) fn parse_runtime_version_payload(payload: &Value) -> Result<String, String> {
    let version = payload
        .get("nimi")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            bridge_error(
                "RUNTIME_BRIDGE_VERSION_PARSE_FAILED",
                "runtime version payload is missing `nimi`",
            )
        })?;
    Ok(version.to_string())
}

pub(super) fn probe_runtime_version(
    mode: daemon_command::RuntimeBridgeMode,
) -> Result<String, String> {
    let payload = run_runtime_cli_json_with_error_code(
        &["version", "--json"],
        None,
        "RUNTIME_BRIDGE_VERSION_PARSE_FAILED",
        "invalid runtime version output",
    )?;
    let version = parse_runtime_version_payload(&payload)?;
    if mode == daemon_command::RuntimeBridgeMode::Release {
        let expected = crate::desktop_release::current_release_version().ok_or_else(|| {
            bridge_error(
                "RUNTIME_BRIDGE_RELEASE_VERSION_UNAVAILABLE",
                "desktop release metadata is unavailable while probing bundled runtime version",
            )
        })?;
        if version != expected {
            return Err(bridge_error(
                "RUNTIME_BRIDGE_VERSION_MISMATCH",
                format!(
                    "bundled runtime reported version {version} but desktop release expects {expected}"
                )
                .as_str(),
            ));
        }
    }
    Ok(version)
}

pub(super) fn run_runtime_cli_json(
    args: &[&str],
    stdin_payload: Option<&str>,
) -> Result<Value, String> {
    run_runtime_cli_json_with_error_code(
        args,
        stdin_payload,
        "RUNTIME_BRIDGE_CONFIG_PARSE_FAILED",
        "invalid runtime config cli output",
    )
}

pub(super) fn run_runtime_cli_json_with_error_code(
    args: &[&str],
    stdin_payload: Option<&str>,
    error_code: &str,
    error_context: &str,
) -> Result<Value, String> {
    let output = run_runtime_cli(args, stdin_payload)?;
    serde_json::from_str::<Value>(output.trim())
        .map_err(|error| bridge_error(error_code, format!("{error_context}: {error}").as_str()))
}

fn run_runtime_cli(args: &[&str], stdin_payload: Option<&str>) -> Result<String, String> {
    let spec = runtime_cli_command_spec(args)?;
    let mut command = Command::new(spec.program.as_str());
    command
        .args(spec.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(current_dir) = spec.current_dir {
        command.current_dir(current_dir);
    }
    if stdin_payload.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command.spawn().map_err(|error| {
        bridge_error(
            "RUNTIME_BRIDGE_CONFIG_CLI_START_FAILED",
            format!("spawn runtime config cli failed: {error}").as_str(),
        )
    })?;

    if let Some(payload) = stdin_payload {
        let stdin = child.stdin.as_mut().ok_or_else(|| {
            bridge_error(
                "RUNTIME_BRIDGE_CONFIG_CLI_START_FAILED",
                "runtime config cli stdin is unavailable",
            )
        })?;
        stdin.write_all(payload.as_bytes()).map_err(|error| {
            bridge_error(
                "RUNTIME_BRIDGE_CONFIG_CLI_START_FAILED",
                format!("write runtime config cli stdin failed: {error}").as_str(),
            )
        })?;
    }

    let output = child.wait_with_output().map_err(|error| {
        bridge_error(
            "RUNTIME_BRIDGE_CONFIG_CLI_FAILED",
            format!("wait runtime config cli failed: {error}").as_str(),
        )
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        if stdout.is_empty() {
            return Err(bridge_error(
                "RUNTIME_BRIDGE_CONFIG_CLI_FAILED",
                "runtime config cli returned empty output",
            ));
        }
        return Ok(stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("runtime config cli exit status {}", output.status)
    };
    let error = bridge_error("RUNTIME_BRIDGE_CONFIG_CLI_FAILED", message.as_str());
    if read_last_error().is_none() {
        set_last_error(Some(error.clone()));
    }
    Err(error)
}
