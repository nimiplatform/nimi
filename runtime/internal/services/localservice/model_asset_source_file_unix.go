//go:build unix

package localservice

import (
	"os"

	"golang.org/x/sys/unix"
)

type modelAssetSourceFileIdentity struct {
	info os.FileInfo
}

func preflightModelAssetSourceFile(path string, expected os.FileInfo) (modelAssetSourceFileIdentity, error) {
	file, err := openNoFollowModelAssetSourceFile(path)
	if err != nil {
		return modelAssetSourceFileIdentity{}, &modelAssetSourceSafetyError{Path: path, Reason: "open no-follow preflight handle", Cause: err}
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return modelAssetSourceFileIdentity{}, &modelAssetSourceSafetyError{Path: path, Reason: "inspect preflight handle", Cause: err}
	}
	if !opened.Mode().IsRegular() {
		return modelAssetSourceFileIdentity{}, &modelAssetSourceSafetyError{Path: path, Reason: "opened handle is not a regular file"}
	}
	if expected == nil || !os.SameFile(expected, opened) {
		return modelAssetSourceFileIdentity{}, &modelAssetSourceSafetyError{Path: path, Reason: "preflight handle identity differs from lstat identity"}
	}
	return modelAssetSourceFileIdentity{info: opened}, nil
}

func openVerifiedModelAssetSourceFile(path string, expected modelAssetSourceFileIdentity) (*os.File, error) {
	file, err := openNoFollowModelAssetSourceFile(path)
	if err != nil {
		return nil, &modelAssetSourceSafetyError{Path: path, Reason: "open no-follow read handle", Cause: err}
	}
	opened, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, &modelAssetSourceSafetyError{Path: path, Reason: "inspect opened read handle", Cause: err}
	}
	if !opened.Mode().IsRegular() {
		_ = file.Close()
		return nil, &modelAssetSourceSafetyError{Path: path, Reason: "opened handle is not a regular file"}
	}
	if expected.info == nil || !os.SameFile(expected.info, opened) {
		_ = file.Close()
		return nil, &modelAssetSourceSafetyError{Path: path, Reason: "opened handle identity differs from preflight identity"}
	}
	return file, nil
}

func openNoFollowModelAssetSourceFile(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		_ = unix.Close(fd)
		return nil, unix.EBADF
	}
	return file, nil
}
