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
#[cfg(feature = "macos-source-local-development")]
const SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT: &str =
    "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE";

unsafe extern "C" {
    fn nimi_macos_spawn_suspended(
        executable: *const libc::c_char,
        argv: *const *mut libc::c_char,
        envp: *const *mut libc::c_char,
        working_directory: *const libc::c_char,
        pid_output: *mut u32,
    ) -> i32;
    fn nimi_macos_spawn_installed_suspended(
        executable: *const libc::c_char,
        argv: *const *mut libc::c_char,
        envp: *const *mut libc::c_char,
        working_directory: *const libc::c_char,
        pid_output: *mut u32,
    ) -> i32;
    fn nimi_macos_watch_child(pid: u32) -> i32;
    fn nimi_macos_child_running(pid: u32, kqueue_fd: i32) -> i32;
    fn nimi_macos_terminate_child_group(pid: u32) -> i32;
    fn nimi_macos_child_exit_code(pid: u32, output: *mut u32) -> i32;
    fn nimi_macos_focus_child(pid: u32) -> i32;
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
        Self::create(&executable, arguments, working_directory, false)
    }

    pub(crate) fn create_verified_installed(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
    ) -> Result<Self, NimiHostError> {
        let canonical = std::fs::canonicalize(executable).map_err(|_| untrusted())?;
        if canonical != executable || !canonical.is_file() || !arguments.is_empty() {
            return Err(untrusted());
        }
        Self::create(&canonical, arguments, working_directory, true)
    }

    fn create(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
        installed: bool,
    ) -> Result<Self, NimiHostError> {
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
            let spawn = if installed {
                nimi_macos_spawn_installed_suspended
            } else {
                nimi_macos_spawn_suspended
            };
            spawn(
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

    pub(crate) fn exit_code(&self) -> Result<Option<u32>, NimiHostError> {
        let mut code = 0;
        // SAFETY: this is the owned direct child; WNOWAIT preserves its PID
        // until scope cleanup, including while descendant processes exit.
        match unsafe { nimi_macos_child_exit_code(self.pid, &mut code) } {
            1 => Ok(Some(code)),
            0 if self.running() => Ok(None),
            _ => Err(untrusted()),
        }
    }

    pub(crate) fn focus(&self) -> Result<(), NimiHostError> {
        if !self.running() {
            return Err(untrusted());
        }
        // SAFETY: focus is restricted to this live, retained child PID.
        if unsafe { nimi_macos_focus_child(self.pid) } == 0 {
            Ok(())
        } else {
            Err(untrusted())
        }
    }

    pub(crate) fn terminate(&self) -> Result<(), NimiHostError> {
        if self.terminated.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        // SAFETY: native termination targets only process group -pid, waits
        // for the direct child, and has a bounded TERM-to-KILL transition.
        let status = unsafe { nimi_macos_terminate_child_group(self.pid) };
        if status == 0 {
            Ok(())
        } else {
            Err(
                untrusted().with_reason_metadata(std::collections::BTreeMap::from([(
                    "native_errno".into(),
                    status.to_string(),
                )])),
            )
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
    #[cfg(feature = "macos-source-local-development")]
    {
        let source_native_entry =
            std::env::var_os("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY")
                .map(PathBuf::from)
                .ok_or_else(untrusted)?;
        let source_runtime_executable = std::env::var_os(SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT)
            .map(PathBuf::from)
            .ok_or_else(untrusted)?;
        return sanitized_environment_with_source_paths(
            Some(&source_native_entry),
            Some(&source_runtime_executable),
        );
    }
    #[cfg(not(feature = "macos-source-local-development"))]
    sanitized_environment_with_source_paths(None, None)
}

fn sanitized_environment_with_source_paths(
    source_native_entry: Option<&Path>,
    source_runtime_executable: Option<&Path>,
) -> Result<Vec<CString>, NimiHostError> {
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
        let entry = source_native_entry
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
        let runtime = source_runtime_executable
            .filter(|value| value.is_absolute())
            .ok_or_else(untrusted)?;
        let canonical_runtime = std::fs::canonicalize(runtime).map_err(|_| untrusted())?;
        if canonical_runtime != runtime {
            return Err(untrusted());
        }
        let runtime_metadata = canonical_runtime.metadata().map_err(|_| untrusted())?;
        if !source_runtime_metadata_admitted(
            runtime_metadata.is_file(),
            runtime_metadata.uid(),
            runtime_metadata.permissions().mode(),
            unsafe { libc::geteuid() },
        ) {
            return Err(untrusted());
        }
        values.push(format!(
            "{SOURCE_RUNTIME_EXECUTABLE_ENVIRONMENT}={}",
            path_text(&canonical_runtime)?
        ));
    }
    #[cfg(not(feature = "macos-source-local-development"))]
    if source_native_entry.is_some() || source_runtime_executable.is_some() {
        return Err(untrusted());
    }
    values.sort();
    values
        .into_iter()
        .map(|value| CString::new(value).map_err(|_| untrusted()))
        .collect()
}

#[cfg(feature = "macos-source-local-development")]
fn source_runtime_metadata_admitted(
    is_file: bool,
    owner_uid: u32,
    mode: u32,
    expected_uid: u32,
) -> bool {
    is_file && owner_uid == expected_uid && mode & 0o022 == 0 && mode & 0o111 != 0
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

    #[test]
    fn installed_child_starts_suspended_and_retains_its_real_exit_status() {
        let root = std::env::temp_dir().join(format!(
            "nimi-installed-child-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root.clone());
        let root = std::fs::canonicalize(root).unwrap();
        let source = root.join("main.c");
        let executable = root.join("app");
        std::fs::write(&source, "int main(void) { return 17; }\n").unwrap();
        let compiled = std::process::Command::new("/usr/bin/xcrun")
            .arg("clang")
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{}",
            String::from_utf8_lossy(&compiled.stderr)
        );
        let mut process =
            SupervisedDevelopmentProcess::create_verified_installed(&executable, &[], &root)
                .unwrap();
        assert!(process.running());
        assert_eq!(process.exit_code().unwrap(), None);
        process.resume().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if let Some(code) = process.exit_code().unwrap() {
                assert_eq!(code, 17);
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "owned child did not exit"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(process.exit_code().unwrap(), Some(17));
        process.terminate().unwrap();
    }
    #[cfg(feature = "macos-source-local-development")]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(not(feature = "macos-source-local-development"))]
    #[test]
    fn fixed_host_path_is_not_project_selectable() {
        assert_eq!(MACOS_LOCAL_APP_HOST_PATH, LOCAL_APP_HOST_PATH);
        assert!(canonical_fixed_host(Path::new("/tmp/electron")).is_err());
    }

    #[test]
    fn child_environment_has_no_runtime_or_session_material() {
        #[cfg(feature = "macos-source-local-development")]
        let source_native_entry = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("protected-local parent")
            .join("protected-local-node")
            .join("npm")
            .join("darwin-arm64")
            .join("index.cjs");
        #[cfg(feature = "macos-source-local-development")]
        let source_runtime_executable = std::env::current_exe()
            .and_then(std::fs::canonicalize)
            .expect("current test executable");
        #[cfg(feature = "macos-source-local-development")]
        let environment = sanitized_environment_with_source_paths(
            Some(&source_native_entry),
            Some(&source_runtime_executable),
        );
        #[cfg(not(feature = "macos-source-local-development"))]
        let environment = sanitized_environment_with_source_paths(None, None);
        let keys = environment
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
                    || value.starts_with("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE=")
            }));
        assert!(keys
            .iter()
            .all(|value| !value.to_ascii_lowercase().contains("token")));
    }

    #[cfg(feature = "macos-source-local-development")]
    #[test]
    fn source_runtime_executable_rejects_missing_relative_symlink_non_file_unsafe_modes_and_foreign_owner(
    ) {
        let source_native_entry = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("protected-local parent")
            .join("protected-local-node")
            .join("npm")
            .join("darwin-arm64")
            .join("index.cjs");
        let root = std::env::temp_dir().join(format!(
            "nimi-macos-runtime-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("temp path");
        let cleanup = || {
            let _ = std::fs::remove_dir_all(&root);
        };

        let executable = root.join("runtime");
        std::fs::write(&executable, b"runtime").expect("runtime fixture");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("executable fixture mode");
        assert!(sanitized_environment_with_source_paths(
            Some(&source_native_entry),
            Some(Path::new("relative-runtime")),
        )
        .is_err());
        assert!(sanitized_environment_with_source_paths(
            Some(&source_native_entry),
            Some(&root.join("missing-runtime")),
        )
        .is_err());
        assert!(
            sanitized_environment_with_source_paths(Some(&source_native_entry), Some(&root),)
                .is_err()
        );

        let symlink = root.join("runtime-link");
        std::os::unix::fs::symlink(&executable, &symlink).expect("runtime symlink");
        assert!(sanitized_environment_with_source_paths(
            Some(&source_native_entry),
            Some(&symlink),
        )
        .is_err());

        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o722))
            .expect("writable fixture mode");
        assert!(sanitized_environment_with_source_paths(
            Some(&source_native_entry),
            Some(&executable),
        )
        .is_err());

        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o600))
            .expect("non-executable fixture mode");
        assert!(sanitized_environment_with_source_paths(
            Some(&source_native_entry),
            Some(&executable),
        )
        .is_err());

        let current_uid = unsafe { libc::geteuid() };
        let foreign_uid = if current_uid == u32::MAX {
            current_uid - 1
        } else {
            current_uid + 1
        };
        assert!(!source_runtime_metadata_admitted(
            true,
            foreign_uid,
            0o700,
            current_uid,
        ));
        cleanup();
    }
}
