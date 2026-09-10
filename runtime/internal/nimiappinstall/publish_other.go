//go:build !windows && !darwin

package nimiappinstall

import "os"

func isReleaseRenameBusy(error) bool { return false }

func publishStagedRelease(*os.Root, string, string) error {
	return ErrUnsupportedInstallPlatform
}
