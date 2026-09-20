//go:build unix

package localservice

import (
	"errors"
	"os"
	"syscall"
)

// modelFileIdentityOf returns the device and inode of the file at path
// without following a symbolic link, together with its Lstat information.
func modelFileIdentityOf(path string) (modelFileIdentity, os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return modelFileIdentity{}, nil, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		return modelFileIdentity{}, nil, errors.New("file identity is unavailable on this platform")
	}
	return modelFileIdentity{Volume: uint64(stat.Dev), Index: uint64(stat.Ino)}, info, nil
}
