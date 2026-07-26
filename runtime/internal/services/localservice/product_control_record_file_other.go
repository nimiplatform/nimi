//go:build !windows

package localservice

import "os"

func productControlRecordIsReparsePoint(os.FileInfo) bool {
	return false
}
