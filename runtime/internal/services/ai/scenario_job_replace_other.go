//go:build !windows

package ai

import (
	"os"
	"path/filepath"
)

func replaceScenarioJobFileAtomically(source, target string) error {
	if err := os.Rename(source, target); err != nil {
		return err
	}
	return syncScenarioJobDirectory(filepath.Dir(target))
}

func openScenarioJobStoreForAppend(path string) (*os.File, error) {
	flags := os.O_RDWR
	return os.OpenFile(path, flags, 0600)
}

func syncScenarioJobDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
