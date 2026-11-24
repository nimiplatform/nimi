use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use base64::Engine;
use napi_derive::napi;
use nimi_shell_protected_local::harness_security::{
    kill_job_process, run_job_process, secure_delete_file, secure_read_file, secure_write_file,
    spawn_job_process, verify_workspace_path, wait_job_process, HarnessJobProcessRequest,
    HarnessJobProcessResult, HarnessRunningJob, HarnessSecureDeleteRequest,
    HarnessSecureWriteRequest, HarnessSecurityError,
};
use serde_json::{json, Value as JsonValue};
use tokio::sync::Mutex;

use super::{
    NativeHarnessJobKillInput, NativeHarnessJobProcessInput, NativeHarnessJobWaitInput,
    NativeHarnessSecureDeleteInput, NativeHarnessSecureReadInput, NativeHarnessSecureWriteInput,
    NativeHarnessVerifyPathInput, NativeJsonOutcome,
};

const MAX_ACTIVE_HARNESS_JOBS: usize = 32;
static HARNESS_JOBS: OnceLock<Mutex<HashMap<String, Arc<HarnessRunningJob>>>> = OnceLock::new();
static HARNESS_JOB_COUNTER: AtomicU64 = AtomicU64::new(1);

fn harness_jobs() -> &'static Mutex<HashMap<String, Arc<HarnessRunningJob>>> {
    HARNESS_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn security_error_outcome(error: HarnessSecurityError) -> NativeJsonOutcome {
    NativeJsonOutcome {
        status: "error".to_string(),
        value: None,
        reason_code: Some(error.reason_code().to_string()),
        retryable: Some(false),
        reason_metadata: Some(json!({ "detail": error.detail() })),
    }
}

fn parse_env_map(env: Option<JsonValue>) -> Result<BTreeMap<String, String>, HarnessSecurityError> {
    let mut out = BTreeMap::new();
    let Some(value) = env else {
        return Ok(out);
    };
    let Some(map) = value.as_object() else {
        return Err(HarnessSecurityError::new(
            "invalid-env",
            "env must be a flat string-to-string object",
        ));
    };
    for (k, v) in map {
        let Some(s) = v.as_str() else {
            return Err(HarnessSecurityError::new(
                "invalid-env",
                format!("env value for '{k}' must be a string"),
            ));
        };
        out.insert(k.clone(), s.to_string());
    }
    Ok(out)
}

fn project_job_result(result: HarnessJobProcessResult) -> JsonValue {
    let b64 = base64::engine::general_purpose::STANDARD;
    json!({
        "pid": result.pid,
        "exitCode": result.exit_code,
        "timedOut": result.timed_out,
        "killed": result.killed,
        "stdoutBase64": b64.encode(&result.stdout),
        "stderrBase64": b64.encode(&result.stderr),
        "stdoutUtf8": String::from_utf8_lossy(&result.stdout),
        "stderrUtf8": String::from_utf8_lossy(&result.stderr),
        "stdoutTruncated": result.stdout_truncated,
        "stderrTruncated": result.stderr_truncated,
        "activeProcessesRemaining": result.active_processes_remaining,
    })
}

#[napi(js_name = "harnessRunJobProcess")]
pub async fn harness_run_job_process(input: NativeHarnessJobProcessInput) -> NativeJsonOutcome {
    let env = match parse_env_map(input.env) {
        Ok(env) => env,
        Err(err) => return security_error_outcome(err),
    };
    let request = HarnessJobProcessRequest {
        executable: input.executable,
        args: input.args,
        working_directory: input.working_directory,
        env,
        timeout_ms: u64::from(input.timeout_ms.unwrap_or(60_000)),
        max_output_bytes: input.max_output_bytes.unwrap_or(4 * 1024 * 1024) as usize,
    };
    match tokio::task::spawn_blocking(move || run_job_process(request)).await {
        Ok(Ok(result)) => NativeJsonOutcome::success(project_job_result(result)),
        Ok(Err(err)) => security_error_outcome(err),
        Err(_) => NativeJsonOutcome::host_reason("host-internal-error", false),
    }
}

