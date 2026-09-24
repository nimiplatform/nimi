//go:build !windows

package ai

import "os"

func replaceScenarioJobFileAtomically(source, target string) error {
	return os.Rename(source, target)
}

func openScenarioJobStoreForAppend(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_WRONLY, 0)
}
