use std::ffi::CString;
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, RawFd};

use crate::macos_profile::{
    DESKTOP_APPLICATION_PATH, DESKTOP_SIGNING_IDENTIFIER, LOCAL_APP_SOCKET_PATH, MACOS_TEAM_ID,
    REQUIRE_AD_HOC, REQUIRE_NOTARIZATION, REQUIRE_TRUSTED_ANCHOR, RUNTIME_EXECUTABLE_PATH,
    RUNTIME_SIGNING_IDENTIFIER, RUNTIME_SOCKET_PATH,
};
use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

pub(crate) const MACOS_RUNTIME_SOCKET_PATH: &str = RUNTIME_SOCKET_PATH;
pub(crate) const MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH: &str = LOCAL_APP_SOCKET_PATH;
pub(crate) const MACOS_RUNTIME_EXECUTABLE_PATH: &str = RUNTIME_EXECUTABLE_PATH;
#[repr(C)]
#[derive(Clone, Copy)]
struct NativeVerifiedRuntimePeer {
    pid: u32,
    pidversion: u32,
    euid: u32,
    ruid: u32,
    ppid: u32,
    start_sec: u64,
    start_usec: u64,
    kqueue_fd: i32,
}

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
        output: *mut NativeVerifiedRuntimePeer,
    ) -> i32;
    fn nimi_macos_verify_outer_bundle(
        expected_path: *const libc::c_char,
        expected_requirement: *const libc::c_char,
        expected_team: *const libc::c_char,
        expected_identifier: *const libc::c_char,
        require_trusted_anchor: i32,
        require_notarization: i32,
        require_ad_hoc: i32,
    ) -> i32;
    fn nimi_macos_runtime_peer_alive(
        pid: u32,
        expected_ppid: u32,
        expected_euid: u32,
        start_sec: u64,
        start_usec: u64,
        kqueue_fd: i32,
        expected_executable: *const libc::c_char,
    ) -> i32;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct MacOSRuntimeProcessIdentity {
    pub(crate) pid: u32,
    pub(crate) pidversion: u32,
    pub(crate) start_sec: u64,
    pub(crate) start_usec: u64,
}

pub(crate) struct VerifiedMacOSRuntimePeer {
    identity: MacOSRuntimeProcessIdentity,
    euid: u32,
    ppid: u32,
    process_events: File,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MacOSRuntimePeerState {
    Intact,
    Exited,
    Replaced,
    Untrusted,
}

fn decode_runtime_peer_state(value: i32) -> MacOSRuntimePeerState {
    match value {
        1 => MacOSRuntimePeerState::Intact,
        0 => MacOSRuntimePeerState::Exited,
        2 => MacOSRuntimePeerState::Replaced,
        _ => MacOSRuntimePeerState::Untrusted,
    }
}

impl VerifiedMacOSRuntimePeer {
    pub(crate) fn identity(&self) -> MacOSRuntimeProcessIdentity {
        self.identity
    }

    pub(crate) fn intact(&self) -> bool {
        self.state() == MacOSRuntimePeerState::Intact
    }

