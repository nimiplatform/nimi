package appstorage

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const (
	LocalAppJSONMaxRelativePathBytes = 240
	LocalAppJSONMaxDocumentBytes     = 256 * 1024
	LocalAppJSONPartitionQuotaBytes  = 16 * 1024 * 1024

	LocalAppJSONReadOperationID   = "app_storage.json.read"
	LocalAppJSONWriteOperationID  = "app_storage.json.write"
	LocalAppJSONRemoveOperationID = "app_storage.json.remove"

	// LocalAppPrivateStorageEntitlement is a Runtime-derived base entitlement,
	// not a manifest capability or mutable user grant.
	LocalAppPrivateStorageEntitlement = "app.private_storage"
)

var (
	ErrLocalAppJSONPathInvalid  = errors.New("local-app JSON storage path is invalid")
	ErrLocalAppJSONNotFound     = errors.New("local-app JSON storage entry not found")
	ErrLocalAppJSONQuota        = errors.New("local-app JSON storage quota exceeded")
	ErrLocalAppJSONUnavailable  = errors.New("local-app JSON storage is unavailable")
	ErrLocalAppJSONValueInvalid = errors.New("local-app JSON storage value is invalid")
)

type LocalAppJSONDocument struct {
	JSONValue []byte
	SizeBytes int64
}

// NormalizeLocalAppJSONRelativePath admits one cross-platform canonical path
// grammar. It deliberately does not clean or repair caller input because the
// exact string is also the owner-policy resource selector.
func NormalizeLocalAppJSONRelativePath(value string) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || len([]byte(value)) > LocalAppJSONMaxRelativePathBytes ||
		strings.ContainsAny(value, "\\:\x00") || path.IsAbs(value) || path.Clean(value) != value ||
		!strings.HasSuffix(value, ".json") {
		return "", ErrLocalAppJSONPathInvalid
	}
	for _, segment := range strings.Split(value, "/") {
		if !validLocalAppJSONPathSegment(segment) {
			return "", ErrLocalAppJSONPathInvalid
		}
	}
	return value, nil
}

func LocalAppJSONResourceRef(relativePath string) (string, error) {
	normalized, err := NormalizeLocalAppJSONRelativePath(relativePath)
	if err != nil {
		return "", err
	}
	return "storage:" + normalized, nil
}

func ParseLocalAppJSONResourceRef(resourceRef string) (string, error) {
	const prefix = "storage:"
	if !strings.HasPrefix(resourceRef, prefix) || resourceRef != strings.TrimSpace(resourceRef) {
		return "", ErrLocalAppJSONPathInvalid
	}
	return NormalizeLocalAppJSONRelativePath(strings.TrimPrefix(resourceRef, prefix))
}

func readLocalAppJSON(root, relativePath string, readFile func(string) ([]byte, error)) (LocalAppJSONDocument, error) {
	target, exists, err := resolveLocalAppJSONTarget(root, relativePath, false)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	if !exists {
		return LocalAppJSONDocument{}, ErrLocalAppJSONNotFound
	}
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return LocalAppJSONDocument{}, ErrLocalAppJSONNotFound
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	if info.Size() < 0 || info.Size() > LocalAppJSONMaxDocumentBytes {
		return LocalAppJSONDocument{}, ErrLocalAppJSONQuota
	}
	value, err := readFile(target)
	if err != nil {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	canonical, canonicalErr := canonicalLocalAppJSON(value)
	if int64(len(value)) != info.Size() || canonicalErr != nil || !bytes.Equal(canonical, value) {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	return LocalAppJSONDocument{JSONValue: value, SizeBytes: int64(len(value))}, nil
}

func prepareLocalAppJSON(target string, canonical []byte) (string, error) {
	parent := filepath.Dir(target)
	temporary, err := os.CreateTemp(parent, ".nimi-json-*.tmp")
	if err != nil {
		return "", ErrLocalAppJSONUnavailable
	}
	temporaryPath := temporary.Name()
	prepared := false
	defer func() {
		if !prepared {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return "", ErrLocalAppJSONUnavailable
	}
	if _, err := temporary.Write(canonical); err != nil {
		_ = temporary.Close()
		return "", ErrLocalAppJSONUnavailable
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return "", ErrLocalAppJSONUnavailable
	}
	if err := temporary.Close(); err != nil {
		return "", ErrLocalAppJSONUnavailable
	}
	prepared = true
	return temporaryPath, nil
}

func localAppJSONRoot(dataRootRef string, owner ManagedOwner, relativePath string) (string, string, error) {
	normalized, err := NormalizeLocalAppJSONRelativePath(relativePath)
	if err != nil {
		return "", "", err
	}
	ownerRoot, _, err := managedOwnerRoot(dataRootRef, owner)
	if err != nil {
		return "", "", ErrLocalAppJSONUnavailable
	}
	root := filepath.Join(ownerRoot, "json", "objects")
	if err := materializeRoot(dataRootRef, root); err != nil {
		return "", "", ErrLocalAppJSONUnavailable
	}
	return root, normalized, nil
}

func resolveLocalAppJSONTarget(root, relativePath string, create bool) (string, bool, error) {
	target, err := encodedLogicalPath(root, relativePath, "document.json")
	if err != nil {
		return "", false, ErrLocalAppJSONUnavailable
	}
	exists, err := ensureManagedParent(root, target, create)
	if err != nil {
		return "", false, ErrLocalAppJSONUnavailable
	}
	return target, exists, nil
}

func localAppJSONPartitionUsage(root string) (int64, error) {
	return localAppJSONPartitionUsageWithReader(root, os.ReadFile)
}

func localAppJSONPartitionUsageWithReader(root string, readFile func(string) ([]byte, error)) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return ErrLocalAppJSONUnavailable
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrLocalAppJSONUnavailable
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Name() != "document.json" {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() < 0 {
			return ErrLocalAppJSONUnavailable
		}
		payload, err := readFile(current)
		if err != nil {
			return ErrLocalAppJSONUnavailable
		}
		canonical, err := canonicalLocalAppJSON(payload)
		if err != nil || int64(len(payload)) != info.Size() || !bytes.Equal(canonical, payload) {
			return ErrLocalAppJSONValueInvalid
		}
		total += info.Size()
		if total > LocalAppJSONPartitionQuotaBytes {
			return ErrLocalAppJSONQuota
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return total, nil
}

func canonicalLocalAppJSON(value []byte) ([]byte, error) {
	if len(value) == 0 {
		return nil, ErrLocalAppJSONValueInvalid
	}
	if len(value) > LocalAppJSONMaxDocumentBytes {
		return nil, ErrLocalAppJSONQuota
	}
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return nil, ErrLocalAppJSONValueInvalid
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, ErrLocalAppJSONValueInvalid
	}
	canonical, err := json.Marshal(decoded)
	if err != nil {
		return nil, ErrLocalAppJSONValueInvalid
	}
	if len(canonical) > LocalAppJSONMaxDocumentBytes {
		return nil, ErrLocalAppJSONQuota
	}
	return canonical, nil
}

func validLocalAppJSONPathSegment(segment string) bool {
	if segment == "" || segment == "." || segment == ".." || len(segment) > 128 ||
		segment[len(segment)-1] == '.' || windowsDeviceSegment(segment) {
		return false
	}
	for index, character := range []byte(segment) {
		alphaNumeric := character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9'
		if alphaNumeric {
			continue
		}
		if index == 0 || character != '.' && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func windowsDeviceSegment(segment string) bool {
	base := strings.ToUpper(strings.SplitN(segment, ".", 2)[0])
	if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" {
		return true
	}
	if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9' {
		return true
	}
	return false
}
