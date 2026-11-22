//go:build darwin && nimi_macos_source_local_development

package protectedlocal

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

const (
	macOSSourceRuntimeRepoRootEnvironment        = "NIMI_SOURCE_RUNTIME_REPO_ROOT"
	macOSSourceHomeHostExecutableEnvironment     = "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE"
)

// ResolveManagedWebCarrier derives the isolated macOS source-dev carrier copy
// under .nimi/local/dev-carrier/Nimi Local App Host Dev.app from the
// Supervisor-bound repo root, keeping Home's workspace Electron.app isolated.
func ResolveManagedWebCarrier(ctx context.Context) (ManagedWebCarrier, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return ManagedWebCarrier{}, err
		}
	}
	rawRoot := os.Getenv(macOSSourceRuntimeRepoRootEnvironment)
	repoRoot := filepath.Clean(strings.TrimSpace(rawRoot))
	if rawRoot == "" || rawRoot != strings.TrimSpace(rawRoot) || !filepath.IsAbs(repoRoot) {
		return ManagedWebCarrier{}, fmt.Errorf("macOS source Runtime repository root is unavailable")
	}
	canonicalRoot, err := filepath.EvalSymlinks(repoRoot)
	if err != nil || canonicalRoot != repoRoot {
		return ManagedWebCarrier{}, fmt.Errorf("macOS source Runtime repository root must be canonical")
	}
	carrierExe := filepath.Join(repoRoot, ".nimi", "local", "dev-carrier", "Nimi Local App Host Dev.app", "Contents", "MacOS", "Electron")
	carrierEntry := filepath.Join(repoRoot, "apps", "desktop", "macos", "local-app-host", "main.mjs")
	carrierInfo, err := validateMacOSSourceRegularFile(carrierExe)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("validate macOS dev-carrier executable: %w", err)
	}
	if _, err := validateMacOSSourceRegularFile(carrierEntry); err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("validate macOS dev-carrier entry: %w", err)
	}
	if homeExe := filepath.Clean(strings.TrimSpace(os.Getenv(macOSSourceHomeHostExecutableEnvironment))); filepath.IsAbs(homeExe) {
		if carrierExe == homeExe {
			return ManagedWebCarrier{}, fmt.Errorf("macOS dev-carrier executable must be distinct from Home executable")
		}
		if homeInfo, statErr := os.Stat(homeExe); statErr == nil && os.SameFile(carrierInfo, homeInfo) {
			return ManagedWebCarrier{}, fmt.Errorf("macOS dev-carrier executable must not share inode with Home executable")
		}
	}
	raw, err := os.ReadFile(carrierExe)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("read macOS dev-carrier executable: %w", err)
	}
	sum := sha256.Sum256(raw)
	var digest Identifier
	copy(digest[:], sum[:])
	if digest == (Identifier{}) {
		return ManagedWebCarrier{}, fmt.Errorf("macOS dev-carrier executable digest is empty")
	}
	return ManagedWebCarrier{
		ExecutablePath:   carrierExe,
		ExecutableDigest: digest,
		ArgumentsPrefix:  []string{carrierEntry},
	}, nil
}

func validateMacOSSourceRegularFile(path string) (os.FileInfo, error) {
	cleaned := filepath.Clean(path)
	canonical, err := filepath.EvalSymlinks(cleaned)
	if err != nil || canonical != cleaned {
		return nil, fmt.Errorf("file must be canonical: %s", cleaned)
	}
	info, err := os.Lstat(cleaned)
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("direct regular file required: %s", cleaned)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0o022 != 0 {
		return nil, fmt.Errorf("unexpected file owner or mode: %s", cleaned)
	}
	return info, nil
}
