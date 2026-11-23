//go:build !darwin

package nimiapppackage

import "os"

func materializeBundleLink(root *os.Root, target, name string) error {
	return root.Symlink(target, name)
}
