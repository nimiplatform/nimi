//go:build windows

// @nimi-authority: rule.nimi.runtime.local-compute.r100

package engine

import (
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"golang.org/x/sys/windows"
)

// windowsVolumeNameGUID is VOLUME_NAME_GUID. Network shares and redirected
// paths do not expose a local volume GUID path even when a server reports NTFS.
const windowsVolumeNameGUID = 0x1

// windowsLocalNTFSModelFilesEligible reports whether every path in the captured
// complete model file set resides directly on a fixed local Windows NTFS volume
// with no network shares, subst redirects, or reparse points along the path or
// on the target files/bundle directories. Any non-eligible path returns false
// so ExecutionHost retains full per-invocation re-verification.
func windowsLocalNTFSModelFilesEligible(bindings []capabilitydriver.InvocationExactBinding) bool {
	if len(bindings) == 0 {
		return false
	}
	for _, binding := range bindings {
		bundleDir := strings.TrimSpace(binding.BundleDir)
		declared := binding.DeclaredFiles
		if bundleDir == "" && len(declared) == 0 {
			if !isWindowsLocalNTFSPath(binding.AbsolutePath, false) {
				return false
			}
			continue
		}
		if bundleDir == "" || len(declared) == 0 || !filepath.IsAbs(bundleDir) || filepath.Clean(bundleDir) != bundleDir {
			return false
		}
		if !isWindowsLocalNTFSPath(bundleDir, true) {
			return false
		}
		if !isWindowsLocalNTFSPath(binding.AbsolutePath, false) {
			return false
		}
		for _, relative := range declared {
			clean := filepath.Clean(filepath.FromSlash(relative))
			if relative == "" || filepath.IsAbs(clean) || clean == "." || clean == ".." ||
				strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.ToSlash(clean) != relative {
				return false
			}
			if !isWindowsLocalNTFSPath(filepath.Join(bundleDir, clean), false) {
				return false
			}
		}
	}
	return true
}

func isWindowsLocalNTFSPath(path string, expectDir bool) bool {
	path = strings.TrimSpace(path)
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	// Reject UNC, extended-length, and device namespace paths.
	if strings.HasPrefix(path, `\\`) {
		return false
	}
	vol := filepath.VolumeName(path)
	if len(vol) != 2 || vol[1] != ':' || !isASCIIAlpha(vol[0]) {
		return false
	}
	volumeRoot := vol + `\`
	if !strings.HasPrefix(path, volumeRoot) {
		return false
	}
	if !isWindowsFixedLocalDrive(vol, volumeRoot) {
		return false
	}
	// Walk every directory ancestor (and the target itself when expectDir is
	// true) to reject directory symlinks, NTFS junctions, and volume mount
	// points along the path.
	dirCheckTarget := filepath.Dir(path)
	if expectDir {
		dirCheckTarget = path
	}
	if !isWindowsDirectDirectoryChain(volumeRoot, dirCheckTarget) {
		return false
	}
	return isWindowsLocalNTFSHandleTarget(path, expectDir)
}

func isASCIIAlpha(b byte) bool {
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}

func isWindowsFixedLocalDrive(driveLetter string, volumeRoot string) bool {
	rootPtr, err := windows.UTF16PtrFromString(volumeRoot)
	if err != nil {
		return false
	}
	if windows.GetDriveType(rootPtr) != windows.DRIVE_FIXED {
		return false
	}
	devicePtr, err := windows.UTF16PtrFromString(driveLetter)
	if err != nil {
		return false
	}
	targetBuf := make([]uint16, 1024)
	n, err := windows.QueryDosDevice(devicePtr, &targetBuf[0], uint32(len(targetBuf)))
	if err != nil || n == 0 {
		return false
	}
	target := windows.UTF16ToString(targetBuf[:n])
	// Reject subst virtual drives (\??\...) and network redirectors.
	if strings.HasPrefix(target, `\??\`) || !strings.HasPrefix(target, `\Device\`) {
		return false
	}
	lowerTarget := strings.ToLower(target)
	if strings.Contains(lowerTarget, "mup") || strings.Contains(lowerTarget, "lanman") || strings.Contains(lowerTarget, "webdav") {
		return false
	}
	return true
}

func isWindowsDirectDirectoryChain(volumeRoot string, targetDir string) bool {
	if !strings.HasPrefix(strings.ToLower(targetDir), strings.ToLower(volumeRoot)) {
		return false
	}
	components := []string{volumeRoot}
	rel := strings.TrimPrefix(targetDir[len(volumeRoot):], `\`)
	current := volumeRoot
	for _, part := range strings.Split(rel, `\`) {
		if part == "" {
			continue
		}
		current = filepath.Join(current, part)
		components = append(components, current)
	}
	for _, component := range components {
		ptr, err := windows.UTF16PtrFromString(component)
		if err != nil {
			return false
		}
		attrs, err := windows.GetFileAttributes(ptr)
		if err != nil {
			return false
		}
		if attrs&windows.FILE_ATTRIBUTE_DIRECTORY == 0 || attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return false
		}
	}
	return true
}

func isWindowsLocalNTFSHandleTarget(path string, expectDir bool) bool {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	access := uint32(windows.GENERIC_READ)
	flags := uint32(windows.FILE_ATTRIBUTE_NORMAL | windows.FILE_FLAG_OPEN_REPARSE_POINT)
	if expectDir {
		access = windows.FILE_READ_ATTRIBUTES
		flags = windows.FILE_FLAG_BACKUP_SEMANTICS | windows.FILE_FLAG_OPEN_REPARSE_POINT
	}
	handle, err := windows.CreateFile(
		name,
		access,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		flags,
		0,
	)
	if err != nil {
		return false
	}
	defer func() { _ = windows.CloseHandle(handle) }()

	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return false
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return false
	}
	isDir := info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0
	if isDir != expectDir {
		return false
	}
	fileSystem := make([]uint16, windows.MAX_PATH+1)
	if err := windows.GetVolumeInformationByHandle(handle, nil, 0, nil, nil, nil, &fileSystem[0], uint32(len(fileSystem))); err != nil ||
		windows.UTF16ToString(fileSystem) != "NTFS" {
		return false
	}
	finalBuf := make([]uint16, 4096)
	n, err := windows.GetFinalPathNameByHandle(handle, &finalBuf[0], uint32(len(finalBuf)), windowsVolumeNameGUID)
	if err != nil || n == 0 || n >= uint32(len(finalBuf)) {
		return false
	}
	finalGUIDPath := windows.UTF16ToString(finalBuf[:n])
	return strings.HasPrefix(finalGUIDPath, `\\?\Volume{`)
}
