package productrelease

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// This is an ephemeral impact preview, not an installation/recovery ledger.
type RetentionEntry struct {
	Version        string `json:"version"`
	Path           string `json:"path"`
	IdentitySHA256 string `json:"identitySha256"`
	DirectoryID    string `json:"directoryId"`
	LogicalBytes   int64  `json:"logicalBytes"`
	Complete       bool   `json:"complete"`
	Eligible       bool   `json:"eligible"`
	Reason         string `json:"reason"`
}

type RetentionPreview struct {
	CurrentVersion string           `json:"currentVersion"`
	RuntimeVersion string           `json:"runtimeVersion"`
	Entries        []RetentionEntry `json:"entries"`
}

type RetentionResult struct {
	Version      string `json:"version"`
	DeletedBytes int64  `json:"deletedBytes"`
	Removed      bool   `json:"removed"`
	Reason       string `json:"reason"`
}

type retentionTree struct {
	identity Identity
	files    []string
	dirs     []string
	bytes    int64
	complete bool
	digest   string
}

// Missing admitted files are permitted only for cleanup of a partial tree.
// Every remaining file must still match its signed bytes. Unknown directories
// (including empty ones) are refused, unlike an executable-only inventory check.
func inspectRetentionTree(root, publicKey string, validatePath func(string) error, hashFiles bool) (retentionTree, error) {
	tree := retentionTree{}
	if err := validatePath(root); err != nil {
		return tree, err
	}
	identityPath := filepath.Join(root, IdentityFile)
	if err := validatePath(identityPath); err != nil {
		return tree, err
	}
	file, err := os.Open(identityPath)
	if err != nil {
		return tree, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(file, MaxIdentityBytes+1))
	_ = file.Close()
	if readErr != nil {
		return tree, readErr
	}
	tree.identity, err = VerifyIdentity(raw, publicKey)
	if err != nil || filepath.Base(root) != tree.identity.Version {
		return tree, fmt.Errorf("UPDATE_RETENTION_IDENTITY_INVALID")
	}
	sum := sha256.Sum256(raw)
	tree.digest = hex.EncodeToString(sum[:])
	allowedDirs := map[string]bool{".": true}
	for name := range tree.identity.Files {
		for parent := filepath.Dir(filepath.FromSlash(name)); parent != "."; parent = filepath.Dir(parent) {
			allowedDirs[parent] = true
		}
	}
	seen := 0
	err = filepath.WalkDir(root, func(name string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := validatePath(name); err != nil {
			return err
		}
		info, err := os.Lstat(name)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("UPDATE_RETENTION_UNTRUSTED_PATH")
		}
		relative, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		if info.IsDir() {
			if !allowedDirs[relative] {
				return fmt.Errorf("UPDATE_RETENTION_UNKNOWN_CONTENT")
			}
			tree.dirs = append(tree.dirs, name)
			return nil
		}
		key := filepath.ToSlash(relative)
		if !info.Mode().IsRegular() || (key != IdentityFile && tree.identity.Files[key] == "") {
			return fmt.Errorf("UPDATE_RETENTION_UNKNOWN_CONTENT")
		}
		if key != IdentityFile {
			if hashFiles {
				digest, err := FileSHA256(name)
				if err != nil || digest != tree.identity.Files[key] {
					return fmt.Errorf("UPDATE_RETENTION_CONTENT_CHANGED")
				}
			}
			seen++
		}
		if info.Size() < 0 || tree.bytes > (1<<63-1)-info.Size() {
			return fmt.Errorf("UPDATE_RETENTION_SIZE_INVALID")
		}
		tree.bytes += info.Size()
		tree.files = append(tree.files, name)
		return nil
	})
	tree.complete = seen == len(tree.identity.Files)
	return tree, err
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-013
func PreviewRetention(root, current, publicKey string, protected map[string]string, directoryID func(string) (string, error), validatePath func(string) error) (RetentionPreview, error) {
	return previewRetention(root, current, publicKey, protected, directoryID, validatePath, nil)
}

