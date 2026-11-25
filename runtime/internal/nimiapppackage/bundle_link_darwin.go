package nimiapppackage

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
func materializeBundleLink(root *os.Root, target, name string) error {
	parent, err := root.Open(filepath.Dir(name))
	if err != nil {
		return err
	}
	defer func() { _ = parent.Close() }()
	fd := int(parent.Fd())
	base := filepath.Base(name)
	if err := unix.Symlinkat(target, fd, base); err != nil {
		return err
	}
	// Darwin applies the service umask to symlinks and checks their read bits
	// for readlink. Restore the archive link mode without touching its target.
	return unix.Fchmodat(fd, base, 0o777, unix.AT_SYMLINK_NOFOLLOW)
}
