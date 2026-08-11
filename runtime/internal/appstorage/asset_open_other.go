//go:build !windows

package appstorage

import "os"

func openCommittedAssetFile(path string) (*os.File, error) {
	return os.Open(path)
}
