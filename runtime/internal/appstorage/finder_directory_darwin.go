//go:build darwin && cgo

package appstorage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"golang.org/x/sys/unix"
)

func finderNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
func openFinderDirectoryAt(parent *os.File, name string) (*os.File, error) {
	fd, e := unix.Openat(int(parent.Fd()), name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	return os.NewFile(uintptr(fd), filepath.Join(parent.Name(), name)), nil
}

// Create in a service-private directory BEFORE publishing the inode into a
// user-selected root. All subsequent child operations use the pinned base fd;
// the interactive user can neither add nor replace children inside this base.
func (v *FinderViews) openBase(dataRoot string, source *os.File, fileID finderIdentity) (*os.File, error) {
	root, e := openFinderItem(dataRoot, unix.O_RDONLY|unix.O_DIRECTORY)
	if e != nil {
		return nil, e
	}
	defer func() { _ = root.Close() }()
	name := "Nimi Finder Items-" + strconv.Itoa(os.Geteuid())
	base, e := openFinderDirectoryAt(root, name)
	if errors.Is(e, unix.ENOENT) {
		staging := v.journal
		journalID, _, err := finderStat(staging)
		if err != nil {
			return nil, err
		}
		if journalID.Volume != fileID.Volume {
			// On a different volume the asset's daemon-owned parent is already
			// on the correct filesystem. Refuse a mutably shared staging parent.
			staging, err = openFinderItem(filepath.Dir(source.Name()), unix.O_RDONLY|unix.O_DIRECTORY)
			if err != nil {
				return nil, err
			}
			defer func() { _ = staging.Close() }()
			_, st, err := finderStat(staging)
			if err != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&0o022 != 0 {
				return nil, ErrAssetUnavailable
			}
			if err = checkFinderMutationACL(staging, 0); err != nil {
				return nil, err
			}
		}
		nonce, err := finderNonce()
		if err != nil {
			return nil, err
		}
		stage := ".base-" + nonce
		if err = unix.Mkdirat(int(staging.Fd()), stage, 0o700); err != nil {
			return nil, err
		}
		defer func() { _ = unix.Unlinkat(int(staging.Fd()), stage, unix.AT_REMOVEDIR) }()
		prepared, err := openFinderDirectoryAt(staging, stage)
		if err != nil {
			return nil, err
		}
		defer func() { _ = prepared.Close() }()
		err = setFinderDirectory(prepared, 0)
		if err == nil {
			err = prepared.Chmod(0o711)
		}
		if err == nil {
			err = unix.RenameatxNp(int(staging.Fd()), stage, int(root.Fd()), name, unix.RENAME_EXCL)
		}
		if err != nil && !errors.Is(err, unix.EEXIST) {
			return nil, err
		}
		if err = root.Sync(); err != nil {
			return nil, err
		}
		base, e = openFinderDirectoryAt(root, name)
	}
	if e != nil {
		return nil, e
	}
	if e = validateFinderBase(base, fileID.Volume); e != nil {
		return nil, errors.Join(e, base.Close())
	}
	return base, nil
}
func validateFinderBase(base *os.File, vol [16]byte) error {
	id, st, e := finderStat(base)
	if e != nil || id.Volume != vol || st.Uid != uint32(os.Geteuid()) || st.Mode&0o777 != 0o711 {
		return ErrAssetUnavailable
	}
	return checkFinderMutationACL(base, 0)
}