    pub(crate) fn state(&self) -> MacOSRuntimePeerState {
        let executable = match CString::new(MACOS_RUNTIME_EXECUTABLE_PATH) {
            Ok(value) => value,
            Err(_) => return MacOSRuntimePeerState::Untrusted,
        };
        // SAFETY: every scalar was returned by the successful native verifier,
        // the kqueue descriptor remains owned by this value, and the C string
        // remains alive for the duration of the read-only liveness check.
        let state = unsafe {
            nimi_macos_runtime_peer_alive(
                self.identity.pid,
                self.ppid,
                self.euid,
                self.identity.start_sec,
                self.identity.start_usec,
                self.process_events.as_raw_fd(),
                executable.as_ptr(),
            )
        };
        decode_runtime_peer_state(state)
    }
}

pub(crate) fn verify_runtime_peer(
    socket_fd: RawFd,
    socket_path: &'static str,
) -> Result<VerifiedMacOSRuntimePeer, ProtectedCarrierError> {
    if socket_fd < 0 {
        return Err(untrusted());
    }
    if socket_path != MACOS_RUNTIME_SOCKET_PATH
        && socket_path != MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH
    {
        return Err(untrusted());
    }
    verify_desktop_bundle()?;
    let policy = signing_policy(RUNTIME_SIGNING_IDENTIFIER)?;
    let socket_path = CString::new(socket_path).map_err(|_| untrusted())?;
    let executable = CString::new(MACOS_RUNTIME_EXECUTABLE_PATH).map_err(|_| untrusted())?;
    let mut native = NativeVerifiedRuntimePeer {
        pid: 0,
        pidversion: 0,
        euid: 0,
        ruid: 0,
        ppid: 0,
        start_sec: 0,
        start_usec: 0,
        kqueue_fd: -1,
    };
    // SAFETY: all pointers reference immutable NUL-terminated strings and the
    // output is valid writable storage. Successful native verification returns
    // ownership of exactly one nonnegative kqueue descriptor.
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
            &mut native,
        )
    };
    if status != 0
        || native.pid == 0
        || native.pidversion == 0
        || native.euid == 0
        || native.euid != native.ruid
        || native.ppid != 1
        || native.start_sec == 0
        || native.kqueue_fd < 0
    {
        close_native_descriptor(native.kqueue_fd);
        return Err(untrusted());
    }
    // SAFETY: the native verifier transferred one owned descriptor on success.
    let process_events = unsafe { File::from_raw_fd(native.kqueue_fd) };
    let peer = VerifiedMacOSRuntimePeer {
        identity: MacOSRuntimeProcessIdentity {
            pid: native.pid,
            pidversion: native.pidversion,
            start_sec: native.start_sec,
            start_usec: native.start_usec,
        },
        euid: native.euid,
        ppid: native.ppid,
        process_events,
    };
    if !peer.intact() {
        return Err(untrusted());
    }
    Ok(peer)
}

struct MacOSSigningPolicy {
    requirement: CString,
    team: CString,
    identifier: CString,
    require_trusted_anchor: bool,
    require_notarization: bool,
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
        require_notarization,
        require_ad_hoc,
    })
}

fn verify_desktop_bundle() -> Result<(), ProtectedCarrierError> {
    let policy = signing_policy(DESKTOP_SIGNING_IDENTIFIER)?;
    let path = CString::new(DESKTOP_APPLICATION_PATH).map_err(|_| untrusted())?;
    // SAFETY: every pointer references immutable NUL-terminated storage for
    // this read-only Security.framework validation of the fixed app path.
    let status = unsafe {
        nimi_macos_verify_outer_bundle(
            path.as_ptr(),
            policy.requirement.as_ptr(),
            policy.team.as_ptr(),
            policy.identifier.as_ptr(),
            i32::from(policy.require_trusted_anchor),
            i32::from(policy.require_notarization),
            i32::from(policy.require_ad_hoc),
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(untrusted())
    }
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

fn close_native_descriptor(kqueue_fd: i32) {
    if kqueue_fd >= 0 {
        // SAFETY: this path runs only before Rust ownership adoption.
        unsafe { libc::close(kqueue_fd) };
    }
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_runtime_witness_states_remain_distinct() {
        assert_eq!(decode_runtime_peer_state(1), MacOSRuntimePeerState::Intact);
        assert_eq!(decode_runtime_peer_state(0), MacOSRuntimePeerState::Exited);
        assert_eq!(
            decode_runtime_peer_state(2),
            MacOSRuntimePeerState::Replaced
        );
        assert_eq!(
            decode_runtime_peer_state(-1),
            MacOSRuntimePeerState::Untrusted
        );
        assert_eq!(
            decode_runtime_peer_state(99),
            MacOSRuntimePeerState::Untrusted
        );
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
        assert!(policy.require_ad_hoc);
        assert!(!policy.require_trusted_anchor);
        assert!(!policy.require_notarization);

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
        assert!(policy.require_notarization);
        assert!(!policy.require_ad_hoc);
        assert!(policy
            .requirement
            .to_str()
            .expect("requirement")
            .contains("anchor apple generic"));

        assert!(build_signing_policy("ai.nimi.runtime", None, true, true, false,).is_err());
    }
}
