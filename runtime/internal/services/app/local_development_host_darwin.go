//go:build darwin && !nimi_macos_source_local_development

package app

import (
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func localDevelopmentHostExecutable(project localDevelopmentProjectSnapshot) (string, error) {
	if project.ShellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		return "", errLocalDevelopmentProjectChanged
	}
	host := protectedlocal.MacOSLocalAppHostPath
	canonical, err := canonicalLocalDevelopmentFilePath(host)
	if err != nil || canonical != host {
		return "", errLocalDevelopmentProjectChanged
	}
	metadata, err := os.Lstat(host)
	if err != nil || !metadata.Mode().IsRegular() || metadata.Mode()&os.ModeSymlink != 0 || metadata.Sys() == nil {
		return "", errLocalDevelopmentProjectChanged
	}
	return host, nil
}

func localDevelopmentProjectHostAliasPath(string, runtimev1.LocalDevelopmentShellKind) string {
	return ""
}

func validLocalDevelopmentHostPath(projectRoot string, hostExecutable string, shellKind runtimev1.LocalDevelopmentShellKind) bool {
	root := filepath.Clean(strings.TrimSpace(projectRoot))
	host := filepath.Clean(strings.TrimSpace(hostExecutable))
	if shellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON ||
		!filepath.IsAbs(root) || root != strings.TrimSpace(projectRoot) || host != protectedlocal.MacOSLocalAppHostPath || host != strings.TrimSpace(hostExecutable) {
		return false
	}
	canonical, err := canonicalLocalDevelopmentFilePath(host)
	if err != nil || canonical != host {
		return false
	}
	metadata, err := os.Lstat(host)
	return err == nil && metadata.Mode().IsRegular() && metadata.Mode()&os.ModeSymlink == 0
}
