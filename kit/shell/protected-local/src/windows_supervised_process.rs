use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, HWND, LPARAM, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, ResumeThread, TerminateProcess, WaitForSingleObject,
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
    ShowWindow, SW_RESTORE,
};

use crate::windows_process_identity::{current_process_user, process_user};
use crate::{NimiHostError, NimiHostErrorReasonCode};

const TERMINATION_WAIT_MS: u32 = 5_000;

pub(crate) struct SupervisedDevelopmentProcess {
    process: HANDLE,
    thread: HANDLE,
    id: u32,
    resumed: bool,
    job: Option<OwnedHandle>,
}

// SAFETY: this value exclusively owns both Windows kernel handles. Kernel
// process/thread handles are valid across threads and mutation requires `&mut`.
unsafe impl Send for SupervisedDevelopmentProcess {}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
impl SupervisedDevelopmentProcess {
    pub(crate) fn create_runtime_authorized(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
    ) -> Result<Self, NimiHostError> {
        Self::create(executable, arguments, working_directory, None)
    }

    pub(crate) fn create_verified_installed(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
    ) -> Result<Self, NimiHostError> {
        Self::create(
            executable,
            arguments,
            working_directory,
            Some(installed_environment()?),
        )
    }

    fn create(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
        environment: Option<Vec<u16>>,
    ) -> Result<Self, NimiHostError> {
        let parent = current_process_user().map_err(|_| context_rejected())?;
        if parent.1 {
            return Err(context_rejected());
        }
        let executable = canonical_file(executable)?;
        let process_executable = windows_process_path(&executable)?;
        let working_directory = canonical_directory(working_directory)?;
        // Runtime admitted this exact executable and issued the pending launch
        // immediately before creation. Electron package managers may resolve
        // the project alias to a package-store file outside the project root;
        // lpApplicationName still fixes the exact authorized image and the
        // child remains suspended until Runtime binds its PID.
        let mut application = wide_null_terminated(process_executable.as_os_str())?;
        let mut command_line = build_windows_command_line(&process_executable, arguments)?
            .encode_utf16()
            .collect::<Vec<_>>();
        command_line.push(0);
        let current_directory = wide_null_terminated(working_directory.as_os_str())?;

        // SAFETY: structures have their documented size; all pointers refer to
        // live UTF-16 buffers for the duration of CreateProcessW. Handles are
        // not inherited, lpApplicationName fixes executable parsing, and the
        // child begins suspended so Runtime can bind the exact PID first.
        let (created, info) = unsafe {
            let mut startup: STARTUPINFOW = zeroed();
            startup.cb = size_of::<STARTUPINFOW>() as u32;
            let mut info: PROCESS_INFORMATION = zeroed();
            let created = CreateProcessW(
                application.as_mut_ptr(),
                command_line.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                CREATE_SUSPENDED
                    | if environment.is_some() {
                        CREATE_UNICODE_ENVIRONMENT
                    } else {
                        0
                    },
                environment
                    .as_ref()
                    .map_or(std::ptr::null::<c_void>(), |block| block.as_ptr().cast()),
                current_directory.as_ptr(),
                &startup,
                &mut info,
            );
            (created, info)
        };
        if created == 0
            || info.hProcess.is_null()
            || info.hThread.is_null()
            || info.dwProcessId == 0
        {
            let failure = native_failure("CreateProcessW", unsafe { GetLastError() });
            unsafe {
                if !info.hThread.is_null() {
                    CloseHandle(info.hThread);
                }
                if !info.hProcess.is_null() {
                    CloseHandle(info.hProcess);
                }
            }
            return Err(failure);
        }
        let mut process = Self {
            process: info.hProcess,
            thread: info.hThread,
            id: info.dwProcessId,
            resumed: false,
            job: None,
        };
        let child = process_user(process.process).map_err(|_| context_rejected())?;
        if child.1 || child.0 != parent.0 || child.2 != parent.2 {
            return Err(context_rejected());
        }
        // The handle is unnamed and non-inheritable. Closing the Desktop owner
        // kills the entire App process scope even if Rust destructors cannot run.
        let job = create_process_job()?;
        if unsafe { AssignProcessToJobObject(job.as_raw_handle().cast(), process.process) } == 0 {
            return Err(native_failure("AssignProcessToJobObject", unsafe {
                GetLastError()
            }));
        }
        process.job = Some(job);
        Ok(process)
    }

