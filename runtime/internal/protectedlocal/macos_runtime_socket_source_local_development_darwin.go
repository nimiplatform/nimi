//go:build darwin && cgo && nimi_macos_source_local_development

package protectedlocal

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

const macOSSourceLocalDevelopmentSocketMode = 0o600

func openMacOSRuntimeSocket(_ string, expectedPath string, serviceUID uint32) (*net.UnixListener, error) {
	cleaned := filepath.Clean(strings.TrimSpace(expectedPath))
	runRoot := filepath.Join(MacOSRuntimeStateRoot, "run")
	if serviceUID == 0 || serviceUID != uint32(os.Geteuid()) ||
		(cleaned != MacOSDesktopSocketPath && cleaned != MacOSLocalAppSocketPath) ||
		filepath.Dir(cleaned) != runRoot {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("current-user Runtime socket authority is invalid"))
	}
	if err := os.Mkdir(runRoot, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("create current-user Runtime socket directory: %w", err))
	}
	if err := os.Chmod(runRoot, 0o700); err != nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("protect current-user Runtime socket directory: %w", err))
	}
	if err := validateMacOSSourceLocalDevelopmentSocketDirectory(runRoot, serviceUID); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(cleaned); err == nil {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || info.Mode()&os.ModeSocket == 0 || info.Mode()&os.ModeSymlink != 0 || stat.Uid != serviceUID {
			return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("refuse to replace an unowned or non-socket Runtime endpoint"))
		}
		if err := os.Remove(cleaned); err != nil {
			return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("remove stale current-user Runtime socket: %w", err))
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("inspect current-user Runtime socket: %w", err))
	}
	address := &net.UnixAddr{Name: cleaned, Net: "unix"}
	listener, err := net.ListenUnix("unix", address)
	if err != nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("listen on current-user Runtime socket: %w", err))
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = listener.Close()
		}
	}()
	listener.SetUnlinkOnClose(true)
	if err := os.Chmod(cleaned, macOSSourceLocalDevelopmentSocketMode); err != nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("protect current-user Runtime socket: %w", err))
	}
	info, err := os.Lstat(cleaned)
	stat, ok := infoSyscallStat(info)
	if err != nil || info == nil || info.Mode()&os.ModeSocket == 0 || info.Mode()&os.ModeSymlink != 0 ||
		!ok || stat.Uid != serviceUID || info.Mode().Perm() != macOSSourceLocalDevelopmentSocketMode {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("current-user Runtime socket owner or mode mismatch"))
	}
	accepted = true
	return listener, nil
}

func validateMacOSSourceLocalDevelopmentSocketDirectory(path string, uid uint32) error {
	info, err := os.Lstat(path)
	stat, ok := infoSyscallStat(info)
	if err != nil || info == nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
		!ok || stat.Uid != uid || info.Mode().Perm() != 0o700 {
		return fail(ReasonProtectedLocalTransportUnsupported, false, "restart_runtime", fmt.Errorf("current-user Runtime socket directory owner or mode mismatch"))
	}
	return nil
}

func infoSyscallStat(info os.FileInfo) (*syscall.Stat_t, bool) {
	if info == nil {
		return nil, false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return stat, ok
}
