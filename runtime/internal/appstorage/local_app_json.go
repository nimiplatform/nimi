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

	LocalAppJSONReadCapability  = "file.read.scoped#app-local-drafts"
	LocalAppJSONWriteCapability = "file.write.scoped#app-local-drafts"
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
// exact string is also the grant resource selector.
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

func ReadLocalAppJSON(dataRootRef, principalID, relativePath string) (LocalAppJSONDocument, error) {
	root, normalized, err := localAppJSONRoot(dataRootRef, principalID, relativePath)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	parent, exists, err := resolveLocalAppJSONParent(root, normalized, false)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	if !exists {
		return LocalAppJSONDocument{}, ErrLocalAppJSONNotFound
	}
	target := filepath.Join(parent, filepath.Base(filepath.FromSlash(normalized)))
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
	value, err := os.ReadFile(target)
	if err != nil {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	if int64(len(value)) != info.Size() || !json.Valid(value) {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	return LocalAppJSONDocument{JSONValue: value, SizeBytes: int64(len(value))}, nil
}

func WriteLocalAppJSON(dataRootRef, principalID, relativePath string, value []byte) (LocalAppJSONDocument, error) {
	root, normalized, err := localAppJSONRoot(dataRootRef, principalID, relativePath)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	canonical, err := canonicalLocalAppJSON(value)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	usage, err := localAppJSONPartitionUsage(root)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	parent, exists, err := resolveLocalAppJSONParent(root, normalized, false)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	var existingSize int64
	if exists {
		target := filepath.Join(parent, filepath.Base(filepath.FromSlash(normalized)))
		if info, statErr := os.Lstat(target); statErr == nil {
			if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
				return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
			}
			existingSize = info.Size()
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
		}
	}
	if usage-existingSize+int64(len(canonical)) > LocalAppJSONPartitionQuotaBytes {
		return LocalAppJSONDocument{}, ErrLocalAppJSONQuota
	}
	parent, _, err = resolveLocalAppJSONParent(root, normalized, true)
	if err != nil {
		return LocalAppJSONDocument{}, err
	}
	target := filepath.Join(parent, filepath.Base(filepath.FromSlash(normalized)))
	temporary, err := os.CreateTemp(parent, ".nimi-json-*.tmp")
	if err != nil {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	if _, err := temporary.Write(canonical); err != nil {
		_ = temporary.Close()
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	if err := temporary.Close(); err != nil {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	if err := replaceLocalAppJSONFile(temporaryPath, target); err != nil {
		return LocalAppJSONDocument{}, ErrLocalAppJSONUnavailable
	}
	committed = true
	return LocalAppJSONDocument{JSONValue: canonical, SizeBytes: int64(len(canonical))}, nil
}

func RemoveLocalAppJSON(dataRootRef, principalID, relativePath string) (bool, error) {
	root, normalized, err := localAppJSONRoot(dataRootRef, principalID, relativePath)
	if err != nil {
		return false, err
	}
	parent, exists, err := resolveLocalAppJSONParent(root, normalized, false)
	if err != nil || !exists {
		return false, err
	}
	target := filepath.Join(parent, filepath.Base(filepath.FromSlash(normalized)))
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return false, ErrLocalAppJSONUnavailable
	}
	if err := os.Remove(target); err != nil {
		return false, ErrLocalAppJSONUnavailable
	}
	return true, nil
}

func localAppJSONRoot(dataRootRef, principalID, relativePath string) (string, string, error) {
	normalized, err := NormalizeLocalAppJSONRelativePath(relativePath)
	if err != nil {
		return "", "", err
	}
	plan, err := ResolveAppRoots(dataRootRef, principalID, "nimi-data-app-roots")
	if err != nil {
		return "", "", ErrLocalAppJSONUnavailable
	}
	if err := MaterializeAppRoots(plan); err != nil {
		return "", "", ErrLocalAppJSONUnavailable
	}
	return plan.DurableDataRoot, normalized, nil
}

func resolveLocalAppJSONParent(root, relativePath string, create bool) (string, bool, error) {
	segments := strings.Split(filepath.FromSlash(relativePath), string(filepath.Separator))
	current := root
	for _, segment := range segments[:len(segments)-1] {
		current = filepath.Join(current, segment)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			if !create {
				return "", false, nil
			}
			if mkdirErr := os.Mkdir(current, 0o700); mkdirErr != nil && !errors.Is(mkdirErr, os.ErrExist) {
				return "", false, ErrLocalAppJSONUnavailable
			}
			info, err = os.Lstat(current)
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", false, ErrLocalAppJSONUnavailable
		}
	}
	return current, true, nil
}

func localAppJSONPartitionUsage(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(_ string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return ErrLocalAppJSONUnavailable
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrLocalAppJSONUnavailable
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() < 0 {
			return ErrLocalAppJSONUnavailable
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