    pub(crate) const fn id(&self) -> u32 {
        self.id
    }

    pub(crate) fn resume(&mut self) -> Result<(), NimiHostError> {
        let parent = current_process_user().map_err(|_| context_rejected())?;
        let child = process_user(self.process).map_err(|_| context_rejected())?;
        if parent.1 || child.1 || parent.0 != child.0 || parent.2 != child.2 || self.job.is_none() {
            return Err(context_rejected());
        }
        // SAFETY: thread is the retained primary thread returned by
        // CreateProcessW and remains open until Drop.
        if unsafe { ResumeThread(self.thread) } == u32::MAX {
            return Err(native_failure("ResumeThread", unsafe { GetLastError() }));
        }
        self.resumed = true;
        Ok(())
    }

    pub(crate) fn running(&self) -> bool {
        // SAFETY: process is a retained live kernel handle.
        // An unreadable wait result is not evidence of process exit.
        unsafe { WaitForSingleObject(self.process, 0) != WAIT_OBJECT_0 }
    }

    pub(crate) fn exit_code(&self) -> Result<Option<u32>, NimiHostError> {
        match unsafe { WaitForSingleObject(self.process, 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut code = 0;
                if unsafe { GetExitCodeProcess(self.process, &mut code) } == 0 {
                    return Err(native_failure("GetExitCodeProcess", unsafe {
                        GetLastError()
                    }));
                }
                Ok(Some(code))
            }
            _ => Err(native_failure("WaitForSingleObject", unsafe {
                GetLastError()
            })),
        }
    }

    pub(crate) fn terminate(&mut self) -> Result<(), NimiHostError> {
        if self.process.is_null() {
            return Ok(());
        }
        // SAFETY: process is the exact retained child handle, so PID reuse
        // cannot redirect termination to another process.
        if let Some(job) = &self.job {
            if unsafe { TerminateJobObject(job.as_raw_handle().cast(), 1) } == 0 {
                return Err(native_failure("TerminateJobObject", unsafe {
                    GetLastError()
                }));
            }
        } else if self.running() && unsafe { TerminateProcess(self.process, 1) } == 0 {
            return Err(native_failure("TerminateProcess", unsafe {
                GetLastError()
            }));
        }
        // TerminateProcess is asynchronous. A replacement may immediately
        // reuse the same browser profile and loopback CDP port, so termination
        // is complete only after the retained process handle is signalled.
        if unsafe { WaitForSingleObject(self.process, TERMINATION_WAIT_MS) } != WAIT_OBJECT_0 {
            return Err(NimiHostError::new(
                NimiHostErrorReasonCode::ProcessStopFailed,
                true,
            ));
        }
        self.wait_for_scope_exit()?;
        Ok(())
    }

