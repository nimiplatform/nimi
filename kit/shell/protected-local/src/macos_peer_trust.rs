use std::ffi::CStr;
use std::ffi::CString;
use std::os::fd::RawFd;
use std::path::PathBuf;

#[cfg(not(feature = "macos-source-local-development"))]
use crate::macos_profile::{
    LOCAL_APP_SOCKET_PATH, RUNTIME_EXECUTABLE_PATH, RUNTIME_SIGNING_IDENTIFIER, RUNTIME_SOCKET_PATH,
};
#[cfg(not(feature = "macos-source-local-development"))]
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
    #[cfg(not(feature = "macos-source-local-development"))]
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
        expected_executable: *const libc::c_char,
    ) -> i32;
}

const SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT: &str =
    "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE";

#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) fn runtime_socket_path() -> Result<PathBuf, ProtectedCarrierError> {
    Ok(PathBuf::from(MACOS_RUNTIME_SOCKET_PATH))
}

#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) fn local_app_runtime_socket_path() -> Result<PathBuf, ProtectedCarrierError> {
    // @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-037a
    // Installed Apps keep their published carrier. Only the source Host's
    // explicit Runtime observation selects D2; failed trust never falls back.
    if std::env::var_os(SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT).is_some() {
        expected_source_runtime_executable()?;
        return per_user_runtime_socket("runtime-local-app.sock");
    }
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
    if std::env::var_os(SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT).is_some() {
        return verify_source_runtime_peer(socket_fd, socket_path);
    }
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
    peer_verification_result(status)
}

#[cfg(feature = "macos-source-local-development")]
pub(crate) fn verify_runtime_peer_once(
    socket_fd: RawFd,
    socket_path: &str,
) -> Result<(), ProtectedCarrierError> {
    verify_source_runtime_peer(socket_fd, socket_path)
}

fn verify_source_runtime_peer(
    socket_fd: RawFd,
    socket_path: &str,
) -> Result<(), ProtectedCarrierError> {
    let local_app = per_user_runtime_socket("runtime-local-app.sock")?;
    let admitted_endpoint = socket_path == local_app.as_os_str();
    // A published App carrier does not redirect production Desktop control.
    #[cfg(feature = "macos-source-local-development")]
    let admitted_endpoint = admitted_endpoint
        || socket_path == per_user_runtime_socket("runtime-desktop.sock")?.as_os_str();
    if socket_fd < 0 || !admitted_endpoint {
        return Err(untrusted());
    }
    use std::os::unix::ffi::OsStrExt;
    let socket_path =
        CString::new(std::ffi::OsStr::new(socket_path).as_bytes()).map_err(|_| untrusted())?;
    let expected_executable = expected_source_runtime_executable()?;
    let expected_executable =
        CString::new(expected_executable.as_os_str().as_bytes()).map_err(|_| untrusted())?;
    let status = unsafe {
        nimi_macos_verify_per_user_runtime_peer(
            socket_fd,
            socket_path.as_ptr(),
            expected_executable.as_ptr(),
        )
    };
    peer_verification_result(status)
}

fn expected_source_runtime_executable() -> Result<PathBuf, ProtectedCarrierError> {
    validate_source_runtime_executable(std::env::var_os(SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT))
}

fn validate_source_runtime_executable(
    observed: Option<std::ffi::OsString>,
) -> Result<PathBuf, ProtectedCarrierError> {
    use std::os::unix::fs::MetadataExt;
    let path = observed
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(untrusted)?;
    let canonical = std::fs::canonicalize(&path).map_err(|_| untrusted())?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| untrusted())?;
    let uid = unsafe { libc::geteuid() };
    if canonical != path
        || uid == 0
        || !metadata.is_file()
        || metadata.uid() != uid
        || metadata.mode() & 0o022 != 0
        || metadata.mode() & 0o111 == 0
    {
        return Err(untrusted());
    }
    Ok(path)
}

fn peer_verification_result(status: i32) -> Result<(), ProtectedCarrierError> {
    match status {
        0 => Ok(()),
        // An unaccepted or disconnected socket can lack a live peer token.
        // No channel is admitted on these errors. Identity, executable and
        // signing mismatches still fail closed without a retryable verdict.
        libc::EINVAL | libc::ENOTCONN | libc::EPIPE | libc::ECONNRESET => Err(unavailable()),
        _ => Err(untrusted()),
    }
}

