//go:build !windows

package nimiappinstall

import "os"

func publishStagedRelease(*os.Root, string, string) error {
	return ErrUnsupportedInstallPlatform
}
