use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};
#[cfg(not(target_os = "windows"))]
use std::path::Path;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecurityError {
    reason_code: String,
    detail: String,
}

impl HarnessSecurityError {
    pub fn new(reason_code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            reason_code: reason_code.into(),
            detail: detail.into(),
        }
    }

    pub fn reason_code(&self) -> &str {
        self.reason_code.as_str()
    }

    pub fn detail(&self) -> &str {
        self.detail.as_str()
    }
}

impl Display for HarnessSecurityError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.reason_code, self.detail)
    }
}

impl std::error::Error for HarnessSecurityError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessJobProcessRequest {
    pub executable: String,
    pub args: Vec<String>,
    pub working_directory: String,
    /// Explicit minimal environment allowlist. Parent environment is never inherited.
    pub env: BTreeMap<String, String>,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessJobProcessResult {
    pub pid: u32,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub killed: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub active_processes_remaining: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessVerifiedPath {
    pub canonical_workspace_root: String,
    pub final_path: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub size_bytes: u64,
    pub n_number_of_links: u32,
    pub object_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecureReadResult {
    pub final_path: String,
    pub content: Vec<u8>,
    pub sha256: String,
    pub size_bytes: u64,
    pub n_number_of_links: u32,
    pub object_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecureWriteRequest {
    pub workspace_root: String,
    pub relative_path: String,
    pub content: Vec<u8>,
    pub precondition_sha256: Option<String>,
    pub allow_create: bool,
    pub must_not_exist: bool,
    pub snapshot_path: Option<String>,
    pub snapshot_root: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecureWriteResult {
    pub final_path: String,
    pub sha256: String,
    pub previous_sha256: Option<String>,
    pub bytes_written: u64,
    pub created: bool,
    pub snapshot_written: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecureDeleteRequest {
    pub workspace_root: String,
    pub relative_path: String,
    pub precondition_sha256: Option<String>,
    pub snapshot_path: Option<String>,
    pub snapshot_root: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecureDeleteResult {
    pub final_path: String,
    pub previous_sha256: String,
    pub snapshot_written: bool,
}

// @nimi-authority: rule.nimi.harness.assistant.security-gates
pub fn validate_relative_workspace_path(
    raw: &str,
    allow_root: bool,
) -> Result<Vec<String>, HarnessSecurityError> {
    if raw.is_empty() {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "path must not be empty",
        ));
    }
    if raw.chars().any(|ch| ch == '\0' || ch.is_control()) {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "path contains control characters or NUL",
        ));
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "path must not be whitespace",
        ));
    }
    if raw.starts_with('@') || trimmed.starts_with('@') {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "leading '@' syntax is rejected",
        ));
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("file:") || lower.starts_with("file://") {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "file:// URI scheme is rejected",
        ));
    }
    if raw.starts_with(r"\\?\")
        || raw.starts_with(r"\\.\")
        || raw.starts_with(r"\??\")
        || raw.starts_with(r"\\")
        || raw.starts_with("//")
        || raw.starts_with('/')
        || raw.starts_with('\\')
    {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "absolute, UNC, and device-prefixed paths are rejected",
        ));
    }
    if raw.contains(':') {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "colon (drive prefix or NTFS alternate data stream) is rejected",
        ));
    }
    if allow_root && (raw == "." || raw == "./" || raw == r".\") {
        return Ok(Vec::new());
    }

    let mut segments = Vec::new();
    for segment in raw.split(['/', '\\']) {
        if segment.is_empty() {
            return Err(HarnessSecurityError::new(
                "invalid-path",
                "empty path segment or trailing separator is rejected",
            ));
        }
        if segment == "." {
            continue;
        }
        if segment == ".." {
            return Err(HarnessSecurityError::new(
                "workspace-escape",
                "parent directory traversal '..' is rejected",
            ));
        }
        if segment.ends_with('.') || segment.ends_with(' ') {
            return Err(HarnessSecurityError::new(
                "invalid-path",
                "Windows trailing dot or space in path segment is rejected",
            ));
        }
        if is_windows_reserved_device_name(segment) {
            return Err(HarnessSecurityError::new(
                "invalid-path",
                "Windows reserved device name is rejected",
            ));
        }
        segments.push(segment.to_string());
    }

    if segments.is_empty() && !allow_root {
        return Err(HarnessSecurityError::new(
            "invalid-path",
            "path must identify a file within the workspace",
        ));
    }
    Ok(segments)
}

fn is_windows_reserved_device_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment);
    matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

pub fn is_sensitive_relative_path(relative_posix: &str) -> bool {
    let norm = relative_posix
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_ascii_lowercase();
    if norm.is_empty() {
        return false;
    }
    let parts: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return false;
    }
    if parts
        .iter()
        .any(|p| matches!(*p, ".ssh" | ".aws" | ".gnupg" | ".kube"))
    {
        return true;
    }
    let name = *parts.last().unwrap_or(&"");
    if name == ".env"
        || name == ".envrc"
        || (name.starts_with(".env")
            && !matches!(name, ".env.example" | ".env.sample" | ".env.template"))
    {
        return true;
    }
    if [
        ".pem",
        ".key",
        ".p12",
        ".pfx",
        ".jks",
        ".keystore",
        ".kdbx",
        ".ppk",
    ]
    .iter()
    .any(|ext| name.ends_with(ext))
    {
        return true;
    }
    if matches!(
        name,
        ".npmrc"
            | ".pypirc"
            | ".netrc"
            | "_netrc"
            | "credentials.json"
            | "service-account.json"
            | "secret.json"
            | "secrets.json"
            | "secret.yaml"
            | "secrets.yaml"
            | "secret.yml"
            | "secrets.yml"
            | "secret.toml"
            | "secrets.toml"
            | "secret.txt"
            | "secrets.txt"
            | "secret.ini"
            | "secrets.ini"
    ) {
        return true;
    }
    if name.starts_with("id_rsa") || name.starts_with("id_ed25519") || name.starts_with("id_ecdsa")
    {
        return true;
    }
    false
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

#[cfg(target_os = "windows")]
pub use crate::windows_harness_security::{
    kill_job_process, list_workspace_directory, run_job_process, secure_delete_file,
    secure_read_file, secure_read_range, secure_write_file, spawn_job_process,
    verify_workspace_path, wait_job_process, HarnessRunningJob,
};

#[cfg(not(target_os = "windows"))]
#[cfg_attr(unix, allow(unsafe_code))] // POSIX descriptor and process-group operations call libc.
mod non_windows_fallback {
    use super::*;
    use std::io::{Read, Seek, SeekFrom, Write};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    #[cfg(unix)]
    use std::os::unix::process::CommandExt;

