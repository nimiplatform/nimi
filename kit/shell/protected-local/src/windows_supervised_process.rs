use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, ResumeThread, TerminateProcess, WaitForSingleObject, CREATE_SUSPENDED,
    PROCESS_INFORMATION, STARTUPINFOW,
};

use crate::{NimiHostError, NimiHostErrorReasonCode};

pub(crate) struct SupervisedDevelopmentProcess {
    process: HANDLE,
    thread: HANDLE,
    id: u32,
    resumed: bool,
}

// SAFETY: this value exclusively owns both Windows kernel handles. Kernel
// process/thread handles are valid across threads and mutation requires `&mut`.
unsafe impl Send for SupervisedDevelopmentProcess {}

impl SupervisedDevelopmentProcess {
    pub(crate) fn create(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
    ) -> Result<Self, NimiHostError> {
        let executable = canonical_file(executable)?;
        let working_directory = canonical_directory(working_directory)?;
        if !path_is_within(&working_directory, &executable) {
            return Err(project_changed());
        }
        let mut application = wide_null_terminated(executable.as_os_str())?;
        let mut command_line = build_windows_command_line(&executable, arguments)?
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
                CREATE_SUSPENDED,
                std::ptr::null::<c_void>(),
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
            unsafe {
                if !info.hThread.is_null() {
                    CloseHandle(info.hThread);
                }
                if !info.hProcess.is_null() {
                    CloseHandle(info.hProcess);
                }
            }
            return Err(unavailable());
        }
        Ok(Self {
            process: info.hProcess,
            thread: info.hThread,
            id: info.dwProcessId,
            resumed: false,
        })
    }

    pub(crate) const fn id(&self) -> u32 {
        self.id
    }

    pub(crate) fn resume(&mut self) -> Result<(), NimiHostError> {
        // SAFETY: thread is the retained primary thread returned by
        // CreateProcessW and remains open until Drop.
        if unsafe { ResumeThread(self.thread) } == u32::MAX {
            return Err(unavailable());
        }
        self.resumed = true;
        Ok(())
    }

    pub(crate) fn running(&self) -> bool {
        // SAFETY: process is a retained live kernel handle.
        unsafe { WaitForSingleObject(self.process, 0) == WAIT_TIMEOUT }
    }

    pub(crate) fn terminate(&mut self) {
        if self.process.is_null() || !self.running() {
            return;
        }
        // SAFETY: process is the exact retained child handle, so PID reuse
        // cannot redirect termination to another process.
        unsafe {
            TerminateProcess(self.process, 1);
        }
    }
}

impl Drop for SupervisedDevelopmentProcess {
    fn drop(&mut self) {
        self.terminate();
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

fn path_is_within(root: &Path, candidate: &Path) -> bool {
    let root = root
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    let candidate = candidate
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    candidate == root
        || candidate
            .strip_prefix(&root)
            .is_some_and(|suffix| suffix.starts_with('\\'))
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

fn unavailable() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
