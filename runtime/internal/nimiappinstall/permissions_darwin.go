package nimiappinstall

import (
	"fmt"
	"os"
	"path/filepath"
)

// The service writes public immutable software; the interactive user must be
// able to traverse and execute it. Work files and App-private data stay private.
func preparePackageDirectories(root string) error {
	for _, directory := range []string{root, filepath.Join(root, packageReleaseDirectory)} {
		if err := os.Chmod(directory, 0o755); err != nil {
			return fmt.Errorf("prepare macOS public App code directory: %w", err)
		}
	}
	return nil
}
