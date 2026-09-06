//go:build windows

package nimiappinstall

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func publishStagedRelease(root *os.Root, stagedName, finalName string) error {
	if root == nil || !runtimeOwnedChild(stagedName) || !runtimeOwnedChild(finalName) || stagedName == finalName {
		return ErrReleasePublication
	}
	staged, err := root.Lstat(stagedName)
	if err != nil || !staged.IsDir() || staged.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("validate staged App release: %w", errors.Join(ErrReleasePublication, err))
	}
	if _, err := root.Lstat(finalName); err == nil {
		return ErrReleasePublication
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect final App release: %w", errors.Join(ErrReleasePublication, err))
	}
	rootPath := filepath.Clean(root.Name())
	if !filepath.IsAbs(rootPath) || rootPath != root.Name() {
		return ErrReleasePublication
	}
	stagedPath := filepath.Join(rootPath, stagedName)
	finalPath := filepath.Join(rootPath, finalName)
	if !strings.EqualFold(filepath.VolumeName(stagedPath), filepath.VolumeName(finalPath)) {
		return ErrReleasePublication
	}
	stagedPointer, err := windows.UTF16PtrFromString(stagedPath)
	if err != nil {
		return fmt.Errorf("encode staged App release path: %w", errors.Join(ErrReleasePublication, err))
	}
	finalPointer, err := windows.UTF16PtrFromString(finalPath)
	if err != nil {
		return fmt.Errorf("encode final App release path: %w", errors.Join(ErrReleasePublication, err))
	}
	if err := windows.MoveFileEx(stagedPointer, finalPointer, windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return fmt.Errorf("durably publish App release: %w", errors.Join(ErrReleasePublication, err))
	}
	if _, err := root.Lstat(stagedName); !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("verify staged App release removal: %w", errors.Join(ErrReleasePublication, err))
	}
	final, err := root.Lstat(finalName)
	if err != nil || !final.IsDir() || final.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("verify final App release: %w", errors.Join(ErrReleasePublication, err))
	}
	return nil
}
