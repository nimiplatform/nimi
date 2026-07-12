//go:build !windows

package app

import "path/filepath"

func canonicalLocalDevelopmentFilePath(path string) (string, error) {
	return filepath.EvalSymlinks(filepath.Clean(path))
}
