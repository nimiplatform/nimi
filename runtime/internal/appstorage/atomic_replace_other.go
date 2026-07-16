//go:build !windows

package appstorage

import "os"

func replaceLocalAppJSONFile(source, target string) error {
	return os.Rename(source, target)
}
