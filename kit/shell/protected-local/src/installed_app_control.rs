use crate::generated::{
    BindLocalAppProcessRequest, EndInstalledAppRunRequest, GetInstalledAppRunAccessRequest,
    PrepareInstalledAppLaunchRequest, ReasonCode,
};
#[cfg(target_os = "macos")]
use crate::macos_supervised_process::SupervisedDevelopmentProcess;
#[cfg(target_os = "windows")]
use crate::windows_supervised_process::SupervisedDevelopmentProcess;
use crate::{
    InstalledAppLaunchOutcome, InstalledAppRunAccess, NimiHostError, NimiHostErrorReasonCode,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tonic::{transport::Channel, Code, Status};

type Runs = HashMap<[u8; 32], SupervisedDevelopmentProcess>;
#[cfg(target_os = "windows")]
const EXECUTION_PROFILE: &str = "windows-user-mode-as-invoker-v1";
#[cfg(target_os = "macos")]
const EXECUTION_PROFILE: &str = "macos-user-mode-same-session-v1";
const MANAGED_WEB_EXECUTION_PROFILE: &str = "nimi-managed-web-v1";
const MANAGED_WEB_LAUNCH_ARGUMENT: &str = "--nimi-managed-web-app";
const MANAGED_WEB_PAYLOAD_DIGEST_PREFIX: &str = "--nimi-payload-digest=";
fn runs() -> &'static Mutex<Runs> {
    static RUNS: OnceLock<Mutex<Runs>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

// Dropping an in-flight native launch cancels its RPC and releases any known
// lease. The suspended child guard drops before this guard and terminates it.
struct PendingLease {
    channel: Channel,
    id: [u8; 32],
    active: bool,
}
impl Drop for PendingLease {
    fn drop(&mut self) {
        if self.active {
            let channel = self.channel.clone();
            let id = self.id;
            tokio::spawn(async move {
                let _ = end(channel, id).await;
            });
        }
    }
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
pub(crate) async fn launch(
    channel: Channel,
    selector: Vec<u8>,
) -> Result<InstalledAppLaunchOutcome, NimiHostError> {
    if selector.is_empty() || selector.len() > 160 {
        return Err(invalid());
    }
    let prepared = crate::grpc_limits::runtime_app_client(channel.clone())
        .prepare_installed_app_launch(request(
            PrepareInstalledAppLaunchRequest {
                launch_selector: selector,
            },
            30,
        ))
        .await
        .map_err(runtime_error)?
        .into_inner();
    let is_managed_web = prepared.execution_profile_ref == MANAGED_WEB_EXECUTION_PROFILE;
    if prepared.reason_code != ReasonCode::ActionExecuted as i32
        || (!is_managed_web && prepared.execution_profile_ref != EXECUTION_PROFILE)
        || (!is_managed_web && !prepared.arguments.is_empty())
    {
        return Err(invalid());
    }
    let id: [u8; 32] = prepared.launch_id.try_into().map_err(|_| invalid())?;
    if id == [0; 32] {
        return Err(invalid());
    }
    let mut lease = PendingLease {
        channel: channel.clone(),
        id,
        active: true,
    };
    let deadline = timestamp_ms(prepared.bind_deadline)?;
    if now_ms()? >= deadline {
        return Err(invalid());
    }
    let host_storage = prepared.host_storage;
    let executable = PathBuf::from(prepared.executable_path);
    let cwd = PathBuf::from(prepared.working_directory);
    let expected: [u8; 32] = prepared
        .executable_sha256
        .try_into()
        .map_err(|_| invalid())?;
    let result = async {
        if expected == [0; 32] {
            return Err(invalid());
        }
        let profile = crate::host_profile::prepare(host_storage)?;
        let mut process = if is_managed_web {
            validate_managed_web_installed_launch(&executable, &prepared.arguments, &cwd)?;
            SupervisedDevelopmentProcess::create_verified_managed_web(
                &executable,
                &prepared.arguments,
                &cwd,
                &profile,
            )?
        } else {
            if !executable.is_absolute() || executable.parent() != Some(cwd.as_path()) {
                return Err(invalid());
            }
            // Runtime checks the committed Host before preparation and independently
            // hashes the actual suspended child image during bind. Rehashing here
            // would neither pin the file nor add a stronger process identity.
            // Arguments stay empty; the standard shell reads its profile from the
            // child environment before any Electron session exists.
            SupervisedDevelopmentProcess::create_verified_installed(
                &executable,
                &prepared.arguments,
                &cwd,
                &profile,
            )?
        };
        let bound = crate::grpc_limits::runtime_app_client(channel.clone())
            .bind_local_app_process(request(
                BindLocalAppProcessRequest {
                    launch_id: id.to_vec(),
                    child_process_id: process.id(),
                },
                20,
            ))
            .await
            .map_err(runtime_error)?
            .into_inner();
        if bound.reason_code != ReasonCode::ActionExecuted as i32 || bound.launch_id != id {
            return Err(invalid());
        }
        let bound_deadline = timestamp_ms(bound.bind_deadline)?;
        if now_ms()? >= bound_deadline || bound_deadline > deadline {
            return Err(invalid());
        }
        process.resume()?;
        let process_id = process.id();
        let mut live = runs().lock().map_err(|_| invalid())?;
        if live.contains_key(&id) {
            return Err(invalid());
        }
        live.insert(id, process);
        Ok(InstalledAppLaunchOutcome {
            launch_id: id,
            process_id,
            app_id: prepared.app_id,
            version: prepared.version,
        })
    }
    .await;
    if result.is_err() {
        // The process guard has terminated/waited/closed any suspended child
        // before releasing the pending Runtime lease.
        let _ = end(channel, id).await;
    }
    lease.active = false;
    result
}

pub fn installed_app_process_status(id: [u8; 32]) -> Result<(bool, Option<u32>), NimiHostError> {
    if id == [0; 32] {
        return Err(invalid());
    }
    let live = runs().lock().map_err(|_| invalid())?;
    let Some(process) = live.get(&id) else {
        return Ok((false, None));
    };
    let code = process.exit_code()?;
    Ok((code.is_none(), code))
}

pub fn focus_installed_app_process(id: [u8; 32]) -> Result<(), NimiHostError> {
    let live = runs().lock().map_err(|_| invalid())?;
    live.get(&id).ok_or_else(invalid)?.focus()
}

pub fn stop_installed_app_process(id: [u8; 32]) -> Result<(), NimiHostError> {
    if id == [0; 32] {
        return Err(invalid());
    }
    let mut live = runs().lock().map_err(|_| invalid())?;
    if let Some(process) = live.get_mut(&id) {
        process.terminate()?;
    }
    live.remove(&id);
    Ok(())
}

pub(crate) async fn end(channel: Channel, id: [u8; 32]) -> Result<(), NimiHostError> {
    let result = crate::grpc_limits::runtime_app_client(channel)
        .end_installed_app_run(request(
            EndInstalledAppRunRequest {
                launch_id: id.to_vec(),
            },
            6,
        ))
        .await
        .map_err(runtime_error)?
        .into_inner();
    if result.reason_code != ReasonCode::ActionExecuted as i32 {
        return Err(invalid());
    }
    Ok(())
}

pub(crate) async fn complete_uninstall(
    channel: Channel,
    job_id: Vec<u8>,
    selector: Vec<u8>,
) -> Result<(), NimiHostError> {
    if job_id.is_empty() || job_id.len() > 160 || selector.is_empty() || selector.len() > 160 {
        return Err(invalid());
    }
    let result = crate::grpc_limits::runtime_app_client(channel)
        .complete_app_package_uninstall(request(
            crate::generated::CompleteAppPackageUninstallRequest {
                job_id: job_id.clone(),
                launch_selector: selector,
            },
            30,
        ))
        .await
        .map_err(runtime_error)?
        .into_inner();
    let job = result.job.ok_or_else(invalid)?;
    if result.reason_code != ReasonCode::ActionExecuted as i32
        || job.job_id != job_id
        || job.phase != crate::generated::AppPackageJobPhase::Completed as i32
    {
        return Err(invalid());
    }
    Ok(())
}

pub(crate) async fn access(
    channel: Channel,
    id: [u8; 32],
) -> Result<InstalledAppRunAccess, NimiHostError> {
    let result = crate::grpc_limits::runtime_app_client(channel)
        .get_installed_app_run_access(request(
            GetInstalledAppRunAccessRequest {
                launch_id: id.to_vec(),
            },
            2,
        ))
        .await
        .map_err(runtime_error)?
        .into_inner();
    let reason = ReasonCode::try_from(result.reason_code).map_err(|_| invalid())?;
    if result.available {
        let suffix = result
            .execution_scope_ref
            .strip_prefix("execution_scope_")
            .ok_or_else(invalid)?;
        if reason != ReasonCode::ActionExecuted
            || suffix.len() != 43
            || !suffix
                .bytes()
                .all(|v| v.is_ascii_alphanumeric() || v == b'_' || v == b'-')
        {
            return Err(invalid());
        }
    } else if !result.execution_scope_ref.is_empty() {
        return Err(invalid());
    }
    Ok(InstalledAppRunAccess {
        available: result.available,
        reason_code: reason.as_str_name().into(),
        execution_scope_ref: result.execution_scope_ref,
    })
}

fn now_ms() -> Result<i64, NimiHostError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| invalid())?
        .as_millis()
        .try_into()
        .map_err(|_| invalid())
}
fn timestamp_ms(value: Option<prost_types::Timestamp>) -> Result<i64, NimiHostError> {
    let value = value.ok_or_else(invalid)?;
    if value.seconds <= 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err(invalid());
    }
    value
        .seconds
        .checked_mul(1000)
        .and_then(|ms| ms.checked_add(i64::from(value.nanos / 1_000_000)))
        .ok_or_else(invalid)
}
fn invalid() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::InstalledAppLaunchFailed, false)
}

