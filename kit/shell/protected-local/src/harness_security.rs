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
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecureReadResult {
    pub final_path: String,
    pub content: Vec<u8>,
    pub sha256: String,
    pub size_bytes: u64,
    pub n_number_of_links: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessSecureWriteRequest {
    pub workspace_root: String,
    pub relative_path: String,
    pub content: Vec<u8>,
    pub precondition_sha256: Option<String>,
    pub allow_create: bool,
    pub snapshot_path: Option<String>,
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
        || (name.starts_with(".env.")
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
    if name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.starts_with("id_ecdsa")
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
    kill_job_process, run_job_process, secure_delete_file, secure_read_file, secure_write_file,
    spawn_job_process, verify_workspace_path, wait_job_process, HarnessRunningJob,
};

#[cfg(not(target_os = "windows"))]
mod non_windows_fallback {
    use super::*;
    use std::io::{Read, Write};
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

    fn kill_process_group(pid: u32) -> u32 {
        #[cfg(unix)]
        {
            if pid > 0 && pid <= i32::MAX as u32 {
                // SIGKILL (9) to the isolated process group (-pgid) kills child + all descendants.
                unsafe {
                    kill(-(pid as i32), 9);
                }
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
        0
    }

    pub fn spawn_job_process(
        request: HarnessJobProcessRequest,
    ) -> Result<HarnessRunningJob, HarnessSecurityError> {
        let mut cmd = Command::new(&request.executable);
        cmd.args(&request.args)
            .current_dir(&request.working_directory)
            .env_clear()
            .envs(&request.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            cmd.process_group(0);
        }
        let mut child = cmd
            .spawn()
            .map_err(|err| HarnessSecurityError::new("process-spawn-failed", err.to_string()))?;
        let pid = child.id();
        let max_output = request.max_output_bytes.max(1024);
        let stdout_rx = child.stdout.take().map(|s| spawn_stream_drainer(s, max_output));
        let stderr_rx = child.stderr.take().map(|s| spawn_stream_drainer(s, max_output));
        Ok(HarnessRunningJob {
            pid,
            child: Arc::new(Mutex::new(Some(child))),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            stdout_rx: Mutex::new(stdout_rx),
            stderr_rx: Mutex::new(stderr_rx),
        })
    }

    pub fn kill_job_process(job: &HarnessRunningJob) -> Result<u32, HarnessSecurityError> {
        job.killed
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let remaining = kill_process_group(job.pid);
        if let Ok(mut guard) = job.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        Ok(remaining)
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
        let mut exit_code = None;
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
                    return Err(HarnessSecurityError::new(
                        "process-already-waited",
                        "process handle already consumed",
                    ));
                };
                child.try_wait().map_err(|err| {
                    HarnessSecurityError::new("process-wait-failed", err.to_string())
                })?
            };
            if let Some(st) = status {
                exit_code = st.code();
                break;
            }
            std::thread::sleep(Duration::from_millis(15));
        }

        let killed = job.killed.load(std::sync::atomic::Ordering::SeqCst);
        let active_processes_remaining = kill_process_group(job.pid);
        if let Ok(mut guard) = job.child.lock() {
            if let Some(mut child) = guard.take() {
                if timed_out || killed {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }

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

    fn canonical_rel_posix(root: &Path, final_path: &Path) -> Result<String, HarnessSecurityError> {
        let rel = final_path.strip_prefix(root).map_err(|_| {
            HarnessSecurityError::new(
                "workspace-escape",
                "resolved path escapes workspace root",
            )
        })?;
        Ok(rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"))
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

    pub fn verify_workspace_path(
        workspace_root: &Path,
        relative_path: &str,
        expect_directory: bool,
    ) -> Result<HarnessVerifiedPath, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(relative_path, expect_directory)?;
        let root = std::fs::canonicalize(workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        ensure_no_symlinks_in_chain(&root, &segments, true)?;
        let mut target = root.clone();
        for seg in &segments {
            target.push(seg);
        }
        let final_path = std::fs::canonicalize(&target)
            .map_err(|err| HarnessSecurityError::new("not-found", err.to_string()))?;
        let canonical_rel = canonical_rel_posix(&root, &final_path)?;
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
            n_number_of_links,
        })
    }

    pub fn secure_read_file(
        workspace_root: &Path,
        relative_path: &str,
        max_bytes: usize,
    ) -> Result<HarnessSecureReadResult, HarnessSecurityError> {
        let verified = verify_workspace_path(workspace_root, relative_path, false)?;
        if verified.size_bytes as usize > max_bytes {
            return Err(HarnessSecurityError::new(
                "file-too-large",
                "file exceeds maximum allowed read size",
            ));
        }
        let mut open_opts = std::fs::OpenOptions::new();
        open_opts.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open_opts.custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = open_opts
            .open(&verified.final_path)
            .map_err(|err| HarnessSecurityError::new("read-failed", err.to_string()))?;
        let meta = file
            .metadata()
            .map_err(|err| HarnessSecurityError::new("stat-failed", err.to_string()))?;
        if !meta.is_file() {
            return Err(HarnessSecurityError::new(
                "is-directory",
                "target is not a regular file",
            ));
        }
        let nlink = check_nlink_one(&meta)?;
        let mut content = Vec::new();
        file.take((max_bytes as u64).saturating_add(1))
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
            final_path: verified.final_path,
            size_bytes: content.len() as u64,
            content,
            sha256,
            n_number_of_links: nlink,
        })
    }

    pub fn secure_write_file(
        request: HarnessSecureWriteRequest,
    ) -> Result<HarnessSecureWriteResult, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(&request.relative_path, false)?;
        let root = std::fs::canonicalize(&request.workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let lexical_rel = segments.join("/");
        if is_sensitive_relative_path(&lexical_rel) {
            return Err(HarnessSecurityError::new(
                "sensitive-path-rejected",
                format!("write to sensitive file '{lexical_rel}' is blocked"),
            ));
        }
        ensure_no_symlinks_in_chain(&root, &segments, false)?;
        let mut target = root.clone();
        for seg in &segments {
            target.push(seg);
        }

        // Validate existing parent directory BEFORE creating or truncating anything!
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

        let existing_meta = match std::fs::symlink_metadata(&target) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err(HarnessSecurityError::new(
                        "reparse-point-rejected",
                        "target file is a symbolic link",
                    ));
                }
                if meta.is_dir() {
                    return Err(HarnessSecurityError::new(
                        "is-directory",
                        "target is a directory",
                    ));
                }
                check_nlink_one(&meta)?;
                Some(meta)
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
            Err(err) => return Err(HarnessSecurityError::new("stat-failed", err.to_string())),
        };

        let exists = existing_meta.is_some();
        let mut previous_sha256 = None;
        let mut snapshot_written = false;
        if exists {
            let verified_existing =
                secure_read_file(Path::new(&request.workspace_root), &request.relative_path, 64 * 1024 * 1024)?;
            if let Some(expected) = request.precondition_sha256.as_deref() {
                if !expected.is_empty() && expected != verified_existing.sha256 {
                    return Err(HarnessSecurityError::new(
                        "precondition-failed",
                        "file hash mismatch before write",
                    ));
                }
            }
            if let Some(snap) = request.snapshot_path.as_deref() {
                if let Some(parent) = Path::new(snap).parent() {
                    std::fs::create_dir_all(parent).map_err(|err| {
                        HarnessSecurityError::new("snapshot-failed", err.to_string())
                    })?;
                }
                let mut f = std::fs::File::create(snap)
                    .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
                f.write_all(&verified_existing.content)
                    .and_then(|_| f.sync_all())
                    .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
                snapshot_written = true;
            }
            previous_sha256 = Some(verified_existing.sha256);
        } else {
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
        }

        let mut open_opts = std::fs::OpenOptions::new();
        open_opts.write(true);
        if exists {
            open_opts.truncate(true);
        } else {
            open_opts.create_new(true);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open_opts.custom_flags(libc::O_NOFOLLOW);
        }
        let mut f = open_opts
            .open(&target)
            .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
        let meta_after = f
            .metadata()
            .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
        check_nlink_one(&meta_after)?;
        let final_path = std::fs::canonicalize(&target)
            .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
        let canonical_rel = canonical_rel_posix(&root, &final_path)?;
        if is_sensitive_relative_path(&canonical_rel) {
            return Err(HarnessSecurityError::new(
                "sensitive-path-rejected",
                format!("write to sensitive file '{canonical_rel}' is blocked"),
            ));
        }
        f.write_all(&request.content)
            .and_then(|_| f.sync_all())
            .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
        Ok(HarnessSecureWriteResult {
            final_path: final_path.to_string_lossy().into_owned(),
            sha256: sha256_hex(&request.content),
            previous_sha256,
            bytes_written: request.content.len() as u64,
            created: !exists,
            snapshot_written,
        })
    }

    pub fn secure_delete_file(
        request: HarnessSecureDeleteRequest,
    ) -> Result<HarnessSecureDeleteResult, HarnessSecurityError> {
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
            if let Some(parent) = Path::new(snap).parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
            }
            let mut f = std::fs::File::create(snap)
                .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
            f.write_all(&read.content)
                .and_then(|_| f.sync_all())
                .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
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

#[cfg(not(target_os = "windows"))]
pub use non_windows_fallback::{
    kill_job_process, run_job_process, secure_delete_file, secure_read_file, secure_write_file,
    spawn_job_process, verify_workspace_path, wait_job_process, HarnessRunningJob,
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
