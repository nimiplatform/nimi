//go:build linux

package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func supervisorProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	if syscall.Kill(pid, syscall.Signal(0)) != nil {
		return false
	}
	state, err := linuxSupervisorProcessState(pid)
	if err != nil {
		return true
	}
	return state != "Z"
}

func supervisorProcessMatchesExpectedPath(pid int, expectedPath string) (bool, bool) {
	expected := canonicalSupervisorProcessPath(expectedPath)
	if expected == "" || pid <= 0 {
		return false, false
	}

	validated := false

	exePath, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "exe"))
	if err == nil {
		validated = true
		if canonicalSupervisorProcessPath(exePath) == expected {
			return true, true
		}
	}

	cmdlineBytes, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cmdline"))
	if err == nil {
		validated = true
		for _, part := range strings.Split(string(cmdlineBytes), "\x00") {
			if canonicalSupervisorProcessPath(part) == expected {
				return true, true
			}
		}
	}

	return false, validated
}

func supervisorProcessIdentityValidationDetail(pid int, expectedPath string) string {
	return fmt.Sprintf("pid=%d expected=%s", pid, canonicalSupervisorProcessPath(expectedPath))
}

func linuxSupervisorProcessState(pid int) (string, error) {
	statPath := filepath.Join("/proc", strconv.Itoa(pid), "stat")
	raw, err := os.ReadFile(statPath)
	if err != nil {
		return "", err
	}
	contents := string(raw)
	closing := strings.LastIndex(contents, ")")
	if closing == -1 || closing+2 >= len(contents) {
		return "", fmt.Errorf("parse %s: missing process state", statPath)
	}
	fields := strings.Fields(contents[closing+1:])
	if len(fields) == 0 {
		return "", fmt.Errorf("parse %s: missing process state", statPath)
	}
	return strings.TrimSpace(fields[0]), nil
}
