use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, FILETIME, HANDLE,
    INVALID_HANDLE_VALUE, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenElevation, TokenUser, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetProcessTimes, OpenProcess, OpenProcessToken,
    QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

const FILE_SHARE_READ: u32 = 0x0000_0001;
const SOURCE_PROFILE_ENVIRONMENT: &str = "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT";
const RUNTIME_EXECUTABLE_ENVIRONMENT: &str =
    "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE";

pub(super) struct VerifiedRuntimePeer {
    _process: OwnedHandle,
    _executable: File,
    _creation_marker: u64,
}

impl VerifiedRuntimePeer {
    pub(super) fn creation_marker(&self) -> u64 {
        self._creation_marker
    }

    pub(super) fn running(&self) -> bool {
        unsafe { WaitForSingleObject(self._process.as_raw_handle().cast(), 0) == WAIT_TIMEOUT }
    }
}

pub(super) fn verify_runtime_peer(
    process_id: u32,
) -> Result<VerifiedRuntimePeer, ProtectedCarrierError> {
    if std::env::var_os(SOURCE_PROFILE_ENVIRONMENT).as_deref() != Some(std::ffi::OsStr::new("1")) {
        return Err(untrusted());
    }
    let expected = expected_runtime_executable()?;
    let process = open_process(process_id)?;
    let server_path = process_path(&process)?;
    if !same_canonical_path(&server_path, &expected)? {
        return Err(untrusted());
    }
    let current_sid = current_process_user_sid()?;
    let (server_sid, elevated) = process_user(&process)?;
    if server_sid != current_sid || elevated {
        return Err(untrusted());
    }
    let server_parent = process_parent_id(process_id)?;
    let current_pid = unsafe { GetCurrentProcessId() };
    let current_parent = process_parent_id(current_pid)?;
    if server_parent == 0 || (server_parent != current_pid && server_parent != current_parent) {
        return Err(untrusted());
    }
    let creation_marker = process_creation_marker(&process)?;
    let executable = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&server_path)
        .map_err(|_| untrusted())?;
    let after_path = process_path(&process)?;
    let after_creation = process_creation_marker(&process)?;
    if after_creation != creation_marker || !same_canonical_path(&after_path, &server_path)? {
        return Err(untrusted());
    }
    Ok(VerifiedRuntimePeer {
        _process: process,
        _executable: executable,
        _creation_marker: creation_marker,
    })
}

fn expected_runtime_executable() -> Result<PathBuf, ProtectedCarrierError> {
    let raw = std::env::var_os(RUNTIME_EXECUTABLE_ENVIRONMENT).ok_or_else(untrusted)?;
    let path = PathBuf::from(raw);
    if !path.is_absolute() || !path.is_file() {
        return Err(untrusted());
    }
    let canonical = std::fs::canonicalize(&path).map_err(|_| untrusted())?;
    if !same_normalized_path(&canonical, &path) {
        return Err(untrusted());
    }
    Ok(path)
}

fn open_process(process_id: u32) -> Result<OwnedHandle, ProtectedCarrierError> {
    if process_id == 0 {
        return Err(untrusted());
    }
    let raw = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
            0,
            process_id,
        )
    };
    if raw.is_null() {
        return Err(untrusted());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(raw.cast()) })
}

fn process_path(process: &OwnedHandle) -> Result<PathBuf, ProtectedCarrierError> {
    let mut buffer = vec![0u16; 32_768];
    let mut length = buffer.len() as u32;
    let succeeded = unsafe {
        QueryFullProcessImageNameW(
            process.as_raw_handle().cast(),
            0,
            buffer.as_mut_ptr(),
            &mut length,
        )
    };
    if succeeded == 0 || length == 0 || length as usize > buffer.len() {
        return Err(untrusted());
    }
    let value = String::from_utf16(&buffer[..length as usize]).map_err(|_| untrusted())?;
    let path = PathBuf::from(value);
    if !path.is_absolute() || !path.is_file() {
        return Err(untrusted());
    }
    Ok(path)
}

