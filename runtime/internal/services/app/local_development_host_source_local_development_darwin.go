//go:build darwin && nimi_macos_source_local_development

package app

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const macOSSourceLocalDevelopmentHostExecutableEnvironment = "NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE"

func localDevelopmentHostExecutable(project localDevelopmentProjectSnapshot) (string, error) {
	if project.ShellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		return "", errLocalDevelopmentProjectChanged
	}
	host := filepath.Clean(strings.TrimSpace(os.Getenv(macOSSourceLocalDevelopmentHostExecutableEnvironment)))
	if !filepath.IsAbs(host) || host != strings.TrimSpace(os.Getenv(macOSSourceLocalDevelopmentHostExecutableEnvironment)) {
		return "", errLocalDevelopmentProjectChanged
	}
	canonical, err := canonicalLocalDevelopmentFilePath(host)
	if err != nil || canonical != host {
		return "", errLocalDevelopmentProjectChanged
	}
	metadata, err := os.Lstat(host)
	stat, ok := metadataSyscallStat(metadata)
	if err != nil || metadata == nil || !metadata.Mode().IsRegular() || metadata.Mode()&os.ModeSymlink != 0 ||
		!ok || stat.Uid != uint32(os.Geteuid()) || metadata.Mode().Perm()&0o022 != 0 {
		return "", errLocalDevelopmentProjectChanged
	}
	return host, nil
}

func metadataSyscallStat(metadata os.FileInfo) (*syscall.Stat_t, bool) {
	if metadata == nil {
		return nil, false
	}
	stat, ok := metadata.Sys().(*syscall.Stat_t)
	return stat, ok
}

func localDevelopmentProjectHostAliasPath(string, runtimev1.LocalDevelopmentShellKind) string {
	return ""
}

func validLocalDevelopmentHostPath(projectRoot string, hostExecutable string, shellKind runtimev1.LocalDevelopmentShellKind) bool {
	root := filepath.Clean(strings.TrimSpace(projectRoot))
	if shellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON ||
		!filepath.IsAbs(root) || root != strings.TrimSpace(projectRoot) {
		return false
	}
	host, err := localDevelopmentHostExecutable(localDevelopmentProjectSnapshot{ShellKind: shellKind})
	return err == nil && hostExecutable == host
}
