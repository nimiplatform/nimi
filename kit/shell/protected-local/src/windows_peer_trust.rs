use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};
use std::fs::{File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::PathBuf;
use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
};

pub(super) struct VerifiedRuntimePeer {
    _process: OwnedHandle,
    _executable: File,
    pub(super) release_version: String,
}
impl VerifiedRuntimePeer {
    pub(super) fn running(&self) -> bool {
        unsafe { WaitForSingleObject(self._process.as_raw_handle().cast(), 0) == WAIT_TIMEOUT }
    }
}
// @nimi-authority: rule.nimi.runtime.service-operations.r054
pub(super) fn verify_runtime_peer(
    process_id: u32,
) -> Result<VerifiedRuntimePeer, ProtectedCarrierError> {
    if process_id == 0 {
        return Err(untrusted());
    }
    let raw = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | 0x00100000,
            0,
            process_id,
        )
    }; // SYNCHRONIZE
    if raw.is_null() {
        return Err(untrusted());
    }
    let process = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    if unsafe {
        QueryFullProcessImageNameW(
            process.as_raw_handle().cast(),
            0,
            buffer.as_mut_ptr(),
            &mut length,
        )
    } == 0
        || length == 0
    {
        return Err(untrusted());
    }
    let path =
        PathBuf::from(String::from_utf16(&buffer[..length as usize]).map_err(|_| untrusted())?);
    // FILE_SHARE_READ excludes writes and replacement while the exact peer
    // remains admitted. Fixed administrative root and signed full inventory
    // also protect the code it loads. NotSigned alone carries no identity.
    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .map_err(|_| untrusted())?;
    let release_version = crate::windows_product_admission::verify_runtime(&path, &mut file)?;
    let peer = VerifiedRuntimePeer {
        _process: process,
        _executable: file,
        release_version,
    };
    if !peer.running() {
        return Err(untrusted());
    }
    Ok(peer)
}
fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}
