//go:build !windows

package engine

import (
	"math"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

const supervisorOwnerGuardShell = "/bin/sh"

// supervisorOwnerGuardScript lets a supervised engine end with this Runtime.
// A watcher reads a pipe only the Runtime writes. Keep a separate descriptor:
// dash redirects an asynchronous list's stdin to /dev/null even with <&0.
// The script passes it to the watcher, then closes it while execing the engine,
// which keeps this pid and process group. When the
// Runtime has finished ending the tree it writes one byte and closes the
// pipe. End of input without that byte means the Runtime is gone
// (a crash, a kill, a stop that ran out of time): the watcher stops its own
// group and escalates after the engine's shutdown budget. A group id is never
// reused while its members live, so nothing outside the group is signalled.
const supervisorOwnerGuardScript = "exec 3<&0\n" +
	"(trap '' TERM; [ -n \"$(head -c 1)\" ] || { kill -TERM 0 2>/dev/null; sleep \"$0\"; kill -KILL 0 2>/dev/null; }) <&3 3<&- &\n" +
	"exec \"$@\" </dev/null 3<&-"

// supervisorOwnerRelease is the Runtime's end of an engine's owner pipe.
type supervisorOwnerRelease struct {
	writer *os.File
}

// guardSupervisorProcessOwner runs cmd under the owner guard. The returned
// reader must be closed once the process started; the release is the
// Runtime's end of the pipe and lives as long as the process does.
// @nimi-authority: rule.nimi.runtime.local-compute.r035
func guardSupervisorProcessOwner(cmd *exec.Cmd, grace time.Duration) (*os.File, *supervisorOwnerRelease, error) {
	if cmd.Err != nil {
		return nil, nil, cmd.Err
	}
	if _, err := os.Stat(cmd.Path); err != nil {
		return nil, nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, nil, err
	}
	seconds := int(math.Ceil(grace.Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	cmd.Args = append([]string{
		supervisorOwnerGuardShell, "-c", supervisorOwnerGuardScript, strconv.Itoa(seconds), cmd.Path,
	}, cmd.Args[1:]...)
	cmd.Path = supervisorOwnerGuardShell
	cmd.Stdin = reader
	return reader, &supervisorOwnerRelease{writer: writer}, nil
}

// release closes the owner pipe after the tracked tree has ended.
func (r *supervisorOwnerRelease) release() {
	if r == nil || r.writer == nil {
		return
	}
	_, _ = r.writer.Write([]byte{1})
	_ = r.writer.Close()
}

type supervisorProcessLifecycle struct {
	processGroupID int
}

func setSupervisorProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func signalSupervisorProcess(pid int, sig syscall.Signal) error {
	return syscall.Kill(-pid, sig)
}

func signalSupervisorProcessDirect(pid int, sig syscall.Signal) error {
	return syscall.Kill(pid, sig)
}

func bindSupervisorProcessLifecycle(cmd *exec.Cmd) (*supervisorProcessLifecycle, error) {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return nil, nil
	}
	return &supervisorProcessLifecycle{processGroupID: cmd.Process.Pid}, nil
}

func supervisorProcessLifecycleSupportsGracefulTermination(_ *supervisorProcessLifecycle) bool {
	return true
}

func signalSupervisorProcessLifecycle(lifecycle *supervisorProcessLifecycle, sig syscall.Signal) error {
	if lifecycle == nil || lifecycle.processGroupID <= 0 {
		return nil
	}
	err := syscall.Kill(-lifecycle.processGroupID, sig)
	if err == syscall.ESRCH {
		return nil
	}
	return err
}

func supervisorProcessLifecycleExited(lifecycle *supervisorProcessLifecycle) (bool, error) {
	if lifecycle == nil || lifecycle.processGroupID <= 0 {
		return true, nil
	}
	err := syscall.Kill(-lifecycle.processGroupID, 0)
	switch err {
	case nil, syscall.EPERM:
		return false, nil
	case syscall.ESRCH:
		return true, nil
	default:
		return false, err
	}
}

func releaseSupervisorProcessLifecycle(_ *supervisorProcessLifecycle) error {
	return nil
}
