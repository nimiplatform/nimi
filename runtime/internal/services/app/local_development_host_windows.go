//go:build windows

package app

import (
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func localDevelopmentHostExecutable(project localDevelopmentProjectSnapshot) (string, error) {
	if project.ShellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		return "", errLocalDevelopmentProjectChanged
	}
	return canonicalLocalDevelopmentHostExecutable(
		project.ProjectRoot,
		filepath.Join(project.ProjectRoot, "node_modules", "electron", "dist", "electron.exe"),
		project.ShellKind,
	)
}

func localDevelopmentProjectHostAliasPath(projectRoot string, shellKind runtimev1.LocalDevelopmentShellKind) string {
	if shellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		return ""
	}
	return filepath.Join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
}

func pathWithinLocalDevelopmentRoot(root string, candidate string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	return err == nil && relative != ".." && !filepath.IsAbs(relative) &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func validLocalDevelopmentHostPath(projectRoot string, hostExecutable string, shellKind runtimev1.LocalDevelopmentShellKind) bool {
	root := filepath.Clean(strings.TrimSpace(projectRoot))
	host := filepath.Clean(strings.TrimSpace(hostExecutable))
	if !filepath.IsAbs(root) || !filepath.IsAbs(host) || root != strings.TrimSpace(projectRoot) || host != strings.TrimSpace(hostExecutable) {
		return false
	}
	switch shellKind {
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON:
		alias := filepath.Join(root, "node_modules", "electron", "dist", "electron.exe")
		canonicalAlias, err := canonicalLocalDevelopmentFilePath(alias)
		if err != nil {
			return false
		}
		_, err = validateCanonicalLocalDevelopmentHostExecutable(root, host, canonicalAlias, shellKind)
		return err == nil
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI:
		return pathWithinLocalDevelopmentRoot(root, host)
	default:
		return false
	}
}

func canonicalLocalDevelopmentHostExecutable(projectRoot string, raw string, shellKind runtimev1.LocalDevelopmentShellKind) (string, error) {
	path := filepath.Clean(strings.TrimSpace(raw))
	if !filepath.IsAbs(path) {
		return "", errLocalDevelopmentProjectChanged
	}
	canonical, err := canonicalLocalDevelopmentFilePath(path)
	if err != nil {
		return "", err
	}
	canonical = filepath.Clean(canonical)
	info, err := os.Stat(canonical)
	if err != nil || !info.Mode().IsRegular() {
		return "", errLocalDevelopmentProjectChanged
	}
	electronAliasCanonical := ""
	if shellKind == runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		electronAlias := filepath.Join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
		if !pathWithinLocalDevelopmentRoot(projectRoot, electronAlias) {
			return "", errLocalDevelopmentProjectChanged
		}
		electronAliasCanonical, err = canonicalLocalDevelopmentFilePath(electronAlias)
		if err != nil {
			return "", errLocalDevelopmentProjectChanged
		}
		aliasInfo, err := os.Stat(electronAliasCanonical)
		if err != nil || !aliasInfo.Mode().IsRegular() {
			return "", errLocalDevelopmentProjectChanged
		}
	}
	return validateCanonicalLocalDevelopmentHostExecutable(projectRoot, canonical, electronAliasCanonical, shellKind)
}

func validateCanonicalLocalDevelopmentHostExecutable(
	projectRoot string,
	candidate string,
	electronAliasCanonical string,
	shellKind runtimev1.LocalDevelopmentShellKind,
) (string, error) {
	candidate = filepath.Clean(candidate)
	switch shellKind {
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON:
		alias := filepath.Clean(electronAliasCanonical)
		if alias == "." || !sameLocalDevelopmentFile(candidate, alias) {
			return "", errLocalDevelopmentProjectChanged
		}
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI:
		if !pathWithinLocalDevelopmentRoot(projectRoot, candidate) {
			return "", errLocalDevelopmentProjectChanged
		}
	default:
		return "", errLocalDevelopmentProjectChanged
	}
	return candidate, nil
}
