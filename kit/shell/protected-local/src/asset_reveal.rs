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
    let metadata = std::fs::metadata(&path).map_err(reveal_io_error)?;
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
    let mut file = std::fs::File::open(&path).map_err(reveal_io_error)?;
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
    let digest_hex: String = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if format!("sha256:{digest_hex}") != target.asset.sha256 {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::IntegrityFailure,
            false,
        ));
    }
    reveal_in_file_manager(&path)
}

fn reveal_io_error(error: std::io::Error) -> LocalAppOperationError {
    if !cfg!(target_os = "macos") {
        return LocalAppOperationError::new(LocalAppReasonCode::NotFound, false);
    }
    let reason = match error.kind() {
        std::io::ErrorKind::NotFound => LocalAppReasonCode::NotFound,
        std::io::ErrorKind::PermissionDenied => LocalAppReasonCode::RuntimeAccessDenied,
        _ => LocalAppReasonCode::HostInternalError,
    };
    LocalAppOperationError::new(reason, false)
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), LocalAppOperationError> {
    crate::windows_asset_reveal::reveal_selected_file(path)
        .map_err(|_| LocalAppOperationError::new(LocalAppReasonCode::HostInternalError, false))
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), LocalAppOperationError> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(reveal_io_error)?;
    if status.success() {
        Ok(())
    } else {
        Err(LocalAppOperationError::new(
            LocalAppReasonCode::HostInternalError,
            false,
        ))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn reveal_in_file_manager(_path: &std::path::Path) -> Result<(), LocalAppOperationError> {
    Err(LocalAppOperationError::new(
        LocalAppReasonCode::CapabilityUnavailable,
        false,
    ))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn macos_reveal_reports_access_denied_separately_from_missing_files() {
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(
            reveal_io_error(denied).reason_code(),
            LocalAppReasonCode::RuntimeAccessDenied
        );
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert_eq!(
            reveal_io_error(missing).reason_code(),
            LocalAppReasonCode::NotFound
        );
    }

    #[test]
    fn macos_reveal_checks_the_file_manager_command_result() {
        let executable = std::env::current_exe().expect("test executable");
        let failed = reveal_in_file_manager(&executable.join("missing.wav")).unwrap_err();
        assert_eq!(failed.reason_code(), LocalAppReasonCode::HostInternalError);
    }
}
