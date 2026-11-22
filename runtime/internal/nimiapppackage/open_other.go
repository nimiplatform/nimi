//go:build !windows

package nimiapppackage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// OpenArchiveReadOnly opens a regular non-symlink archive file for bounded
// verification and materialization.
func OpenArchiveReadOnly(rawPath string) (*os.File, int64, error) {
	cleanPath := filepath.Clean(strings.TrimSpace(rawPath))
	if rawPath == "" || cleanPath == "." || !filepath.IsAbs(cleanPath) {
		return nil, 0, fmt.Errorf("open nimiapp archive: %w", ErrInvalidPackage)
	}
	linfo, err := os.Lstat(cleanPath)
	if err != nil {
		return nil, 0, fmt.Errorf("open nimiapp archive: %w", err)
	}
	if !linfo.Mode().IsRegular() || linfo.Mode()&os.ModeSymlink != 0 || linfo.Size() < 0 {
		return nil, 0, fmt.Errorf("validate nimiapp archive file: %w", ErrInvalidPackage)
	}
	file, err := os.Open(cleanPath)
	if err != nil {
		return nil, 0, fmt.Errorf("open nimiapp archive: %w", err)
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 0 {
		_ = file.Close()
		return nil, 0, fmt.Errorf("stat nimiapp archive: %w", errors.Join(ErrInvalidPackage, err))
	}
	return file, info.Size(), nil
}
