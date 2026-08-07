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

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HANDLE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, GetTokenInformation, TokenUser, ACCESS_ALLOWED_ACE, ACL,
    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, NO_PROPAGATE_INHERIT_ACE, OBJECT_INHERIT_ACE,
    OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE,
};
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::SystemServices::{ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows_sys::Win32::UI::Shell::GetUserProfileDirectoryW;

const FIXED_RUNTIME_SERVICE_SID: &str =
    "S-1-5-80-152272774-1324336204-4147968316-71209937-3548791786";
const ACL_TOOL_TIMEOUT: Duration = Duration::from_secs(10);
const ACL_TOOL_POLL_INTERVAL: Duration = Duration::from_millis(25);
const FIXED_RUNTIME_SERVICE_MODIFY_ACCESS: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;

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
    validate_selected_root_chain(path, true)?;
    fs::create_dir_all(path).map_err(|error| {
        FixedRuntimeDataRootError::new("create-selected-root", error.to_string())
    })?;
    validate_selected_root_chain(path, false)
}

fn validate_selected_root_chain(
    path: &Path,
    allow_missing_tail: bool,
) -> Result<(), FixedRuntimeDataRootError> {
    let mut components = path.ancestors().collect::<Vec<_>>();
    components.reverse();
    let mut missing_tail = false;
    for component in components {
        if missing_tail {
            continue;
        }
        let metadata = match fs::symlink_metadata(component) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_missing_tail => {
                missing_tail = true;
                continue;
            }
            Err(error) => {
                return Err(FixedRuntimeDataRootError::new(
                    "validate-selected-root",
                    error.to_string(),
                ));
            }
        };
        if !metadata.is_dir() {
            return Err(FixedRuntimeDataRootError::new(
                "validate-selected-root",
                "selected root chain contains a non-directory component",
            ));
        }
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(FixedRuntimeDataRootError::new(
                "validate-selected-root",
                "selected root chain contains a reparse point",
            ));
        }
    }
    Ok(())
}

fn service_acl_grant() -> String {
    format!("*{FIXED_RUNTIME_SERVICE_SID}:(OI)(CI)M")
}

fn product_control_acl_grant() -> String {
    format!("*{FIXED_RUNTIME_SERVICE_SID}:(OI)(NP)M")
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

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: OpenProcessToken returned this owned handle and it is
            // closed exactly once here.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

fn current_process_token() -> Result<OwnedHandle, FixedRuntimeDataRootError> {
    let mut token: HANDLE = null_mut();
    // SAFETY: the current-process pseudo handle is valid and token points to
    // writable storage for the newly owned process-token handle.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        // SAFETY: GetLastError is read immediately after the failed Win32 call.
        let error = unsafe { GetLastError() };
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user",
            format!("OpenProcessToken failed with {error}"),
        ));
    }
    Ok(OwnedHandle(token))
}

fn current_process_profile_root() -> Result<PathBuf, FixedRuntimeDataRootError> {
    let token = current_process_token()?;
    let mut required_chars = 0u32;
    // SAFETY: the first call intentionally supplies no buffer and obtains the
    // required UTF-16 character count for the current token's OS profile.
    let first = unsafe { GetUserProfileDirectoryW(token.0, null_mut(), &mut required_chars) };
    // SAFETY: GetLastError is read immediately after GetUserProfileDirectoryW.
    let first_error = unsafe { GetLastError() };
    if first != 0 || first_error != ERROR_INSUFFICIENT_BUFFER || required_chars < 2 {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user-profile",
            format!("query GetUserProfileDirectoryW size failed with {first_error}"),
        ));
    }
    let mut buffer = vec![0u16; required_chars as usize];
    // SAFETY: buffer is writable for required_chars UTF-16 elements and the
    // token remains open for the duration of the call.
    if unsafe { GetUserProfileDirectoryW(token.0, buffer.as_mut_ptr(), &mut required_chars) } == 0 {
        // SAFETY: GetLastError is read immediately after the failed Win32 call.
        let error = unsafe { GetLastError() };
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user-profile",
            format!("read GetUserProfileDirectoryW failed with {error}"),
        ));
    }
    let length = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    let profile_root = PathBuf::from(OsString::from_wide(&buffer[..length]));
    if !profile_root.is_absolute() || profile_root.parent().is_none() {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user-profile",
            "the OS profile path is not an absolute non-volume-root directory",
        ));
    }
    validate_selected_root_chain(&profile_root, false)?;
    Ok(profile_root)
}

