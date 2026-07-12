use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::windows_release_trust::{
    verify_windows_release_trust_record, VerifiedWindowsReleaseTrust,
    WindowsReleaseTrustRequirements,
};
use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

const FILE_SHARE_READ: u32 = 0x0000_0001;
const MAX_RELEASE_RECORD_BYTES: u64 = 64 * 1024;
const RELEASE_RECORD_RELATIVE_PATH: &str =
    "trust/protected-local/v1/nimi_runtime_service.release-trust-record.json";
const ROOT_KEY_ID: Option<&str> = option_env!("NIMI_PLATFORM_RELEASE_ROOT_KEY_ID");
const ROOT_PUBLIC_KEY_B64URL: Option<&str> =
    option_env!("NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL");

pub(super) struct LockedRuntimeExecutable {
    pub file: File,
    pub path: PathBuf,
    pub digest_hex: String,
    pub release: VerifiedWindowsReleaseTrust,
}

struct ProcessHandle(HANDLE);

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: this type exclusively owns the handle returned by
            // OpenProcess and closes it exactly once.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

pub(super) fn lock_and_verify_runtime_executable(
    process_id: u32,
) -> Result<LockedRuntimeExecutable, ProtectedCarrierError> {
    let path = runtime_process_path(process_id)?;
    let release_root = path.parent().ok_or_else(untrusted)?;
    let release_id = release_root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| valid_path_component(value))
        .ok_or_else(untrusted)?;
    let canonical_root = fs::canonicalize(release_root).map_err(|_| untrusted())?;
    let canonical_path = fs::canonicalize(&path).map_err(|_| untrusted())?;
    if canonical_path.parent() != Some(canonical_root.as_path()) {
        return Err(untrusted());
    }

    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&canonical_path)
        .map_err(|_| untrusted())?;
    if !file.metadata().map_err(|_| untrusted())?.is_file() {
        return Err(untrusted());
    }
    let digest_hex = hash_locked_file(&mut file)?;
    let record_path = canonical_root.join(RELEASE_RECORD_RELATIVE_PATH);
    let record = read_bounded_regular_file(&record_path)?;
    let root_key_id = ROOT_KEY_ID
        .filter(|value| valid_path_component(value))
        .ok_or_else(untrusted)?;
    let root_key = decode_build_root_key()?;
    let release = verify_windows_release_trust_record(
        &record,
        WindowsReleaseTrustRequirements {
            release_id,
            artifact_sha256: &digest_hex,
            root_key_id,
            root_public_key: &root_key,
            now: OffsetDateTime::now_utc(),
        },
    )?;
    Ok(LockedRuntimeExecutable {
        file,
        path: canonical_path,
        digest_hex,
        release,
    })
}

fn runtime_process_path(process_id: u32) -> Result<PathBuf, ProtectedCarrierError> {
    if process_id == 0 {
        return Err(untrusted());
    }
    // SAFETY: OpenProcess receives a concrete nonzero PID and requests only
    // query-limited access; ownership transfers to ProcessHandle.
    let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if raw.is_null() {
        return Err(untrusted());
    }
    let process = ProcessHandle(raw);
    let mut buffer = vec![0u16; 32_768];
    let mut length = buffer.len() as u32;
    // SAFETY: the process handle is live, the UTF-16 buffer is writable for
    // `length` elements, and Windows updates length within that allocation.
    let succeeded =
        unsafe { QueryFullProcessImageNameW(process.0, 0, buffer.as_mut_ptr(), &mut length) };
    if succeeded == 0 || length == 0 || length as usize > buffer.len() {
        return Err(untrusted());
    }
    let path = String::from_utf16(&buffer[..length as usize]).map_err(|_| untrusted())?;
    let path = PathBuf::from(path);
    if !path.is_absolute() || path.as_os_str().is_empty() {
        return Err(untrusted());
    }
    Ok(path)
}

fn hash_locked_file(file: &mut File) -> Result<String, ProtectedCarrierError> {
    file.seek(SeekFrom::Start(0)).map_err(|_| untrusted())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| untrusted())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    file.seek(SeekFrom::Start(0)).map_err(|_| untrusted())?;
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").map_err(|_| untrusted())?;
    }
    Ok(encoded)
}

fn read_bounded_regular_file(path: &Path) -> Result<Vec<u8>, ProtectedCarrierError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| untrusted())?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_RELEASE_RECORD_BYTES
    {
        return Err(untrusted());
    }
    let bytes = fs::read(path).map_err(|_| untrusted())?;
    if bytes.is_empty() || bytes.len() as u64 != metadata.len() {
        return Err(untrusted());
    }
    Ok(bytes)
}

fn decode_build_root_key() -> Result<[u8; 32], ProtectedCarrierError> {
    let encoded = ROOT_PUBLIC_KEY_B64URL.ok_or_else(untrusted)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.as_bytes())
        .map_err(|_| untrusted())?;
    bytes.try_into().map_err(|_| untrusted())
}

fn valid_path_component(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value != "."
        && value != ".."
        && !value.contains(['/', '\\', '\0'])
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_and_root_identifiers_are_single_canonical_components() {
        for value in ["runtime-2026.07", "platform-release-root-production-v1"] {
            assert!(valid_path_component(value));
        }
        for value in ["", ".", "..", "../escape", "nested/path", " bad", "bad\0id"] {
            assert!(!valid_path_component(value));
        }
    }
}
