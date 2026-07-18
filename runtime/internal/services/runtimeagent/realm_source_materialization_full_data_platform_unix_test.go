//go:build realm_v3_full_data && !windows

package runtimeagent

import (
	"fmt"
	"os"
	"syscall"
)

func validateRealmV3FullDataPrivatePathPlatformV1(_ string, info os.FileInfo, directory bool) error {
	if directory {
		if info.Mode().Perm()&0o077 != 0 || info.Mode().Perm()&0o700 != 0o700 {
			return fmt.Errorf("directory is not private owner-only: mode=%#o", info.Mode().Perm())
		}
	} else if info.Mode().Perm() != 0o600 {
		return fmt.Errorf("file is not private 0600")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return fmt.Errorf("path is not owned by the current worker uid")
	}
	return nil
}

func syncRealmV3FullDataDirectoryPlatformV1(directory *os.File) error {
	return directory.Sync()
}

func lockRealmV3FullDataFilePlatformV1(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

func unlockRealmV3FullDataFilePlatformV1(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
}

func realmV3FullDataFileIdentityPlatformV1(file *os.File) (string, error) {
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", fmt.Errorf("file inode identity is unavailable")
	}
	return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino), nil
}
