use std::error::Error;
use std::ffi::{c_void, OsString};
use std::fmt::{Display, Formatter};
use std::fs;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::ptr::{null_mut, NonNull};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HANDLE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
    ACCESS_MODE, EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE, SET_ACCESS, SE_FILE_OBJECT,
    TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, ACCESS_ALLOWED_ACE, ACL, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION,
    INHERITED_ACE, NO_PROPAGATE_INHERIT_ACE, OBJECT_INHERIT_ACE, PSECURITY_DESCRIPTOR, PSID,
    TOKEN_QUERY,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE,
};
use windows_sys::Win32::System::SystemServices::{ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows_sys::Win32::UI::Shell::GetUserProfileDirectoryW;

const FIXED_RUNTIME_SERVICE_SID: &str =
    "S-1-5-80-152272774-1324336204-4147968316-71209937-3548791786";
const FIXED_RUNTIME_SERVICE_MODIFY_ACCESS: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;
const FIXED_RUNTIME_SERVICE_ROOT_INHERITANCE: u32 = OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE;
const FIXED_RUNTIME_PRODUCT_CONTROL_INHERITANCE: u32 =
    OBJECT_INHERIT_ACE | NO_PROPAGATE_INHERIT_ACE;

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

struct LocalAllocation(NonNull<c_void>);

impl LocalAllocation {
    fn new(value: *mut c_void) -> Option<Self> {
        NonNull::new(value).map(Self)
    }

    fn as_ptr(&self) -> *mut c_void {
        self.0.as_ptr()
    }
}

impl Drop for LocalAllocation {
    fn drop(&mut self) {
        // SAFETY: GetNamedSecurityInfoW, ConvertStringSidToSidW, and
        // SetEntriesInAclW return LocalAlloc-owned memory that must be released
        // exactly once.
        unsafe {
            let _ = LocalFree(self.0.as_ptr());
        }
    }
}

fn fixed_runtime_service_sid(
    stage: &'static str,
) -> Result<LocalAllocation, FixedRuntimeDataRootError> {
    let service_sid_wide = wide_null(std::ffi::OsStr::new(FIXED_RUNTIME_SERVICE_SID));
    let mut service_sid: PSID = null_mut();
    // SAFETY: service_sid_wide is nul-terminated and service_sid is a valid
    // output pointer. The returned LocalAlloc-owned SID is adopted below.
    if unsafe { ConvertStringSidToSidW(service_sid_wide.as_ptr(), &mut service_sid) } == 0 {
        // SAFETY: GetLastError is read immediately after the failed Win32 call.
        let error = unsafe { GetLastError() };
        return Err(FixedRuntimeDataRootError::new(
            stage,
            format!("ConvertStringSidToSidW failed with {error}"),
        ));
    }
    LocalAllocation::new(service_sid).ok_or_else(|| {
        FixedRuntimeDataRootError::new(stage, "ConvertStringSidToSidW returned no SID")
    })
}

struct DaclView {
    _descriptor: LocalAllocation,
    dacl: *mut ACL,
}

fn read_dacl(path: &Path, stage: &'static str) -> Result<DaclView, FixedRuntimeDataRootError> {
    let path_wide = wide_null(path.as_os_str());
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: path_wide is nul-terminated and all output pointers are valid.
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
            stage,
            format!("GetNamedSecurityInfoW failed with {status}"),
        ));
    }
    let descriptor = LocalAllocation::new(descriptor).ok_or_else(|| {
        FixedRuntimeDataRootError::new(stage, "GetNamedSecurityInfoW returned no descriptor")
    })?;
    Ok(DaclView {
        _descriptor: descriptor,
        dacl,
    })
}

fn set_dacl(
    path: &Path,
    dacl: *mut ACL,
    stage: &'static str,
) -> Result<(), FixedRuntimeDataRootError> {
    let path_wide = wide_null(path.as_os_str());
    // SAFETY: path_wide is nul-terminated. Only the supplied DACL is updated.
    let status = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            dacl,
            null_mut(),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(FixedRuntimeDataRootError::new(
            stage,
            format!("SetNamedSecurityInfoW failed with {status}"),
        ));
    }
    Ok(())
}

