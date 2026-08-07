use std::ffi::CString;
use std::os::fd::{FromRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(not(feature = "macos-source-local-development"))]
use crate::macos_profile::LOCAL_APP_HOST_PATH;
use crate::{NimiHostError, NimiHostErrorReasonCode};

#[cfg(not(feature = "macos-source-local-development"))]
pub(crate) const MACOS_LOCAL_APP_HOST_PATH: &str = LOCAL_APP_HOST_PATH;
const MAX_HOST_ARGUMENTS: usize = 64;
const MAX_HOST_ARGUMENT_BYTES: usize = 64 * 1024;

unsafe extern "C" {
    fn nimi_macos_spawn_suspended(
        executable: *const libc::c_char,
        argv: *const *mut libc::c_char,
        envp: *const *mut libc::c_char,
        working_directory: *const libc::c_char,
        pid_output: *mut u32,
    ) -> i32;
    fn nimi_macos_watch_child(pid: u32) -> i32;
    fn nimi_macos_child_running(pid: u32, kqueue_fd: i32) -> i32;
    fn nimi_macos_terminate_child_group(pid: u32) -> i32;
}

pub(crate) struct SupervisedDevelopmentProcess {
    pid: u32,
    process_events: OwnedFd,
    terminated: AtomicBool,
}

impl SupervisedDevelopmentProcess {
    pub(crate) fn create_runtime_authorized(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
    ) -> Result<Self, NimiHostError> {
        let executable = canonical_fixed_host(executable)?;
        let working_directory = canonical_working_directory(working_directory)?;
        let argument_bytes = arguments.iter().try_fold(0usize, |total, value| {
            if value.is_empty() || value.as_bytes().contains(&0) {
                return Err(untrusted());
            }
            total.checked_add(value.len()).ok_or_else(untrusted)
        })?;
        if arguments.len() > MAX_HOST_ARGUMENTS || argument_bytes > MAX_HOST_ARGUMENT_BYTES {
            return Err(untrusted());
        }
        let executable_c = path_cstring(&executable)?;
        let working_directory_c = path_cstring(&working_directory)?;
        let mut argv_values = Vec::with_capacity(arguments.len() + 1);
        argv_values.push(executable_c.clone());
        for argument in arguments {
            argv_values.push(CString::new(argument.as_str()).map_err(|_| untrusted())?);
        }
        let mut argv = argv_values
            .iter()
            .map(|value| value.as_ptr().cast_mut())
            .collect::<Vec<_>>();
        argv.push(std::ptr::null_mut());
        let environment_values = sanitized_environment()?;
        let mut envp = environment_values
            .iter()
            .map(|value| value.as_ptr().cast_mut())
            .collect::<Vec<_>>();
        envp.push(std::ptr::null_mut());
        let mut pid = 0u32;
        // SAFETY: every pointer references stable NUL-terminated storage for
        // the complete call, both pointer vectors have a terminal NULL, and
        // the native wrapper returns only a start-suspended child in a new
        // process group for the fixed signed host path.
        let status = unsafe {
            nimi_macos_spawn_suspended(
                executable_c.as_ptr(),
                argv.as_ptr(),
                envp.as_ptr(),
                working_directory_c.as_ptr(),
                &mut pid,
            )
        };
        if status != 0 || pid == 0 {
            return Err(untrusted());
        }
        // SAFETY: pid is the newly owned, start-suspended direct child.
        let queue = unsafe { nimi_macos_watch_child(pid) };
        if queue < 0 {
            // SAFETY: termination is bounded to the just-created process group.
            unsafe { nimi_macos_terminate_child_group(pid) };
            return Err(untrusted());
        }
        // SAFETY: the native watcher returned a newly owned descriptor.
        let process_events = unsafe { OwnedFd::from_raw_fd(queue) };
        Ok(Self {
            pid,
            process_events,
            terminated: AtomicBool::new(false),
        })
    }

    pub(crate) fn id(&self) -> u32 {
        self.pid
    }

    pub(crate) fn resume(&mut self) -> Result<(), NimiHostError> {
        if self.terminated.load(Ordering::Acquire) || !self.running() {
            return Err(untrusted());
        }
        // SAFETY: the positive PID is the retained direct child; SIGCONT does
        // not cross the child's independently created process group boundary.
        if unsafe { libc::kill(self.pid as libc::pid_t, libc::SIGCONT) } != 0 {
            return Err(untrusted());
        }
        Ok(())
    }

