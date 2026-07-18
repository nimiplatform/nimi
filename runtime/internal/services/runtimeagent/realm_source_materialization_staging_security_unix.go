//go:build !windows

package runtimeagent

import (
	"fmt"
	"os"
)

func ensureRealmSourceMaterializationPrivateDirectoryV3(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(path, 0o700); err != nil {
		return err
	}
	return validateRealmSourceMaterializationPrivatePathV3(path, true)
}

func createRealmSourceMaterializationPrivateTempDirectoryV3(parent, prefix string) (string, error) {
	path, err := os.MkdirTemp(parent, prefix)
	if err != nil {
		return "", err
	}
	if err := os.Chmod(path, 0o700); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	if err := validateRealmSourceMaterializationPrivatePathV3(path, true); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func openRealmSourceMaterializationPrivateFileV3(path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := validateRealmSourceMaterializationPrivatePathV3(path, false); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return file, nil
}

func validateRealmSourceMaterializationPrivatePathV3(path string, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || info.IsDir() != directory {
		return fmt.Errorf("private staging path has an invalid filesystem identity")
	}
	want := os.FileMode(0o600)
	if directory {
		want = 0o700
	}
	if info.Mode().Perm() != want {
		return fmt.Errorf("private staging permissions = %o, want %o", info.Mode().Perm(), want)
	}
	return nil
}
