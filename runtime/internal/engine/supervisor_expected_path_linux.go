//go:build linux

package engine

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func resolveSupervisorExpectedExecutablePath(pid int, fallbackPath string) string {
	if pid > 0 {
		deadline := time.Now().Add(2 * time.Second)
		for {
			if actual := observedSupervisorExecutablePath(pid); actual != "" {
				if !shouldRetryObservedExecutablePath(actual, fallbackPath) || time.Now().After(deadline) {
					return actual
				}
			}
			if time.Now().After(deadline) {
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
	}
	return canonicalSupervisorProcessPath(fallbackPath)
}

func observedSupervisorExecutablePath(pid int) string {
	if pid <= 0 {
		return ""
	}
	exePath, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "exe"))
	if err == nil {
		if actual := canonicalSupervisorProcessPath(exePath); actual != "" {
			return actual
		}
	}
	cmdlineBytes, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cmdline"))
	if err == nil {
		for _, part := range strings.Split(string(cmdlineBytes), "\x00") {
			if actual := canonicalSupervisorProcessPath(part); actual != "" {
				return actual
			}
		}
	}
	return ""
}
