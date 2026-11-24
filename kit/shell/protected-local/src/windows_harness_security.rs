use std::collections::BTreeMap;
use std::ffi::{c_void, OsStr};
use std::io::Write;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, SetHandleInformation, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND,
    GENERIC_READ, GENERIC_WRITE, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
    WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FileDispositionInfo, FlushFileBuffers, GetFileInformationByHandle,
    GetFinalPathNameByHandleW, ReadFile, SetEndOfFile, SetFileInformationByHandle,
    SetFilePointerEx, WriteFile, BY_HANDLE_FILE_INFORMATION, CREATE_NEW, DELETE,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_BEGIN,
    FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_NAME_NORMALIZED, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    VOLUME_NAME_DOS,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, ResumeThread, TerminateProcess, WaitForSingleObject,
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION,
    STARTF_USESTDHANDLES, STARTUPINFOW,
};

use crate::harness_security::{
    sha256_hex, validate_relative_workspace_path, HarnessJobProcessRequest, HarnessJobProcessResult,
    HarnessSecureDeleteRequest, HarnessSecureDeleteResult, HarnessSecureReadResult,
    HarnessSecureWriteRequest, HarnessSecureWriteResult, HarnessSecurityError, HarnessVerifiedPath,
};

const JOB_EXIT_POLL_TIMEOUT_MS: u64 = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_HARD_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

struct PipeReadOutcome {
    bytes: Vec<u8>,
    truncated: bool,
}

pub struct HarnessRunningJob {
    pid: u32,
    job: OwnedHandle,
    process: OwnedHandle,
    killed: Arc<AtomicBool>,
    stdout_thread: Mutex<Option<JoinHandle<PipeReadOutcome>>>,
    stderr_thread: Mutex<Option<JoinHandle<PipeReadOutcome>>>,
}

// SAFETY: OwnedHandle wraps exclusive Windows kernel handles valid across threads.
unsafe impl Send for HarnessRunningJob {}
unsafe impl Sync for HarnessRunningJob {}

impl HarnessRunningJob {
    pub fn pid(&self) -> u32 {
        self.pid
    }
}

impl Drop for HarnessRunningJob {
    fn drop(&mut self) {
        // Ensure zero lingering grandchildren if dropped before explicit wait/kill.
        let _ = terminate_and_drain_job(&self.job);
    }
}

fn wide_null_terminated(value: &OsStr) -> Result<Vec<u16>, HarnessSecurityError> {
    let mut encoded = value.encode_wide().collect::<Vec<_>>();
    if encoded.contains(&0) {
        return Err(HarnessSecurityError::new(
            "invalid-input",
            "interior NUL in UTF-16 string",
        ));
    }
    encoded.push(0);
    Ok(encoded)
}

fn wide_str(value: &str) -> Result<Vec<u16>, HarnessSecurityError> {
    wide_null_terminated(OsStr::new(value))
}

fn win32_err(reason: &str, api: &str, code: u32) -> HarnessSecurityError {
    HarnessSecurityError::new(reason, format!("{api} failed with Win32 error {code}"))
}

fn build_windows_command_line(executable: &Path, arguments: &[String]) -> String {
    let mut command_line = quote_windows_arg(&executable.to_string_lossy());
    for arg in arguments {
        command_line.push(' ');
        command_line.push_str(&quote_windows_arg(arg));
    }
    command_line
}

fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty()
        && !arg
            .chars()
            .any(|ch| matches!(ch, ' ' | '\t' | '\n' | '\r' | '"'))
    {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                if backslashes > 0 {
                    out.extend(std::iter::repeat_n('\\', backslashes));
                    backslashes = 0;
                }
                out.push(ch);
            }
        }
    }
    if backslashes > 0 {
        out.extend(std::iter::repeat_n('\\', backslashes * 2));
    }
    out.push('"');
    out
}