#[napi(js_name = "harnessSpawnJobProcess")]
pub async fn harness_spawn_job_process(input: NativeHarnessJobProcessInput) -> NativeJsonOutcome {
    let env = match parse_env_map(input.env) {
        Ok(env) => env,
        Err(err) => return security_error_outcome(err),
    };
    {
        let registry = harness_jobs().lock().await;
        if registry.len() >= MAX_ACTIVE_HARNESS_JOBS {
            return NativeJsonOutcome::host_reason("resource-exhausted", false);
        }
    }
    let request = HarnessJobProcessRequest {
        executable: input.executable,
        args: input.args,
        working_directory: input.working_directory,
        env,
        timeout_ms: u64::from(input.timeout_ms.unwrap_or(60_000)),
        max_output_bytes: input.max_output_bytes.unwrap_or(4 * 1024 * 1024) as usize,
    };
    let spawned = match tokio::task::spawn_blocking(move || spawn_job_process(request)).await {
        Ok(Ok(job)) => Arc::new(job),
        Ok(Err(err)) => return security_error_outcome(err),
        Err(_) => return NativeJsonOutcome::host_reason("host-internal-error", false),
    };
    let pid = spawned.pid();
    let job_id = format!(
        "harness-job-{}",
        HARNESS_JOB_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    harness_jobs().lock().await.insert(job_id.clone(), spawned);
    NativeJsonOutcome::success(json!({ "jobId": job_id, "pid": pid }))
}

#[napi(js_name = "harnessWaitJobProcess")]
pub async fn harness_wait_job_process(input: NativeHarnessJobWaitInput) -> NativeJsonOutcome {
    let job = harness_jobs().lock().await.get(&input.job_id).cloned();
    let Some(job) = job else {
        return NativeJsonOutcome::host_reason("not-found", false);
    };
    let timeout_ms = u64::from(input.timeout_ms.unwrap_or(60_000));
    let outcome = tokio::task::spawn_blocking(move || wait_job_process(&job, timeout_ms)).await;
    harness_jobs().lock().await.remove(&input.job_id);
    match outcome {
        Ok(Ok(result)) => NativeJsonOutcome::success(project_job_result(result)),
        Ok(Err(err)) => security_error_outcome(err),
        Err(_) => NativeJsonOutcome::host_reason("host-internal-error", false),
    }
}

#[napi(js_name = "harnessKillJobProcess")]
pub async fn harness_kill_job_process(input: NativeHarnessJobKillInput) -> NativeJsonOutcome {
    let job = harness_jobs().lock().await.get(&input.job_id).cloned();
    let Some(job) = job else {
        return NativeJsonOutcome::success(json!({ "killed": false, "activeProcessesRemaining": 0 }));
    };
    match tokio::task::spawn_blocking(move || kill_job_process(&job)).await {
        Ok(Ok(remaining)) => NativeJsonOutcome::success(json!({
            "killed": true,
            "activeProcessesRemaining": remaining,
        })),
        Ok(Err(err)) => security_error_outcome(err),
        Err(_) => NativeJsonOutcome::host_reason("host-internal-error", false),
    }
}

#[napi(js_name = "harnessVerifyWorkspacePath")]
pub async fn harness_verify_workspace_path(
    input: NativeHarnessVerifyPathInput,
) -> NativeJsonOutcome {
    let root = PathBuf::from(input.workspace_root);
    let rel = input.relative_path;
    let expect_dir = input.expect_directory.unwrap_or(false);
    match tokio::task::spawn_blocking(move || verify_workspace_path(&root, &rel, expect_dir)).await
    {
        Ok(Ok(verified)) => NativeJsonOutcome::success(json!({
            "canonicalWorkspaceRoot": verified.canonical_workspace_root,
            "finalPath": verified.final_path,
            "relativePath": verified.relative_path,
            "isDirectory": verified.is_directory,
            "sizeBytes": verified.size_bytes,
            "nNumberOfLinks": verified.n_number_of_links,
        })),
        Ok(Err(err)) => security_error_outcome(err),
        Err(_) => NativeJsonOutcome::host_reason("host-internal-error", false),
    }
}

#[napi(js_name = "harnessSecureReadFile")]
pub async fn harness_secure_read_file(input: NativeHarnessSecureReadInput) -> NativeJsonOutcome {
    let root = PathBuf::from(input.workspace_root);
    let rel = input.relative_path;
    let max_bytes = input.max_bytes.unwrap_or(16 * 1024 * 1024) as usize;
    match tokio::task::spawn_blocking(move || secure_read_file(&root, &rel, max_bytes)).await {
        Ok(Ok(result)) => NativeJsonOutcome::success(json!({
            "finalPath": result.final_path,
            "contentBase64": base64::engine::general_purpose::STANDARD.encode(&result.content),
            "sha256": result.sha256,
            "sizeBytes": result.size_bytes,
            "nNumberOfLinks": result.n_number_of_links,
        })),
        Ok(Err(err)) => security_error_outcome(err),
        Err(_) => NativeJsonOutcome::host_reason("host-internal-error", false),
    }
}

#[napi(js_name = "harnessSecureWriteFile")]
pub async fn harness_secure_write_file(input: NativeHarnessSecureWriteInput) -> NativeJsonOutcome {
    let request = HarnessSecureWriteRequest {
        workspace_root: input.workspace_root,
        relative_path: input.relative_path,
        content: input.content.to_vec(),
        precondition_sha256: input.precondition_sha256,
        allow_create: input.allow_create.unwrap_or(false),
        snapshot_path: input.snapshot_path,
    };
    match tokio::task::spawn_blocking(move || secure_write_file(request)).await {
        Ok(Ok(result)) => NativeJsonOutcome::success(json!({
            "finalPath": result.final_path,
            "sha256": result.sha256,
            "previousSha256": result.previous_sha256,
            "bytesWritten": result.bytes_written,
            "created": result.created,
            "snapshotWritten": result.snapshot_written,
        })),
        Ok(Err(err)) => security_error_outcome(err),
        Err(_) => NativeJsonOutcome::host_reason("host-internal-error", false),
    }
}

#[napi(js_name = "harnessSecureDeleteFile")]
pub async fn harness_secure_delete_file(
    input: NativeHarnessSecureDeleteInput,
) -> NativeJsonOutcome {
    let request = HarnessSecureDeleteRequest {
        workspace_root: input.workspace_root,
        relative_path: input.relative_path,
        precondition_sha256: input.precondition_sha256,
        snapshot_path: input.snapshot_path,
    };
    match tokio::task::spawn_blocking(move || secure_delete_file(request)).await {
        Ok(Ok(result)) => NativeJsonOutcome::success(json!({
            "finalPath": result.final_path,
            "previousSha256": result.previous_sha256,
            "snapshotWritten": result.snapshot_written,
        })),
        Ok(Err(err)) => security_error_outcome(err),
        Err(_) => NativeJsonOutcome::host_reason("host-internal-error", false),
    }
}
