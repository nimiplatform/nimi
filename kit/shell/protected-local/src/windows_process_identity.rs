use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};
use std::ffi::c_void;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use windows_sys::Win32::Foundation::{GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, HANDLE};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenElevation, TokenSessionId, TokenUser, TOKEN_ELEVATION, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

// Shared token facts; no identity admission or elevation is performed here.
pub(crate) fn current_process_user() -> Result<(String, bool, u32), ProtectedCarrierError> {
    let mut raw: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 || raw.is_null()
    {
        return Err(untrusted());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    token_user_and_elevation(&token)
}

pub(crate) fn process_user(process: HANDLE) -> Result<(String, bool, u32), ProtectedCarrierError> {
    let mut raw: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) } == 0 || raw.is_null() {
        return Err(untrusted());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    token_user_and_elevation(&token)
}

fn token_user_and_elevation(
    token: &OwnedHandle,
) -> Result<(String, bool, u32), ProtectedCarrierError> {
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
    let mut session_id = 0u32;
    let mut session_size = 0u32;
    if unsafe {
        GetTokenInformation(
            handle,
            TokenSessionId,
            (&mut session_id as *mut u32).cast::<c_void>(),
            std::mem::size_of::<u32>() as u32,
            &mut session_size,
        )
    } == 0
        || session_size != std::mem::size_of::<u32>() as u32
        || session_id == 0
    {
        return Err(untrusted());
    }
    Ok((sid, elevation.TokenIsElevated != 0, session_id))
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

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}