// A confirmed operation rechecks its selected versions and the possible most
// recent retained version; unrelated obsolete payloads need not be read again.
func PreviewRetentionSelection(root, current, publicKey string, protected map[string]string, directoryID func(string) (string, error), validatePath func(string) error, selected map[string]bool) (RetentionPreview, error) {
	return previewRetention(root, current, publicKey, protected, directoryID, validatePath, selected)
}

func previewRetention(root, current, publicKey string, protected map[string]string, directoryID func(string) (string, error), validatePath func(string) error, selected map[string]bool) (RetentionPreview, error) {
	result := RetentionPreview{CurrentVersion: current, Entries: []RetentionEntry{}}
	if !filepath.IsAbs(root) {
		return result, fmt.Errorf("UPDATE_RETENTION_UNTRUSTED_PATH")
	}
	if _, err := CompareVersions(current, current); err != nil {
		return result, err
	}
	if err := validatePath(root); err != nil {
		return result, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return result, err
	}
	if len(entries) > 256 {
		return result, fmt.Errorf("UPDATE_RETENTION_TOO_MANY_ENTRIES")
	}
	sort.Slice(entries, func(i, j int) bool { return retentionVersionBefore(entries[i].Name(), entries[j].Name()) })
	retainedComplete := false
	for _, entry := range entries {
		item := RetentionEntry{Version: entry.Name(), Path: filepath.Join(root, entry.Name()), Reason: "unknown"}
		order, err := CompareVersions(item.Version, current)
		if err != nil || !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			result.Entries = append(result.Entries, item)
			continue
		}
		if order >= 0 {
			item.Reason = "current-or-newer"
		} else if retainedComplete && (protected[item.Version] != "" || (selected != nil && !selected[item.Version])) {
			item.Reason = protected[item.Version]
			if item.Reason == "" {
				item.Reason = "not-selected"
			}
		} else {
			item.DirectoryID, err = directoryID(item.Path)
			if err == nil {
				var tree retentionTree
				tree, err = inspectRetentionTree(item.Path, publicKey, validatePath, true)
				if err == nil {
					after, identityErr := directoryID(item.Path)
					if identityErr != nil || after != item.DirectoryID {
						err = fmt.Errorf("UPDATE_RETENTION_DIRECTORY_CHANGED")
					} else {
						item.IdentitySHA256, item.LogicalBytes, item.Complete = tree.digest, tree.bytes, tree.complete
						item.Eligible, item.Reason = protected[item.Version] == "", "obsolete"
						if protected[item.Version] != "" {
							item.Reason = protected[item.Version]
						}
						if tree.complete && !retainedComplete {
							retainedComplete = true
							item.Eligible = false
							if protected[item.Version] == "" {
								item.Reason = "retained-code-version"
							}
						}
						if selected != nil && !selected[item.Version] {
							item.Eligible = false
						}
					}
				}
			}
			if err != nil {
				item.Reason = err.Error()
			}
		}
		result.Entries = append(result.Entries, item)
	}
	return result, nil
}

func retentionVersionBefore(left, right string) bool {
	_, leftErr := CompareVersions(left, left)
	_, rightErr := CompareVersions(right, right)
	if (leftErr == nil) != (rightErr == nil) {
		return leftErr == nil
	}
	order, err := CompareVersions(left, right)
	if err != nil {
		return left < right
	}
	return order > 0
}

func ValidateRetentionSelection(root string, preview RetentionPreview, selected []RetentionEntry) error {
	if len(selected) == 0 || len(selected) > 256 {
		return fmt.Errorf("UPDATE_RETENTION_SELECTION_INVALID")
	}
	known := map[string]RetentionEntry{}
	for _, entry := range preview.Entries {
		if entry.Eligible {
			known[entry.Version] = entry
		}
	}
	seen := map[string]bool{}
	for _, entry := range selected {
		expected, ok := known[entry.Version]
		if !ok || seen[entry.Version] || entry != expected || !strings.EqualFold(entry.Path, filepath.Join(root, entry.Version)) {
			return fmt.Errorf("UPDATE_RETENTION_PREVIEW_CHANGED")
		}
		seen[entry.Version] = true
	}
	return nil
}
