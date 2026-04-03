//go:build linux

package engine

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func resolveSupervisorExpectedExecutablePath(pid int, fallbackPath string) string {
	if pid > 0 {
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
	}
	return canonicalSupervisorProcessPath(fallbackPath)
}
