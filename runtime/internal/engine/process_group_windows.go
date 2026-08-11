//go:build windows

package engine

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type supervisorProcessLifecycle struct {
	mu     sync.Mutex
	job    windows.Handle
	closed bool
}

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

func bindSupervisorProcessLifecycle(cmd *exec.Cmd) (*supervisorProcessLifecycle, error) {
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

	return &supervisorProcessLifecycle{job: job}, nil
}

func supervisorProcessLifecycleSupportsGracefulTermination(_ *supervisorProcessLifecycle) bool {
	return false
}

func signalSupervisorProcessLifecycle(lifecycle *supervisorProcessLifecycle, sig syscall.Signal) error {
	if lifecycle == nil {
		return fmt.Errorf("supervised process lifecycle is unavailable")
	}
	if sig != syscall.SIGKILL {
		return fmt.Errorf("graceful process-tree termination is unsupported on Windows")
	}
	lifecycle.mu.Lock()
	defer lifecycle.mu.Unlock()
	if lifecycle.closed || lifecycle.job == 0 {
		return nil
	}
	return windows.TerminateJobObject(lifecycle.job, 1)
}

func supervisorProcessLifecycleExited(lifecycle *supervisorProcessLifecycle) (bool, error) {
	if lifecycle == nil {
		return true, nil
	}
	lifecycle.mu.Lock()
	defer lifecycle.mu.Unlock()
	if lifecycle.closed || lifecycle.job == 0 {
		return true, nil
	}
	result, err := windows.WaitForSingleObject(lifecycle.job, 0)
	if err != nil {
		return false, err
	}
	switch result {
	case windows.WAIT_OBJECT_0:
		return true, nil
	case uint32(windows.WAIT_TIMEOUT):
		return false, nil
	default:
		return false, fmt.Errorf("unexpected Job Object wait result %#x", result)
	}
}

func releaseSupervisorProcessLifecycle(lifecycle *supervisorProcessLifecycle) error {
	if lifecycle == nil {
		return nil
	}
	lifecycle.mu.Lock()
	defer lifecycle.mu.Unlock()
	if lifecycle.closed || lifecycle.job == 0 {
		return nil
	}
	err := windows.CloseHandle(lifecycle.job)
	lifecycle.job = 0
	lifecycle.closed = true
	return err
}
