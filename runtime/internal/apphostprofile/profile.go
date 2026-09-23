// Package apphostprofile derives the Host technical profile locations below the
// bound nimi_data root. It is a pure path mapping: it creates nothing, reads no
// filesystem state, and its hashed names are neither identity nor
// authorization. Runtime owners (the local-app kernel and Product Control)
// share it so launch and selected-root projections always agree.
package apphostprofile

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// DirectoryName is the first-level nimi_data directory holding Host technical
// profiles (P-MIG-006 declaration app_hosts).
const DirectoryName = "app-hosts"

const (
	hostUserKeyPrefix = "nimi.app-host-profile.host-user.v1"
	subjectKeyPrefix  = "nimi.app-host-profile.subject.v1"
	// 16 digest bytes keep collision risk negligible while leaving room for
	// Chromium's deep profile trees under Windows path limits.
	keyDigestBytes = 16
)

var ErrInvalidInput = errors.New("app host profile input invalid")

// @nimi-authority: rule.nimi.runtime.app-surface.r105
// HostScopeRoot returns <dataRoot>/app-hosts/<host-user-key> for the current
// Product Control installId and verified local OS-user anchor.
func HostScopeRoot(dataRoot string, installID string, localOSUserAnchor string) (string, error) {
	root, err := cleanDataRoot(dataRoot)
	if err != nil {
		return "", err
	}
	key, err := hashedKey(hostUserKeyPrefix, installID, localOSUserAnchor)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, DirectoryName, key), nil
}

// AppProfileRoot returns <host-scope-root>/apps/<subject-key> for one
// Registered App Subject. The profile is not partitioned by Nimi account.
func AppProfileRoot(dataRoot string, installID string, localOSUserAnchor string, registeredAppSubject string) (string, error) {
	scope, err := HostScopeRoot(dataRoot, installID, localOSUserAnchor)
	if err != nil {
		return "", err
	}
	key, err := hashedKey(subjectKeyPrefix, registeredAppSubject)
	if err != nil {
		return "", err
	}
	return filepath.Join(scope, "apps", key), nil
}

func cleanDataRoot(dataRoot string) (string, error) {
	if dataRoot == "" || strings.TrimSpace(dataRoot) != dataRoot {
		return "", fmt.Errorf("%w: data root", ErrInvalidInput)
	}
	root := filepath.Clean(dataRoot)
	if !filepath.IsAbs(root) || root == filepath.VolumeName(root)+string(filepath.Separator) {
		return "", fmt.Errorf("%w: data root", ErrInvalidInput)
	}
	return root, nil
}

// hashedKey is SHA-256 over a fixed version prefix and length-delimited fields,
// so no two distinct field tuples share an encoding.
func hashedKey(prefix string, fields ...string) (string, error) {
	digest := sha256.New()
	var length [8]byte
	for _, value := range append([]string{prefix}, fields...) {
		if value == "" || strings.TrimSpace(value) != value {
			return "", fmt.Errorf("%w: identity field", ErrInvalidInput)
		}
		binary.BigEndian.PutUint64(length[:], uint64(len(value)))
		digest.Write(length[:])
		digest.Write([]byte(value))
	}
	return hex.EncodeToString(digest.Sum(nil)[:keyDigestBytes]), nil
}
