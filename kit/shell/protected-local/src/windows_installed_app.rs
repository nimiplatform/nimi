use crate::generated::{
    BindLocalAppProcessRequest, EndInstalledAppRunRequest, GetInstalledAppRunAccessRequest,
    PrepareInstalledAppLaunchRequest, ReasonCode,
};
use crate::windows_supervised_process::SupervisedDevelopmentProcess;
use crate::{
    InstalledAppLaunchOutcome, InstalledAppRunAccess, NimiHostError, NimiHostErrorReasonCode,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tonic::{transport::Channel, Code, Status};

type Runs = HashMap<[u8; 32], SupervisedDevelopmentProcess>;
fn runs() -> &'static Mutex<Runs> {
    static RUNS: OnceLock<Mutex<Runs>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
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
    if prepared.reason_code != ReasonCode::ActionExecuted as i32
        || prepared.execution_profile_ref != "windows-user-mode-as-invoker-v1"
        || !prepared.arguments.is_empty()
    {
        return Err(invalid());
    }
    let id: [u8; 32] = prepared.launch_id.try_into().map_err(|_| invalid())?;
    if id == [0; 32] {
        return Err(invalid());
    }
    let deadline = timestamp_ms(prepared.bind_deadline)?;
    if now_ms()? >= deadline {
        return Err(invalid());
    }
    let executable = PathBuf::from(prepared.executable_path);
    let cwd = PathBuf::from(prepared.working_directory);
    let expected: [u8; 32] = prepared
        .executable_sha256
        .try_into()
        .map_err(|_| invalid())?;
    let result = async {
        if !executable.is_absolute()
            || executable.parent() != Some(cwd.as_path())
            || expected == [0; 32]
        {
            return Err(invalid());
        }
        let mut file = std::fs::File::open(&executable).map_err(|_| invalid())?;
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 128 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(|_| invalid())?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        if <[u8; 32]>::from(digest.finalize()) != expected {
            return Err(invalid());
        }
        drop(file);
        let mut process = SupervisedDevelopmentProcess::create_verified_installed(
            &executable,
            &prepared.arguments,
            &cwd,
        )?;
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
    if result.available && reason != ReasonCode::ActionExecuted {
        return Err(invalid());
    }
    Ok(InstalledAppRunAccess {
        available: result.available,
        reason_code: reason.as_str_name().into(),
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
    let code = if matches!(
        status.code(),
        Code::Unavailable | Code::DeadlineExceeded | Code::Cancelled
    ) {
        NimiHostErrorReasonCode::RuntimeServiceUnavailable
    } else {
        NimiHostErrorReasonCode::InstalledAppLaunchFailed
    };
    NimiHostError::new(code, false).with_reason_metadata(metadata)
}
