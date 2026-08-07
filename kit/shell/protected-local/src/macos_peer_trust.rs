use std::ffi::{CStr, CString};
use std::os::fd::RawFd;
use std::path::PathBuf;

#[cfg(not(feature = "macos-source-local-development"))]
use crate::macos_profile::{
    LOCAL_APP_SOCKET_PATH, RUNTIME_EXECUTABLE_PATH, RUNTIME_SIGNING_IDENTIFIER, RUNTIME_SOCKET_PATH,
};
use crate::macos_profile::{
    MACOS_TEAM_ID, REQUIRE_AD_HOC, REQUIRE_NOTARIZATION, REQUIRE_TRUSTED_ANCHOR,
};
use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) const MACOS_RUNTIME_SOCKET_PATH: &str = RUNTIME_SOCKET_PATH;
#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) const MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH: &str = LOCAL_APP_SOCKET_PATH;
#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) const MACOS_RUNTIME_EXECUTABLE_PATH: &str = RUNTIME_EXECUTABLE_PATH;
unsafe extern "C" {
    fn nimi_macos_verify_runtime_peer(
        socket_fd: i32,
        expected_path: *const libc::c_char,
        expected_executable: *const libc::c_char,
        expected_requirement: *const libc::c_char,
        expected_team: *const libc::c_char,
        expected_identifier: *const libc::c_char,
        require_trusted_anchor: i32,
        require_ad_hoc: i32,
    ) -> i32;
    fn nimi_macos_verify_per_user_runtime_peer(
        socket_fd: i32,
        expected_path: *const libc::c_char,
    ) -> i32;
}

#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) fn runtime_socket_path() -> Result<PathBuf, ProtectedCarrierError> {
    Ok(PathBuf::from(MACOS_RUNTIME_SOCKET_PATH))
}

#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) fn local_app_runtime_socket_path() -> Result<PathBuf, ProtectedCarrierError> {
    Ok(PathBuf::from(MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH))
}

#[cfg(feature = "macos-source-local-development")]
pub(crate) fn runtime_socket_path() -> Result<PathBuf, ProtectedCarrierError> {
    per_user_runtime_socket("runtime-desktop.sock")
}

#[cfg(feature = "macos-source-local-development")]
pub(crate) fn local_app_runtime_socket_path() -> Result<PathBuf, ProtectedCarrierError> {
    per_user_runtime_socket("runtime-local-app.sock")
}

#[cfg(feature = "macos-source-local-development")]
fn per_user_runtime_socket(filename: &str) -> Result<PathBuf, ProtectedCarrierError> {
    let uid = unsafe { libc::geteuid() };
    if uid == 0 {
        return Err(untrusted());
    }
    let mut record = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut result = std::ptr::null_mut();
    let mut buffer = vec![0u8; 16 * 1024];
    let status = unsafe {
        libc::getpwuid_r(
            uid,
            record.as_mut_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return Err(untrusted());
    }
    let record = unsafe { record.assume_init() };
    if record.pw_dir.is_null() {
        return Err(untrusted());
    }
    let home = unsafe { CStr::from_ptr(record.pw_dir) }
        .to_str()
        .ok()
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(untrusted)?;
    let canonical_home = std::fs::canonicalize(&home).map_err(|_| untrusted())?;
    if canonical_home != home {
        return Err(untrusted());
    }
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Nimi")
        .join("RuntimeLocalDevelopment")
        .join("run")
        .join(filename))
}