fn build_explicit_unicode_env_block(
    env: &BTreeMap<String, String>,
) -> Result<Vec<u16>, HarnessSecurityError> {
    let mut entries: Vec<(&str, &str)> = env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    // Win32 CreateProcessW with CREATE_UNICODE_ENVIRONMENT requires case-insensitive ASCII sort.
    entries.sort_by(|a, b| a.0.to_ascii_uppercase().cmp(&b.0.to_ascii_uppercase()));
    let mut block = Vec::new();
    for (key, value) in entries {
        if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
            return Err(HarnessSecurityError::new(
                "invalid-env",
                "environment key/value contains NUL or invalid '='",
            ));
        }
        block.extend(key.encode_utf16());
        block.push(b'=' as u16);
        block.extend(value.encode_utf16());
        block.push(0);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

fn create_inheritable_pipe() -> Result<(OwnedHandle, OwnedHandle), HarnessSecurityError> {
    let sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: 1,
    };
    let mut read_handle: HANDLE = std::ptr::null_mut();
    let mut write_handle: HANDLE = std::ptr::null_mut();
    if unsafe { CreatePipe(&mut read_handle, &mut write_handle, &sa, 0) } == 0 {
        return Err(win32_err(
            "process-pipe-failed",
            "CreatePipe",
            unsafe { GetLastError() },
        ));
    }
    // Parent read handle MUST NOT be inherited by child processes!
    if unsafe { SetHandleInformation(read_handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
        let code = unsafe { GetLastError() };
        unsafe {
            CloseHandle(read_handle);
            CloseHandle(write_handle);
        }
        return Err(win32_err(
            "process-pipe-failed",
            "SetHandleInformation",
            code,
        ));
    }
    let read_owned = unsafe { OwnedHandle::from_raw_handle(read_handle.cast()) };
    let write_owned = unsafe { OwnedHandle::from_raw_handle(write_handle.cast()) };
    Ok((read_owned, write_owned))
}

fn open_inheritable_nul_stdin() -> Result<OwnedHandle, HarnessSecurityError> {
    let sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: 1,
    };
    let nul_path = wide_str("NUL")?;
    let handle = unsafe {
        CreateFileW(
            nul_path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &sa,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(win32_err(
            "process-pipe-failed",
            "CreateFileW(NUL)",
            unsafe { GetLastError() },
        ));
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle.cast()) })
}

fn create_kill_on_close_job() -> Result<OwnedHandle, HarnessSecurityError> {
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        return Err(win32_err(
            "job-object-failed",
            "CreateJobObjectW",
            unsafe { GetLastError() },
        ));
    }
    let job_owned = unsafe { OwnedHandle::from_raw_handle(job.cast()) };
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            job_owned.as_raw_handle().cast(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(win32_err(
            "job-object-failed",
            "SetInformationJobObject",
            unsafe { GetLastError() },
        ));
    }
    Ok(job_owned)
}

