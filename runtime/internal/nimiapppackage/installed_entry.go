package nimiapppackage

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ResolveInstalledRuntimeEntry uses the installation-owned expectation and
// checks only its path. Package-wide integrity belongs to install and repair.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
func ResolveInstalledRuntimeEntry(rootPath string, expected Expected) (string, error) {
	if err := validateExpectedTarget(expected); err != nil {
		return "", err
	}
	if !filepath.IsAbs(rootPath) {
		return "", ErrPackageIntegrity
	}
	current := rootPath
	segments := append([]string{""}, strings.Split(expected.RuntimeEntry, "/")...)
	for index, segment := range segments {
		current = filepath.Join(current, segment)
		info, err := os.Lstat(current)
		if err != nil {
			return "", errors.Join(ErrPackageIntegrity, err)
		}
		if info.Mode()&os.ModeSymlink != 0 || (index < len(segments)-1 && !info.IsDir()) || (index == len(segments)-1 && (!info.Mode().IsRegular() || info.Size() == 0)) {
			return "", ErrPackageIntegrity
		}
	}
	return current, nil
}