pub(crate) fn valid_managed_web_payload_digest_arg(value: &str) -> bool {
    let Some(digest) = value.strip_prefix(MANAGED_WEB_PAYLOAD_DIGEST_PREFIX) else {
        return false;
    };
    let Some(hex) = digest.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn validate_managed_web_installed_launch(
    executable: &std::path::Path,
    arguments: &[String],
    cwd: &std::path::Path,
) -> Result<(), NimiHostError> {
    if !executable.is_absolute() || !cwd.is_absolute() || !cwd.is_dir() {
        return Err(invalid());
    }
    let canonical_exe = std::fs::canonicalize(executable).map_err(|_| invalid())?;
    if !canonical_exe.is_file() {
        return Err(invalid());
    }
    #[cfg(all(target_os = "windows", not(feature = "windows-source-local-development")))]
    {
        if arguments.len() != 2
            || arguments[0] != MANAGED_WEB_LAUNCH_ARGUMENT
            || !valid_managed_web_payload_digest_arg(&arguments[1])
        {
            return Err(invalid());
        }
        let current_exe = std::env::current_exe()
            .and_then(std::fs::canonicalize)
            .map_err(|_| invalid())?;
        let expected_carrier = current_exe
            .parent()
            .ok_or_else(invalid)?
            .join("NimiAppHost.exe");
        let canonical_expected = std::fs::canonicalize(&expected_carrier).map_err(|_| invalid())?;
        if canonical_exe != canonical_expected || canonical_exe == current_exe {
            return Err(invalid());
        }
        return Ok(());
    }
    #[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
    {
        if arguments.len() != 3
            || arguments[1] != MANAGED_WEB_LAUNCH_ARGUMENT
            || !valid_managed_web_payload_digest_arg(&arguments[2])
        {
            return Err(invalid());
        }
        let entry_path = std::fs::canonicalize(std::path::Path::new(&arguments[0]))
            .map_err(|_| invalid())?;
        if !entry_path.is_file() {
            return Err(invalid());
        }
        let repo_root = entry_path
            .parent()
            .filter(|p| p.file_name() == Some(std::ffi::OsStr::new("dist-electron")))
            .and_then(|p| p.parent())
            .filter(|p| p.file_name() == Some(std::ffi::OsStr::new("desktop")))
            .and_then(|p| p.parent())
            .filter(|p| p.file_name() == Some(std::ffi::OsStr::new("apps")))
            .and_then(|p| p.parent())
            .ok_or_else(invalid)?;
        if entry_path.file_name() != Some(std::ffi::OsStr::new("managed-web-carrier.js")) {
            return Err(invalid());
        }
        let expected_carrier = repo_root
            .join(".nimi")
            .join("local")
            .join("dev-carrier")
            .join("win32-x64")
            .join("NimiAppHost.exe");
        let canonical_expected = std::fs::canonicalize(&expected_carrier).map_err(|_| invalid())?;
        let current_exe = std::env::current_exe()
            .and_then(std::fs::canonicalize)
            .map_err(|_| invalid())?;
        if canonical_exe != canonical_expected || canonical_exe == current_exe {
            return Err(invalid());
        }
        return Ok(());
    }
    #[cfg(all(target_os = "macos", not(feature = "macos-source-local-development")))]
    {
        if arguments.len() != 2
            || arguments[0] != MANAGED_WEB_LAUNCH_ARGUMENT
            || !valid_managed_web_payload_digest_arg(&arguments[1])
        {
            return Err(invalid());
        }
        let expected_carrier =
            std::path::Path::new(crate::macos_supervised_process::MACOS_LOCAL_APP_HOST_PATH);
        let canonical_expected = std::fs::canonicalize(expected_carrier).map_err(|_| invalid())?;
        if executable != expected_carrier || canonical_exe != canonical_expected {
            return Err(invalid());
        }
        return Ok(());
    }
    #[cfg(all(target_os = "macos", feature = "macos-source-local-development"))]
    {
        if arguments.len() != 3
            || arguments[1] != MANAGED_WEB_LAUNCH_ARGUMENT
            || !valid_managed_web_payload_digest_arg(&arguments[2])
        {
            return Err(invalid());
        }
        let entry_path = std::fs::canonicalize(std::path::Path::new(&arguments[0]))
            .map_err(|_| invalid())?;
        if !entry_path.is_file() || entry_path.file_name() != Some(std::ffi::OsStr::new("main.mjs"))
        {
            return Err(invalid());
        }
        let repo_root = entry_path
            .parent()
            .filter(|p| p.file_name() == Some(std::ffi::OsStr::new("local-app-host")))
            .and_then(|p| p.parent())
            .filter(|p| p.file_name() == Some(std::ffi::OsStr::new("macos")))
            .and_then(|p| p.parent())
            .filter(|p| p.file_name() == Some(std::ffi::OsStr::new("desktop")))
            .and_then(|p| p.parent())
            .filter(|p| p.file_name() == Some(std::ffi::OsStr::new("apps")))
            .and_then(|p| p.parent())
            .ok_or_else(invalid)?;
        let expected_carrier = repo_root
            .join(".nimi")
            .join("local")
            .join("dev-carrier")
            .join("Nimi Local App Host Dev.app")
            .join("Contents")
            .join("MacOS")
            .join("Electron");
        let canonical_expected = std::fs::canonicalize(&expected_carrier).map_err(|_| invalid())?;
        if canonical_exe != canonical_expected {
            return Err(invalid());
        }
        if let Some(home_exe) =
            std::env::var_os("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE")
        {
            if let Ok(canonical_home) = std::fs::canonicalize(home_exe) {
                if canonical_home == canonical_exe {
                    return Err(invalid());
                }
            }
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err(invalid())
}
fn request<T>(message: T, timeout_seconds: u64) -> tonic::Request<T> {
    let mut request = tonic::Request::new(message);
    request.set_timeout(Duration::from_secs(timeout_seconds));
    request
}
fn runtime_error(status: Status) -> NimiHostError {
    let mut metadata = crate::grpc_status::desktop_runtime_reason_metadata(&status);
    if let Some(reason) = crate::grpc_status::runtime_reason(&status) {
        metadata.insert("runtime_reason_code".into(), reason);
    }
    let code = if status.code() == Code::Unavailable {
        NimiHostErrorReasonCode::RuntimeServiceUnavailable
    } else {
        NimiHostErrorReasonCode::InstalledAppLaunchFailed
    };
    NimiHostError::new(code, false).with_reason_metadata(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_deadline_or_cancellation_does_not_invalidate_healthy_runtime_transport() {
        for status in [
            Status::deadline_exceeded("package verification timed out"),
            Status::cancelled("launch canceled"),
        ] {
            assert_eq!(
                runtime_error(status).reason_code(),
                NimiHostErrorReasonCode::InstalledAppLaunchFailed
            );
        }
        assert_eq!(
            runtime_error(Status::unavailable("pipe disconnected")).reason_code(),
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        );
    }

    #[test]
    fn managed_web_payload_digest_arg_requires_lowercase_sha256() {
        let valid = format!("--nimi-payload-digest=sha256:{}", "a".repeat(64));
        assert!(valid_managed_web_payload_digest_arg(&valid));
        assert!(!valid_managed_web_payload_digest_arg(&format!(
            "--nimi-payload-digest=sha256:{}",
            "A".repeat(64)
        )));
        assert!(!valid_managed_web_payload_digest_arg(&format!(
            "--nimi-payload-digest=sha256:{}",
            "a".repeat(63)
        )));
        assert!(!valid_managed_web_payload_digest_arg(
            "--nimi-managed-web-app"
        ));
    }
}
