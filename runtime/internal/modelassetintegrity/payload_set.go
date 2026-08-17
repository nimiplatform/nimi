// @nimi-authority: rule.nimi.runtime.local-compute.r100

// Package modelassetintegrity contains the shared filesystem integrity check
// used at Local Job admission and the final ExecutionHost seal.
package modelassetintegrity

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const CanonicalManifestFileName = "asset.manifest.json"

// ValidateDeclaredPayloadSet requires the bundle's regular payload files to
// exactly match the captured declaration. The canonical root manifest is the
// only regular control file outside that declaration.
func ValidateDeclaredPayloadSet(bundleDir string, declared []string) error {
	if bundleDir == "" || !filepath.IsAbs(bundleDir) || filepath.Clean(bundleDir) != bundleDir {
		return fmt.Errorf("ModelAsset bundle path is not canonical and absolute")
	}
	expected := make(map[string]struct{}, len(declared))
	for _, relative := range declared {
		clean := filepath.Clean(filepath.FromSlash(relative))
		if relative == "" || filepath.IsAbs(clean) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.ToSlash(clean) != relative {
			return fmt.Errorf("ModelAsset bundle has an invalid declared payload path")
		}
		if relative == CanonicalManifestFileName {
			return fmt.Errorf("ModelAsset canonical manifest cannot be a declared payload")
		}
		if _, duplicate := expected[relative]; duplicate {
			return fmt.Errorf("ModelAsset bundle has a duplicate declared payload path")
		}
		expected[relative] = struct{}{}
	}

	observed := make(map[string]struct{}, len(expected))
	err := filepath.WalkDir(bundleDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == bundleDir {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("ModelAsset bundle entry is a link: %s", entry.Name())
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("ModelAsset bundle entry is not a regular file: %s", entry.Name())
		}
		relative, err := filepath.Rel(bundleDir, path)
		if err != nil || filepath.IsAbs(relative) || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return fmt.Errorf("ModelAsset bundle payload escapes its root")
		}
		relative = filepath.ToSlash(relative)
		if relative == CanonicalManifestFileName {
			return nil
		}
		if _, declared := expected[relative]; !declared {
			return fmt.Errorf("ModelAsset bundle contains undeclared payload %q", relative)
		}
		observed[relative] = struct{}{}
		return nil
	})
	if err != nil {
		return fmt.Errorf("inspect ModelAsset bundle payload set: %w", err)
	}
	for _, relative := range declared {
		if _, exists := observed[relative]; !exists {
			return fmt.Errorf("ModelAsset bundle is missing declared payload %q", relative)
		}
	}
	return nil
}