fn wide_null(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn with_current_process_user_sid<T>(
    use_sid: impl FnOnce(PSID) -> Result<T, FixedRuntimeDataRootError>,
) -> Result<T, FixedRuntimeDataRootError> {
    let token = current_process_token()?;

    let mut required_bytes = 0u32;
    // SAFETY: the first call intentionally supplies no buffer and obtains the
    // required size for TOKEN_USER.
    let first =
        unsafe { GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut required_bytes) };
    // SAFETY: GetLastError is read immediately after GetTokenInformation.
    let first_error = unsafe { GetLastError() };
    if first != 0 || first_error != ERROR_INSUFFICIENT_BUFFER || required_bytes == 0 {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user",
            format!("query TokenUser size failed with {first_error}"),
        ));
    }
    let word_bytes = std::mem::size_of::<usize>();
    let word_count = (required_bytes as usize).div_ceil(word_bytes);
    let mut buffer = vec![0usize; word_count];
    // SAFETY: buffer is aligned for TOKEN_USER and has at least required_bytes
    // writable bytes. The embedded SID remains valid while use_sid executes.
    if unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            buffer.as_mut_ptr().cast::<c_void>(),
            required_bytes,
            &mut required_bytes,
        )
    } == 0
    {
        // SAFETY: GetLastError is read immediately after the failed Win32 call.
        let error = unsafe { GetLastError() };
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user",
            format!("read TokenUser failed with {error}"),
        ));
    }
    // SAFETY: the successful call populated a TOKEN_USER at the aligned start
    // of buffer and the buffer remains live through use_sid.
    let token_user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
    if token_user.User.Sid.is_null() {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user",
            "TokenUser returned no SID",
        ));
    }
    use_sid(token_user.User.Sid)
}

fn validate_selected_root_owner(
    path: &Path,
    expected_owner: PSID,
) -> Result<(), FixedRuntimeDataRootError> {
    let path_wide = wide_null(path.as_os_str());
    let mut owner: PSID = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: path_wide is nul-terminated and all output pointers remain valid
    // until the returned descriptor is adopted below.
    let status = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root-owner",
            format!("GetNamedSecurityInfoW failed with {status}"),
        ));
    }
    let _descriptor_allocation = LocalAllocation::new(descriptor).ok_or_else(|| {
        FixedRuntimeDataRootError::new(
            "validate-selected-root-owner",
            "GetNamedSecurityInfoW returned no security descriptor",
        )
    })?;
    if owner.is_null() || unsafe { EqualSid(owner, expected_owner) } == 0 {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root-owner",
            "selected root owner does not match the OS process user",
        ));
    }
    Ok(())
}

fn fixed_runtime_service_acl_is_exact_with_flags(
    path: &Path,
    expected_flags: u8,
) -> Result<bool, FixedRuntimeDataRootError> {
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
                && ace.Mask == FIXED_RUNTIME_SERVICE_MODIFY_ACCESS
            {
                exact_entry = true;
            }
        }
    }
    Ok(exact_entry && matching_entries == 1)
}

fn fixed_runtime_service_acl_is_exact(path: &Path) -> Result<bool, FixedRuntimeDataRootError> {
    fixed_runtime_service_acl_is_exact_with_flags(
        path,
        (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8,
    )
}

fn fixed_runtime_product_control_acl_is_exact(
    path: &Path,
) -> Result<bool, FixedRuntimeDataRootError> {
    fixed_runtime_service_acl_is_exact_with_flags(
        path,
        (OBJECT_INHERIT_ACE | NO_PROPAGATE_INHERIT_ACE) as u8,
    )
}

fn grant_fixed_runtime_service_acl_with(
    path: &Path,
    grant: String,
) -> Result<(), FixedRuntimeDataRootError> {
    let mut child = Command::new(system_icacls_path()?)
        .arg(path)
        .arg("/grant:r")
        .arg(grant)
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

fn grant_fixed_runtime_service_acl(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    grant_fixed_runtime_service_acl_with(path, service_acl_grant())
}

fn grant_fixed_runtime_product_control_acl(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    grant_fixed_runtime_service_acl_with(path, product_control_acl_grant())
}

fn prepare_fixed_runtime_data_root_with<F>(
    path: &Path,
    grant: F,
) -> Result<(), FixedRuntimeDataRootError>
where
    F: FnOnce(&Path) -> Result<(), FixedRuntimeDataRootError>,
{
    with_current_process_user_sid(|expected_owner| {
        prepare_fixed_runtime_data_root_with_owner(path, expected_owner, grant)
    })
}

fn prepare_fixed_runtime_data_root_with_owner<F>(
    path: &Path,
    expected_owner: PSID,
    grant: F,
) -> Result<(), FixedRuntimeDataRootError>
where
    F: FnOnce(&Path) -> Result<(), FixedRuntimeDataRootError>,
{
    validate_selected_root(path)?;
    validate_selected_root_owner(path, expected_owner)?;
    if fixed_runtime_service_acl_is_exact(path)? {
        return Ok(());
    }
    grant(path)
}

/// Prepares a user-selected Windows data-plane root for the fixed production
/// Runtime service. Source D2 instead requires a direct current-user-owned
/// directory and performs no privileged or cross-principal ACL mutation.
#[cfg(not(feature = "windows-source-local-development"))]
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    prepare_fixed_runtime_data_root_with(path, grant_fixed_runtime_service_acl)
}

#[cfg(feature = "windows-source-local-development")]
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    with_current_process_user_sid(|expected_owner| {
        validate_selected_root(path)?;
        validate_selected_root_owner(path, expected_owner)
    })
}