fn service_explicit_access(
    sid: &LocalAllocation,
    mode: ACCESS_MODE,
    access: u32,
    inheritance: u32,
) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: access,
        grfAccessMode: mode,
        grfInheritance: inheritance,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.as_ptr().cast::<u16>(),
        },
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

struct FixedRuntimeServiceAclInspection {
    exact: bool,
    replaceable: bool,
}

fn inspect_fixed_runtime_service_acl_with_flags(
    path: &Path,
    expected_flags: u8,
) -> Result<FixedRuntimeServiceAclInspection, FixedRuntimeDataRootError> {
    let view = read_dacl(path, "inspect-service-root-acl")?;
    let dacl = view.dacl;
    if dacl.is_null() {
        // A Windows null DACL already grants the Runtime SID access. Preserve
        // that user-selected sharing posture instead of narrowing it.
        return Ok(FixedRuntimeServiceAclInspection {
            exact: true,
            replaceable: false,
        });
    }

    let service_sid = fixed_runtime_service_sid("inspect-service-root-acl")?;

    let mut matching_entries = 0usize;
    let mut exact_entry = false;
    let mut replaceable = true;
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
            if EqualSid(ace_sid, service_sid.as_ptr()) == 0 {
                continue;
            }
            matching_entries += 1;
            if ace_type == ACCESS_DENIED_ACE_TYPE
                || u32::from(ace.Header.AceFlags) & INHERITED_ACE != 0
            {
                replaceable = false;
            }
            if ace_type == ACCESS_ALLOWED_ACE_TYPE
                && ace.Header.AceFlags == expected_flags
                && ace.Mask == FIXED_RUNTIME_SERVICE_MODIFY_ACCESS
            {
                exact_entry = true;
            }
        }
    }
    Ok(FixedRuntimeServiceAclInspection {
        exact: exact_entry && matching_entries == 1,
        replaceable,
    })
}

fn fixed_runtime_service_acl_is_exact(path: &Path) -> Result<bool, FixedRuntimeDataRootError> {
    Ok(inspect_fixed_runtime_service_acl_with_flags(
        path,
        FIXED_RUNTIME_SERVICE_ROOT_INHERITANCE as u8,
    )?
    .exact)
}

fn fixed_runtime_product_control_acl_is_exact(
    path: &Path,
) -> Result<bool, FixedRuntimeDataRootError> {
    Ok(inspect_fixed_runtime_service_acl_with_flags(
        path,
        FIXED_RUNTIME_PRODUCT_CONTROL_INHERITANCE as u8,
    )?
    .exact)
}

fn grant_fixed_runtime_service_acl_with(
    path: &Path,
    access: u32,
    inheritance: u32,
) -> Result<(), FixedRuntimeDataRootError> {
    let inspection = inspect_fixed_runtime_service_acl_with_flags(path, inheritance as u8)?;
    if inspection.exact {
        return Ok(());
    }
    if !inspection.replaceable {
        return Err(FixedRuntimeDataRootError::new(
            "prepare-service-root-acl",
            "fixed Runtime SID has deny or inherited access that cannot be replaced safely",
        ));
    }

    let view = read_dacl(path, "prepare-service-root-acl")?;
    let current_dacl = view.dacl;
    if current_dacl.is_null() {
        return Ok(());
    }

    let service_sid = fixed_runtime_service_sid("prepare-service-root-acl")?;
    let explicit_access = service_explicit_access(&service_sid, SET_ACCESS, access, inheritance);
    let mut replacement_dacl: *mut ACL = null_mut();
    // SAFETY: the preflight proved every supported matching service entry is
    // an explicit allow. SET_ACCESS therefore replaces only those allows;
    // other trustees and their inherited entries remain in current_dacl.
    let status =
        unsafe { SetEntriesInAclW(1, &explicit_access, current_dacl, &mut replacement_dacl) };
    if status != ERROR_SUCCESS {
        return Err(FixedRuntimeDataRootError::new(
            "prepare-service-root-acl",
            format!("SetEntriesInAclW failed with {status}"),
        ));
    }
    let _replacement_dacl_allocation =
        LocalAllocation::new(replacement_dacl.cast()).ok_or_else(|| {
            FixedRuntimeDataRootError::new(
                "prepare-service-root-acl",
                "SetEntriesInAclW returned no ACL",
            )
        })?;

    set_dacl(path, replacement_dacl, "prepare-service-root-acl")
}