    #[cfg(unix)]
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }

    struct PipeReadOutcome {
        bytes: Vec<u8>,
        truncated: bool,
    }

    pub struct HarnessRunningJob {
        pid: u32,
        child: Arc<Mutex<Option<std::process::Child>>>,
        killed: Arc<std::sync::atomic::AtomicBool>,
        stdout_rx: Mutex<Option<mpsc::Receiver<PipeReadOutcome>>>,
        stderr_rx: Mutex<Option<mpsc::Receiver<PipeReadOutcome>>>,
    }

    impl HarnessRunningJob {
        pub fn pid(&self) -> u32 {
            self.pid
        }
    }

    impl Drop for HarnessRunningJob {
        fn drop(&mut self) {
            let _ = kill_job_process(self);
        }
    }

    fn spawn_stream_drainer<R: Read + Send + 'static>(
        mut reader: R,
        max_bytes: usize,
    ) -> mpsc::Receiver<PipeReadOutcome> {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let mut truncated = false;
            let mut buf = [0_u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = &buf[..n];
                        if bytes.len() < max_bytes {
                            let rem = max_bytes - bytes.len();
                            let take = rem.min(chunk.len());
                            bytes.extend_from_slice(&chunk[..take]);
                            if take < chunk.len() {
                                truncated = true;
                            }
                        } else {
                            truncated = true;
                        }
                    }
                }
            }
            let _ = tx.send(PipeReadOutcome { bytes, truncated });
        });
        rx
    }

    fn signal_kill_process_group(pid: u32) {
        #[cfg(unix)]
        {
            if pid > 0 && pid <= i32::MAX as u32 {
                // SIGKILL (9) to the isolated process group (-pgid) kills child + all descendants.
                unsafe {
                    kill(-(pid as i32), 9);
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
        }
    }

    fn poll_process_group_drained(pid: u32) -> u32 {
        #[cfg(unix)]
        {
            if pid > 0 && pid <= i32::MAX as u32 {
                let deadline = Instant::now() + Duration::from_secs(2);
                while Instant::now() < deadline {
                    let probe = unsafe { kill(-(pid as i32), 0) };
                    if probe != 0 {
                        return 0;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                return 1;
            }
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
        }
        0
    }

    pub fn spawn_job_process(
        request: HarnessJobProcessRequest,
    ) -> Result<HarnessRunningJob, HarnessSecurityError> {
        let mut cmd = Command::new(&request.executable);
        cmd.args(&request.args)
            .env_clear()
            .envs(&request.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let dir =
                open_anchored_parent_dir_unix(Path::new(&request.working_directory), &[], false)?;
            cmd.process_group(0);
            unsafe {
                cmd.pre_exec(move || {
                    if libc::fchdir(dir.as_raw_fd()) == 0 {
                        Ok(())
                    } else {
                        Err(std::io::Error::last_os_error())
                    }
                });
            }
        }
        #[cfg(not(unix))]
        cmd.current_dir(&request.working_directory);
        let mut child = cmd
            .spawn()
            .map_err(|err| HarnessSecurityError::new("process-spawn-failed", err.to_string()))?;
        let pid = child.id();
        let max_output = request.max_output_bytes.clamp(1024, 32 * 1024 * 1024);
        let stdout_rx = child
            .stdout
            .take()
            .map(|s| spawn_stream_drainer(s, max_output));
        let stderr_rx = child
            .stderr
            .take()
            .map(|s| spawn_stream_drainer(s, max_output));
        Ok(HarnessRunningJob {
            pid,
            child: Arc::new(Mutex::new(Some(child))),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            stdout_rx: Mutex::new(stdout_rx),
            stderr_rx: Mutex::new(stderr_rx),
        })
    }

    pub fn kill_job_process(job: &HarnessRunningJob) -> Result<u32, HarnessSecurityError> {
        job.killed.store(true, std::sync::atomic::Ordering::SeqCst);
        let (_, remaining) = finish_process_group(job)?;
        Ok(remaining)
    }

    fn finish_process_group(
        job: &HarnessRunningJob,
    ) -> Result<(Option<i32>, u32), HarnessSecurityError> {
        let mut guard = job
            .child
            .lock()
            .map_err(|_| HarnessSecurityError::new("process-lock-poisoned", "lock poisoned"))?;
        let Some(child) = guard.as_mut() else {
            return Ok((None, 0));
        };
        // The unreaped leader reserves its numeric identity through the final group signal.
        signal_kill_process_group(job.pid);
        let status = child
            .wait()
            .map_err(|err| HarnessSecurityError::new("process-wait-failed", err.to_string()))?;
        guard.take();
        Ok((status.code(), poll_process_group_drained(job.pid)))
    }

    #[cfg(unix)]
    fn child_exited(child: &mut std::process::Child) -> std::io::Result<bool> {
        let mut info = unsafe { std::mem::zeroed::<libc::siginfo_t>() };
        let rc = unsafe {
            libc::waitid(
                libc::P_PID,
                child.id(),
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if rc == 0 {
            return Ok(unsafe { info.si_pid() } != 0);
        }
        let err = std::io::Error::last_os_error();
        if err.kind() == std::io::ErrorKind::Interrupted {
            return Ok(false);
        }
        Err(err)
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
            if job.killed.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            if let Some(dl) = deadline {
                if Instant::now() >= dl {
                    timed_out = true;
                    break;
                }
            }
            let status = {
                let mut guard = job.child.lock().map_err(|_| {
                    HarnessSecurityError::new("process-lock-poisoned", "lock poisoned")
                })?;
                let Some(child) = guard.as_mut() else {
                    if job.killed.load(std::sync::atomic::Ordering::SeqCst) {
                        break;
                    }
                    return Err(HarnessSecurityError::new(
                        "process-already-waited",
                        "process handle already consumed",
                    ));
                };
                child_exited(child).map_err(|err| {
                    HarnessSecurityError::new("process-wait-failed", err.to_string())
                })?
            };
            if status {
                break;
            }
            std::thread::sleep(Duration::from_millis(15));
        }

        let killed = job.killed.load(std::sync::atomic::Ordering::SeqCst);
        let (exit_code, active_processes_remaining) = finish_process_group(job)?;

        let drain_timeout = if active_processes_remaining > 0 {
            Duration::from_millis(500)
        } else {
            Duration::from_secs(5)
        };
        let stdout_out = job
            .stdout_rx
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .and_then(|rx| rx.recv_timeout(drain_timeout).ok())
            .unwrap_or(PipeReadOutcome {
                bytes: Vec::new(),
                truncated: false,
            });
        let stderr_out = job
            .stderr_rx
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .and_then(|rx| rx.recv_timeout(drain_timeout).ok())
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

    #[cfg(not(unix))]
    fn ensure_no_symlinks_in_chain(
        root: &Path,
        segments: &[String],
        require_all_exist: bool,
    ) -> Result<(), HarnessSecurityError> {
        let mut current = root.to_path_buf();
        for seg in segments {
            current.push(seg);
            match std::fs::symlink_metadata(&current) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() {
                        return Err(HarnessSecurityError::new(
                            "reparse-point-rejected",
                            format!("symlink rejected at segment '{seg}'"),
                        ));
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound && !require_all_exist => {
                    return Ok(());
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    return Err(HarnessSecurityError::new("not-found", err.to_string()));
                }
                Err(err) => {
                    return Err(HarnessSecurityError::new("stat-failed", err.to_string()));
                }
            }
        }
        Ok(())
    }

    #[cfg(not(unix))]
    fn canonical_rel_posix(root: &Path, final_path: &Path) -> Result<String, HarnessSecurityError> {
        let rel = final_path.strip_prefix(root).map_err(|_| {
            HarnessSecurityError::new("workspace-escape", "resolved path escapes workspace root")
        })?;
        Ok(rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"))
    }

    #[cfg(not(unix))]
    fn verify_segments_match_posix(
        expected_segments: &[String],
        canonical_rel: &str,
    ) -> Result<(), HarnessSecurityError> {
        let actual: Vec<&str> = if canonical_rel.is_empty() {
            Vec::new()
        } else {
            canonical_rel.split('/').collect()
        };
        if actual.len() != expected_segments.len() {
            return Err(HarnessSecurityError::new(
                "path-alias-rejected",
                format!("resolved path '{canonical_rel}' does not match requested segments"),
            ));
        }
        for (exp, act) in expected_segments.iter().zip(actual.iter()) {
            #[cfg(target_os = "macos")]
            let matched = exp.to_lowercase() == act.to_lowercase();
            #[cfg(not(target_os = "macos"))]
            let matched = exp == act;
            if !matched {
                return Err(HarnessSecurityError::new(
                    "path-alias-rejected",
                    format!("resolved segment '{act}' does not match requested '{exp}'"),
                ));
            }
        }
        Ok(())
    }

    fn check_nlink_one(meta: &std::fs::Metadata) -> Result<u32, HarnessSecurityError> {
        #[cfg(unix)]
        {
            let nlink = meta.nlink() as u32;
            if nlink != 1 {
                return Err(HarnessSecurityError::new(
                    "hardlink-rejected",
                    format!("hardlink rejected (nlink = {nlink}, must be 1)"),
                ));
            }
            return Ok(nlink);
        }
        #[cfg(not(unix))]
        {
            let _ = meta;
            Ok(1)
        }
    }

    #[cfg(target_os = "macos")]
    fn remove_verified_entry(
        workspace: &Path,
        parent: i32,
        leaf: &std::ffi::CStr,
        root: Option<&str>,
        expected: (u64, u64),
    ) -> Result<(), HarnessSecurityError> {
        use std::ffi::CString;
        use std::os::fd::AsRawFd;
        let private = root.filter(|v| !v.is_empty()).ok_or_else(|| {
            HarnessSecurityError::new(
                "snapshot-root-required",
                "deletion needs a private custody directory",
            )
        })?;
        use std::ffi::CStr;
        use std::os::fd::{FromRawFd, OwnedFd};
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::MetadataExt;

        let snapshot_dir = std::fs::File::from(open_anchored_parent_dir_unix(
            Path::new(private),
            &[],
            false,
        )?);
        let mut staging_path = None;
        let custody = if snapshot_dir
            .metadata()
            .map_err(|e| HarnessSecurityError::new("snapshot-root-invalid", e.to_string()))?
            .dev()
            == expected.0
        {
            OwnedFd::from(snapshot_dir)
        } else {
            extern "C" {
                fn nimi_open_delete_staging(
                    parent: i32,
                    workspace: *const libc::c_char,
                    path: *mut libc::c_char,
                    capacity: usize,
                ) -> i32;
            }
            let workspace = CString::new(workspace.as_os_str().as_bytes()).map_err(|_| {
                HarnessSecurityError::new("invalid-workspace-root", "root contains NUL")
            })?;
            let mut path = [0 as libc::c_char; libc::PATH_MAX as usize];
            let fd = unsafe {
                nimi_open_delete_staging(parent, workspace.as_ptr(), path.as_mut_ptr(), path.len())
            };
            if fd < 0 {
                return Err(HarnessSecurityError::new(
                    "private-staging-unavailable",
                    std::io::Error::last_os_error().to_string(),
                ));
            }
            staging_path = Some(std::path::PathBuf::from(std::ffi::OsStr::from_bytes(
                unsafe { CStr::from_ptr(path.as_ptr()) }.to_bytes(),
            )));
            unsafe { OwnedFd::from_raw_fd(fd) }
        };
        let private = staging_path.as_deref().unwrap_or(Path::new(private));
        let mut nonce = [0u8; 16];
        unsafe {
            libc::arc4random_buf(nonce.as_mut_ptr().cast(), nonce.len());
        }
        let name = format!("pending-delete-{}", u128::from_ne_bytes(nonce));
        let held = CString::new(name.as_str()).unwrap();
        let dest = custody.as_raw_fd();
        // Take exclusive custody before choosing whether to unlink. Never unlink a name in
        // the mutable workspace after checking its inode.
        let claim = unsafe {
            libc::renameatx_np(
                parent,
                leaf.as_ptr(),
                dest,
                held.as_ptr(),
                libc::RENAME_EXCL,
            )
        };
        if claim != 0 {
            let err = std::io::Error::last_os_error();
            if let Some(path) = &staging_path {
                let _ = std::fs::remove_dir(path);
            }
            return Err(HarnessSecurityError::new("delete-failed", err.to_string()));
        }
        let mut st: libc::stat = unsafe { std::mem::zeroed() };
        let checked =
            unsafe { libc::fstatat(dest, held.as_ptr(), &mut st, libc::AT_SYMLINK_NOFOLLOW) };
        if checked != 0 || (st.st_dev as u64, st.st_ino as u64) != expected || st.st_nlink != 1 {
            let restored = unsafe {
                libc::renameatx_np(
                    dest,
                    held.as_ptr(),
                    parent,
                    leaf.as_ptr(),
                    libc::RENAME_EXCL,
                )
            };
            if restored == 0 {
                if let Some(path) = &staging_path {
                    let _ = std::fs::remove_dir(path);
                }
            }
            return Err(HarnessSecurityError::new(
                "precondition-failed",
                if restored == 0 {
                    "Target changed before deletion; the displaced entry was restored.".to_owned()
                } else {
                    format!(
                        "Target changed. The displaced entry was preserved at {}",
                        Path::new(private).join(name).display()
                    )
                },
            ));
        }
        if unsafe { libc::unlinkat(dest, held.as_ptr(), 0) } != 0 {
            return Err(HarnessSecurityError::new(
                "delete-failed",
                format!(
                    "File retained in custody at {}",
                    Path::new(private).join(name).display()
                ),
            ));
        }
        if let Some(path) = staging_path {
            let _ = std::fs::remove_dir(path);
        }
        Ok(())
    }

    #[cfg(unix)]
    fn open_anchored_parent_dir_unix(
        root: &Path,
        parent_segments: &[String],
        create_missing: bool,
    ) -> Result<std::os::unix::io::OwnedFd, HarnessSecurityError> {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::io::{AsRawFd, FromRawFd, OwnedFd};

        #[cfg(target_os = "macos")]
        let root = anchored_root(root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let root_c = CString::new(root.as_os_str().as_bytes()).map_err(|_| {
            HarnessSecurityError::new("invalid-workspace-root", "root path contains NUL")
        })?;
        #[cfg(target_os = "macos")]
        let no_links = libc::O_NOFOLLOW_ANY;
        #[cfg(not(target_os = "macos"))]
        let no_links = libc::O_NOFOLLOW;
        let root_fd = unsafe {
            libc::open(
                root_c.as_ptr(),
                no_links | libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if root_fd < 0 {
            return Err(HarnessSecurityError::new(
                "invalid-workspace-root",
                std::io::Error::last_os_error().to_string(),
            ));
        }
        let mut dir_fd = unsafe { OwnedFd::from_raw_fd(root_fd) };
        for seg in parent_segments {
            let seg_c = CString::new(seg.as_bytes())
                .map_err(|_| HarnessSecurityError::new("invalid-path", "segment contains NUL"))?;
            let next_fd = unsafe {
                libc::openat(
                    dir_fd.as_raw_fd(),
                    seg_c.as_ptr(),
                    libc::O_RDONLY
                        | libc::O_DIRECTORY
                        | libc::O_NONBLOCK
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                )
            };
            if next_fd >= 0 {
                dir_fd = unsafe { OwnedFd::from_raw_fd(next_fd) };
                continue;
            }
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::ELOOP) {
                return Err(HarnessSecurityError::new(
                    "reparse-point-rejected",
                    format!("symlink rejected at parent segment '{seg}'"),
                ));
            }
            if err.kind() == std::io::ErrorKind::NotFound && create_missing {
                let mk = unsafe { libc::mkdirat(dir_fd.as_raw_fd(), seg_c.as_ptr(), 0o755) };
                if mk < 0 {
                    let mk_err = std::io::Error::last_os_error();
                    if mk_err.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(HarnessSecurityError::new(
                            "write-failed",
                            mk_err.to_string(),
                        ));
                    }
                }
                let created_fd = unsafe {
                    libc::openat(
                        dir_fd.as_raw_fd(),
                        seg_c.as_ptr(),
                        libc::O_RDONLY
                            | libc::O_DIRECTORY
                            | libc::O_NONBLOCK
                            | libc::O_NOFOLLOW
                            | libc::O_CLOEXEC,
                    )
                };
                if created_fd < 0 {
                    let open_err = std::io::Error::last_os_error();
                    if open_err.raw_os_error() == Some(libc::ELOOP) {
                        return Err(HarnessSecurityError::new(
                            "reparse-point-rejected",
                            format!("symlink rejected at parent segment '{seg}'"),
                        ));
                    }
                    return Err(HarnessSecurityError::new(
                        "write-failed",
                        open_err.to_string(),
                    ));
                }
                dir_fd = unsafe { OwnedFd::from_raw_fd(created_fd) };
                continue;
            }
            return Err(HarnessSecurityError::new(
                if err.kind() == std::io::ErrorKind::NotFound {
                    "not-found"
                } else {
                    "open-failed"
                },
                err.to_string(),
            ));
        }
        Ok(dir_fd)
    }

    fn anchored_root(path: impl AsRef<Path>) -> std::io::Result<std::path::PathBuf> {
        #[cfg(target_os = "macos")]
        {
            let path = path.as_ref();
            if !path.is_absolute()
                || path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "absolute canonical workspace root required",
                ));
            }
            // These system-owned links are aliases of directories on the macOS data volume.
            // Resolve only the alias, leaving every workspace-controlled component to openat.
            for alias in ["/var", "/tmp", "/etc"] {
                if let Ok(tail) = path.strip_prefix(alias) {
                    let canonical = std::fs::canonicalize(alias)?;
                    return Ok(canonical.join(tail));
                }
            }
            Ok(path.to_owned())
        }
        #[cfg(not(target_os = "macos"))]
        std::fs::canonicalize(path)
    }

    fn write_snapshot_file_posix(
        snapshot_root: Option<&str>,
        snapshot_path: &str,
        bytes: &[u8],
    ) -> Result<(), HarnessSecurityError> {
        let Some(root_str) = snapshot_root.map(str::trim).filter(|s| !s.is_empty()) else {
            return Err(HarnessSecurityError::new(
                "snapshot-root-required",
                "snapshot_root is required whenever snapshot_path is provided",
            ));
        };
        let raw_path = Path::new(snapshot_path);
        let root = anchored_root(root_str)
            .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
        let rel = raw_path
            .strip_prefix(Path::new(root_str))
            .or_else(|_| raw_path.strip_prefix(&root))
            .map_err(|_| {
                HarnessSecurityError::new(
                    "snapshot-escape",
                    "snapshot_path escapes declared snapshot_root",
                )
            })?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let segments = validate_relative_workspace_path(&rel_str, false)?;
        let leaf = segments.last().ok_or_else(|| {
            HarnessSecurityError::new("snapshot-failed", "snapshot path missing leaf")
        })?;
        #[cfg(unix)]
        let mut f = {
            use std::ffi::CString;
            use std::os::unix::io::{AsRawFd, FromRawFd};
            let parent_fd =
                open_anchored_parent_dir_unix(&root, &segments[..segments.len() - 1], true)?;
            let leaf_c = CString::new(leaf.as_bytes())
                .map_err(|_| HarnessSecurityError::new("snapshot-failed", "leaf contains NUL"))?;
            let fd = unsafe {
                libc::openat(
                    parent_fd.as_raw_fd(),
                    leaf_c.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_NONBLOCK
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600 as libc::c_uint,
                )
            };
            if fd < 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ELOOP) {
                    return Err(HarnessSecurityError::new(
                        "reparse-point-rejected",
                        "snapshot target is a symlink",
                    ));
                }
                return Err(HarnessSecurityError::new(
                    "snapshot-failed",
                    err.to_string(),
                ));
            }
            unsafe { std::fs::File::from_raw_fd(fd) }
        };
        #[cfg(not(unix))]
        let mut f = {
            let mut out = root;
            for seg in &segments {
                out.push(seg);
            }
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .open(&out)
                .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?
        };
        let meta = f
            .metadata()
            .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
        if !meta.is_file() {
            return Err(HarnessSecurityError::new(
                "snapshot-failed",
                "snapshot target is not a regular file",
            ));
        }
        check_nlink_one(&meta)?;
        f.set_len(0)
            .and_then(|_| f.seek(SeekFrom::Start(0)))
            .and_then(|_| f.write_all(bytes))
            .and_then(|_| f.sync_all())
            .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
        Ok(())
    }

    #[cfg(unix)]
    fn unix_fstat_dev_ino(meta: &std::fs::Metadata) -> (u64, u64) {
        use std::os::unix::fs::MetadataExt;
        (meta.dev(), meta.ino())
    }

    pub fn verify_workspace_path(
        workspace_root: &Path,
        relative_path: &str,
        expect_directory: bool,
    ) -> Result<HarnessVerifiedPath, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(relative_path, expect_directory)?;
        let root = anchored_root(workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let lexical_rel = segments.join("/");
        if !expect_directory && is_sensitive_relative_path(&lexical_rel) {
            return Err(HarnessSecurityError::new(
                "sensitive-path-rejected",
                format!("access to sensitive file '{lexical_rel}' is blocked"),
            ));
        }

        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::unix::io::{AsRawFd, FromRawFd, IntoRawFd};

            let (file, final_path) = if segments.is_empty() {
                let root_fd = open_anchored_parent_dir_unix(&root, &[], false)?;
                (
                    unsafe { std::fs::File::from_raw_fd(root_fd.into_raw_fd()) },
                    root.clone(),
                )
            } else {
                let parent_fd =
                    open_anchored_parent_dir_unix(&root, &segments[..segments.len() - 1], false)?;
                let leaf = &segments[segments.len() - 1];
                let leaf_c = CString::new(leaf.as_bytes())
                    .map_err(|_| HarnessSecurityError::new("invalid-path", "leaf contains NUL"))?;
                let flags = if expect_directory {
                    libc::O_RDONLY
                        | libc::O_DIRECTORY
                        | libc::O_NONBLOCK
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC
                } else {
                    libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC
                };
                let fd = unsafe { libc::openat(parent_fd.as_raw_fd(), leaf_c.as_ptr(), flags) };
                if fd < 0 {
                    let err = std::io::Error::last_os_error();
                    let raw = err.raw_os_error();
                    if raw == Some(libc::ELOOP) {
                        return Err(HarnessSecurityError::new(
                            "reparse-point-rejected",
                            "target is a symbolic link",
                        ));
                    }
                    if raw == Some(libc::ENOTDIR) {
                        return Err(HarnessSecurityError::new(
                            "not-directory",
                            "target is not a directory",
                        ));
                    }
                    if err.kind() == std::io::ErrorKind::NotFound {
                        return Err(HarnessSecurityError::new("not-found", err.to_string()));
                    }
                    return Err(HarnessSecurityError::new("open-failed", err.to_string()));
                }
                let mut target = root.clone();
                for seg in &segments {
                    target.push(seg);
                }
                (unsafe { std::fs::File::from_raw_fd(fd) }, target)
            };
            let meta = file
                .metadata()
                .map_err(|err| HarnessSecurityError::new("stat-failed", err.to_string()))?;
            if expect_directory && !meta.is_dir() {
                return Err(HarnessSecurityError::new(
                    "not-directory",
                    "target is not a directory",
                ));
            }
            let mut n_number_of_links = 1;
            if !expect_directory {
                if meta.is_dir() {
                    return Err(HarnessSecurityError::new(
                        "is-directory",
                        "target is a directory",
                    ));
                }
                if !meta.is_file() {
                    return Err(HarnessSecurityError::new(
                        "invalid-file-type",
                        "target is not a regular file",
                    ));
                }
                n_number_of_links = check_nlink_one(&meta)?;
            }
            return Ok(HarnessVerifiedPath {
                canonical_workspace_root: root.to_string_lossy().into_owned(),
                final_path: final_path.to_string_lossy().into_owned(),
                relative_path: lexical_rel,
                is_directory: meta.is_dir(),
                size_bytes: meta.len(),
                object_id: metadata_identity(&meta),
                n_number_of_links,
            });
        }

        #[cfg(not(unix))]
        {
            ensure_no_symlinks_in_chain(&root, &segments, true)?;
            let mut target = root.clone();
            for seg in &segments {
                target.push(seg);
            }
            let final_path = std::fs::canonicalize(&target)
                .map_err(|err| HarnessSecurityError::new("not-found", err.to_string()))?;
            let canonical_rel = canonical_rel_posix(&root, &final_path)?;
            verify_segments_match_posix(&segments, &canonical_rel)?;
            if !expect_directory && is_sensitive_relative_path(&canonical_rel) {
                return Err(HarnessSecurityError::new(
                    "sensitive-path-rejected",
                    format!("access to sensitive file '{canonical_rel}' is blocked"),
                ));
            }
            let meta = std::fs::symlink_metadata(&final_path)
                .map_err(|err| HarnessSecurityError::new("stat-failed", err.to_string()))?;
            if meta.file_type().is_symlink() {
                return Err(HarnessSecurityError::new(
                    "reparse-point-rejected",
                    "target is a symbolic link",
                ));
            }
            if expect_directory && !meta.is_dir() {
                return Err(HarnessSecurityError::new(
                    "not-directory",
                    "target is not a directory",
                ));
            }
            let mut n_number_of_links = 1;
            if !expect_directory {
                if meta.is_dir() {
                    return Err(HarnessSecurityError::new(
                        "is-directory",
                        "target is a directory",
                    ));
                }
                n_number_of_links = check_nlink_one(&meta)?;
            }
            Ok(HarnessVerifiedPath {
                canonical_workspace_root: root.to_string_lossy().into_owned(),
                final_path: final_path.to_string_lossy().into_owned(),
                relative_path: canonical_rel,
                is_directory: meta.is_dir(),
                size_bytes: meta.len(),
                object_id: metadata_identity(&meta),
                n_number_of_links,
            })
        }
    }

    #[cfg(unix)]
    fn metadata_identity(meta: &std::fs::Metadata) -> String {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", meta.dev(), meta.ino())
    }

    #[cfg(not(unix))]
    fn metadata_identity(_: &std::fs::Metadata) -> String {
        String::new()
    }

    #[cfg(unix)]
    pub fn list_workspace_directory(
        root: &Path,
        relative: &str,
    ) -> Result<Vec<(String, bool, u64, i64)>, HarnessSecurityError> {
        use std::ffi::CStr;
        use std::os::fd::{AsRawFd, IntoRawFd};
        let segments = validate_relative_workspace_path(relative, true)?;
        let root = anchored_root(root)
            .map_err(|e| HarnessSecurityError::new("invalid-workspace-root", e.to_string()))?;
        let fd = open_anchored_parent_dir_unix(&root, &segments, false)?;
        let dir = unsafe { libc::fdopendir(fd.as_raw_fd()) };
        if dir.is_null() {
            return Err(HarnessSecurityError::new(
                "open-failed",
                std::io::Error::last_os_error().to_string(),
            ));
        }
        let owned = fd.into_raw_fd();
        let mut entries = Vec::new();
        loop {
            let entry = unsafe { libc::readdir(dir) };
            if entry.is_null() {
                break;
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            let Ok(text) = name.to_str() else { continue };
            if text == "." || text == ".." {
                continue;
            }
            let mut st = unsafe { std::mem::zeroed::<libc::stat>() };
            if unsafe { libc::fstatat(owned, name.as_ptr(), &mut st, libc::AT_SYMLINK_NOFOLLOW) }
                != 0
            {
                continue;
            }
            let kind = st.st_mode & libc::S_IFMT;
            if kind == libc::S_IFDIR || (kind == libc::S_IFREG && st.st_nlink == 1) {
                entries.push((
                    text.to_owned(),
                    kind == libc::S_IFDIR,
                    st.st_size.max(0) as u64,
                    st.st_mtime.saturating_mul(1000),
                ));
            }
        }
        unsafe { libc::closedir(dir) };
        Ok(entries)
    }

    pub fn secure_read_file(
        workspace_root: &Path,
        relative_path: &str,
        max_bytes: usize,
    ) -> Result<HarnessSecureReadResult, HarnessSecurityError> {
        secure_read_range(workspace_root, relative_path, max_bytes, None)
    }

    pub fn secure_read_range(
        workspace_root: &Path,
        relative_path: &str,
        max_bytes: usize,
        offset: Option<u64>,
    ) -> Result<HarnessSecureReadResult, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(relative_path, false)?;
        let root = anchored_root(workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let lexical_rel = segments.join("/");
        if is_sensitive_relative_path(&lexical_rel) {
            return Err(HarnessSecurityError::new(
                "sensitive-path-rejected",
                format!("access to sensitive file '{lexical_rel}' is blocked"),
            ));
        }

        #[cfg(unix)]
        let (mut file, final_path_str) = {
            use std::ffi::CString;
            use std::os::unix::io::{AsRawFd, FromRawFd};

            let parent_fd =
                open_anchored_parent_dir_unix(&root, &segments[..segments.len() - 1], false)?;
            let leaf = &segments[segments.len() - 1];
            let leaf_c = CString::new(leaf.as_bytes())
                .map_err(|_| HarnessSecurityError::new("invalid-path", "leaf contains NUL"))?;
            let fd = unsafe {
                libc::openat(
                    parent_fd.as_raw_fd(),
                    leaf_c.as_ptr(),
                    libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ELOOP) {
                    return Err(HarnessSecurityError::new(
                        "reparse-point-rejected",
                        "target is a symbolic link",
                    ));
                }
                if err.kind() == std::io::ErrorKind::NotFound {
                    return Err(HarnessSecurityError::new("not-found", err.to_string()));
                }
                return Err(HarnessSecurityError::new("read-failed", err.to_string()));
            }
            let mut target = root.clone();
            for seg in &segments {
                target.push(seg);
            }
            (
                unsafe { std::fs::File::from_raw_fd(fd) },
                target.to_string_lossy().into_owned(),
            )
        };

        #[cfg(not(unix))]
        let (mut file, final_path_str) = {
            let verified = verify_workspace_path(workspace_root, relative_path, false)?;
            let f = std::fs::OpenOptions::new()
                .read(true)
                .open(&verified.final_path)
                .map_err(|err| HarnessSecurityError::new("read-failed", err.to_string()))?;
            (f, verified.final_path)
        };

        let meta = file
            .metadata()
            .map_err(|err| HarnessSecurityError::new("stat-failed", err.to_string()))?;
        if meta.is_dir() {
            return Err(HarnessSecurityError::new(
                "is-directory",
                "target is a directory",
            ));
        }
        if !meta.is_file() {
            return Err(HarnessSecurityError::new(
                "invalid-file-type",
                "target is not a regular file",
            ));
        }
        let nlink = check_nlink_one(&meta)?;
        if offset.is_none() && meta.len() > max_bytes as u64 {
            return Err(HarnessSecurityError::new(
                "file-too-large",
                "file exceeds maximum allowed read size",
            ));
        }
        let mut content = Vec::new();
        if let Some(start) = offset {
            file.seek(SeekFrom::Start(start))
                .map_err(|e| HarnessSecurityError::new("read-failed", e.to_string()))?;
        }
        let limit = if offset.is_some() {
            max_bytes as u64
        } else {
            (max_bytes as u64).saturating_add(1)
        };
        file.take(limit)
            .read_to_end(&mut content)
            .map_err(|err| HarnessSecurityError::new("read-failed", err.to_string()))?;
        if content.len() > max_bytes {
            return Err(HarnessSecurityError::new(
                "file-too-large",
                "file exceeds maximum allowed read size",
            ));
        }
        let sha256 = sha256_hex(&content);
        Ok(HarnessSecureReadResult {
            final_path: final_path_str,
            size_bytes: meta.len(),
            object_id: metadata_identity(&meta),
            content,
            sha256,
            n_number_of_links: nlink,
        })
    }

    pub fn secure_write_file(
        request: HarnessSecureWriteRequest,
    ) -> Result<HarnessSecureWriteResult, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(&request.relative_path, false)?;
        let root = anchored_root(&request.workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let lexical_rel = segments.join("/");
        if is_sensitive_relative_path(&lexical_rel) {
            return Err(HarnessSecurityError::new(
                "sensitive-path-rejected",
                format!("write to sensitive file '{lexical_rel}' is blocked"),
            ));
        }
        let mut target = root.clone();
        for seg in &segments {
            target.push(seg);
        }

        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::unix::io::{AsRawFd, FromRawFd};

            let parent_fd = open_anchored_parent_dir_unix(
                &root,
                &segments[..segments.len() - 1],
                request.allow_create
                    && request
                        .precondition_sha256
                        .as_deref()
                        .unwrap_or("")
                        .is_empty(),
            )?;
            let leaf = &segments[segments.len() - 1];
            let leaf_c = CString::new(leaf.as_bytes())
                .map_err(|_| HarnessSecurityError::new("invalid-path", "leaf contains NUL"))?;

            // Try opening existing file via anchored parent FD WITHOUT O_TRUNC so nlink,
            // regular-file, and CAS precondition checks ALL succeed BEFORE any truncation!
            if !request.must_not_exist {
                let fd = unsafe {
                    libc::openat(
                        parent_fd.as_raw_fd(),
                        leaf_c.as_ptr(),
                        libc::O_RDWR | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                };
                if fd >= 0 {
                    let mut f = unsafe { std::fs::File::from_raw_fd(fd) };
                    let meta = f
                        .metadata()
                        .map_err(|err| HarnessSecurityError::new("stat-failed", err.to_string()))?;
                    if meta.is_dir() {
                        return Err(HarnessSecurityError::new(
                            "is-directory",
                            "target is a directory",
                        ));
                    }
                    if !meta.is_file() {
                        return Err(HarnessSecurityError::new(
                            "invalid-file-type",
                            "target is not a regular file",
                        ));
                    }
                    check_nlink_one(&meta)?;
                    let mut existing_bytes = Vec::new();
                    (&f).take(64 * 1024 * 1024 + 1)
                        .read_to_end(&mut existing_bytes)
                        .map_err(|err| HarnessSecurityError::new("read-failed", err.to_string()))?;
                    if existing_bytes.len() > 64 * 1024 * 1024 {
                        return Err(HarnessSecurityError::new(
                            "file-too-large",
                            "existing file exceeds 64MiB write limit",
                        ));
                    }
                    let existing_sha = sha256_hex(&existing_bytes);
                    if let Some(expected) = request.precondition_sha256.as_deref() {
                        if !expected.is_empty() && expected != existing_sha {
                            return Err(HarnessSecurityError::new(
                                "precondition-failed",
                                "file hash mismatch before write",
                            ));
                        }
                    }
                    let mut snapshot_written = false;
                    if let Some(snap) = request.snapshot_path.as_deref() {
                        write_snapshot_file_posix(
                            request.snapshot_root.as_deref(),
                            snap,
                            &existing_bytes,
                        )?;
                        snapshot_written = true;
                    }
                    f.seek(SeekFrom::Start(0))
                        .and_then(|_| f.set_len(0))
                        .and_then(|_| f.write_all(&request.content))
                        .and_then(|_| f.sync_all())
                        .map_err(|err| {
                            HarnessSecurityError::new("write-failed", err.to_string())
                        })?;
                    return Ok(HarnessSecureWriteResult {
                        final_path: target.to_string_lossy().into_owned(),
                        sha256: sha256_hex(&request.content),
                        previous_sha256: Some(existing_sha),
                        bytes_written: request.content.len() as u64,
                        created: false,
                        snapshot_written,
                    });
                }
                let open_err = std::io::Error::last_os_error();
                if open_err.raw_os_error() == Some(libc::ELOOP) {
                    return Err(HarnessSecurityError::new(
                        "reparse-point-rejected",
                        "target is a symbolic link",
                    ));
                }
                if open_err.raw_os_error() == Some(libc::EISDIR) {
                    return Err(HarnessSecurityError::new(
                        "is-directory",
                        "target is a directory",
                    ));
                }
                if open_err.kind() != std::io::ErrorKind::NotFound {
                    return Err(HarnessSecurityError::new(
                        "write-failed",
                        open_err.to_string(),
                    ));
                }
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

            let new_fd = unsafe {
                libc::openat(
                    parent_fd.as_raw_fd(),
                    leaf_c.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NONBLOCK
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600 as libc::c_uint,
                )
            };
            if new_fd < 0 {
                let err = std::io::Error::last_os_error();
                if err.kind() == std::io::ErrorKind::AlreadyExists {
                    return Err(HarnessSecurityError::new(
                        "already-exists",
                        "target file already exists",
                    ));
                }
                if err.raw_os_error() == Some(libc::ELOOP) {
                    return Err(HarnessSecurityError::new(
                        "reparse-point-rejected",
                        "target is a symbolic link",
                    ));
                }
                return Err(HarnessSecurityError::new("write-failed", err.to_string()));
            }
            let mut f = unsafe { std::fs::File::from_raw_fd(new_fd) };
            // The leaf may already have changed owner. Never clean it up by its old name.
            let meta_after = f
                .metadata()
                .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
            if !meta_after.is_file() || check_nlink_one(&meta_after).is_err() {
                return Err(HarnessSecurityError::new(
                    "hardlink-rejected",
                    "newly created file failed regular-file/nlink verification",
                ));
            }
            f.write_all(&request.content)
                .and_then(|_| f.sync_all())
                .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
            return Ok(HarnessSecureWriteResult {
                final_path: target.to_string_lossy().into_owned(),
                sha256: sha256_hex(&request.content),
                previous_sha256: None,
                bytes_written: request.content.len() as u64,
                created: true,
                snapshot_written: false,
            });
        }

        #[cfg(not(unix))]
        {
            ensure_no_symlinks_in_chain(&root, &segments, false)?;
            if segments.len() > 1 {
                let mut dir = root.clone();
                for seg in &segments[..segments.len() - 1] {
                    dir.push(seg);
                    match std::fs::symlink_metadata(&dir) {
                        Ok(meta) => {
                            if meta.file_type().is_symlink() {
                                return Err(HarnessSecurityError::new(
                                    "reparse-point-rejected",
                                    format!("symlink rejected at parent segment '{seg}'"),
                                ));
                            }
                            if !meta.is_dir() {
                                return Err(HarnessSecurityError::new(
                                    "not-directory",
                                    format!("parent segment '{seg}' is not a directory"),
                                ));
                            }
                        }
                        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                            if !request.allow_create {
                                return Err(HarnessSecurityError::new(
                                    "not-found",
                                    "parent directory does not exist and allow_create is false",
                                ));
                            }
                            std::fs::create_dir(&dir).map_err(|e| {
                                HarnessSecurityError::new("write-failed", e.to_string())
                            })?;
                        }
                        Err(err) => {
                            return Err(HarnessSecurityError::new("stat-failed", err.to_string()));
                        }
                    }
                }
                let parent_real = std::fs::canonicalize(&dir)
                    .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
                let _ = canonical_rel_posix(&root, &parent_real)?;
            }

            if !request.must_not_exist {
                match std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(&target)
                {
                    Ok(mut f) => {
                        let meta = f.metadata().map_err(|err| {
                            HarnessSecurityError::new("stat-failed", err.to_string())
                        })?;
                        if !meta.is_file() {
                            return Err(HarnessSecurityError::new(
                                "is-directory",
                                "target is not a regular file",
                            ));
                        }
                        check_nlink_one(&meta)?;
                        let final_path = std::fs::canonicalize(&target).map_err(|err| {
                            HarnessSecurityError::new("write-failed", err.to_string())
                        })?;
                        let canonical_rel = canonical_rel_posix(&root, &final_path)?;
                        verify_segments_match_posix(&segments, &canonical_rel)?;
                        if is_sensitive_relative_path(&canonical_rel) {
                            return Err(HarnessSecurityError::new(
                                "sensitive-path-rejected",
                                format!("write to sensitive file '{canonical_rel}' is blocked"),
                            ));
                        }
                        let mut existing_bytes = Vec::new();
                        (&f).take(64 * 1024 * 1024 + 1)
                            .read_to_end(&mut existing_bytes)
                            .map_err(|err| {
                                HarnessSecurityError::new("read-failed", err.to_string())
                            })?;
                        if existing_bytes.len() > 64 * 1024 * 1024 {
                            return Err(HarnessSecurityError::new(
                                "file-too-large",
                                "existing file exceeds 64MiB write limit",
                            ));
                        }
                        let existing_sha = sha256_hex(&existing_bytes);
                        if let Some(expected) = request.precondition_sha256.as_deref() {
                            if !expected.is_empty() && expected != existing_sha {
                                return Err(HarnessSecurityError::new(
                                    "precondition-failed",
                                    "file hash mismatch before write",
                                ));
                            }
                        }
                        let mut snapshot_written = false;
                        if let Some(snap) = request.snapshot_path.as_deref() {
                            write_snapshot_file_posix(
                                request.snapshot_root.as_deref(),
                                snap,
                                &existing_bytes,
                            )?;
                            snapshot_written = true;
                        }
                        f.seek(SeekFrom::Start(0))
                            .and_then(|_| f.set_len(0))
                            .and_then(|_| f.write_all(&request.content))
                            .and_then(|_| f.sync_all())
                            .map_err(|err| {
                                HarnessSecurityError::new("write-failed", err.to_string())
                            })?;
                        return Ok(HarnessSecureWriteResult {
                            final_path: final_path.to_string_lossy().into_owned(),
                            sha256: sha256_hex(&request.content),
                            previous_sha256: Some(existing_sha),
                            bytes_written: request.content.len() as u64,
                            created: false,
                            snapshot_written,
                        });
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                    Err(err) => {
                        return Err(HarnessSecurityError::new("write-failed", err.to_string()));
                    }
                }
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

            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|err| {
                    if err.kind() == std::io::ErrorKind::AlreadyExists {
                        HarnessSecurityError::new("already-exists", err.to_string())
                    } else {
                        HarnessSecurityError::new("write-failed", err.to_string())
                    }
                })?;
            let final_path = std::fs::canonicalize(&target)
                .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
            f.write_all(&request.content)
                .and_then(|_| f.sync_all())
                .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
            Ok(HarnessSecureWriteResult {
                final_path: final_path.to_string_lossy().into_owned(),
                sha256: sha256_hex(&request.content),
                previous_sha256: None,
                bytes_written: request.content.len() as u64,
                created: true,
                snapshot_written: false,
            })
        }
    }

    pub fn secure_delete_file(
        request: HarnessSecureDeleteRequest,
    ) -> Result<HarnessSecureDeleteResult, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(&request.relative_path, false)?;
        let root = anchored_root(&request.workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let lexical_rel = segments.join("/");
        if is_sensitive_relative_path(&lexical_rel) {
            return Err(HarnessSecurityError::new(
                "sensitive-path-rejected",
                format!("delete of sensitive file '{lexical_rel}' is blocked"),
            ));
        }

        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::unix::io::{AsRawFd, FromRawFd};

            let parent_fd =
                open_anchored_parent_dir_unix(&root, &segments[..segments.len() - 1], false)?;
            let leaf = &segments[segments.len() - 1];
            let leaf_c = CString::new(leaf.as_bytes())
                .map_err(|_| HarnessSecurityError::new("invalid-path", "leaf contains NUL"))?;
            let fd = unsafe {
                libc::openat(
                    parent_fd.as_raw_fd(),
                    leaf_c.as_ptr(),
                    libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ELOOP) {
                    return Err(HarnessSecurityError::new(
                        "reparse-point-rejected",
                        "target is a symbolic link",
                    ));
                }
                if err.kind() == std::io::ErrorKind::NotFound {
                    return Err(HarnessSecurityError::new("not-found", err.to_string()));
                }
                return Err(HarnessSecurityError::new("delete-failed", err.to_string()));
            }
            let file = unsafe { std::fs::File::from_raw_fd(fd) };
            let meta = file
                .metadata()
                .map_err(|err| HarnessSecurityError::new("stat-failed", err.to_string()))?;
            if meta.is_dir() {
                return Err(HarnessSecurityError::new(
                    "is-directory",
                    "target is a directory",
                ));
            }
            if !meta.is_file() {
                return Err(HarnessSecurityError::new(
                    "invalid-file-type",
                    "target is not a regular file",
                ));
            }
            check_nlink_one(&meta)?;
            let (open_dev, open_ino) = unix_fstat_dev_ino(&meta);
            let mut content = Vec::new();
            (&file)
                .take(64 * 1024 * 1024 + 1)
                .read_to_end(&mut content)
                .map_err(|err| HarnessSecurityError::new("read-failed", err.to_string()))?;
            if content.len() > 64 * 1024 * 1024 {
                return Err(HarnessSecurityError::new(
                    "file-too-large",
                    "target file exceeds 64MiB delete limit",
                ));
            }
            let sha = sha256_hex(&content);
            if let Some(expected) = request.precondition_sha256.as_deref() {
                if !expected.is_empty() && expected != sha {
                    return Err(HarnessSecurityError::new(
                        "precondition-failed",
                        "file hash mismatch before delete",
                    ));
                }
            }
            let mut snapshot_written = false;
            if let Some(snap) = request.snapshot_path.as_deref() {
                write_snapshot_file_posix(request.snapshot_root.as_deref(), snap, &content)?;
                snapshot_written = true;
            }
            #[cfg(target_os = "macos")]
            remove_verified_entry(
                &root,
                parent_fd.as_raw_fd(),
                &leaf_c,
                request.snapshot_root.as_deref(),
                (open_dev, open_ino),
            )?;
            #[cfg(not(target_os = "macos"))]
            {
                // Verify directory entry still points to the exact same (st_dev, st_ino) before unlinkat.
                let mut st: libc::stat = unsafe { std::mem::zeroed() };
                let rc = unsafe {
                    libc::fstatat(
                        parent_fd.as_raw_fd(),
                        leaf_c.as_ptr(),
                        &mut st,
                        libc::AT_SYMLINK_NOFOLLOW,
                    )
                };
                if rc != 0 {
                    return Err(HarnessSecurityError::new(
                        "delete-failed",
                        std::io::Error::last_os_error().to_string(),
                    ));
                }
                if (st.st_dev as u64) != open_dev || (st.st_ino as u64) != open_ino {
                    return Err(HarnessSecurityError::new(
                        "precondition-failed",
                        "target file inode changed before delete",
                    ));
                }
                let unlink_rc =
                    unsafe { libc::unlinkat(parent_fd.as_raw_fd(), leaf_c.as_ptr(), 0) };
                if unlink_rc != 0 {
                    return Err(HarnessSecurityError::new(
                        "delete-failed",
                        std::io::Error::last_os_error().to_string(),
                    ));
                }
            }
            let mut target = root.clone();
            for seg in &segments {
                target.push(seg);
            }
            return Ok(HarnessSecureDeleteResult {
                final_path: target.to_string_lossy().into_owned(),
                previous_sha256: sha,
                snapshot_written,
            });
        }

        #[cfg(not(unix))]
        {
            let read = secure_read_file(
                Path::new(&request.workspace_root),
                &request.relative_path,
                64 * 1024 * 1024,
            )?;
            if let Some(expected) = request.precondition_sha256.as_deref() {
                if !expected.is_empty() && expected != read.sha256 {
                    return Err(HarnessSecurityError::new(
                        "precondition-failed",
                        "file hash mismatch before delete",
                    ));
                }
            }
            let mut snapshot_written = false;
            if let Some(snap) = request.snapshot_path.as_deref() {
                write_snapshot_file_posix(request.snapshot_root.as_deref(), snap, &read.content)?;
                snapshot_written = true;
            }
            std::fs::remove_file(&read.final_path)
                .map_err(|err| HarnessSecurityError::new("delete-failed", err.to_string()))?;
            Ok(HarnessSecureDeleteResult {
                final_path: read.final_path,
                previous_sha256: read.sha256,
                snapshot_written,
            })
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub use non_windows_fallback::{
    kill_job_process, list_workspace_directory, run_job_process, secure_delete_file,
    secure_read_file, secure_read_range, secure_write_file, spawn_job_process,
    verify_workspace_path, wait_job_process, HarnessRunningJob,
};

#[cfg(test)]
mod lexical_tests {
    use super::*;

    #[test]
    fn rejects_adversarial_path_syntax() {
        for bad in [
            "",
            "   ",
            "@src/index.ts",
            "file:///C:/Windows/System32",
            "FILE://localhost/c$/foo",
            r"\\?\C:\foo",
            r"\\.\pipe\foo",
            r"\??\C:\foo",
            r"\\server\share\file.txt",
            "/etc/passwd",
            r"\Windows\win.ini",
            "C:/foo.txt",
            "foo.txt:Zone.Identifier",
            "dir/file.txt:ads",
            "../secret.env",
            "a/../../secret.env",
            "trailing-dot.",
            "dir/trailing-space ",
            "CON",
            "dir/nul.txt",
            "COM1.log",
            "LPT9",
            "bad\0name.txt",
            "bad\nname.txt",
        ] {
            assert!(
                validate_relative_workspace_path(bad, false).is_err(),
                "must reject adversarial path: {bad:?}"
            );
        }
        assert_eq!(
            validate_relative_workspace_path("src/app/main.ts", false).unwrap(),
            vec!["src", "app", "main.ts"]
        );
        assert_eq!(
            validate_relative_workspace_path(".", true).unwrap(),
            Vec::<String>::new()
        );
    }
}
