//go:build darwin && cgo

package grpcserver

import (
	"fmt"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

// ResolveProtectedProductControlRoot derives the fixed Product Control
// directory from the OS account database entry for the kernel-verified
// interactive euid.
func ResolveProtectedProductControlRoot(identity localappkernel.VerifiedLocalOSUserIdentity) (string, error) {
	euid, _, ok := identity.MacOSInteractiveUser()
	if !ok {
		return "", fmt.Errorf("verified macOS interactive-user identity is required")
	}
	account, err := user.LookupId(strconv.FormatUint(uint64(euid), 10))
	if err != nil {
		return "", fmt.Errorf("resolve verified macOS interactive-user profile mapping: %w", err)
	}
	if account == nil || strings.TrimSpace(account.Uid) != strconv.FormatUint(uint64(euid), 10) {
		return "", fmt.Errorf("verified macOS interactive-user profile mapping is inconsistent")
	}
	profileRoot := filepath.Clean(strings.TrimSpace(account.HomeDir))
	if profileRoot == "." || !filepath.IsAbs(profileRoot) || profileRoot == string(filepath.Separator) {
		return "", fmt.Errorf("verified macOS interactive-user profile mapping is not an absolute non-root path")
	}
	return filepath.Join(profileRoot, ".nimi"), nil
}
