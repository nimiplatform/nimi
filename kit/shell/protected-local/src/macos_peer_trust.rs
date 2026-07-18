use std::ffi::CString;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};

use sha2::{Digest, Sha256};

use crate::macos_release_trust::{
    load_release_trust, require_mutual_compatibility, DESKTOP_ROLE, RUNTIME_ROLE,
};
use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

pub(crate) const MACOS_RUNTIME_SOCKET_PATH: &str = "/private/var/run/nimi/runtime-desktop.sock";
pub(crate) const MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH: &str =
    "/private/var/run/nimi/runtime-local-app.sock";
pub(crate) const MACOS_RUNTIME_EXECUTABLE_PATH: &str =
    "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime";
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
    executable_fd: i32,
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
        expected_cdhash: *const libc::c_char,
        output: *mut NativeVerifiedRuntimePeer,
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
    _executable: File,
    process_events: File,
    _release_id: String,
    _release_generation: u64,
}

impl VerifiedMacOSRuntimePeer {
    pub(crate) fn identity(&self) -> MacOSRuntimeProcessIdentity {
        self.identity
    }

    pub(crate) fn intact(&self) -> bool {
        let executable = match CString::new(MACOS_RUNTIME_EXECUTABLE_PATH) {
            Ok(value) => value,
            Err(_) => return false,
        };
        // SAFETY: every scalar was returned by the successful native verifier,
        // the kqueue descriptor remains owned by this value, and the C string
        // remains alive for the duration of the read-only liveness check.
        unsafe {
            nimi_macos_runtime_peer_alive(
                self.identity.pid,
                self.ppid,
                self.euid,
                self.identity.start_sec,
                self.identity.start_usec,
                self.process_events.as_raw_fd(),
                executable.as_ptr(),
            ) == 1
        }
    }
}

pub(crate) fn verify_runtime_peer(
    socket_fd: RawFd,
    socket_path: &'static str,
) -> Result<VerifiedMacOSRuntimePeer, ProtectedCarrierError> {
    if socket_fd < 0 {
        return Err(untrusted());
    }
    let runtime_release = load_release_trust(RUNTIME_ROLE)?;
    let desktop_release = load_release_trust(DESKTOP_ROLE)?;
    require_mutual_compatibility(&runtime_release, &desktop_release)?;
    if socket_path != MACOS_RUNTIME_SOCKET_PATH
        && socket_path != MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH
    {
        return Err(untrusted());
    }
    let socket_path = CString::new(socket_path).map_err(|_| untrusted())?;
    let executable = CString::new(MACOS_RUNTIME_EXECUTABLE_PATH).map_err(|_| untrusted())?;
    let identifier = CString::new(runtime_release.signing_identifier).map_err(|_| untrusted())?;
    let team = CString::new(runtime_release.team_id.as_str()).map_err(|_| untrusted())?;
    let requirement =
        CString::new(runtime_release.designated_requirement.as_str()).map_err(|_| untrusted())?;
    let cdhash = CString::new(runtime_release.cdhash.as_str()).map_err(|_| untrusted())?;
    let mut native = NativeVerifiedRuntimePeer {
        pid: 0,
        pidversion: 0,
        euid: 0,
        ruid: 0,
        ppid: 0,
        start_sec: 0,
        start_usec: 0,
        executable_fd: -1,
        kqueue_fd: -1,
    };
    // SAFETY: all pointers reference immutable NUL-terminated strings and the
    // output is valid writable storage. Successful native verification returns
    // ownership of exactly two nonnegative descriptors.
    let status = unsafe {
        nimi_macos_verify_runtime_peer(
            socket_fd,
            socket_path.as_ptr(),
            executable.as_ptr(),
            requirement.as_ptr(),
            team.as_ptr(),
            identifier.as_ptr(),
            cdhash.as_ptr(),
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
        || native.executable_fd < 0
        || native.kqueue_fd < 0
    {
        close_native_descriptors(native.executable_fd, native.kqueue_fd);
        return Err(untrusted());
    }
    // SAFETY: the native verifier transferred two distinct owned descriptors
    // on success; each is adopted once and closed by File.
    let mut executable = unsafe { File::from_raw_fd(native.executable_fd) };
    // SAFETY: see above.
    let process_events = unsafe { File::from_raw_fd(native.kqueue_fd) };
    if hash_open_executable(&mut executable)? != runtime_release.artifact_sha256 {
        return Err(untrusted());
    }
    let peer = VerifiedMacOSRuntimePeer {
        identity: MacOSRuntimeProcessIdentity {
            pid: native.pid,
            pidversion: native.pidversion,
            start_sec: native.start_sec,
            start_usec: native.start_usec,
        },
        euid: native.euid,
        ppid: native.ppid,
        _executable: executable,
        process_events,
        _release_id: runtime_release.release_id,
        _release_generation: runtime_release.generation,
    };
    if !peer.intact() {
        return Err(untrusted());
    }
    Ok(peer)
}

fn hash_open_executable(file: &mut File) -> Result<String, ProtectedCarrierError> {
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

fn close_native_descriptors(executable_fd: i32, kqueue_fd: i32) {
    if executable_fd >= 0 {
        // SAFETY: this path runs only before Rust ownership adoption.
        unsafe { libc::close(executable_fd) };
    }
    if kqueue_fd >= 0 && kqueue_fd != executable_fd {
        // SAFETY: this path runs only before Rust ownership adoption.
        unsafe { libc::close(kqueue_fd) };
    }
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}
