//go:build darwin

package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

const macOSNimiBundleRoot = "/Applications/Nimi.app"

func protectedPlatformAppResourceBindings() (string, string, error) {
	resourcesRoot := filepath.Join(macOSNimiBundleRoot, "Contents", "Resources")
	identityProjectionPath := filepath.Join(resourcesRoot, "nimi-app-identity-surfaces.yaml")
	bundledAppsRoot := filepath.Join(resourcesRoot, "nimi-apps")
	identityProjectionExists, err := validateMacOSProtectedResourcePath(identityProjectionPath, false)
	if err != nil {
		return "", "", fmt.Errorf("validate macOS Platform app identity projection: %w", err)
	}
	if !identityProjectionExists {
		return "", "", nil
	}
	bundledExists, err := validateMacOSProtectedResourcePath(bundledAppsRoot, true)
	if err != nil {
		return "", "", fmt.Errorf("validate macOS bundled apps: %w", err)
	}
	if !bundledExists {
		bundledAppsRoot = ""
	}
	return identityProjectionPath, bundledAppsRoot, nil
}

func validateMacOSProtectedResourcePath(target string, directory bool) (bool, error) {
	cleaned := filepath.Clean(strings.TrimSpace(target))
	relative, err := filepath.Rel(macOSNimiBundleRoot, cleaned)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return false, fmt.Errorf("resource escapes the fixed Nimi bundle")
	}
	current := macOSNimiBundleRoot
	components := strings.Split(relative, string(filepath.Separator))
	for index, component := range components {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			return false, nil
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return false, fmt.Errorf("resource component is missing or symlinked")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || info.Mode().Perm()&0o022 != 0 {
			return false, fmt.Errorf("resource component is not root-owned and immutable")
		}
		last := index == len(components)-1
		if !last && !info.IsDir() {
			return false, fmt.Errorf("resource ancestor is not a directory")
		}
		if last && info.IsDir() != directory {
			return false, fmt.Errorf("resource kind mismatch")
		}
	}
	return true, nil
}
