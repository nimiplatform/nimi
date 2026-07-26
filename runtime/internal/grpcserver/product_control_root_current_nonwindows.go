//go:build !windows

package grpcserver

import (
	"fmt"
	"os/user"
	"path/filepath"
	"strings"
)

// ResolveCurrentProcessProductControlRoot resolves the fixed locator for an
// explicit non-production Runtime from the OS account database, not HOME or
// Runtime configuration.
func ResolveCurrentProcessProductControlRoot() (string, error) {
	account, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("resolve current OS-user profile mapping: %w", err)
	}
	if account == nil {
		return "", fmt.Errorf("current OS-user profile mapping is unavailable")
	}
	profileRoot := filepath.Clean(strings.TrimSpace(account.HomeDir))
	if profileRoot == "." || !filepath.IsAbs(profileRoot) || profileRoot == string(filepath.Separator) {
		return "", fmt.Errorf("current OS-user profile mapping is not an absolute non-root path")
	}
	return filepath.Join(profileRoot, ".nimi"), nil
}
