//go:build !windows

package ai

import "os"

func replaceScenarioJobFileAtomically(source, target string) error {
	return os.Rename(source, target)
}
