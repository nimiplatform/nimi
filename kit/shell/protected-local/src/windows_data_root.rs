use std::error::Error;
use std::ffi::{c_void, OsString};
use std::fmt::{Display, Formatter};
use std::fs;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::ptr::{null_mut, NonNull};
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{GetLastError, LocalFree, ERROR_SUCCESS};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, ACCESS_ALLOWED_ACE, ACL, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION,
    OBJECT_INHERIT_ACE, PSECURITY_DESCRIPTOR, PSID,
};
use windows_sys::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_ATTRIBUTE_REPARSE_POINT};
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::SystemServices::{ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE};

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

struct LocalAllocation(NonNull<c_void>);

impl LocalAllocation {
    fn new(value: *mut c_void) -> Option<Self> {
        NonNull::new(value).map(Self)
    }
}

impl Drop for LocalAllocation {
    fn drop(&mut self) {
        // SAFETY: both GetNamedSecurityInfoW and ConvertStringSidToSidW return
        // LocalAlloc-owned memory that must be released exactly once.
        unsafe {
            let _ = LocalFree(self.0.as_ptr());
        }
    }
}

fn wide_null(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn fixed_runtime_service_acl_is_exact(path: &Path) -> Result<bool, FixedRuntimeDataRootError> {
    let path_wide = wide_null(path.as_os_str());
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: all output pointers are valid for the duration of the call and
    // path_wide is a nul-terminated Windows path. The returned descriptor is
    // held by descriptor_allocation until the DACL inspection completes.
    let status = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(FixedRuntimeDataRootError::new(
            "inspect-service-root-acl",
            format!("GetNamedSecurityInfoW failed with {status}"),
        ));
    }
    let _descriptor_allocation = LocalAllocation::new(descriptor).ok_or_else(|| {
        FixedRuntimeDataRootError::new(
            "inspect-service-root-acl",
            "GetNamedSecurityInfoW returned no security descriptor",
        )
    })?;
    if dacl.is_null() {
        return Ok(false);
    }

    let service_sid_wide = wide_null(std::ffi::OsStr::new(FIXED_RUNTIME_SERVICE_SID));
    let mut service_sid: PSID = null_mut();
    // SAFETY: service_sid_wide is nul-terminated and service_sid is a valid
    // output pointer. The returned SID is held by sid_allocation.
    if unsafe { ConvertStringSidToSidW(service_sid_wide.as_ptr(), &mut service_sid) } == 0 {
        // SAFETY: GetLastError is read immediately after the failed Win32 call.
        let error = unsafe { GetLastError() };
        return Err(FixedRuntimeDataRootError::new(
            "inspect-service-root-acl",
            format!("ConvertStringSidToSidW failed with {error}"),
        ));
    }
    let _sid_allocation = LocalAllocation::new(service_sid).ok_or_else(|| {
        FixedRuntimeDataRootError::new(
            "inspect-service-root-acl",
            "ConvertStringSidToSidW returned no SID",
        )
    })?;

    let expected_flags = (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8;
    let mut matching_entries = 0usize;
    let mut exact_entry = false;
    // SAFETY: dacl belongs to the live security descriptor allocation. GetAce
    // validates each index, and standard allow/deny ACEs share the inspected
    // ACCESS_ALLOWED_ACE prefix containing Mask and SidStart.
    unsafe {
        for index in 0..u32::from((*dacl).AceCount) {
            let mut raw_ace: *mut c_void = null_mut();
            if GetAce(dacl, index, &mut raw_ace) == 0 || raw_ace.is_null() {
                let error = GetLastError();
                return Err(FixedRuntimeDataRootError::new(
                    "inspect-service-root-acl",
                    format!("GetAce({index}) failed with {error}"),
                ));
            }
            let ace = &*(raw_ace.cast::<ACCESS_ALLOWED_ACE>());
            let ace_type = u32::from(ace.Header.AceType);
            if ace_type != ACCESS_ALLOWED_ACE_TYPE && ace_type != ACCESS_DENIED_ACE_TYPE {
                continue;
            }
            let ace_sid = std::ptr::addr_of!(ace.SidStart).cast_mut().cast::<c_void>();
            if EqualSid(ace_sid, service_sid) == 0 {
                continue;
            }
            matching_entries += 1;
            if ace_type == ACCESS_ALLOWED_ACE_TYPE
                && ace.Header.AceFlags == expected_flags
                && ace.Mask == FILE_ALL_ACCESS
            {
                exact_entry = true;
            }
        }
    }
    Ok(exact_entry && matching_entries == 1)
}

fn grant_fixed_runtime_service_acl(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
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

fn prepare_fixed_runtime_data_root_with<F>(
    path: &Path,
    grant: F,
) -> Result<(), FixedRuntimeDataRootError>
where
    F: FnOnce(&Path) -> Result<(), FixedRuntimeDataRootError>,
{
    validate_selected_root(path)?;
    if fixed_runtime_service_acl_is_exact(path)? {
        return Ok(());
    }
    grant(path)
}

/// Prepares a user-selected Windows data-plane root for the fixed Runtime
/// service. The caller remains the owner; only an inheritable ACE for the
/// exact production service SID is added or replaced. Runtime still owns the
/// subsequent layout validation and service-state mutation.
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    prepare_fixed_runtime_data_root_with(path, grant_fixed_runtime_service_acl)
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

    #[test]
    fn exact_existing_service_acl_is_idempotent_without_mutation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-fixed-runtime-data-root-idempotent-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test root");
        let result = (|| {
            prepare_fixed_runtime_data_root(&root)?;
            if !fixed_runtime_service_acl_is_exact(&root)? {
                return Err(FixedRuntimeDataRootError::new(
                    "verify-service-root-acl",
                    "fresh fixed-service ACL did not read back exactly",
                ));
            }
            prepare_fixed_runtime_data_root_with(&root, |_| {
                panic!("exact existing ACL must not invoke the mutation tool")
            })
        })();
        fs::remove_dir_all(&root).expect("remove test root");
        result.expect("reuse exact fixed Runtime data-root ACL");
    }

    #[test]
    fn insufficient_existing_service_acl_still_requires_mutation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-fixed-runtime-data-root-insufficient-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test root");
        let status = Command::new(system_icacls_path().expect("resolve icacls"))
            .arg(&root)
            .arg("/grant:r")
            .arg(format!("*{FIXED_RUNTIME_SERVICE_SID}:(OI)(CI)RX"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("grant insufficient service ACL");
        assert!(status.success(), "grant insufficient service ACL failed");
        assert!(
            !fixed_runtime_service_acl_is_exact(&root).expect("inspect insufficient service ACL"),
            "read-only service ACL must not satisfy fixed Runtime preparation"
        );
        let mutation_called = std::cell::Cell::new(false);
        prepare_fixed_runtime_data_root_with(&root, |_| {
            mutation_called.set(true);
            Ok(())
        })
        .expect("insufficient ACL should route to the mutation owner");
        assert!(mutation_called.get(), "mutation owner was not invoked");
        fs::remove_dir_all(&root).expect("remove test root");
    }
}
