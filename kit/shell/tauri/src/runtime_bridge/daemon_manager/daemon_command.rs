use std::path::{Path, PathBuf};
#[cfg(not(test))]
use std::sync::{Mutex, OnceLock};
use std::{fs, process::Command};

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

#[cfg(not(test))]
static RUNTIME_DEV_BINARY: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[cfg(not(test))]
fn runtime_dev_binary_cache() -> &'static Mutex<Option<PathBuf>> {
    RUNTIME_DEV_BINARY.get_or_init(|| Mutex::new(None))
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

fn runtime_dev_binary_path(runtime_dir: &Path) -> Result<PathBuf, String> {
    let repo_root = runtime_dir.parent().ok_or_else(|| {
        bridge_error(
            "RUNTIME_BRIDGE_RUNTIME_ROOT_INVALID",
            format!("runtime root has no parent: {}", runtime_dir.display()).as_str(),
        )
    })?;
    let binary_name = if cfg!(windows) {
        "nimi-dev.exe"
    } else {
        "nimi-dev"
    };
    Ok(repo_root.join("dist").join(binary_name))
}

fn build_runtime_dev_binary(runtime_dir: &Path, binary_path: &Path) -> Result<(), String> {
    let parent = binary_path.parent().ok_or_else(|| {
        bridge_error(
            "RUNTIME_BRIDGE_RUNTIME_BUILD_PATH_INVALID",
            format!(
                "runtime dev binary has no parent: {}",
                binary_path.display()
            )
            .as_str(),
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        bridge_error(
            "RUNTIME_BRIDGE_RUNTIME_BUILD_DIR_FAILED",
            format!(
                "create runtime dev binary dir {} failed: {error}",
                parent.display()
            )
            .as_str(),
        )
    })?;

    let output = Command::new("go")
        .args(["build", "-o"])
        .arg(binary_path)
        .arg("./cmd/nimi")
        .current_dir(runtime_dir)
        .output()
        .map_err(|error| {
            bridge_error(
                "RUNTIME_BRIDGE_RUNTIME_BUILD_START_FAILED",
                format!("spawn runtime dev build failed: {error}").as_str(),
            )
        })?;

    if output.status.success() && binary_path.exists() {
        sign_runtime_dev_binary(binary_path)?;
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else if output.status.success() {
        format!(
            "go build did not create runtime dev binary {}",
            binary_path.display()
        )
    } else {
        format!("go build exit status {}", output.status)
    };
    Err(bridge_error(
        "RUNTIME_BRIDGE_RUNTIME_BUILD_FAILED",
        message.as_str(),
    ))
}

#[cfg(windows)]
fn sign_runtime_dev_binary(binary_path: &Path) -> Result<(), String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BinaryPath = $env:NIMI_RUNTIME_DEV_SIGN_BINARY_PATH
if ([string]::IsNullOrWhiteSpace($BinaryPath)) {
  throw 'NIMI_RUNTIME_DEV_SIGN_BINARY_PATH is required'
}
$Subject = 'CN=Nimi Local Development Code Signing'
$Cert = Get-ChildItem Cert:\CurrentUser\My\ -CodeSigningCert |
  Where-Object { $_.Subject -eq $Subject -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1
if (-not $Cert) {
  $Cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(2)
}
foreach ($StorePath in @('Cert:\CurrentUser\Root', 'Cert:\CurrentUser\TrustedPublisher')) {
  $Existing = Get-ChildItem $StorePath -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Cert.Thumbprint } |
    Select-Object -First 1
  if (-not $Existing) {
    $CertPath = Join-Path $env:TEMP "nimi-dev-code-signing-$($Cert.Thumbprint).cer"
    try {
      Export-Certificate -Cert $Cert -FilePath $CertPath -Force | Out-Null
      Import-Certificate -FilePath $CertPath -CertStoreLocation $StorePath | Out-Null
    } finally {
      Remove-Item -LiteralPath $CertPath -Force -ErrorAction SilentlyContinue
    }
  }
}
$LastError = $null
for ($Attempt = 1; $Attempt -le 12; $Attempt++) {
  try {
    $Signature = Set-AuthenticodeSignature -FilePath $BinaryPath -Certificate $Cert -HashAlgorithm SHA256
    if ($Signature.Status -ne 'Valid') {
      throw "Set-AuthenticodeSignature failed: $($Signature.Status) $($Signature.StatusMessage)"
    }
    return
  } catch {
    $LastError = $_
    Start-Sleep -Milliseconds 250
  }
}
if ($null -ne $LastError) {
  [Console]::Error.WriteLine($LastError.Exception.Message)
}
exit 1
"#;
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-OutputFormat",
            "Text",
            "-Command",
            script,
        ])
        .env("NIMI_RUNTIME_DEV_SIGN_BINARY_PATH", binary_path)
        .output()
        .map_err(|error| {
            bridge_error(
                "RUNTIME_BRIDGE_RUNTIME_SIGN_START_FAILED",
                format!("spawn runtime dev signing failed: {error}").as_str(),
            )
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("powershell exit status {}", output.status)
    };
    Err(bridge_error(
        "RUNTIME_BRIDGE_RUNTIME_SIGN_FAILED",
        message.as_str(),
    ))
}

#[cfg(not(windows))]
fn sign_runtime_dev_binary(_binary_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(test))]
fn materialize_runtime_dev_binary(runtime_dir: &Path) -> Result<PathBuf, String> {
    {
        let guard = runtime_dev_binary_cache()
            .lock()
            .expect("runtime dev binary cache lock poisoned");
        if let Some(path) = guard.as_ref().filter(|path| path.exists()) {
            return Ok(path.clone());
        }
    }

    let binary_path = runtime_dev_binary_path(runtime_dir)?;
    build_runtime_dev_binary(runtime_dir, &binary_path)?;
    let mut guard = runtime_dev_binary_cache()
        .lock()
        .expect("runtime dev binary cache lock poisoned");
    *guard = Some(binary_path.clone());
    Ok(binary_path)
}

#[cfg(test)]
fn materialize_runtime_dev_binary(runtime_dir: &Path) -> Result<PathBuf, String> {
    let binary_path = runtime_dev_binary_path(runtime_dir)?;
    build_runtime_dev_binary(runtime_dir, &binary_path)?;
    Ok(binary_path)
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
            let binary = materialize_runtime_dev_binary(runtime_dir.as_path())?;
            Ok(RuntimeCliCommandSpec {
                program: binary.display().to_string(),
                args: args.iter().map(|value| (*value).to_string()).collect(),
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