/// Prepares the fixed interactive-user `~/.nimi` control directory for atomic
/// Runtime-owned `nimi.json` writes. The exact production service SID receives
/// Modify on the directory and its immediate files only; the ACE does not
/// propagate into Desktop-owned subdirectories.
#[cfg(not(feature = "windows-source-local-development"))]
pub(crate) fn prepare_fixed_runtime_product_control_root() -> Result<(), FixedRuntimeDataRootError>
{
    let root = current_process_profile_root()?.join(".nimi");
    with_current_process_user_sid(|expected_owner| {
        validate_selected_root(&root)?;
        validate_selected_root_owner(&root, expected_owner)?;
        if fixed_runtime_product_control_acl_is_exact(&root)? {
            return Ok(());
        }
        grant_fixed_runtime_product_control_acl(&root)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn exact_fixed_service_sid_receives_only_selected_tree_inheritance() {
        assert_eq!(
            service_acl_grant(),
            format!("*{FIXED_RUNTIME_SERVICE_SID}:(OI)(CI)M"),
        );
    }

    #[test]
    fn product_control_grant_stops_at_immediate_files() {
        assert_eq!(
            product_control_acl_grant(),
            format!("*{FIXED_RUNTIME_SERVICE_SID}:(OI)(NP)M"),
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
    fn ancestor_junction_fails_before_root_creation_or_acl_mutation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "nimi-fixed-runtime-data-root-junction-{}-{nonce}",
            std::process::id()
        ));
        let target = fixture.join("target");
        let junction = fixture.join("junction");
        fs::create_dir_all(&target).expect("create junction target");
        let output = Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .output()
            .expect("create disposable ancestor junction");
        assert!(
            output.status.success(),
            "create disposable ancestor junction: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let selected = junction.join("nimi-data");
        let mutation_called = std::cell::Cell::new(false);
        let result = prepare_fixed_runtime_data_root_with(&selected, |_| {
            mutation_called.set(true);
            Ok(())
        });
        let target_was_created = target.join("nimi-data").exists();
        fs::remove_dir(&junction).expect("remove disposable ancestor junction");
        fs::remove_dir_all(&fixture).expect("remove disposable junction fixture");

        let error = result.expect_err("ancestor junction must fail closed");
        assert_eq!(error.stage(), "validate-selected-root");
        assert!(!target_was_created, "junction target was mutated");
        assert!(!mutation_called.get(), "ACL mutation owner was invoked");
    }

    #[test]
    fn owner_mismatch_fails_before_acl_mutation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-fixed-runtime-data-root-owner-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create owner fixture");

        let wrong_owner_wide = wide_null(std::ffi::OsStr::new("S-1-5-80-1-2-3-4-5"));
        let mut wrong_owner: PSID = null_mut();
        // SAFETY: wrong_owner_wide is nul-terminated and wrong_owner is valid
        // writable output storage.
        assert_ne!(
            unsafe { ConvertStringSidToSidW(wrong_owner_wide.as_ptr(), &mut wrong_owner) },
            0,
            "parse fixed mismatched owner SID"
        );
        let _wrong_owner_allocation =
            LocalAllocation::new(wrong_owner).expect("own fixed mismatched owner SID");

        let mutation_called = std::cell::Cell::new(false);
        let result = prepare_fixed_runtime_data_root_with_owner(&root, wrong_owner, |_| {
            mutation_called.set(true);
            Ok(())
        });
        fs::remove_dir_all(&root).expect("remove owner fixture");

        let error = result.expect_err("mismatched owner must fail closed");
        assert_eq!(error.stage(), "validate-selected-root-owner");
        assert!(!mutation_called.get(), "ACL mutation owner was invoked");
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