fn query_job_active_processes(job: &OwnedHandle) -> Result<u32, HarnessSecurityError> {
    let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
    if unsafe {
        QueryInformationJobObject(
            job.as_raw_handle().cast(),
            JobObjectBasicAccountingInformation,
            (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(win32_err(
            "job-object-failed",
            "QueryInformationJobObject",
            unsafe { GetLastError() },
        ));
    }
    Ok(accounting.ActiveProcesses)
}

fn terminate_and_drain_job(job: &OwnedHandle) -> Result<u32, HarnessSecurityError> {
    let active = query_job_active_processes(job)?;
    if active == 0 {
        return Ok(0);
    }
    if unsafe { TerminateJobObject(job.as_raw_handle().cast(), 1) } == 0 {
        return Err(win32_err(
            "job-terminate-failed",
            "TerminateJobObject",
            unsafe { GetLastError() },
        ));
    }
    let deadline = Instant::now() + Duration::from_millis(JOB_EXIT_POLL_TIMEOUT_MS);
    loop {
        let remaining = query_job_active_processes(job)?;
        if remaining == 0 {
            return Ok(0);
        }
        if Instant::now() >= deadline {
            return Ok(remaining);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn spawn_pipe_drainer(handle: OwnedHandle, max_bytes: usize) -> JoinHandle<PipeReadOutcome> {
    std::thread::spawn(move || {
        let mut collected = Vec::new();
        let mut truncated = false;
        let mut buf = [0_u8; 8192];
        loop {
            let mut bytes_read: u32 = 0;
            let ok = unsafe {
                ReadFile(
                    handle.as_raw_handle().cast(),
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                    &mut bytes_read,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 || bytes_read == 0 {
                break;
            }
            let chunk = &buf[..bytes_read as usize];
            if collected.len() < max_bytes {
                let remaining = max_bytes - collected.len();
                let take = remaining.min(chunk.len());
                collected.extend_from_slice(&chunk[..take]);
                if take < chunk.len() {
                    truncated = true;
                }
            } else {
                truncated = true;
            }
        }
        PipeReadOutcome {
            bytes: collected,
            truncated,
        }
    })
}

// @nimi-authority: rule.nimi.harness.assistant.p-harn-002
pub fn spawn_job_process(
    request: HarnessJobProcessRequest,
) -> Result<HarnessRunningJob, HarnessSecurityError> {
    if request.executable.trim().is_empty() {
        return Err(HarnessSecurityError::new(
            "invalid-input",
            "executable path must not be empty",
        ));
    }
    let work_dir = PathBuf::from(&request.working_directory);
    if !work_dir.is_dir() {
        return Err(HarnessSecurityError::new(
            "invalid-working-directory",
            "working directory does not exist",
        ));
    }
    let max_output = if request.max_output_bytes == 0 {
        DEFAULT_MAX_OUTPUT_BYTES
    } else {
        request.max_output_bytes.min(MAX_HARD_OUTPUT_BYTES)
    };

    let (stdout_read, stdout_write) = create_inheritable_pipe()?;
    let (stderr_read, stderr_write) = create_inheritable_pipe()?;
    let stdin_nul = open_inheritable_nul_stdin()?;

    let env_block = build_explicit_unicode_env_block(&request.env)?;
    let exe_path = PathBuf::from(&request.executable);
    let mut command_line = build_windows_command_line(&exe_path, &request.args)
        .encode_utf16()
        .collect::<Vec<_>>();
    command_line.push(0);
    let application = if exe_path.is_absolute() {
        Some(wide_null_terminated(exe_path.as_os_str())?)
    } else {
        None
    };
    let current_dir = wide_null_terminated(work_dir.as_os_str())?;

    let mut startup: STARTUPINFOW = unsafe { zeroed() };
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_nul.as_raw_handle().cast();
    startup.hStdOutput = stdout_write.as_raw_handle().cast();
    startup.hStdError = stderr_write.as_raw_handle().cast();

    let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
    let created = unsafe {
        CreateProcessW(
            application
                .as_ref()
                .map_or(std::ptr::null(), |buf| buf.as_ptr()),
            command_line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1, // inherit stdout/stderr/nul-stdin handles only
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            env_block.as_ptr().cast::<c_void>(),
            current_dir.as_ptr(),
            &startup,
            &mut info,
        )
    };
    // Close child ends in parent immediately so pipe EOF tracks child + grandchild exit.
    drop(stdout_write);
    drop(stderr_write);
    drop(stdin_nul);

    if created == 0 || info.hProcess.is_null() || info.hThread.is_null() || info.dwProcessId == 0 {
        let code = unsafe { GetLastError() };
        unsafe {
            if !info.hThread.is_null() {
                CloseHandle(info.hThread);
            }
            if !info.hProcess.is_null() {
                CloseHandle(info.hProcess);
            }
        }
        return Err(win32_err("process-spawn-failed", "CreateProcessW", code));
    }

    let process_owned = unsafe { OwnedHandle::from_raw_handle(info.hProcess.cast()) };
    let thread_owned = unsafe { OwnedHandle::from_raw_handle(info.hThread.cast()) };

    let job_owned = match create_kill_on_close_job() {
        Ok(job) => job,
        Err(err) => {
            unsafe { TerminateProcess(process_owned.as_raw_handle().cast(), 1) };
            return Err(err);
        }
    };

    if unsafe {
        AssignProcessToJobObject(
            job_owned.as_raw_handle().cast(),
            process_owned.as_raw_handle().cast(),
        )
    } == 0
    {
        let code = unsafe { GetLastError() };
        unsafe { TerminateProcess(process_owned.as_raw_handle().cast(), 1) };
        return Err(win32_err(
            "job-assign-failed",
            "AssignProcessToJobObject",
            code,
        ));
    }

    let stdout_thread = spawn_pipe_drainer(stdout_read, max_output);
    let stderr_thread = spawn_pipe_drainer(stderr_read, max_output);

    if unsafe { ResumeThread(thread_owned.as_raw_handle().cast()) } == u32::MAX {
        let code = unsafe { GetLastError() };
        let _ = terminate_and_drain_job(&job_owned);
        return Err(win32_err("process-resume-failed", "ResumeThread", code));
    }
    drop(thread_owned);

    Ok(HarnessRunningJob {
        pid: info.dwProcessId,
        job: job_owned,
        process: process_owned,
        killed: Arc::new(AtomicBool::new(false)),
        stdout_thread: Mutex::new(Some(stdout_thread)),
        stderr_thread: Mutex::new(Some(stderr_thread)),
    })
}

pub fn kill_job_process(job: &HarnessRunningJob) -> Result<u32, HarnessSecurityError> {
    job.killed.store(true, Ordering::SeqCst);
    terminate_and_drain_job(&job.job)
}

pub fn wait_job_process(
    job: &HarnessRunningJob,
    timeout_ms: u64,
) -> Result<HarnessJobProcessResult, HarnessSecurityError> {
    let deadline = if timeout_ms > 0 {
        Some(Instant::now() + Duration::from_millis(timeout_ms))
    } else {
        None
    };

    let mut timed_out = false;
    loop {
        if job.killed.load(Ordering::SeqCst) {
            break;
        }
        let slice_ms = match deadline {
            Some(dl) => {
                let now = Instant::now();
                if now >= dl {
                    timed_out = true;
                    break;
                }
                dl.saturating_duration_since(now)
                    .as_millis()
                    .min(50) as u32
            }
            None => 50,
        };
        let wait = unsafe { WaitForSingleObject(job.process.as_raw_handle().cast(), slice_ms) };
        match wait {
            WAIT_OBJECT_0 => break,
            WAIT_TIMEOUT => continue,
            _ => {
                let code = unsafe { GetLastError() };
                let _ = terminate_and_drain_job(&job.job);
                return Err(win32_err(
                    "process-wait-failed",
                    "WaitForSingleObject",
                    code,
                ));
            }
        }
    }

    let killed = job.killed.load(Ordering::SeqCst);
    let mut exit_code = None;
    if !timed_out && !killed {
        let mut raw_code: u32 = 0;
        if unsafe { GetExitCodeProcess(job.process.as_raw_handle().cast(), &mut raw_code) } != 0 {
            exit_code = Some(raw_code as i32);
        }
    }

    // Always clean up any orphaned grandchildren inside the Job Object so 0 active processes remain.
    let active_processes_remaining = terminate_and_drain_job(&job.job)?;

    let stdout_out = job
        .stdout_thread
        .lock()
        .ok()
        .and_then(|mut g| g.take())
        .and_then(|h| h.join().ok())
        .unwrap_or(PipeReadOutcome {
            bytes: Vec::new(),
            truncated: false,
        });
    let stderr_out = job
        .stderr_thread
        .lock()
        .ok()
        .and_then(|mut g| g.take())
        .and_then(|h| h.join().ok())
        .unwrap_or(PipeReadOutcome {
            bytes: Vec::new(),
            truncated: false,
        });

    Ok(HarnessJobProcessResult {
        pid: job.pid,
        exit_code,
        timed_out,
        killed,
        stdout: stdout_out.bytes,
        stderr: stderr_out.bytes,
        stdout_truncated: stdout_out.truncated,
        stderr_truncated: stderr_out.truncated,
        active_processes_remaining,
    })
}

pub fn run_job_process(
    request: HarnessJobProcessRequest,
) -> Result<HarnessJobProcessResult, HarnessSecurityError> {
    let timeout_ms = request.timeout_ms;
    let job = spawn_job_process(request)?;
    wait_job_process(&job, timeout_ms)
}

// --- Handle-level NTFS Workspace Security ---

fn normalize_dos_final_path(raw: String) -> String {
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw
    }
}

fn final_path_from_handle(handle: HANDLE) -> Result<String, HarnessSecurityError> {
    let mut len = unsafe {
        GetFinalPathNameByHandleW(
            handle,
            std::ptr::null_mut(),
            0,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if len == 0 {
        return Err(win32_err(
            "path-resolution-failed",
            "GetFinalPathNameByHandleW",
            unsafe { GetLastError() },
        ));
    }
    let mut buf = vec![0_u16; (len as usize) + 1];
    len = unsafe {
        GetFinalPathNameByHandleW(
            handle,
            buf.as_mut_ptr(),
            buf.len() as u32,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if len == 0 || (len as usize) >= buf.len() {
        return Err(win32_err(
            "path-resolution-failed",
            "GetFinalPathNameByHandleW",
            unsafe { GetLastError() },
        ));
    }
    let raw = String::from_utf16_lossy(&buf[..len as usize]);
    Ok(normalize_dos_final_path(raw))
}

fn file_info_from_handle(handle: HANDLE) -> Result<BY_HANDLE_FILE_INFORMATION, HarnessSecurityError> {
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
    if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
        return Err(win32_err(
            "file-info-failed",
            "GetFileInformationByHandle",
            unsafe { GetLastError() },
        ));
    }
    Ok(info)
}

fn is_within_workspace_root(canonical_root: &str, candidate_final: &str) -> bool {
    let root = canonical_root.trim_end_matches('\\').to_lowercase();
    let cand = candidate_final.trim_end_matches('\\').to_lowercase();
    if cand == root {
        return true;
    }
    let prefix = format!("{root}\\");
    cand.starts_with(&prefix)
}

fn canonicalize_workspace_root(workspace_root: &Path) -> Result<String, HarnessSecurityError> {
    let wide = wide_null_terminated(workspace_root.as_os_str())?;
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(win32_err(
            "invalid-workspace-root",
            "CreateFileW(workspace_root)",
            unsafe { GetLastError() },
        ));
    }
    let owned = unsafe { OwnedHandle::from_raw_handle(handle.cast()) };
    let info = file_info_from_handle(owned.as_raw_handle().cast())?;
    if (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 {
        return Err(HarnessSecurityError::new(
            "invalid-workspace-root",
            "workspace root is not a directory",
        ));
    }
    final_path_from_handle(owned.as_raw_handle().cast())
}

/// Checks every existing path component beneath `canonical_root` with
/// `FILE_FLAG_OPEN_REPARSE_POINT` to reject symlinks, junctions, and mount points
/// (even intra-workspace symlinks that might alias `.env` or control-plane files).
fn ensure_no_reparse_points_in_chain(
    canonical_root: &str,
    segments: &[String],
    require_all_exist: bool,
) -> Result<(), HarnessSecurityError> {
    let mut current = PathBuf::from(canonical_root);
    for seg in segments {
        current.push(seg);
        let wide = wide_null_terminated(current.as_os_str())?;
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            let code = unsafe { GetLastError() };
            if !require_all_exist && (code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND)
            {
                return Ok(());
            }
            return Err(win32_err(
                if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
                    "not-found"
                } else {
                    "path-inspection-failed"
                },
                "CreateFileW(reparse-check)",
                code,
            ));
        }
        let owned = unsafe { OwnedHandle::from_raw_handle(handle.cast()) };
        let info = file_info_from_handle(owned.as_raw_handle().cast())?;
        if (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            return Err(HarnessSecurityError::new(
                "reparse-point-rejected",
                format!("symlink/junction reparse point rejected at segment '{seg}'"),
            ));
        }
    }
    Ok(())
}

fn read_all_from_handle(
    handle: HANDLE,
    max_bytes: usize,
) -> Result<Vec<u8>, HarnessSecurityError> {
    let info = file_info_from_handle(handle)?;
    let size = ((info.nFileSizeHigh as u64) << 32) | (info.nFileSizeLow as u64);
    if size as usize > max_bytes {
        return Err(HarnessSecurityError::new(
            "file-too-large",
            format!("file size {size} exceeds limit {max_bytes}"),
        ));
    }
    let mut out = Vec::with_capacity(size as usize);
    let mut buf = [0_u8; 65536];
    loop {
        let mut bytes_read: u32 = 0;
        let ok = unsafe {
            ReadFile(
                handle,
                buf.as_mut_ptr(),
                buf.len() as u32,
                &mut bytes_read,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(win32_err("read-failed", "ReadFile", unsafe {
                GetLastError()
            }));
        }
        if bytes_read == 0 {
            break;
        }
        if out.len() + (bytes_read as usize) > max_bytes {
            return Err(HarnessSecurityError::new(
                "file-too-large",
                format!("file stream exceeded limit {max_bytes}"),
            ));
        }
        out.extend_from_slice(&buf[..bytes_read as usize]);
    }
    Ok(out)
}

fn write_all_to_handle(handle: HANDLE, content: &[u8]) -> Result<(), HarnessSecurityError> {
    let mut written_total = 0usize;
    while written_total < content.len() {
        let chunk = &content[written_total..content.len().min(written_total + 65536)];
        let mut written: u32 = 0;
        let ok = unsafe {
            WriteFile(
                handle,
                chunk.as_ptr(),
                chunk.len() as u32,
                &mut written,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(win32_err("write-failed", "WriteFile", unsafe {
                GetLastError()
            }));
        }
        written_total += written as usize;
    }
    if unsafe { FlushFileBuffers(handle) } == 0 {
        return Err(win32_err("write-failed", "FlushFileBuffers", unsafe {
            GetLastError()
        }));
    }
    Ok(())
}

fn write_snapshot_file(snapshot_path: &str, bytes: &[u8]) -> Result<(), HarnessSecurityError> {
    let path = Path::new(snapshot_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
    }
    let mut file = std::fs::File::create(path)
        .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
    Ok(())
}

fn verify_open_file_handle(
    handle: HANDLE,
    canonical_root: &str,
    expect_directory: bool,
) -> Result<(String, BY_HANDLE_FILE_INFORMATION), HarnessSecurityError> {
    let final_path = final_path_from_handle(handle)?;
    if !is_within_workspace_root(canonical_root, &final_path) {
        return Err(HarnessSecurityError::new(
            "workspace-escape",
            "resolved handle final path escapes canonical workspace root",
        ));
    }
    let info = file_info_from_handle(handle)?;
    let is_dir = (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    if expect_directory && !is_dir {
        return Err(HarnessSecurityError::new(
            "not-directory",
            "target is not a directory",
        ));
    }
    if !expect_directory {
        if is_dir {
            return Err(HarnessSecurityError::new(
                "is-directory",
                "target is a directory",
            ));
        }
        if info.nNumberOfLinks != 1 {
            return Err(HarnessSecurityError::new(
                "hardlink-rejected",
                format!(
                    "NTFS hardlink rejected (nNumberOfLinks = {}, must be 1)",
                    info.nNumberOfLinks
                ),
            ));
        }
    }
    Ok((final_path, info))
}

// @nimi-authority: rule.nimi.harness.assistant.p-harn-002
pub fn verify_workspace_path(
    workspace_root: &Path,
    relative_path: &str,
    expect_directory: bool,
) -> Result<HarnessVerifiedPath, HarnessSecurityError> {
    let segments = validate_relative_workspace_path(relative_path, expect_directory)?;
    let canonical_root = canonicalize_workspace_root(workspace_root)?;
    ensure_no_reparse_points_in_chain(&canonical_root, &segments, true)?;

    let mut target = PathBuf::from(&canonical_root);
    for seg in &segments {
        target.push(seg);
    }
    let wide = wide_null_terminated(target.as_os_str())?;
    let flags = if expect_directory {
        FILE_FLAG_BACKUP_SEMANTICS
    } else {
        FILE_ATTRIBUTE_NORMAL
    };
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            flags,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        let code = unsafe { GetLastError() };
        return Err(win32_err(
            if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
                "not-found"
            } else {
                "open-failed"
            },
            "CreateFileW",
            code,
        ));
    }
    let owned = unsafe { OwnedHandle::from_raw_handle(handle.cast()) };
    let (final_path, info) =
        verify_open_file_handle(owned.as_raw_handle().cast(), &canonical_root, expect_directory)?;
    let size_bytes = ((info.nFileSizeHigh as u64) << 32) | (info.nFileSizeLow as u64);
    Ok(HarnessVerifiedPath {
        canonical_workspace_root: canonical_root,
        final_path,
        relative_path: segments.join("/"),
        is_directory: (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0,
        size_bytes,
        n_number_of_links: info.nNumberOfLinks,
    })
}

pub fn secure_read_file(
    workspace_root: &Path,
    relative_path: &str,
    max_bytes: usize,
) -> Result<HarnessSecureReadResult, HarnessSecurityError> {
    let segments = validate_relative_workspace_path(relative_path, false)?;
    let canonical_root = canonicalize_workspace_root(workspace_root)?;
    ensure_no_reparse_points_in_chain(&canonical_root, &segments, true)?;

    let mut target = PathBuf::from(&canonical_root);
    for seg in &segments {
        target.push(seg);
    }
    let wide = wide_null_terminated(target.as_os_str())?;
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        let code = unsafe { GetLastError() };
        return Err(win32_err(
            if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
                "not-found"
            } else {
                "read-failed"
            },
            "CreateFileW(read)",
            code,
        ));
    }
    let owned = unsafe { OwnedHandle::from_raw_handle(handle.cast()) };
    let raw = owned.as_raw_handle().cast();
    let (final_path, info) = verify_open_file_handle(raw, &canonical_root, false)?;
    let content = read_all_from_handle(raw, max_bytes)?;
    let sha256 = sha256_hex(&content);
    Ok(HarnessSecureReadResult {
        final_path,
        size_bytes: content.len() as u64,
        content,
        sha256,
        n_number_of_links: info.nNumberOfLinks,
    })
}

pub fn secure_write_file(
    request: HarnessSecureWriteRequest,
) -> Result<HarnessSecureWriteResult, HarnessSecurityError> {
    let segments = validate_relative_workspace_path(&request.relative_path, false)?;
    let canonical_root = canonicalize_workspace_root(Path::new(&request.workspace_root))?;
    ensure_no_reparse_points_in_chain(&canonical_root, &segments, false)?;

    let mut target = PathBuf::from(&canonical_root);
    for seg in &segments {
        target.push(seg);
    }
    let wide = wide_null_terminated(target.as_os_str())?;

    // Try opening existing file exclusively against concurrent writers/renamers/deleters.
    let existing_handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if existing_handle != INVALID_HANDLE_VALUE && !existing_handle.is_null() {
        let owned = unsafe { OwnedHandle::from_raw_handle(existing_handle.cast()) };
        let raw = owned.as_raw_handle().cast();
        let (final_path, _info) = verify_open_file_handle(raw, &canonical_root, false)?;
        let existing_bytes = read_all_from_handle(raw, 64 * 1024 * 1024)?;
        let existing_sha = sha256_hex(&existing_bytes);

        if let Some(expected) = request.precondition_sha256.as_deref() {
            if !expected.is_empty() && expected != existing_sha {
                return Err(HarnessSecurityError::new(
                    "precondition-failed",
                    "file content hash changed before write (CAS failed)",
                ));
            }
        }
        let mut snapshot_written = false;
        if let Some(snap) = request.snapshot_path.as_deref() {
            write_snapshot_file(snap, &existing_bytes)?;
            snapshot_written = true;
        }
        // Rewind the exact verified handle, overwrite, truncate, and flush.
        if unsafe { SetFilePointerEx(raw, 0, std::ptr::null_mut(), FILE_BEGIN) } == 0 {
            return Err(win32_err(
                "write-failed",
                "SetFilePointerEx",
                unsafe { GetLastError() },
            ));
        }
        if unsafe { SetEndOfFile(raw) } == 0 {
            return Err(win32_err("write-failed", "SetEndOfFile", unsafe {
                GetLastError()
            }));
        }
        write_all_to_handle(raw, &request.content)?;
        return Ok(HarnessSecureWriteResult {
            final_path,
            sha256: sha256_hex(&request.content),
            previous_sha256: Some(existing_sha),
            bytes_written: request.content.len() as u64,
            created: false,
            snapshot_written,
        });
    }

    let open_code = unsafe { GetLastError() };
    if open_code != ERROR_FILE_NOT_FOUND && open_code != ERROR_PATH_NOT_FOUND {
        return Err(win32_err(
            "write-failed",
            "CreateFileW(OPEN_EXISTING)",
            open_code,
        ));
    }
    if !request.allow_create {
        return Err(HarnessSecurityError::new(
            "not-found",
            "target file does not exist and allow_create is false",
        ));
    }
    if let Some(expected) = request.precondition_sha256.as_deref() {
        if !expected.is_empty() {
            return Err(HarnessSecurityError::new(
                "precondition-failed",
                "expected existing file hash, but target file does not exist",
            ));
        }
    }

    // Create missing parent directories safely under canonical_root, checking reparse points at each step.
    if segments.len() > 1 {
        let mut dir = PathBuf::from(&canonical_root);
        for seg in &segments[..segments.len() - 1] {
            dir.push(seg);
            if !dir.exists() {
                std::fs::create_dir(&dir)
                    .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
            }
        }
        ensure_no_reparse_points_in_chain(
            &canonical_root,
            &segments[..segments.len() - 1],
            true,
        )?;
    }

    let new_handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if new_handle == INVALID_HANDLE_VALUE || new_handle.is_null() {
        return Err(win32_err(
            "write-failed",
            "CreateFileW(CREATE_NEW)",
            unsafe { GetLastError() },
        ));
    }
    let owned = unsafe { OwnedHandle::from_raw_handle(new_handle.cast()) };
    let raw = owned.as_raw_handle().cast();
    let (final_path, _info) = verify_open_file_handle(raw, &canonical_root, false)?;
    write_all_to_handle(raw, &request.content)?;
    Ok(HarnessSecureWriteResult {
        final_path,
        sha256: sha256_hex(&request.content),
        previous_sha256: None,
        bytes_written: request.content.len() as u64,
        created: true,
        snapshot_written: false,
    })
}

pub fn secure_delete_file(
    request: HarnessSecureDeleteRequest,
) -> Result<HarnessSecureDeleteResult, HarnessSecurityError> {
    let segments = validate_relative_workspace_path(&request.relative_path, false)?;
    let canonical_root = canonicalize_workspace_root(Path::new(&request.workspace_root))?;
    ensure_no_reparse_points_in_chain(&canonical_root, &segments, true)?;

    let mut target = PathBuf::from(&canonical_root);
    for seg in &segments {
        target.push(seg);
    }
    let wide = wide_null_terminated(target.as_os_str())?;
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            DELETE | GENERIC_READ,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        let code = unsafe { GetLastError() };
        return Err(win32_err(
            if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
                "not-found"
            } else {
                "delete-failed"
            },
            "CreateFileW(DELETE)",
            code,
        ));
    }
    let owned = unsafe { OwnedHandle::from_raw_handle(handle.cast()) };
    let raw = owned.as_raw_handle().cast();
    let (final_path, _info) = verify_open_file_handle(raw, &canonical_root, false)?;
    let existing_bytes = read_all_from_handle(raw, 64 * 1024 * 1024)?;
    let existing_sha = sha256_hex(&existing_bytes);

    if let Some(expected) = request.precondition_sha256.as_deref() {
        if !expected.is_empty() && expected != existing_sha {
            return Err(HarnessSecurityError::new(
                "precondition-failed",
                "file content hash changed before delete (CAS failed)",
            ));
        }
    }
    let mut snapshot_written = false;
    if let Some(snap) = request.snapshot_path.as_deref() {
        write_snapshot_file(snap, &existing_bytes)?;
        snapshot_written = true;
    }

    let disp = FILE_DISPOSITION_INFO { DeleteFile: true };
    if unsafe {
        SetFileInformationByHandle(
            raw,
            FileDispositionInfo,
            (&disp as *const FILE_DISPOSITION_INFO).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    } == 0
    {
        return Err(win32_err(
            "delete-failed",
            "SetFileInformationByHandle(FileDispositionInfo)",
            unsafe { GetLastError() },
        ));
    }
    Ok(HarnessSecureDeleteResult {
        final_path,
        previous_sha256: existing_sha,
        snapshot_written,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nimi-harness-sec-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn hardlink_inside_workspace_pointing_outside_is_rejected_by_handle_check() {
        let workspace = unique_temp_dir("ws");
        let outside = unique_temp_dir("out");
        let outside_file = outside.join("secret.txt");
        std::fs::write(&outside_file, b"TOP_SECRET").unwrap();
        let hardlink = workspace.join("linked.txt");
        std::fs::hard_link(&outside_file, &hardlink).unwrap();

        let err = secure_read_file(&workspace, "linked.txt", 1024).unwrap_err();
        assert_eq!(err.reason_code(), "hardlink-rejected");

        let write_err = secure_write_file(HarnessSecureWriteRequest {
            workspace_root: workspace.to_string_lossy().into_owned(),
            relative_path: "linked.txt".to_string(),
            content: b"OVERWRITTEN".to_vec(),
            precondition_sha256: None,
            allow_create: false,
            snapshot_path: None,
        })
        .unwrap_err();
        assert_eq!(write_err.reason_code(), "hardlink-rejected");
        assert_eq!(std::fs::read(&outside_file).unwrap(), b"TOP_SECRET");

        let _ = std::fs::remove_dir_all(&workspace);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn secure_write_cas_snapshot_and_delete_round_trip() {
        let workspace = unique_temp_dir("cas");
        let snap_dir = unique_temp_dir("snap");
        let snap_file = snap_dir.join("before.bak");

        let created = secure_write_file(HarnessSecureWriteRequest {
            workspace_root: workspace.to_string_lossy().into_owned(),
            relative_path: "src/app.ts".to_string(),
            content: b"export const v = 1;\n".to_vec(),
            precondition_sha256: None,
            allow_create: true,
            snapshot_path: None,
        })
        .unwrap();
        assert!(created.created);
        assert_eq!(created.sha256, sha256_hex(b"export const v = 1;\n"));

        // Wrong CAS precondition must fail without modifying file
        let mismatch = secure_write_file(HarnessSecureWriteRequest {
            workspace_root: workspace.to_string_lossy().into_owned(),
            relative_path: "src/app.ts".to_string(),
            content: b"export const v = 2;\n".to_vec(),
            precondition_sha256: Some("0000".to_string()),
            allow_create: false,
            snapshot_path: Some(snap_file.to_string_lossy().into_owned()),
        })
        .unwrap_err();
        assert_eq!(mismatch.reason_code(), "precondition-failed");
        assert!(!snap_file.exists());

        // Matching CAS writes pre-write snapshot and updates file
        let updated = secure_write_file(HarnessSecureWriteRequest {
            workspace_root: workspace.to_string_lossy().into_owned(),
            relative_path: "src/app.ts".to_string(),
            content: b"export const v = 2;\n".to_vec(),
            precondition_sha256: Some(created.sha256.clone()),
            allow_create: false,
            snapshot_path: Some(snap_file.to_string_lossy().into_owned()),
        })
        .unwrap();
        assert!(!updated.created);
        assert!(updated.snapshot_written);
        assert_eq!(std::fs::read(&snap_file).unwrap(), b"export const v = 1;\n");

        let read = secure_read_file(&workspace, "src/app.ts", 4096).unwrap();
        assert_eq!(read.content, b"export const v = 2;\n");
        assert_eq!(read.sha256, updated.sha256);

        let deleted = secure_delete_file(HarnessSecureDeleteRequest {
            workspace_root: workspace.to_string_lossy().into_owned(),
            relative_path: "src/app.ts".to_string(),
            precondition_sha256: Some(updated.sha256),
            snapshot_path: None,
        })
        .unwrap();
        assert_eq!(deleted.previous_sha256, read.sha256);
        assert!(!workspace.join("src/app.ts").exists());

        let _ = std::fs::remove_dir_all(&workspace);
        let _ = std::fs::remove_dir_all(&snap_dir);
    }

    #[test]
    fn job_object_terminates_grandchild_processes_and_does_not_inherit_parent_env() {
        let workspace = unique_temp_dir("job");
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
        let cmd_exe = PathBuf::from(&system_root).join(r"System32\cmd.exe");
        let mut minimal_env = BTreeMap::new();
        minimal_env.insert("SystemRoot".to_string(), system_root.clone());
        minimal_env.insert("NIMI_ALLOW_TEST".to_string(), "ok-visible".to_string());

        // 1. Verify parent environment is NOT inherited (e.g. PATH/USERNAME absent unless allowlisted).
        let env_check = run_job_process(HarnessJobProcessRequest {
            executable: cmd_exe.to_string_lossy().into_owned(),
            args: vec!["/C".to_string(), "set".to_string()],
            working_directory: workspace.to_string_lossy().into_owned(),
            env: minimal_env.clone(),
            timeout_ms: 10_000,
            max_output_bytes: 65536,
        })
        .unwrap();
        assert_eq!(env_check.exit_code, Some(0));
        assert_eq!(env_check.active_processes_remaining, 0);
        let env_stdout = String::from_utf8_lossy(&env_check.stdout);
        assert!(env_stdout.contains("NIMI_ALLOW_TEST=ok-visible"));
        assert!(!env_stdout.contains("USERPROFILE="));

        // 2. Spawn a child that launches a detached-style grandchild sleeping 30s; timeout at 400ms
        // must kill the entire Job tree and leave 0 active processes.
        let tree = run_job_process(HarnessJobProcessRequest {
            executable: cmd_exe.to_string_lossy().into_owned(),
            args: vec![
                "/C".to_string(),
                r"start /B C:\Windows\System32\ping.exe -n 30 127.0.0.1 >nul & C:\Windows\System32\ping.exe -n 30 127.0.0.1 >nul"
                    .to_string(),
            ],
            working_directory: workspace.to_string_lossy().into_owned(),
            env: minimal_env,
            timeout_ms: 400,
            max_output_bytes: 65536,
        })
        .unwrap();
        assert!(tree.timed_out);
        assert_eq!(tree.active_processes_remaining, 0);

        let _ = std::fs::remove_dir_all(&workspace);
    }
}
