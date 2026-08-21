use crate::{LocalAppAssetRevealTarget, LocalAppOperationError, LocalAppReasonCode};
use sha2::{Digest, Sha256};
use std::io::Read;

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-044
pub fn reveal_local_app_asset_target(
    target: LocalAppAssetRevealTarget,
) -> Result<(), LocalAppOperationError> {
    let path = std::path::PathBuf::from(&target.absolute_path);
    let expected_name = target
        .asset
        .relative_path
        .rsplit('/')
        .next()
        .ok_or_else(|| {
            LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUntrusted, false)
        })?;
    let metadata = std::fs::metadata(&path)
        .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::NotFound, false))?;
    if !path.is_absolute()
        || !metadata.is_file()
        || metadata.len() != target.asset.size_bytes as u64
        || path.file_name().and_then(|value| value.to_str()) != Some(expected_name)
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::RuntimeServiceUntrusted,
            false,
        ));
    }
    let mut file = std::fs::File::open(&path)
        .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::NotFound, false))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| {
            LocalAppOperationError::new(LocalAppReasonCode::IntegrityFailure, false)
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if format!("sha256:{:x}", hasher.finalize()) != target.asset.sha256 {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::IntegrityFailure,
            false,
        ));
    }
    reveal_in_file_manager(&path)
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), LocalAppOperationError> {
    crate::windows_asset_reveal::reveal_selected_file(path)
        .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::HostInternalError, false))
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), LocalAppOperationError> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::HostInternalError, false))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn reveal_in_file_manager(_path: &std::path::Path) -> Result<(), LocalAppOperationError> {
    Err(LocalAppOperationError::new(
        LocalAppReasonCode::CapabilityUnavailable,
        false,
    ))
}
