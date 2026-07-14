use std::error::Error;
use std::ffi::OsString;
use std::fmt::{Display, Formatter};
use std::fs;
use std::os::windows::ffi::OsStringExt;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;

#[cfg(not(feature = "windows-e2e-fixture"))]
const FIXED_RUNTIME_SERVICE_SID: &str =
    "S-1-5-80-152272774-1324336204-4147968316-71209937-3548791786";
#[cfg(feature = "windows-e2e-fixture")]
const FIXED_RUNTIME_SERVICE_SID: &str =
    "S-1-5-80-2508001767-432113807-2225235661-2974466524-556849280";
const ACL_TOOL_TIMEOUT: Duration = Duration::from_secs(10);
const ACL_TOOL_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Debug)]
pub struct FixedRuntimeDataRootError {
    stage: &'static str,
    detail: String,
}

impl FixedRuntimeDataRootError {
    fn new(stage: &'static str, detail: impl Into<String>) -> Self {
        Self {
            stage,
            detail: detail.into(),
        }
    }

    pub const fn stage(&self) -> &'static str {
        self.stage
    }
}

impl Display for FixedRuntimeDataRootError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.stage, self.detail)
    }
}

impl Error for FixedRuntimeDataRootError {}

fn system_icacls_path() -> Result<PathBuf, FixedRuntimeDataRootError> {
    let mut buffer = vec![0u16; 32_768];
    // SAFETY: the writable buffer is valid for the supplied element count.
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-system-acl-tool",
            "GetSystemDirectoryW failed",
        ));
    }
    let tool = PathBuf::from(OsString::from_wide(&buffer[..length])).join("icacls.exe");
    if !tool.is_absolute() || !tool.is_file() {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-system-acl-tool",
            "the trusted Windows ACL tool is unavailable",
        ));
    }
    Ok(tool)
}

fn validate_selected_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root",
            "an absolute non-volume-root path is required",
        ));
    }
    fs::create_dir_all(path).map_err(|error| {
        FixedRuntimeDataRootError::new("create-selected-root", error.to_string())
    })?;
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        FixedRuntimeDataRootError::new("inspect-selected-root", error.to_string())
    })?;
    if !metadata.is_dir() {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root",
            "selected root is not a directory",
        ));
    }
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root",
            "reparse-point data roots are forbidden",
        ));
    }
    Ok(())
}

fn service_acl_grant() -> String {
    format!("*{FIXED_RUNTIME_SERVICE_SID}:(OI)(CI)F")
}

/// Prepares a user-selected Windows data-plane root for the fixed Runtime
/// service. The caller remains the owner; only an inheritable ACE for the
/// exact production service SID is added or replaced. Runtime still owns the
/// subsequent layout validation and service-state mutation.
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    validate_selected_root(path)?;
    let mut child = Command::new(system_icacls_path()?)
        .arg(path)
        .arg("/grant:r")
        .arg(service_acl_grant())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            FixedRuntimeDataRootError::new("prepare-service-root-acl", error.to_string())
        })?;

    let deadline = Instant::now() + ACL_TOOL_TIMEOUT;
    loop {
        let status = child.try_wait().map_err(|error| {
            FixedRuntimeDataRootError::new("prepare-service-root-acl", error.to_string())
        })?;
        if let Some(status) = status {
            if status.success() {
                return Ok(());
            }
            return Err(FixedRuntimeDataRootError::new(
                "prepare-service-root-acl",
                format!("icacls exited with {status}"),
            ));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(FixedRuntimeDataRootError::new(
                "prepare-service-root-acl",
                "icacls exceeded the 10 second fixed-service root preparation deadline",
            ));
        }
        thread::sleep(ACL_TOOL_POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn exact_fixed_service_sid_receives_only_selected_tree_inheritance() {
        assert_eq!(
            service_acl_grant(),
            format!("*{FIXED_RUNTIME_SERVICE_SID}:(OI)(CI)F"),
        );
    }

    #[test]
    fn relative_or_volume_root_selection_fails_before_acl_mutation() {
        let relative = validate_selected_root(Path::new("relative-data-root"))
            .expect_err("relative root must fail");
        assert_eq!(relative.stage(), "validate-selected-root");

        let volume_root =
            validate_selected_root(Path::new(r"C:\")).expect_err("volume root must fail");
        assert_eq!(volume_root.stage(), "validate-selected-root");
    }

    #[test]
    fn native_preparation_grants_service_access_and_preserves_user_writes() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-fixed-runtime-data-root-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test root");
        let result = (|| {
            prepare_fixed_runtime_data_root(&root)?;
            fs::write(root.join("interactive-owner-write.txt"), b"owner-retained").map_err(
                |error| FixedRuntimeDataRootError::new("verify-user-owner", error.to_string()),
            )?;
            let listing = Command::new(system_icacls_path()?)
                .arg(&root)
                .output()
                .map_err(|error| {
                    FixedRuntimeDataRootError::new("verify-service-root-acl", error.to_string())
                })?;
            let text = String::from_utf8_lossy(&listing.stdout);
            if !listing.status.success()
                || (!text.contains(FIXED_RUNTIME_SERVICE_SID) && !text.contains("NimiRuntime"))
            {
                return Err(FixedRuntimeDataRootError::new(
                    "verify-service-root-acl",
                    "exact fixed service SID ACE was not observable",
                ));
            }
            Ok(())
        })();
        fs::remove_dir_all(&root).expect("remove test root");
        result.expect("prepare fixed Runtime data root");
    }
}
