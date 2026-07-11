use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use tonic::transport::Channel;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, ResumeThread, TerminateProcess, CREATE_SUSPENDED, PROCESS_INFORMATION,
    STARTUPINFOW,
};

use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::BindInstalledLaunchProcessRequest;
use crate::{
    InstalledAppLaunchOutcome, InstalledAppLaunchRequest, ProtectedCarrierError,
    ProtectedCarrierReasonCode,
};

pub(crate) async fn launch_installed_app(
    channel: Channel,
    request: InstalledAppLaunchRequest,
) -> Result<InstalledAppLaunchOutcome, ProtectedCarrierError> {
    if request.launch_id == [0u8; 32] {
        return Err(untrusted());
    }
    let executable = validate_executable(&request.executable_path)?;
    let mut process = SuspendedProcess::create(&executable)?;
    let mut client = RuntimeAppServiceClient::new(channel);
    let response = client
        .bind_installed_launch_process(BindInstalledLaunchProcessRequest {
            launch_id: request.launch_id.to_vec(),
            child_process_id: process.id,
        })
        .await
        .map_err(|_| untrusted())?
        .into_inner();
    if response.launch_id.as_slice() != request.launch_id || response.bind_deadline.is_none() {
        return Err(untrusted());
    }
    process.resume()?;
    Ok(InstalledAppLaunchOutcome {
        launch_id: request.launch_id,
        process_id: process.id,
    })
}

fn validate_executable(path: &Path) -> Result<std::path::PathBuf, ProtectedCarrierError> {
    if !path.is_absolute() || path.as_os_str().is_empty() || !path.is_file() {
        return Err(untrusted());
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| untrusted())?;
    if !canonical.is_absolute() || !canonical.is_file() {
        return Err(untrusted());
    }
    Ok(canonical)
}

struct SuspendedProcess {
    process: HANDLE,
    thread: HANDLE,
    id: u32,
    resumed: bool,
}

// SAFETY: SuspendedProcess exclusively owns both kernel handles. Windows
// process/thread handles are valid across threads, and all mutation still
// requires exclusive `&mut self` access.
unsafe impl Send for SuspendedProcess {}

impl SuspendedProcess {
    fn create(executable: &Path) -> Result<Self, ProtectedCarrierError> {
        let mut application = executable.as_os_str().encode_wide().collect::<Vec<_>>();
        if application.contains(&0) {
            return Err(untrusted());
        }
        application.push(0);
        let mut command = format!("\"{}\"", executable.display())
            .encode_utf16()
            .collect::<Vec<_>>();
        command.push(0);
        // SAFETY: structures are initialized to their documented sizes; all
        // pointers reference live UTF-16 buffers for the duration of the call.
        // No handles are inherited and lpApplicationName fixes exact parsing.
        let (created, info) = unsafe {
            let mut startup: STARTUPINFOW = zeroed();
            startup.cb = size_of::<STARTUPINFOW>() as u32;
            let mut info: PROCESS_INFORMATION = zeroed();
            let created = CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                CREATE_SUSPENDED,
                std::ptr::null::<c_void>(),
                std::ptr::null(),
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
            if !info.hProcess.is_null() {
                unsafe { CloseHandle(info.hProcess) };
            }
            if !info.hThread.is_null() {
                unsafe { CloseHandle(info.hThread) };
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

    fn resume(&mut self) -> Result<(), ProtectedCarrierError> {
        // SAFETY: thread is the retained primary thread handle returned by
        // CreateProcessW and has not been closed.
        if unsafe { ResumeThread(self.thread) } == u32::MAX {
            return Err(unavailable());
        }
        self.resumed = true;
        Ok(())
    }
}

impl Drop for SuspendedProcess {
    fn drop(&mut self) {
        // A child that was not atomically bound and resumed must not survive.
        unsafe {
            if !self.resumed && !self.process.is_null() {
                TerminateProcess(self.process, 1);
            }
            if !self.thread.is_null() {
                CloseHandle(self.thread);
            }
            if !self.process.is_null() {
                CloseHandle(self.process);
            }
        }
    }
}

fn unavailable() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUnavailable, true)
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_selector_rejects_relative_missing_and_directory_paths() {
        for path in [
            std::path::PathBuf::from("relative.exe"),
            std::env::temp_dir().join("nimi-missing-installed-app.exe"),
            std::env::temp_dir(),
        ] {
            let error = validate_executable(&path).expect_err("invalid executable must fail");
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::RuntimeServiceUntrusted
            );
        }
    }
}
