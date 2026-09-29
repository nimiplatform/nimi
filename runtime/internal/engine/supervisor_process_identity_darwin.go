//go:build darwin

package engine

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"syscall"

	"golang.org/x/sys/unix"
)

// darwinProcessZombie is SZOMB from <sys/proc.h>.
const darwinProcessZombie = 5

func supervisorProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	if syscall.Kill(pid, syscall.Signal(0)) != nil {
		return false
	}
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		return true
	}
	return info.Proc.P_stat != darwinProcessZombie
}

// darwinProcessArguments reads the executable path and argv of pid from
// KERN_PROCARGS2. Its entries are NUL-separated, so a path with spaces such as
// ~/Library/Application Support/... stays whole.
func darwinProcessArguments(pid int) (string, []string, error) {
	raw, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil {
		return "", nil, err
	}
	if len(raw) < 4 {
		return "", nil, fmt.Errorf("process %d arguments are truncated", pid)
	}
	argc := int(binary.LittleEndian.Uint32(raw[:4]))
	rest := raw[4:]
	end := bytes.IndexByte(rest, 0)
	if end <= 0 {
		return "", nil, fmt.Errorf("process %d has no executable path", pid)
	}
	executable := string(rest[:end])
	rest = bytes.TrimLeft(rest[end:], "\x00")
	args := make([]string, 0, argc)
	for len(args) < argc && len(rest) > 0 {
		end = bytes.IndexByte(rest, 0)
		if end < 0 {
			args = append(args, string(rest))
			break
		}
		args = append(args, string(rest[:end]))
		rest = rest[end+1:]
	}
	return executable, args, nil
}

func supervisorProcessMatchesExpectedPath(pid int, expectedPath string) (bool, bool) {
	expected := canonicalSupervisorProcessPath(expectedPath)
	if expected == "" || pid <= 0 {
		return false, false
	}
	executable, args, err := darwinProcessArguments(pid)
	if err != nil {
		return false, false
	}
	if canonicalSupervisorProcessPath(executable) == expected {
		return true, true
	}
	for _, arg := range args {
		if canonicalSupervisorProcessPath(arg) == expected {
			return true, true
		}
	}
	return false, true
}

func supervisorProcessIdentityValidationDetail(pid int, expectedPath string) string {
	return fmt.Sprintf("pid=%d expected=%s", pid, canonicalSupervisorProcessPath(expectedPath))
}

func observedSupervisorExecutablePath(pid int) string {
	if pid <= 0 {
		return ""
	}
	executable, _, err := darwinProcessArguments(pid)
	if err != nil {
		return ""
	}
	return canonicalSupervisorProcessPath(executable)
}

// supervisorProcessStartTime is when the kernel created pid. It survives exec,
// so it names this process instance and no later process given the same pid.
func supervisorProcessStartTime(pid int) (string, bool) {
	if pid <= 0 {
		return "", false
	}
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil || info.Proc.P_starttime.Sec <= 0 {
		return "", false
	}
	return fmt.Sprintf("darwin:%d.%06d", info.Proc.P_starttime.Sec, info.Proc.P_starttime.Usec), true
}
