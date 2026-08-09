package appstorage

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

func ensureManagedParent(root string, target string, create bool) (bool, error) {
	parent := filepath.Dir(target)
	relative, err := filepath.Rel(root, parent)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." {
		return false, ErrAssetPathInvalid
	}
	current := root
	for _, segment := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, segment)
		info, statErr := os.Lstat(current)
		if errors.Is(statErr, os.ErrNotExist) {
			if !create {
				return false, nil
			}
			if mkdirErr := os.Mkdir(current, 0o700); mkdirErr != nil && !errors.Is(mkdirErr, os.ErrExist) {
				return false, mkdirErr
			}
			info, statErr = os.Lstat(current)
		}
		if statErr != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return false, ErrAssetPathInvalid
		}
	}
	return true, nil
}

const (
	AssetMaxRelativePathBytes = 1024
	AssetMaxPathComponents    = 32
	AssetMaxComponentBytes    = 255
)

var ErrAssetPathInvalid = errors.New("managed App asset path is invalid")

func NormalizeAssetRelativePath(value string) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || len([]byte(value)) > AssetMaxRelativePathBytes ||
		!utf8.ValidString(value) || !norm.NFC.IsNormalString(value) || path.IsAbs(value) ||
		path.Clean(value) != value || strings.ContainsAny(value, "\\\x00<>:\"|?*") || strings.HasPrefix(value, "//") {
		return "", ErrAssetPathInvalid
	}
	components := strings.Split(value, "/")
	if len(components) == 0 || len(components) > AssetMaxPathComponents {
		return "", ErrAssetPathInvalid
	}
	for _, component := range components {
		if component == "" || component == "." || component == ".." || len([]byte(component)) > AssetMaxComponentBytes ||
			strings.HasSuffix(component, ".") || strings.HasSuffix(component, " ") || windowsDeviceSegment(component) {
			return "", ErrAssetPathInvalid
		}
		for _, character := range component {
			if character < 0x20 || character == 0x7f {
				return "", ErrAssetPathInvalid
			}
		}
	}
	return value, nil
}

func NormalizeAssetListPrefix(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if strings.HasSuffix(value, "/") {
		base := strings.TrimSuffix(value, "/")
		normalized, err := NormalizeAssetRelativePath(base)
		if err != nil {
			return "", err
		}
		return normalized + "/", nil
	}
	return NormalizeAssetRelativePath(value)
}

func encodedLogicalPath(root string, relativePath string, objectName string) (string, error) {
	normalized, err := NormalizeAssetRelativePath(relativePath)
	if err != nil {
		return "", err
	}
	segments := []string{root}
	for _, component := range strings.Split(normalized, "/") {
		segments = append(segments, encodeManagedComponent(component)...)
	}
	segments = append(segments, objectName)
	target := filepath.Join(segments...)
	if !within(root, target) {
		return "", ErrAssetPathInvalid
	}
	return target, nil
}

func decodeLogicalPath(root string, target string, objectName string) (string, error) {
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." {
		return "", ErrAssetPathInvalid
	}
	segments := strings.Split(relative, string(filepath.Separator))
	if len(segments) < 2 || segments[len(segments)-1] != objectName {
		return "", ErrAssetPathInvalid
	}
	segments = segments[:len(segments)-1]
	components := make([]string, 0, len(segments))
	var component []byte
	for _, segment := range segments {
		if len(segment) < 2 || segment[0] != 'c' && segment[0] != 'f' {
			return "", ErrAssetPathInvalid
		}
		decoded, err := managedBase32.DecodeString(segment[1:])
		if err != nil || len(decoded) == 0 {
			return "", ErrAssetPathInvalid
		}
		component = append(component, decoded...)
		if segment[0] == 'f' {
			if !utf8.Valid(component) {
				return "", ErrAssetPathInvalid
			}
			components = append(components, string(component))
			component = nil
		}
	}
	if len(component) != 0 || len(components) == 0 {
		return "", ErrAssetPathInvalid
	}
	logical := strings.Join(components, "/")
	return NormalizeAssetRelativePath(logical)
}