#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) fn verify_runtime_peer_once(
    socket_fd: RawFd,
    socket_path: &str,
) -> Result<(), ProtectedCarrierError> {
    if socket_fd < 0
        || (socket_path != MACOS_RUNTIME_SOCKET_PATH
            && socket_path != MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH)
    {
        return Err(untrusted());
    }
    let policy = signing_policy(RUNTIME_SIGNING_IDENTIFIER)?;
    let socket_path = CString::new(socket_path).map_err(|_| untrusted())?;
    let executable = CString::new(MACOS_RUNTIME_EXECUTABLE_PATH).map_err(|_| untrusted())?;
    // A null output requests direct peer validation without retaining a
    // process witness. The connected Unix socket owns the Desktop channel
    // lifetime.
    let status = unsafe {
        nimi_macos_verify_runtime_peer(
            socket_fd,
            socket_path.as_ptr(),
            executable.as_ptr(),
            policy.requirement.as_ptr(),
            policy.team.as_ptr(),
            policy.identifier.as_ptr(),
            i32::from(policy.require_trusted_anchor),
            i32::from(policy.require_ad_hoc),
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(untrusted())
    }
}

#[cfg(feature = "macos-source-local-development")]
pub(crate) fn verify_runtime_peer_once(
    socket_fd: RawFd,
    socket_path: &str,
) -> Result<(), ProtectedCarrierError> {
    let desktop = runtime_socket_path()?;
    let local_app = local_app_runtime_socket_path()?;
    if socket_fd < 0 || (socket_path != desktop.as_os_str() && socket_path != local_app.as_os_str())
    {
        return Err(untrusted());
    }
    use std::os::unix::ffi::OsStrExt;
    let socket_path =
        CString::new(std::ffi::OsStr::new(socket_path).as_bytes()).map_err(|_| untrusted())?;
    let status =
        unsafe { nimi_macos_verify_per_user_runtime_peer(socket_fd, socket_path.as_ptr()) };
    if status == 0 {
        Ok(())
    } else {
        Err(untrusted())
    }
}

struct MacOSSigningPolicy {
    requirement: CString,
    team: CString,
    identifier: CString,
    require_trusted_anchor: bool,
    require_ad_hoc: bool,
}

fn signing_policy(
    signing_identifier: &'static str,
) -> Result<MacOSSigningPolicy, ProtectedCarrierError> {
    build_signing_policy(
        signing_identifier,
        MACOS_TEAM_ID,
        REQUIRE_TRUSTED_ANCHOR,
        REQUIRE_NOTARIZATION,
        REQUIRE_AD_HOC,
    )
}

fn build_signing_policy(
    signing_identifier: &str,
    team: Option<&str>,
    require_trusted_anchor: bool,
    require_notarization: bool,
    require_ad_hoc: bool,
) -> Result<MacOSSigningPolicy, ProtectedCarrierError> {
    if !valid_signing_identifier(signing_identifier) {
        return Err(untrusted());
    }
    if require_notarization && (!require_trusted_anchor || require_ad_hoc) {
        return Err(untrusted());
    }
    let (team, mut requirement) = if require_ad_hoc {
        if team.is_some() || require_trusted_anchor {
            return Err(untrusted());
        }
        (None, format!("identifier \"{signing_identifier}\""))
    } else {
        let team = team
            .filter(|team| valid_team_id(team))
            .ok_or_else(untrusted)?;
        if !require_trusted_anchor {
            return Err(untrusted());
        }
        (
            Some(team),
            format!(
                "identifier \"{signing_identifier}\" and anchor apple generic and \
                 certificate leaf[subject.OU] = \"{team}\""
            ),
        )
    };
    if require_notarization {
        requirement.push_str(" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists");
    }
    Ok(MacOSSigningPolicy {
        requirement: CString::new(requirement).map_err(|_| untrusted())?,
        team: CString::new(team.unwrap_or_default()).map_err(|_| untrusted())?,
        identifier: CString::new(signing_identifier).map_err(|_| untrusted())?,
        require_trusted_anchor,
        require_ad_hoc,
    })
}

fn valid_signing_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('.')
        && !value.ends_with('.')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

fn valid_team_id(value: &str) -> bool {
    value.len() == 10
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_signing_policy_values_are_closed() {
        assert!(valid_signing_identifier("ai.nimi.runtime"));
        assert!(!valid_signing_identifier("../ai.nimi.runtime"));
        assert!(valid_team_id("ABCDE12345"));
        assert!(!valid_team_id("abcde12345"));
    }

    #[test]
    fn ad_hoc_signing_policy_is_identifier_only_and_teamless() {
        let policy = build_signing_policy("ai.nimi.runtime.dev", None, false, false, true)
            .expect("ad-hoc local-development policy");
        assert_eq!(
            policy.requirement.to_str().expect("requirement"),
            "identifier \"ai.nimi.runtime.dev\""
        );
        assert_eq!(policy.team.to_bytes(), b"");
        assert!(policy.require_ad_hoc);
        assert!(!policy.require_trusted_anchor);

        assert!(build_signing_policy(
            "ai.nimi.runtime.dev",
            Some("ABCDE12345"),
            false,
            false,
            true,
        )
        .is_err());
        assert!(build_signing_policy("ai.nimi.runtime.dev", None, true, false, true,).is_err());
    }

    #[test]
    fn production_signing_policy_keeps_team_anchor_and_notarization() {
        let policy = build_signing_policy("ai.nimi.runtime", Some("ABCDE12345"), true, true, false)
            .expect("production signing policy");
        assert_eq!(policy.team.to_str().expect("team"), "ABCDE12345");
        assert!(policy.require_trusted_anchor);
        assert!(!policy.require_ad_hoc);
        assert!(policy
            .requirement
            .to_str()
            .expect("requirement")
            .contains("anchor apple generic"));

        assert!(build_signing_policy("ai.nimi.runtime", None, true, true, false,).is_err());
    }
}
