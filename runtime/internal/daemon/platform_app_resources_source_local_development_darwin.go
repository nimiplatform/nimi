//go:build darwin && nimi_macos_source_local_development

package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func protectedProductControlRoot(stateRoot string, identity localappkernel.VerifiedLocalOSUserIdentity) (string, error) {
	uid, _, ok := identity.MacOSInteractiveUser()
	root := filepath.Join(stateRoot, ".nimi")
	if !ok || uid == 0 || uid != uint32(os.Geteuid()) {
		return "", fmt.Errorf("current-user Product Control identity is unavailable")
	}
	if err := os.Mkdir(root, 0o700); err != nil && !os.IsExist(err) {
		return "", fmt.Errorf("create current-user Product Control root: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return "", fmt.Errorf("protect current-user Product Control root: %w", err)
	}
	info, err := os.Lstat(root)
	if err != nil {
		return "", fmt.Errorf("inspect current-user Product Control root: %w", err)
	}
	stat, statOK := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !statOK ||
		stat.Uid != uid || info.Mode().Perm() != 0o700 {
		return "", fmt.Errorf("current-user Product Control root owner or mode mismatch")
	}
	return root, nil
}

func protectedPlatformAppResourceBindings() (string, error) {
	return sourceLocalDevelopmentPlatformAppResources()
}
