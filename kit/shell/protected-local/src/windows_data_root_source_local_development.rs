use std::error::Error;
use std::ffi::c_void;
use std::fmt::{Display, Formatter};
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::os::windows::io::{FromRawHandle, OwnedHandle};
use std::path::Path;

use windows_sys::Win32::Foundation::{
    GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HANDLE,
};
use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
use windows_sys::Win32::Security::{
    EqualSid, GetTokenInformation, TokenUser, OWNER_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

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

pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root",
            "an absolute non-volume-root path is required",
        ));
    }
    validate_direct_directory_chain(path, true)?;
    fs::create_dir_all(path).map_err(|error| {
        FixedRuntimeDataRootError::new("create-selected-root", error.to_string())
    })?;
    validate_direct_directory_chain(path, false)?;
    let token = current_process_token()?;
    with_token_user_sid(&token, |user_sid| validate_owner(path, user_sid))
}

fn validate_direct_directory_chain(
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
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(FixedRuntimeDataRootError::new(
                "validate-selected-root",
                "selected root chain contains a non-directory or reparse component",
            ));
        }
    }
    Ok(())
}

fn current_process_token() -> Result<OwnedHandle, FixedRuntimeDataRootError> {
    let mut raw: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 || raw.is_null()
    {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-current-user",
            "current process token is unavailable",
        ));
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(raw.cast()) })
}

fn with_token_user_sid<T>(
    token: &OwnedHandle,
    use_sid: impl FnOnce(*mut c_void) -> Result<T, FixedRuntimeDataRootError>,
) -> Result<T, FixedRuntimeDataRootError> {
    use std::os::windows::io::AsRawHandle;
    let handle = token.as_raw_handle().cast();
    let mut required = 0u32;
    let first =
        unsafe { GetTokenInformation(handle, TokenUser, std::ptr::null_mut(), 0, &mut required) };
    if first != 0
        || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER
        || required < std::mem::size_of::<TOKEN_USER>() as u32
    {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-current-user",
            "current-user SID size is unavailable",
        ));
    }
    let words = (required as usize).div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; words];
    if unsafe {
        GetTokenInformation(
            handle,
            TokenUser,
            buffer.as_mut_ptr().cast::<c_void>(),
            required,
            &mut required,
        )
    } == 0
    {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-current-user",
            "current-user SID is unavailable",
        ));
    }
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    if user.User.Sid.is_null() {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-current-user",
            "current-user SID is empty",
        ));
    }
    use_sid(user.User.Sid)
}

fn validate_owner(
    path: &Path,
    expected_owner: *mut c_void,
) -> Result<(), FixedRuntimeDataRootError> {
    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut owner = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let status = unsafe {
        GetNamedSecurityInfoW(
            wide.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS || descriptor.is_null() {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root-owner",
            format!("GetNamedSecurityInfoW failed with {status}"),
        ));
    }
    let matches = !owner.is_null() && unsafe { EqualSid(owner, expected_owner) } != 0;
    unsafe {
        LocalFree(descriptor);
    }
    matches.then_some(()).ok_or_else(|| {
        FixedRuntimeDataRootError::new(
            "validate-selected-root-owner",
            "selected root owner does not match the current OS user",
        )
    })
}