fn grant_fixed_runtime_service_acl(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    grant_fixed_runtime_service_acl_with(
        path,
        FIXED_RUNTIME_SERVICE_MODIFY_ACCESS,
        FIXED_RUNTIME_SERVICE_ROOT_INHERITANCE,
    )?;
    if fixed_runtime_service_acl_is_exact(path)? {
        return Ok(());
    }
    Err(FixedRuntimeDataRootError::new(
        "verify-service-root-acl",
        "fixed Runtime service ACL did not read back as one exact allow entry",
    ))
}

fn grant_fixed_runtime_product_control_acl(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    grant_fixed_runtime_service_acl_with(
        path,
        FIXED_RUNTIME_SERVICE_MODIFY_ACCESS,
        FIXED_RUNTIME_PRODUCT_CONTROL_INHERITANCE,
    )?;
    if fixed_runtime_product_control_acl_is_exact(path)? {
        return Ok(());
    }
    Err(FixedRuntimeDataRootError::new(
        "verify-service-root-acl",
        "fixed Runtime Product Control ACL did not read back as one exact allow entry",
    ))
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

/// Prepares a user-selected Windows data-plane root for the fixed production
/// Runtime service while preserving the directory's existing owner and sharing
/// ACL. Source D2 performs no privileged or cross-principal ACL mutation.
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-013b
#[cfg(not(feature = "windows-source-local-development"))]
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    prepare_fixed_runtime_data_root_with(path, grant_fixed_runtime_service_acl)
}

#[cfg(feature = "windows-source-local-development")]
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    validate_selected_root(path)
}

