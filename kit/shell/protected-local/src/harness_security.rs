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

// @nimi-authority: rule.nimi.harness.assistant.p-harn-002
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
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};

    pub struct HarnessRunningJob {
        pid: u32,
        child: Arc<Mutex<Option<std::process::Child>>>,
        killed: Arc<std::sync::atomic::AtomicBool>,
        max_output_bytes: usize,
    }

    impl HarnessRunningJob {
        pub fn pid(&self) -> u32 {
            self.pid
        }
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
        let child = cmd
            .spawn()
            .map_err(|err| HarnessSecurityError::new("process-spawn-failed", err.to_string()))?;
        let pid = child.id();
        Ok(HarnessRunningJob {
            pid,
            child: Arc::new(Mutex::new(Some(child))),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            max_output_bytes: request.max_output_bytes.max(1024),
        })
    }

    pub fn kill_job_process(job: &HarnessRunningJob) -> Result<u32, HarnessSecurityError> {
        job.killed
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut guard) = job.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        Ok(0)
    }

    pub fn wait_job_process(
        job: &HarnessRunningJob,
        _timeout_ms: u64,
    ) -> Result<HarnessJobProcessResult, HarnessSecurityError> {
        let mut guard = job
            .child
            .lock()
            .map_err(|_| HarnessSecurityError::new("process-lock-poisoned", "lock poisoned"))?;
        let Some(child) = guard.take() else {
            return Err(HarnessSecurityError::new(
                "process-already-waited",
                "process handle already consumed",
            ));
        };
        let output = child
            .wait_with_output()
            .map_err(|err| HarnessSecurityError::new("process-wait-failed", err.to_string()))?;
        let max_bytes = job.max_output_bytes;
        let stdout_truncated = output.stdout.len() > max_bytes;
        let stderr_truncated = output.stderr.len() > max_bytes;
        let stdout = output.stdout.into_iter().take(max_bytes).collect();
        let stderr = output.stderr.into_iter().take(max_bytes).collect();
        Ok(HarnessJobProcessResult {
            pid: job.pid,
            exit_code: output.status.code(),
            timed_out: false,
            killed: job.killed.load(std::sync::atomic::Ordering::SeqCst),
            stdout,
            stderr,
            stdout_truncated,
            stderr_truncated,
            active_processes_remaining: 0,
        })
    }

    pub fn run_job_process(
        request: HarnessJobProcessRequest,
    ) -> Result<HarnessJobProcessResult, HarnessSecurityError> {
        let timeout_ms = request.timeout_ms;
        let job = spawn_job_process(request)?;
        wait_job_process(&job, timeout_ms)
    }

    pub fn verify_workspace_path(
        workspace_root: &Path,
        relative_path: &str,
        expect_directory: bool,
    ) -> Result<HarnessVerifiedPath, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(relative_path, expect_directory)?;
        let root = std::fs::canonicalize(workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let mut target = root.clone();
        for seg in &segments {
            target.push(seg);
        }
        let final_path = std::fs::canonicalize(&target)
            .map_err(|err| HarnessSecurityError::new("not-found", err.to_string()))?;
        if !final_path.starts_with(&root) {
            return Err(HarnessSecurityError::new(
                "workspace-escape",
                "resolved path escapes workspace root",
            ));
        }
        let meta = std::fs::metadata(&final_path)
            .map_err(|err| HarnessSecurityError::new("stat-failed", err.to_string()))?;
        if expect_directory && !meta.is_dir() {
            return Err(HarnessSecurityError::new(
                "not-directory",
                "target is not a directory",
            ));
        }
        if !expect_directory && meta.is_dir() {
            return Err(HarnessSecurityError::new(
                "is-directory",
                "target is a directory",
            ));
        }
        Ok(HarnessVerifiedPath {
            canonical_workspace_root: root.to_string_lossy().into_owned(),
            final_path: final_path.to_string_lossy().into_owned(),
            relative_path: segments.join("/"),
            is_directory: meta.is_dir(),
            size_bytes: meta.len(),
            n_number_of_links: 1,
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
        let content = std::fs::read(&verified.final_path)
            .map_err(|err| HarnessSecurityError::new("read-failed", err.to_string()))?;
        let sha256 = sha256_hex(&content);
        Ok(HarnessSecureReadResult {
            final_path: verified.final_path,
            size_bytes: content.len() as u64,
            content,
            sha256,
            n_number_of_links: verified.n_number_of_links,
        })
    }

    pub fn secure_write_file(
        request: HarnessSecureWriteRequest,
    ) -> Result<HarnessSecureWriteResult, HarnessSecurityError> {
        let segments = validate_relative_workspace_path(&request.relative_path, false)?;
        let root = std::fs::canonicalize(&request.workspace_root)
            .map_err(|err| HarnessSecurityError::new("invalid-workspace-root", err.to_string()))?;
        let mut target = root.clone();
        for seg in &segments {
            target.push(seg);
        }
        let exists = target.exists();
        let mut previous_sha256 = None;
        let mut snapshot_written = false;
        if exists {
            let existing = std::fs::read(&target)
                .map_err(|err| HarnessSecurityError::new("read-failed", err.to_string()))?;
            let hash = sha256_hex(&existing);
            if let Some(expected) = request.precondition_sha256.as_deref() {
                if !expected.is_empty() && expected != hash {
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
                f.write_all(&existing)
                    .and_then(|_| f.sync_all())
                    .map_err(|err| HarnessSecurityError::new("snapshot-failed", err.to_string()))?;
                snapshot_written = true;
            }
            previous_sha256 = Some(hash);
        } else {
            if !request.allow_create {
                return Err(HarnessSecurityError::new(
                    "not-found",
                    "target file does not exist and allow_create is false",
                ));
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
            }
        }
        let mut f = std::fs::File::create(&target)
            .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
        f.write_all(&request.content)
            .and_then(|_| f.sync_all())
            .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
        let final_path = std::fs::canonicalize(&target)
            .map_err(|err| HarnessSecurityError::new("write-failed", err.to_string()))?;
        if !final_path.starts_with(&root) {
            return Err(HarnessSecurityError::new(
                "workspace-escape",
                "resolved path escapes workspace root",
            ));
        }
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
