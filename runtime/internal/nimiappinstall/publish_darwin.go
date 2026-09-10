package nimiappinstall

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func isReleaseRenameBusy(error) bool { return false }

func publishStagedRelease(root *os.Root, stage, final string) error {
	directory, err := root.Open(".")
	if err != nil {
		return fmt.Errorf("open macOS release directory: %w", err)
	}
	defer func() { _ = directory.Close() }()
	if err := root.Chmod(stage, 0o755); err != nil {
		return fmt.Errorf("make verified App bundle traversable: %w", err)
	}
	if err := unix.RenameatxNp(int(directory.Fd()), stage, int(directory.Fd()), final, unix.RENAME_EXCL); err != nil {
		return fmt.Errorf("publish macOS App release without replacement: %w", err)
	}
	return nil
}
