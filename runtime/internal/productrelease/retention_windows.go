//go:build windows

package productrelease

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"unsafe"

	"golang.org/x/sys/windows"
)

func RetentionDirectoryID(directory string) (string, error) {
	name, err := windows.UTF16PtrFromString(directory)
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	return retentionHandleID(handle, true)
}

func retentionHandleID(handle windows.Handle, directory bool) (string, error) {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return "", err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || (info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0) != directory {
		return "", fmt.Errorf("UPDATE_RETENTION_UNTRUSTED_PATH")
	}
	return fmt.Sprintf("%08x:%08x%08x", info.VolumeSerialNumber, info.FileIndexHigh, info.FileIndexLow), nil
}

type retainedHandle struct {
	name string
	file *os.File
	size int64
}

func openRetentionHandle(name string, directory bool) (*os.File, error) {
	encoded, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	access := uint32(windows.GENERIC_READ | windows.DELETE)
	sharing := uint32(0)
	flags := uint32(windows.FILE_FLAG_OPEN_REPARSE_POINT)
	if directory {
		flags |= windows.FILE_FLAG_BACKUP_SEMANTICS
		access = windows.FILE_READ_ATTRIBUTES | windows.DELETE
		// Pin directory names against rename/replacement. Child files have
		// separate exclusive handles; directory read sharing permits traversal.
		sharing = windows.FILE_SHARE_READ
	}
	handle, err := windows.CreateFile(encoded, access, sharing, nil, windows.OPEN_EXISTING, flags, 0)
	if err != nil {
		return nil, fmt.Errorf("UPDATE_RETENTION_IN_USE_OR_LOCKED: %w", err)
	}
	if _, err := retentionHandleID(handle, directory); err != nil {
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	return os.NewFile(uintptr(handle), name), nil
}

func markRetentionDelete(file *os.File) error {
	// Ordinary disposition honors existing image sections and locks. Never
	// use POSIX unlink semantics, reboot deletion, or path-based RemoveAll.
	disposition := byte(1)
	return windows.SetFileInformationByHandle(windows.Handle(file.Fd()), windows.FileDispositionInfo, &disposition, uint32(unsafe.Sizeof(disposition)))
}

// DeleteRetainedVersion is called only under the fixed installer mutex.
// validatePath and references come from the production owner; tests supply a
// temporary filesystem boundary but still exercise the real Windows handles.
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-013
func DeleteRetainedVersion(approved RetentionEntry, publicKey string, validatePath func(string) error, references func() error) RetentionResult {
	result := RetentionResult{Version: approved.Version}
	fail := func(err error) RetentionResult { result.Reason = err.Error(); return result }
	if !approved.Eligible || approved.DirectoryID == "" || approved.IdentitySHA256 == "" {
		return fail(fmt.Errorf("UPDATE_RETENTION_SELECTION_INVALID"))
	}
	if err := references(); err != nil {
		return fail(err)
	}
	tree, err := inspectRetentionTree(approved.Path, publicKey, validatePath, false)
	if err != nil {
		return fail(err)
	}
	if tree.digest != approved.IdentitySHA256 || tree.bytes != approved.LogicalBytes {
		return fail(fmt.Errorf("UPDATE_RETENTION_PREVIEW_CHANGED"))
	}
	dirs, files := []retainedHandle{}, []retainedHandle{}
	defer func() {
		for _, item := range files {
			if item.file != nil {
				_ = item.file.Close()
			}
		}
		for i := len(dirs) - 1; i >= 0; i-- {
			if dirs[i].file != nil {
				_ = dirs[i].file.Close()
			}
		}
	}()
	// Root first; each descendant name is pinned before its contents.
	sort.Slice(tree.dirs, func(i, j int) bool { return len(tree.dirs[i]) < len(tree.dirs[j]) })
	for _, name := range tree.dirs {
		file, err := openRetentionHandle(name, true)
		if err != nil {
			return fail(err)
		}
		dirs = append(dirs, retainedHandle{name: name, file: file})
		if name == approved.Path {
			actual, err := retentionHandleID(windows.Handle(file.Fd()), true)
			if err != nil || actual != approved.DirectoryID {
				return fail(fmt.Errorf("UPDATE_RETENTION_DIRECTORY_CHANGED"))
			}
		}
	}
	sort.Slice(tree.files, func(i, j int) bool {
		if tree.files[i] == filepath.Join(approved.Path, IdentityFile) {
			return false
		}
		if tree.files[j] == filepath.Join(approved.Path, IdentityFile) {
			return true
		}
		return tree.files[i] < tree.files[j]
	})
	for _, name := range tree.files {
		file, err := openRetentionHandle(name, false)
		if err != nil {
			return fail(err)
		}
		info, err := file.Stat()
		files = append(files, retainedHandle{name: name, file: file})
		if err != nil {
			return fail(err)
		}
		files[len(files)-1].size = info.Size()
		hash := sha256.New()
		if _, err := io.Copy(hash, file); err != nil {
			return fail(err)
		}
		relative, _ := filepath.Rel(approved.Path, name)
		expected := tree.identity.Files[filepath.ToSlash(relative)]
		if relative == IdentityFile {
			expected = approved.IdentitySHA256
		}
		if hex.EncodeToString(hash.Sum(nil)) != expected {
			return fail(fmt.Errorf("UPDATE_RETENTION_CONTENT_CHANGED"))
		}
	}
	if err := references(); err != nil {
		return fail(err)
	}
	// Re-enumerate names under the pinned directories before the first
	// deletion. Unknown content arriving after preview is never selected.
	if err := validateLockedRetentionNames(approved.Path, tree); err != nil {
		return fail(err)
	}
	for index := range files {
		item := &files[index]
		if item.name == filepath.Join(approved.Path, IdentityFile) {
			// Preserve the signed identity when a payload directory cannot be
			// removed, so a later confirmed preview can resume partial cleanup.
			for dir := len(dirs) - 1; dir > 0; dir-- {
				if err := markRetentionDelete(dirs[dir].file); err != nil {
					return fail(err)
				}
				if err := dirs[dir].file.Close(); err != nil {
					return fail(err)
				}
				dirs[dir].file = nil
			}
		}
		if err := markRetentionDelete(item.file); err != nil {
			return fail(err)
		}
		if err := item.file.Close(); err != nil {
			return fail(err)
		}
		item.file = nil
		result.DeletedBytes += item.size
	}
	if err := markRetentionDelete(dirs[0].file); err != nil {
		return fail(err)
	}
	if err := dirs[0].file.Close(); err != nil {
		return fail(err)
	}
	dirs[0].file = nil
	result.Removed = true
	return result
}

func validateLockedRetentionNames(root string, tree retentionTree) error {
	known := map[string]bool{}
	for _, name := range tree.files {
		known[name] = true
	}
	for _, name := range tree.dirs {
		known[name] = true
	}
	// os.ReadDir opens without FILE_SHARE_DELETE on Windows and conflicts
	// with our own directory DELETE handle. FindFirstFile enumerates names
	// while preserving those pins; it does not reopen payload file handles.
	seen := 1
	var visit func(string) error
	visit = func(directory string) error {
		pattern, err := windows.UTF16PtrFromString(filepath.Join(directory, "*"))
		if err != nil {
			return err
		}
		var data windows.Win32finddata
		search, err := windows.FindFirstFile(pattern, &data)
		if err == windows.ERROR_FILE_NOT_FOUND {
			return nil
		}
		if err != nil {
			return err
		}
		defer windows.FindClose(search)
		for {
			base := windows.UTF16ToString(data.FileName[:])
			if base != "." && base != ".." {
				name := filepath.Join(directory, base)
				if !known[name] || data.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
					return fmt.Errorf("UPDATE_RETENTION_UNKNOWN_CONTENT")
				}
				seen++
				if data.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
					if err := visit(name); err != nil {
						return err
					}
				}
			}
			if err := windows.FindNextFile(search, &data); err != nil {
				if err == windows.ERROR_NO_MORE_FILES {
					return nil
				}
				return err
			}
		}
	}
	err := visit(root)
	if err != nil {
		return err
	}
	if seen != len(known) {
		return fmt.Errorf("UPDATE_RETENTION_PREVIEW_CHANGED")
	}
	return nil
}