fn process_creation_marker(process: &OwnedHandle) -> Result<u64, ProtectedCarrierError> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    let succeeded = unsafe {
        GetProcessTimes(
            process.as_raw_handle().cast(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    let marker = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    if succeeded == 0 || marker == 0 {
        return Err(untrusted());
    }
    Ok(marker)
}

pub(super) fn current_user_sid() -> Result<String, ProtectedCarrierError> {
    current_process_user_sid()
}

fn current_process_user_sid() -> Result<String, ProtectedCarrierError> {
    let mut raw: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 || raw.is_null()
    {
        return Err(untrusted());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    token_user_and_elevation(&token).map(|(sid, _)| sid)
}

fn process_user(process: &OwnedHandle) -> Result<(String, bool), ProtectedCarrierError> {
    let mut raw: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(process.as_raw_handle().cast(), TOKEN_QUERY, &mut raw) } == 0
        || raw.is_null()
    {
        return Err(untrusted());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    token_user_and_elevation(&token)
}

fn token_user_and_elevation(token: &OwnedHandle) -> Result<(String, bool), ProtectedCarrierError> {
    let handle = token.as_raw_handle().cast();
    let mut required = 0u32;
    let first =
        unsafe { GetTokenInformation(handle, TokenUser, std::ptr::null_mut(), 0, &mut required) };
    if first != 0
        || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER
        || required < std::mem::size_of::<TOKEN_USER>() as u32
    {
        return Err(untrusted());
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
        return Err(untrusted());
    }
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    if user.User.Sid.is_null() {
        return Err(untrusted());
    }
    let sid = sid_string(user.User.Sid)?;
    let mut elevation = TOKEN_ELEVATION::default();
    let mut elevation_size = 0u32;
    if unsafe {
        GetTokenInformation(
            handle,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast::<c_void>(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut elevation_size,
        )
    } == 0
        || elevation_size != std::mem::size_of::<TOKEN_ELEVATION>() as u32
    {
        return Err(untrusted());
    }
    Ok((sid, elevation.TokenIsElevated != 0))
}

fn sid_string(sid: *mut c_void) -> Result<String, ProtectedCarrierError> {
    let mut encoded = std::ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(sid, &mut encoded) } == 0 || encoded.is_null() {
        return Err(untrusted());
    }
    let result = (|| {
        let mut length = 0usize;
        while unsafe { *encoded.add(length) } != 0 {
            length += 1;
            if length > 256 {
                return Err(untrusted());
            }
        }
        String::from_utf16(unsafe { std::slice::from_raw_parts(encoded, length) })
            .map_err(|_| untrusted())
    })();
    unsafe {
        LocalFree(encoded.cast());
    }
    result
}

fn process_parent_id(process_id: u32) -> Result<u32, ProtectedCarrierError> {
    if process_id == 0 {
        return Err(untrusted());
    }
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
        return Err(untrusted());
    }
    let result = (|| {
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if unsafe { Process32FirstW(snapshot, &mut entry) } == 0 {
            return Err(untrusted());
        }
        loop {
            if entry.th32ProcessID == process_id {
                return (entry.th32ParentProcessID != 0)
                    .then_some(entry.th32ParentProcessID)
                    .ok_or_else(untrusted);
            }
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                return Err(untrusted());
            }
        }
    })();
    unsafe {
        CloseHandle(snapshot);
    }
    result
}

fn same_canonical_path(left: &Path, right: &Path) -> Result<bool, ProtectedCarrierError> {
    let left = std::fs::canonicalize(left).map_err(|_| untrusted())?;
    let right = std::fs::canonicalize(right).map_err(|_| untrusted())?;
    Ok(same_normalized_path(&left, &right))
}

fn same_normalized_path(left: &Path, right: &Path) -> bool {
    normalize_path(left).eq_ignore_ascii_case(&normalize_path(right))
}

fn normalize_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    value
        .strip_prefix(r"\\?\")
        .unwrap_or(&value)
        .replace('/', "\\")
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}
