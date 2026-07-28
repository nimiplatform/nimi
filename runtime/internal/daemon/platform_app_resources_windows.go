//go:build windows

package daemon

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"golang.org/x/sys/windows"
)

func protectedPlatformAppResourceBindings() (string, string, error) {
	if protectedlocal.WindowsRuntimeIsNonProductFixture() {
		return "", "", nil
	}
	executable, err := os.Executable()
	if err != nil {
		return "", "", fmt.Errorf("resolve Runtime executable for Platform resources: %w", err)
	}
	programFiles, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return "", "", fmt.Errorf("resolve Windows Program Files: %w", err)
	}
	return resolveWindowsProtectedPlatformAppResources(executable, programFiles)
}

func resolveWindowsProtectedPlatformAppResources(executablePath, programFilesRoot string) (string, string, error) {
	executablePath = filepath.Clean(strings.TrimSpace(executablePath))
	programFilesRoot = filepath.Clean(strings.TrimSpace(programFilesRoot))
	if !filepath.IsAbs(executablePath) || !filepath.IsAbs(programFilesRoot) || !windowsPathWithin(programFilesRoot, executablePath) {
		return "", "", nil
	}
	if exists, err := validateWindowsProtectedResourcePath(programFilesRoot, executablePath, false); err != nil || !exists {
		if err == nil {
			err = fmt.Errorf("verified Runtime executable is missing")
		}
		return "", "", fmt.Errorf("validate Runtime installation path: %w", err)
	}

	resourcesRoot := filepath.Join(filepath.Dir(executablePath), "resources")
	identityProjectionPath := filepath.Join(resourcesRoot, "nimi-app-identity-surfaces.yaml")
	bundledAppsRoot := filepath.Join(resourcesRoot, "nimi-apps")

	identityProjectionExists, identityProjectionErr := validateWindowsProtectedResourcePath(programFilesRoot, identityProjectionPath, false)
	if identityProjectionErr != nil {
		return "", "", fmt.Errorf("validate Platform app identity projection resource: %w", identityProjectionErr)
	}
	if !identityProjectionExists {
		return "", "", nil
	}

	bundledExists, bundledErr := validateWindowsProtectedResourcePath(programFilesRoot, bundledAppsRoot, true)
	if bundledErr != nil {
		return "", "", fmt.Errorf("validate Platform bundled apps resource: %w", bundledErr)
	}
	if !bundledExists {
		bundledAppsRoot = ""
	}
	return identityProjectionPath, bundledAppsRoot, nil
}

func validateWindowsProtectedResourcePath(root, target string, directory bool) (bool, error) {
	if !windowsPathWithin(root, target) {
		return false, fmt.Errorf("resource escapes Windows Program Files")
	}
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil {
		return false, err
	}
	components := strings.Split(relative, string(filepath.Separator))
	current := filepath.Clean(root)
	for index, component := range components {
		if component == "" || component == "." {
			continue
		}
		current = filepath.Join(current, component)
		encoded, err := windows.UTF16PtrFromString(current)
		if err != nil {
			return false, err
		}
		attributes, err := windows.GetFileAttributes(encoded)
		if err != nil {
			if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND) {
				return false, nil
			}
			return false, err
		}
		if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return false, fmt.Errorf("reparse point is forbidden: %s", current)
		}
		last := index == len(components)-1
		if !last && attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
			return false, fmt.Errorf("resource ancestor is not a directory: %s", current)
		}
		if last && directory != (attributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0) {
			return false, fmt.Errorf("resource kind mismatch: %s", current)
		}
	}
	return true, nil
}

func windowsPathWithin(root, target string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil || relative == "." {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