    pub(crate) fn running(&self) -> bool {
        if self.terminated.load(Ordering::Acquire) {
            return false;
        }
        use std::os::fd::AsRawFd;
        // SAFETY: pid and kqueue are retained together for this child.
        unsafe { nimi_macos_child_running(self.pid, self.process_events.as_raw_fd()) == 1 }
    }

    fn terminate(&self) -> Result<(), NimiHostError> {
        if self.terminated.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        // SAFETY: native termination targets only process group -pid, waits
        // for the direct child, and has a bounded TERM-to-KILL transition.
        let status = unsafe { nimi_macos_terminate_child_group(self.pid) };
        if status == 0 {
            Ok(())
        } else {
            Err(untrusted())
        }
    }
}

impl Drop for SupervisedDevelopmentProcess {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

fn canonical_fixed_host(path: &Path) -> Result<PathBuf, NimiHostError> {
    #[cfg(not(feature = "macos-source-local-development"))]
    if path != Path::new(MACOS_LOCAL_APP_HOST_PATH) {
        return Err(untrusted());
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| untrusted())?;
    if canonical != path || !canonical.is_file() {
        return Err(untrusted());
    }
    #[cfg(feature = "macos-source-local-development")]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let metadata = canonical.metadata().map_err(|_| untrusted())?;
        if unsafe { libc::geteuid() } == 0
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o022 != 0
        {
            return Err(untrusted());
        }
    }
    Ok(canonical)
}

fn canonical_working_directory(path: &Path) -> Result<PathBuf, NimiHostError> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(untrusted());
    }
    std::fs::canonicalize(path).map_err(|_| untrusted())
}

fn path_cstring(path: &Path) -> Result<CString, NimiHostError> {
    use std::os::unix::ffi::OsStrExt;
    CString::new(path.as_os_str().as_bytes()).map_err(|_| untrusted())
}

fn sanitized_environment() -> Result<Vec<CString>, NimiHostError> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .and_then(|path| std::fs::canonicalize(path).ok())
        .ok_or_else(untrusted)?;
    let home = path_text(&home)?;
    let mut values = vec![
        "PATH=/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
        format!("HOME={home}"),
        "TMPDIR=/private/tmp".to_string(),
        "LANG=en_US.UTF-8".to_string(),
    ];
    #[cfg(feature = "macos-source-local-development")]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let entry = std::env::var_os("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY")
            .map(PathBuf::from)
            .filter(|value| value.is_absolute())
            .and_then(|value| std::fs::canonicalize(value).ok())
            .ok_or_else(untrusted)?;
        let metadata = entry.metadata().map_err(|_| untrusted())?;
        let expected_suffix = Path::new("kit")
            .join("shell")
            .join("protected-local-node")
            .join("npm")
            .join("darwin-arm64")
            .join("index.cjs");
        if !entry.ends_with(expected_suffix)
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o022 != 0
        {
            return Err(untrusted());
        }
        values.push("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT=1".to_string());
        values.push(format!(
            "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY={}",
            path_text(&entry)?
        ));
    }
    values.sort();
    values
        .into_iter()
        .map(|value| CString::new(value).map_err(|_| untrusted()))
        .collect()
}

fn path_text(path: &Path) -> Result<&str, NimiHostError> {
    path.to_str().ok_or_else(untrusted)
}

fn untrusted() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(feature = "macos-source-local-development"))]
    #[test]
    fn fixed_host_path_is_not_project_selectable() {
        assert_eq!(MACOS_LOCAL_APP_HOST_PATH, LOCAL_APP_HOST_PATH);
        assert!(canonical_fixed_host(Path::new("/tmp/electron")).is_err());
    }

    #[test]
    fn child_environment_has_no_runtime_or_session_material() {
        let keys = sanitized_environment()
            .expect("sanitized environment")
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        #[cfg(not(feature = "macos-source-local-development"))]
        assert!(keys.iter().all(|value| !value.starts_with("NIMI_")));
        #[cfg(feature = "macos-source-local-development")]
        assert!(keys
            .iter()
            .filter(|value| value.starts_with("NIMI_"))
            .all(|value| {
                value == "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT=1"
                    || value.starts_with("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY=")
            }));
        assert!(keys
            .iter()
            .all(|value| !value.to_ascii_lowercase().contains("token")));
    }
}
