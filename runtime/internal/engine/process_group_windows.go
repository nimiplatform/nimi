//go:build windows

package engine

import (
	"os"
	"os/exec"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

func setSupervisorProcessGroup(cmd *exec.Cmd) {
	// Windows services run in Session 0 without an interactive console. Keep
	// supervised console-subsystem engines (notably the managed Python speech
	// host) on the same service-safe creation path as bounded materialization
	// commands. Without CREATE_NO_WINDOW, the Python child can fail during
	// console initialization before its health endpoint is bound.
	configureManagedCommand(cmd)
}

func signalSupervisorProcess(pid int, sig syscall.Signal) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if sig == syscall.SIGKILL {
		return process.Kill()
	}
	return process.Signal(sig)
}

func signalSupervisorProcessDirect(pid int, sig syscall.Signal) error {
	return signalSupervisorProcess(pid, sig)
}

func bindSupervisorProcessLifecycle(cmd *exec.Cmd) (func(), error) {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return nil, nil
	}

	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}

	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}

	processHandle, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	defer func() {
		_ = windows.CloseHandle(processHandle)
	}()

	if err := windows.AssignProcessToJobObject(job, processHandle); err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}

	return func() {
		_ = windows.CloseHandle(job)
	}, nil
}