/// Prepares the fixed interactive-user `~/.nimi` control directory for atomic
/// Runtime-owned `nimi.json` writes. The exact production service SID receives
/// Modify on the directory and its immediate files only; the ACE does not
/// propagate into Desktop-owned subdirectories.
#[cfg(not(feature = "windows-source-local-development"))]
pub(crate) fn prepare_fixed_runtime_product_control_root() -> Result<(), FixedRuntimeDataRootError>
{
    let root = current_process_profile_root()?.join(".nimi");
    // Windows assigns a new directory to the token's default owner, which may
    // be Administrators for an elevated user rather than the token's user SID.
    // The token-derived profile path and reparse-free chain bind this root.
    validate_selected_root(&root)?;
    if fixed_runtime_product_control_acl_is_exact(&root)? {
        return Ok(());
    }
    grant_fixed_runtime_product_control_acl(&root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Security::Authorization::DENY_ACCESS;

    fn fixture_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "nimi-fixed-runtime-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn dacl_snapshot(path: &Path) -> Result<Option<Vec<u8>>, FixedRuntimeDataRootError> {
        let view = read_dacl(path, "inspect-test-root-acl")?;
        let dacl = view.dacl;
        if dacl.is_null() {
            return Ok(None);
        }
        // SAFETY: dacl belongs to the live descriptor and AclSize is the
        // complete byte length of that ACL.
        let bytes = unsafe {
            std::slice::from_raw_parts(dacl.cast::<u8>(), usize::from((*dacl).AclSize)).to_vec()
        };
        Ok(Some(bytes))
    }

    fn add_fixed_runtime_service_deny(
        path: &Path,
        access: u32,
        inheritance: u32,
    ) -> Result<(), FixedRuntimeDataRootError> {
        let view = read_dacl(path, "prepare-test-service-deny")?;
        let current_dacl = view.dacl;
        let service_sid = fixed_runtime_service_sid("prepare-test-service-deny")?;
        let deny = service_explicit_access(&service_sid, DENY_ACCESS, access, inheritance);
        let mut replacement_dacl: *mut ACL = null_mut();
        // SAFETY: current_dacl belongs to the live descriptor; deny points at
        // the live service SID; replacement_dacl receives LocalAlloc memory.
        let status = unsafe { SetEntriesInAclW(1, &deny, current_dacl, &mut replacement_dacl) };
        if status != ERROR_SUCCESS {
            return Err(FixedRuntimeDataRootError::new(
                "prepare-test-service-deny",
                format!("SetEntriesInAclW failed with {status}"),
            ));
        }
        let _replacement_allocation =
            LocalAllocation::new(replacement_dacl.cast()).ok_or_else(|| {
                FixedRuntimeDataRootError::new(
                    "prepare-test-service-deny",
                    "SetEntriesInAclW returned no ACL",
                )
            })?;
        set_dacl(path, replacement_dacl, "prepare-test-service-deny")
    }

    #[test]
    fn exact_fixed_service_sid_receives_only_selected_tree_inheritance() {
        assert_eq!(
            FIXED_RUNTIME_SERVICE_ROOT_INHERITANCE,
            OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
        );
        assert_eq!(
            FIXED_RUNTIME_SERVICE_MODIFY_ACCESS,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE,
        );
    }

    #[test]
    fn product_control_grant_stops_at_immediate_files() {
        assert_eq!(
            FIXED_RUNTIME_PRODUCT_CONTROL_INHERITANCE,
            OBJECT_INHERIT_ACE | NO_PROPAGATE_INHERIT_ACE,
        );
    }

    #[test]
    fn native_product_control_grant_writes_the_exact_immediate_file_acl() {
        let root = fixture_root("product-control-acl");
        fs::create_dir_all(&root).expect("create Product Control ACL test root");
        let result = (|| {
            grant_fixed_runtime_product_control_acl(&root)?;
            if !fixed_runtime_product_control_acl_is_exact(&root)? {
                return Err(FixedRuntimeDataRootError::new(
                    "verify-service-root-acl",
                    "Product Control ACL was not exact after native grant",
                ));
            }
            Ok(())
        })();
        fs::remove_dir_all(&root).expect("remove Product Control ACL test root");
        result.expect("grant fixed Runtime Product Control ACL");
    }

    #[test]
    fn service_deny_is_preserved_and_prevents_exact_acl_acceptance() {
        let root = fixture_root("data-root-service-deny");
        fs::create_dir_all(&root).expect("create service-deny test root");
        let deny_access = FILE_GENERIC_WRITE;
        let flags = FIXED_RUNTIME_SERVICE_ROOT_INHERITANCE;
        add_fixed_runtime_service_deny(&root, deny_access, flags).expect("add fixed-service deny");
        let before = dacl_snapshot(&root)
            .expect("inspect fixed-service deny before preparation")
            .expect("service-deny test root has a DACL");
        assert!(!fixed_runtime_service_acl_is_exact(&root).expect("inspect service deny"));

        let error = prepare_fixed_runtime_data_root(&root)
            .expect_err("service deny must block allow replacement before mutation");
        assert_eq!(error.stage(), "prepare-service-root-acl");
        let after = dacl_snapshot(&root)
            .expect("inspect fixed-service deny after preparation")
            .expect("service-deny test root retains a DACL");
        assert_eq!(
            after, before,
            "preparation mutated a DACL containing a fixed-service deny",
        );
        assert!(
            !fixed_runtime_service_acl_is_exact(&root).expect("inspect combined service ACL"),
            "a preserved deny must keep the combined service ACL non-exact",
        );
        fs::remove_dir_all(&root).expect("remove service-deny test root");
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
    fn data_root_preparation_has_no_interactive_owner_precondition() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-fixed-runtime-data-root-user-choice-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create user-selected fixture");

        let mutation_called = std::cell::Cell::new(false);
        let result = prepare_fixed_runtime_data_root_with(&root, |_| {
            mutation_called.set(true);
            Ok(())
        });
        fs::remove_dir_all(&root).expect("remove user-selected fixture");

        result.expect("user-selected directory owner must not block data-root preparation");
        assert!(
            mutation_called.get(),
            "fixed-service ACL grant was not requested"
        );
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
            if !fixed_runtime_service_acl_is_exact(&root)? {
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
        grant_fixed_runtime_service_acl_with(
            &root,
            FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
            FIXED_RUNTIME_SERVICE_ROOT_INHERITANCE,
        )
        .expect("grant insufficient service ACL");
        assert!(
            !fixed_runtime_service_acl_is_exact(&root).expect("inspect insufficient service ACL"),
            "read-only service ACL must not satisfy fixed Runtime preparation"
        );
        prepare_fixed_runtime_data_root(&root)
            .expect("insufficient explicit allow should be replaced exactly");
        assert!(
            fixed_runtime_service_acl_is_exact(&root).expect("inspect replacement service ACL"),
            "replacement service ACL was not exact",
        );
        fs::remove_dir_all(&root).expect("remove test root");
    }
}