fn unavailable() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUnavailable, true)
}

#[cfg(any(test, not(feature = "macos-source-local-development")))]
struct MacOSSigningPolicy {
    requirement: CString,
    team: CString,
    identifier: CString,
    require_trusted_anchor: bool,
    require_ad_hoc: bool,
}

#[cfg(not(feature = "macos-source-local-development"))]
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

#[cfg(any(test, not(feature = "macos-source-local-development")))]
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

#[cfg(any(test, not(feature = "macos-source-local-development")))]
fn valid_signing_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('.')
        && !value.ends_with('.')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

#[cfg(any(test, not(feature = "macos-source-local-development")))]
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
    fn source_runtime_observation_requires_current_user_canonical_executable() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = std::env::temp_dir().join(format!(
            "nimi-source-peer-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let executable = root.join("runtime");
        std::fs::write(&executable, b"fixture").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            validate_source_runtime_executable(Some(executable.clone().into())).unwrap(),
            executable
        );
        let alias = root.join("alias");
        symlink(&executable, &alias).unwrap();
        for value in [
            None,
            Some("".into()),
            Some("relative/runtime".into()),
            Some(root.clone().into()),
            Some(root.join("missing").into()),
            Some(alias.into()),
        ] {
            let error = validate_source_runtime_executable(value).unwrap_err();
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::RuntimeServiceUntrusted
            );
            assert!(!error.retryable());
        }
        for mode in [0o600, 0o720, 0o702] {
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(mode)).unwrap();
            assert!(validate_source_runtime_executable(Some(executable.clone().into())).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(feature = "macos-source-local-development"))]
    #[test]
    fn published_carrier_selects_only_explicit_installed_source_runtime() {
        const CHILD: &str = "NIMI_TEST_INSTALLED_SOURCE_RUNTIME_PROFILE";
        if let Some(case) = std::env::var_os(CHILD) {
            assert_eq!(
                runtime_socket_path().unwrap(),
                PathBuf::from(MACOS_RUNTIME_SOCKET_PATH)
            );
            match case.to_str().unwrap() {
                "production" => assert_eq!(
                    local_app_runtime_socket_path().unwrap(),
                    PathBuf::from(MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH)
                ),
                "source" => assert_eq!(
                    local_app_runtime_socket_path().unwrap(),
                    per_user_runtime_socket("runtime-local-app.sock").unwrap()
                ),
                "invalid" => assert_eq!(
                    local_app_runtime_socket_path().unwrap_err().reason_code(),
                    ProtectedCarrierReasonCode::RuntimeServiceUntrusted
                ),
                _ => panic!("unknown test case"),
            }
            return;
        }
        for case in ["production", "source", "invalid"] {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap());
            child.args(["--exact", "macos_peer_trust::tests::published_carrier_selects_only_explicit_installed_source_runtime"])
                .env(CHILD, case).env_remove(SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT);
            if case == "source" {
                child.env(
                    SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT,
                    std::env::current_exe().unwrap(),
                );
            }
            if case == "invalid" {
                child.env(SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT, "");
            }
            assert!(child.status().unwrap().success(), "profile {case}");
        }
    }

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
        assert_eq!(policy.identifier.to_bytes(), b"ai.nimi.runtime.dev");
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

#[cfg(test)]
mod peer_result_tests {
    use super::*;

    #[test]
    fn accept_side_close_race_is_transient_unavailable() {
        for status in [libc::EINVAL, libc::ENOTCONN, libc::EPIPE, libc::ECONNRESET] {
            let error = peer_verification_result(status)
                .expect_err("accept-side close race must be transient");
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::RuntimeServiceUnavailable,
                "status {status}"
            );
            assert!(error.retryable(), "status {status}");
        }
    }

    #[test]
    fn identity_or_executable_mismatch_stays_fail_closed_untrusted() {
        assert!(peer_verification_result(0).is_ok());
        for status in [libc::EACCES, libc::EPERM, libc::ENOENT, -1] {
            let error =
                peer_verification_result(status).expect_err("genuine mismatch must fail closed");
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::RuntimeServiceUntrusted,
                "status {status}"
            );
            assert!(!error.retryable(), "status {status}");
        }
    }
}
