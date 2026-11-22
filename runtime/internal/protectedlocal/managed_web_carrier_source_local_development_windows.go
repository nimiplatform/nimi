//go:build windows && nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const sourceRuntimeRepoRootEnvironment = "NIMI_SOURCE_RUNTIME_REPO_ROOT"

// ResolveManagedWebCarrier resolves the isolated source-development Electron
// copy under .nimi/local/dev-carrier/win32-x64/NimiAppHost.exe and enforces
// strict file-identity separation from Home's workspace electron.exe.
func ResolveManagedWebCarrier(ctx context.Context) (ManagedWebCarrier, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return ManagedWebCarrier{}, err
		}
	}
	repoRoot, err := windowsSourceManagedWebRepoRoot()
	if err != nil {
		return ManagedWebCarrier{}, err
	}
	carrierExe, err := canonicalWindowsSourceRegularFile(filepath.Join(repoRoot, ".nimi", "local", "dev-carrier", "win32-x64", "NimiAppHost.exe"))
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("resolve Windows dev-carrier executable: %w", err)
	}
	carrierEntry, err := canonicalWindowsSourceRegularFile(filepath.Join(repoRoot, "apps", "desktop", "dist-electron", "managed-web-carrier.js"))
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("resolve Windows dev-carrier entry: %w", err)
	}
	if homeExe, homeErr := windowsSourceExpectedExecutable(windowsSourceDesktopExecutableEnvironment); homeErr == nil {
		if sameWindowsSourceExecutable(carrierExe, homeExe) {
			return ManagedWebCarrier{}, fmt.Errorf("Windows dev-carrier executable must be distinct from Home executable")
		}
	}
	_, digest, err := inspectWindowsSourceExecutable(ctx, carrierExe)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("inspect Windows dev-carrier executable: %w", err)
	}
	return ManagedWebCarrier{
		ExecutablePath:   carrierExe,
		ExecutableDigest: digest,
		ArgumentsPrefix:  []string{carrierEntry},
	}, nil
}

func windowsSourceManagedWebRepoRoot() (string, error) {
	raw := os.Getenv(sourceRuntimeRepoRootEnvironment)
	cleaned := filepath.Clean(strings.TrimSpace(raw))
	if raw == "" || raw != strings.TrimSpace(raw) || !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("source Runtime repository root is unavailable")
	}
	canonical, err := filepath.EvalSymlinks(cleaned)
	if err != nil || !strings.EqualFold(filepath.Clean(canonical), cleaned) {
		return "", fmt.Errorf("source Runtime repository root must be canonical")
	}
	info, err := os.Lstat(cleaned)
	if err != nil || info == nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("source Runtime repository root must be a direct directory")
	}
	return cleaned, nil
}

func canonicalWindowsSourceRegularFile(path string) (string, error) {
	cleaned := filepath.Clean(path)
	if !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("absolute path is required")
	}
	canonical, err := filepath.EvalSymlinks(cleaned)
	if err != nil || !strings.EqualFold(filepath.Clean(canonical), cleaned) {
		return "", fmt.Errorf("path must be canonical: %s", cleaned)
	}
	info, err := os.Lstat(cleaned)
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("direct regular file is required: %s", cleaned)
	}
	return filepath.Clean(canonical), nil
}
