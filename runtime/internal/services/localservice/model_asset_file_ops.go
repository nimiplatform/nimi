package localservice

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

func maybeMoveOrCopyFile(sourcePath string, destPath string, removeSource bool) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	if removeSource {
		if err := os.Rename(sourcePath, destPath); err == nil {
			return nil
		}
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return err
	}
	if err := copyFile(sourcePath, destPath, info.Mode().Perm()); err != nil {
		return err
	}
	if removeSource {
		if err := os.Remove(sourcePath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func copyFile(sourcePath string, destPath string, mode os.FileMode) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open source file: %w", err)
	}
	defer func() { _ = source.Close() }()
	target, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return fmt.Errorf("open destination file: %w", err)
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		return fmt.Errorf("copy source file: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close destination file: %w", closeErr)
	}
	return nil
}

func copyDirRecursive(sourceDir string, destDir string) error {
	return filepath.WalkDir(sourceDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destDir, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return copyFile(path, target, info.Mode().Perm())
	})
}