    fn wait_for_scope_exit(&self) -> Result<(), NimiHostError> {
        let Some(job) = &self.job else {
            return Ok(());
        };
        let deadline = Instant::now() + Duration::from_millis(u64::from(TERMINATION_WAIT_MS));
        loop {
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
            if unsafe {
                QueryInformationJobObject(
                    job.as_raw_handle().cast(),
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(native_failure("QueryInformationJobObject", unsafe {
                    GetLastError()
                }));
            }
            if accounting.ActiveProcesses == 0 {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(NimiHostError::new(
                    NimiHostErrorReasonCode::ProcessStopFailed,
                    true,
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub(crate) fn focus(&self) -> Result<(), NimiHostError> {
        if !self.resumed || self.exit_code()?.is_some() {
            return Err(NimiHostError::new(
                NimiHostErrorReasonCode::ProcessFocusFailed,
                false,
            ));
        }
        let mut target = WindowTarget {
            pid: self.id,
            window: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(
                Some(find_process_window),
                (&mut target as *mut WindowTarget) as LPARAM,
            );
        }
        if target.window.is_null() {
            return Err(NimiHostError::new(
                NimiHostErrorReasonCode::ProcessFocusFailed,
                true,
            ));
        }
        if unsafe { IsIconic(target.window) } != 0 {
            unsafe {
                ShowWindow(target.window, SW_RESTORE);
            }
        }
        if unsafe { SetForegroundWindow(target.window) } == 0 {
            return Err(NimiHostError::new(
                NimiHostErrorReasonCode::ProcessFocusFailed,
                true,
            ));
        }
        Ok(())
    }
}

impl Drop for SupervisedDevelopmentProcess {
    fn drop(&mut self) {
        let _ = self.terminate();
        drop(self.job.take());
        unsafe {
            if !self.thread.is_null() {
                CloseHandle(self.thread);
            }
            if !self.process.is_null() {
                CloseHandle(self.process);
            }
        }
    }
}

fn canonical_file(path: &Path) -> Result<PathBuf, NimiHostError> {
    if !path.is_absolute() || !path.is_file() {
        return Err(project_changed());
    }
    let path = std::fs::canonicalize(path).map_err(|_| project_changed())?;
    path.is_file().then_some(path).ok_or_else(project_changed)
}

fn canonical_directory(path: &Path) -> Result<PathBuf, NimiHostError> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(project_changed());
    }
    let path = std::fs::canonicalize(path).map_err(|_| project_changed())?;
    path.is_dir().then_some(path).ok_or_else(project_changed)
}

fn windows_process_path(path: &Path) -> Result<PathBuf, NimiHostError> {
    let raw = path.to_string_lossy();
    let projected = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    let bytes = projected.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || !matches!(bytes[2], b'\\' | b'/')
    {
        return Err(project_changed());
    }
    Ok(PathBuf::from(projected.to_string()))
}

fn wide_null_terminated(value: &std::ffi::OsStr) -> Result<Vec<u16>, NimiHostError> {
    let mut encoded = value.encode_wide().collect::<Vec<_>>();
    if encoded.contains(&0) {
        return Err(project_changed());
    }
    encoded.push(0);
    Ok(encoded)
}

fn build_windows_command_line(
    executable: &Path,
    arguments: &[String],
) -> Result<String, NimiHostError> {
    let executable = executable.to_string_lossy();
    if executable.contains('\0') || arguments.iter().any(|argument| argument.contains('\0')) {
        return Err(project_changed());
    }
    let mut values = Vec::with_capacity(arguments.len() + 1);
    values.push(quote_windows_argument(&executable));
    values.extend(
        arguments
            .iter()
            .map(|argument| quote_windows_argument(argument)),
    );
    Ok(values.join(" "))
}

fn quote_windows_argument(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return value.to_string();
    }
    let mut quoted = String::from("\"");
    let mut backslashes = 0usize;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
            quoted.push('"');
            backslashes = 0;
            continue;
        }
        quoted.push_str(&"\\".repeat(backslashes));
        backslashes = 0;
        quoted.push(character);
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

fn project_changed() -> NimiHostError {
    NimiHostError::new(
        NimiHostErrorReasonCode::LocalDevelopmentProjectChanged,
        false,
    )
}

fn context_rejected() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::ProcessContextRejected, false)
}

const INSTALLED_ENVIRONMENT_KEYS: &[&str] = &[
    "APPDATA",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SystemDrive",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
];

fn installed_environment() -> Result<Vec<u16>, NimiHostError> {
    let mut keys = INSTALLED_ENVIRONMENT_KEYS.to_vec();
    #[cfg(feature = "windows-source-local-development")]
    keys.extend([
        "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT",
        "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE",
    ]);
    keys.sort_by_key(|key| key.to_ascii_uppercase());
    let mut block = Vec::new();
    for key in keys {
        let Some(value) = std::env::var_os(key) else {
            continue;
        };
        let mut item = std::ffi::OsString::from(key);
        item.push("=");
        item.push(value);
        block.extend(wide_null_terminated(&item)?);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

fn native_failure(operation: &str, code: u32) -> NimiHostError {
    let reason = match (operation, code) {
        ("CreateProcessW", 740) => NimiHostErrorReasonCode::ElevationRequired,
        ("CreateProcessW", 577 | 1260) => NimiHostErrorReasonCode::OsPolicyBlocked,
        ("TerminateProcess" | "TerminateJobObject" | "QueryInformationJobObject", _) => {
            NimiHostErrorReasonCode::ProcessStopFailed
        }
        _ => NimiHostErrorReasonCode::ProcessStartFailed,
    };
    NimiHostError::new(reason, false).with_reason_metadata(
        [
            ("native_operation".into(), operation.into()),
            ("native_error_code".into(), code.to_string()),
        ]
        .into(),
    )
}

fn create_process_job() -> Result<OwnedHandle, NimiHostError> {
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(native_failure("CreateJobObjectW", unsafe {
            GetLastError()
        }));
    }
    let job = unsafe { OwnedHandle::from_raw_handle(handle.cast()) };
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(native_failure("SetInformationJobObject", unsafe {
            GetLastError()
        }));
    }
    Ok(job)
}

struct WindowTarget {
    pid: u32,
    window: HWND,
}

unsafe extern "system" fn find_process_window(window: HWND, parameter: LPARAM) -> i32 {
    // EnumWindows invokes this callback synchronously with our live stack value.
    let target = unsafe { &mut *(parameter as *mut WindowTarget) };
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(window, &mut pid);
    }
    if pid == target.pid && unsafe { IsWindowVisible(window) } != 0 {
        target.window = window;
        return 0;
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    // An elevated or non-interactive runner must prove rejection. The same
    // tests exercise actual child/job mechanics in an admitted user context;
    // no CI flag changes the production token checks or reports a fake spawn.
    fn assert_context_result(
        result: Result<SupervisedDevelopmentProcess, NimiHostError>,
    ) -> Option<SupervisedDevelopmentProcess> {
        let allowed = matches!(current_process_user(), Ok((_, false, _)));
        match (allowed, result) {
            (true, Ok(process)) => Some(process),
            (false, Err(error)) => {
                assert_eq!(
                    error.reason_code(),
                    NimiHostErrorReasonCode::ProcessContextRejected
                );
                eprintln!("observed forbidden execution context; verified ProcessContextRejected");
                None
            }
            (true, Err(error)) => panic!("admitted process creation failed: {error:?}"),
            (false, Ok(mut process)) => {
                let _ = process.terminate();
                panic!("forbidden execution context created a child");
            }
        }
    }

    #[test]
    fn windows_argument_quoting_preserves_spaces_quotes_and_trailing_slashes() {
        assert_eq!(quote_windows_argument("plain"), "plain");
        assert_eq!(quote_windows_argument("two words"), "\"two words\"");
        assert_eq!(quote_windows_argument(""), "\"\"");
        assert_eq!(quote_windows_argument("a\\\"b"), "\"a\\\\\\\"b\"");
        assert_eq!(
            quote_windows_argument("folder with space\\"),
            "\"folder with space\\\\\""
        );
    }

    #[test]
    fn process_creation_uses_a_drive_path_after_canonical_identity_validation() {
        assert_eq!(
            windows_process_path(Path::new(r"\\?\D:\store\electron.exe"))
                .expect("projected executable"),
            PathBuf::from(r"D:\store\electron.exe")
        );
        assert!(windows_process_path(Path::new(r"\\?\UNC\server\electron.exe")).is_err());
    }

    #[test]
    fn runtime_authorized_external_host_is_created_suspended() {
        let executable = std::env::current_exe().expect("current test executable");
        let working_directory = std::env::temp_dir();
        assert!(!executable.starts_with(&working_directory));
        let Some(process) =
            assert_context_result(SupervisedDevelopmentProcess::create_runtime_authorized(
                &executable,
                &[],
                &working_directory,
            ))
        else {
            return;
        };
        assert!(process.id() > 0);
        assert!(process.running());
    }

    #[test]
    fn termination_waits_for_process_exit_before_returning() {
        let executable = std::env::current_exe().expect("current test executable");
        let working_directory = std::env::temp_dir();
        let Some(mut process) =
            assert_context_result(SupervisedDevelopmentProcess::create_runtime_authorized(
                &executable,
                &[],
                &working_directory,
            ))
        else {
            return;
        };
        assert!(process.running());

        process.terminate().expect("terminate child");

        assert!(!process.running());
    }

    #[test]
    fn closing_owner_job_kills_child_without_process_destructor() {
        let executable = std::env::current_exe().expect("current test executable");
        let Some(mut process) =
            assert_context_result(SupervisedDevelopmentProcess::create_runtime_authorized(
                &executable,
                &[],
                &std::env::temp_dir(),
            ))
        else {
            return;
        };
        drop(process.job.take());
        assert_eq!(
            unsafe { WaitForSingleObject(process.process, TERMINATION_WAIT_MS) },
            WAIT_OBJECT_0
        );
        assert!(!process.running());
    }

    #[test]
    fn installed_environment_contains_only_system_and_existing_d2_discovery_facts() {
        let block = installed_environment().expect("installed environment");
        assert!(block.ends_with(&[0, 0]));
        let text = String::from_utf16(&block).expect("environment UTF-16");
        for entry in text.split('\0').filter(|entry| !entry.is_empty()) {
            let (key, _) = entry.split_once('=').expect("environment entry");
            let d2 = cfg!(feature = "windows-source-local-development")
                && [
                    "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT",
                    "NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE",
                ]
                .contains(&key);
            assert!(
                INSTALLED_ENVIRONMENT_KEYS.contains(&key) || d2,
                "unexpected inherited variable: {key}"
            );
        }
        let executable = std::env::current_exe().expect("test executable");
        let Some(mut child) =
            assert_context_result(SupervisedDevelopmentProcess::create_verified_installed(
                &executable,
                &[],
                &std::env::temp_dir(),
            ))
        else {
            return;
        };
        child.terminate().expect("stop installed child");
        assert!(!child.running());
    }

    #[test]
    fn native_start_failure_keeps_direct_win32_cause() {
        let path =
            std::env::temp_dir().join(format!("nimi-invalid-exe-{}.exe", std::process::id()));
        std::fs::write(&path, b"not a Windows executable").expect("write invalid executable");
        let direct_code = std::process::Command::new(&path)
            .spawn()
            .err()
            .and_then(|error| error.raw_os_error())
            .expect("direct Windows process creation fails with its native code")
            .to_string();
        let result = SupervisedDevelopmentProcess::create_runtime_authorized(
            &path,
            &[],
            &std::env::temp_dir(),
        );
        std::fs::remove_file(&path).expect("remove test input");
        let error = result.err().expect("Windows rejects invalid executable");
        if !matches!(current_process_user(), Ok((_, false, _))) {
            assert_eq!(
                error.reason_code(),
                NimiHostErrorReasonCode::ProcessContextRejected
            );
            return;
        }
        assert_eq!(
            error.reason_code(),
            NimiHostErrorReasonCode::ProcessStartFailed
        );
        assert_eq!(
            error
                .reason_metadata()
                .get("native_operation")
                .map(String::as_str),
            Some("CreateProcessW")
        );
        assert_eq!(
            error
                .reason_metadata()
                .get("native_error_code")
                .map(String::as_str),
            Some(direct_code.as_str())
        );
    }

    #[test]
    fn only_direct_policy_and_elevation_codes_have_specific_start_reasons() {
        assert_eq!(
            native_failure("CreateProcessW", 1260).reason_code(),
            NimiHostErrorReasonCode::OsPolicyBlocked
        );
        assert_eq!(
            native_failure("CreateProcessW", 577).reason_code(),
            NimiHostErrorReasonCode::OsPolicyBlocked
        );
        assert_eq!(
            native_failure("CreateProcessW", 740).reason_code(),
            NimiHostErrorReasonCode::ElevationRequired
        );
        assert_eq!(
            native_failure("CreateProcessW", 5).reason_code(),
            NimiHostErrorReasonCode::ProcessStartFailed
        );
        assert_eq!(
            native_failure("ResumeThread", 5).reason_code(),
            NimiHostErrorReasonCode::ProcessStartFailed
        );
    }
}
