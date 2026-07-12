use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::PathBuf;

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Security::Cryptography::{
    CertGetCertificateContextProperty, CERT_SHA256_HASH_PROP_ID,
};
use windows_sys::Win32::Security::WinTrust::{
    WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData,
    WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
    WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT,
    WTD_REVOKE_WHOLECHAIN, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

const FILE_SHARE_READ: u32 = 0x0000_0001;
#[cfg(not(feature = "windows-e2e-fixture"))]
const EXPECTED_SIGNER_CERT_SHA256: Option<&str> =
    option_env!("NIMI_WINDOWS_PRODUCTION_SIGNER_CERT_SHA256");
#[cfg(feature = "windows-e2e-fixture")]
const EXPECTED_SIGNER_CERT_SHA256: Option<&str> =
    option_env!("NIMI_WINDOWS_E2E_SIGNER_CERT_SHA256");

pub(super) struct VerifiedRuntimePeer {
    _process: OwnedHandle,
    _executable: File,
}

pub(super) fn verify_runtime_peer_code_signing(
    process_id: u32,
) -> Result<VerifiedRuntimePeer, ProtectedCarrierError> {
    let expected = EXPECTED_SIGNER_CERT_SHA256
        .filter(|value| valid_sha256(value))
        .ok_or_else(untrusted)?;
    let process = open_runtime_process(process_id)?;
    let path = runtime_process_path(&process)?;
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .map_err(|_| untrusted())?;
    verify_authenticode_on_open_file(&file, expected)?;
    Ok(VerifiedRuntimePeer {
        _process: process,
        _executable: file,
    })
}

fn open_runtime_process(process_id: u32) -> Result<OwnedHandle, ProtectedCarrierError> {
    if process_id == 0 {
        return Err(untrusted());
    }
    // SAFETY: query-limited access is requested for a concrete nonzero PID and
    // ownership of a successful handle transfers to OwnedHandle.
    let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if raw.is_null() {
        return Err(untrusted());
    }
    // SAFETY: `raw` is newly owned and transferred exactly once.
    Ok(unsafe { OwnedHandle::from_raw_handle(raw.cast()) })
}

fn runtime_process_path(process: &OwnedHandle) -> Result<PathBuf, ProtectedCarrierError> {
    let mut buffer = vec![0u16; 32_768];
    let mut length = buffer.len() as u32;
    // SAFETY: the process handle is live and the mutable UTF-16 buffer has the
    // advertised capacity for the duration of the call.
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
    if !path.is_absolute() || path.as_os_str().is_empty() {
        return Err(untrusted());
    }
    Ok(path)
}

fn verify_authenticode_on_open_file(
    file: &File,
    expected_signer_cert_sha256: &str,
) -> Result<(), ProtectedCarrierError> {
    if !valid_sha256(expected_signer_cert_sha256) {
        return Err(untrusted());
    }
    let handle = file.as_raw_handle() as HANDLE;
    if handle.is_null() {
        return Err(untrusted());
    }
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: std::ptr::null(),
        hFile: handle,
        pgKnownSubject: std::ptr::null_mut(),
    };
    let mut trust_data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        pPolicyCallbackData: std::ptr::null_mut(),
        pSIPClientData: std::ptr::null_mut(),
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_WHOLECHAIN,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        hWVTStateData: std::ptr::null_mut(),
        pwszURLReference: std::ptr::null_mut(),
        dwProvFlags: WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT,
        dwUIContext: 0,
        pSignatureSettings: std::ptr::null_mut(),
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: all WinTrust structures are initialized with their exact sizes,
    // pointers reference stack values that outlive the call, and the file
    // handle stays open through verification and provider inspection.
    let status = unsafe {
        WinVerifyTrust(
            std::ptr::null_mut(),
            &mut action,
            (&mut trust_data as *mut WINTRUST_DATA).cast::<c_void>(),
        )
    };
    let result = if status == 0 {
        verified_leaf_cert_sha256(&trust_data).and_then(|observed| {
            if constant_time_eq_hex(&observed, expected_signer_cert_sha256) {
                Ok(())
            } else {
                Err(untrusted())
            }
        })
    } else {
        Err(untrusted())
    };
    trust_data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: closes only the state allocated by the matching VERIFY call.
    unsafe {
        WinVerifyTrust(
            std::ptr::null_mut(),
            &mut action,
            (&mut trust_data as *mut WINTRUST_DATA).cast::<c_void>(),
        );
    }
    result
}

fn verified_leaf_cert_sha256(trust_data: &WINTRUST_DATA) -> Result<String, ProtectedCarrierError> {
    if trust_data.hWVTStateData.is_null() {
        return Err(untrusted());
    }
    // SAFETY: provider/signer/certificate pointers are owned by the live
    // WinTrust state and are used read-only before WTD_STATEACTION_CLOSE.
    let cert = unsafe {
        let provider = WTHelperProvDataFromStateData(trust_data.hWVTStateData);
        if provider.is_null() {
            return Err(untrusted());
        }
        let signer = WTHelperGetProvSignerFromChain(provider, 0, 0, 0);
        if signer.is_null() {
            return Err(untrusted());
        }
        let provider_cert = WTHelperGetProvCertFromChain(signer, 0);
        if provider_cert.is_null() || (*provider_cert).pCert.is_null() {
            return Err(untrusted());
        }
        (*provider_cert).pCert
    };
    let mut bytes = [0u8; 32];
    let mut length = bytes.len() as u32;
    // SAFETY: cert is valid while WinTrust state is live and the output buffer
    // is writable for the supplied length.
    let succeeded = unsafe {
        CertGetCertificateContextProperty(
            cert,
            CERT_SHA256_HASH_PROP_ID,
            bytes.as_mut_ptr().cast::<c_void>(),
            &mut length,
        )
    };
    if succeeded == 0 || length as usize != bytes.len() {
        return Err(untrusted());
    }
    Ok(encode_hex(&bytes))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn constant_time_eq_hex(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signer_identity_is_exact_lowercase_sha256() {
        let digest = "ab".repeat(32);
        assert!(valid_sha256(&digest));
        assert!(constant_time_eq_hex(&digest, &digest));
        assert!(!constant_time_eq_hex(&digest, &"22".repeat(32)));
        assert!(!valid_sha256(&digest.to_uppercase()));
        assert!(!valid_sha256("11"));
    }

    #[test]
    fn certificate_hash_encoding_is_stable() {
        assert_eq!(encode_hex(&[0x00, 0x1f, 0xa0, 0xff]), "001fa0ff");
    }
}
