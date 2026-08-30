//go:build !windows

package localservice

import "os"

func replaceLocalStateFileAtomically(source string, target string) error {
	return os.Rename(source, target)
}
