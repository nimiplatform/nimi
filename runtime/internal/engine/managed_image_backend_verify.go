package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r077
func verifyManagedImageBackendPackage(backendsPath, backendName string, spec managedImageBackendPackageSpec) (string, string, error) {
	if spec.InstallDirName == "" || filepath.Base(spec.InstallDirName) != spec.InstallDirName || spec.InstallDirName == "." || spec.InstallDirName == ".." || spec.ArchiveSHA256 == "" {
		return "", "", fmt.Errorf("managed image package identity incomplete")
	}
	root := filepath.Join(backendsPath, spec.InstallDirName)
	metadataPath := filepath.Join(root, "metadata.json")
	info, err := os.Lstat(metadataPath)
	if err != nil || !info.Mode().IsRegular() {
		return "", "", fmt.Errorf("managed image package custody unavailable")
	}
	metadata, err := readManagedImageBackendMetadata(metadataPath)
	if err != nil || metadata == nil || metadata.Name != spec.InstallDirName || metadata.Alias != backendName || metadata.ArchiveSHA256 != strings.ToLower(spec.ArchiveSHA256) || len(metadata.PayloadHashes) == 0 {
		return "", "", fmt.Errorf("managed image package custody identity mismatch")
	}
	hashes, err := managedImageBackendPayloadHashes(root)
	if err != nil {
		return "", "", err
	}
	if !reflect.DeepEqual(hashes, metadata.PayloadHashes) {
		return "", "", fmt.Errorf("%w: managed image package payload changed", ErrEngineBinaryHashMismatch)
	}
	executable, _, err := discoverManagedImageBackendExecutablePathInDir(root, spec.ExecutableCandidates)
	if err != nil {
		return "", "", err
	}
	return executable, filepath.Dir(executable), nil
}

// Hash the complete installed package, including dynamic libraries. The owner
// metadata is the only excluded file; model weights live outside this package.
func managedImageBackendPayloadHashes(root string) (map[string]string, error) {
	hashes := make(map[string]string)
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return fmt.Errorf("managed image package contains a non-regular entry: %s", path)
		}
		if info.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if relative == "metadata.json" {
			return nil
		}
		hash, err := sha256File(path)
		if err != nil {
			return err
		}
		hashes[filepath.ToSlash(relative)] = hash
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("verify managed image package payload: %w", err)
	}
	if len(hashes) == 0 {
		return nil, fmt.Errorf("managed image package payload empty")
	}
	return hashes, nil
}
