package appstorage

import (
	"encoding/base32"
	"errors"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const managedStorageDirectory = "managed-app-storage"

var ErrManagedOwnerInvalid = errors.New("managed App storage owner is invalid")

// ManagedOwner is derived from the protected Runtime session. AppID is
// deliberately absent: it is producer/catalog metadata, never a storage key.
type ManagedOwner struct {
	AccountID            string
	RegisteredAppSubject string
}

func (owner ManagedOwner) normalized() (ManagedOwner, error) {
	owner.AccountID = strings.TrimSpace(owner.AccountID)
	owner.RegisteredAppSubject = strings.TrimSpace(owner.RegisteredAppSubject)
	if owner.AccountID == "" || owner.RegisteredAppSubject == "" ||
		len([]byte(owner.AccountID)) > 1024 || len([]byte(owner.RegisteredAppSubject)) > 1024 ||
		!utf8.ValidString(owner.AccountID) || !utf8.ValidString(owner.RegisteredAppSubject) ||
		!norm.NFC.IsNormalString(owner.AccountID) || !norm.NFC.IsNormalString(owner.RegisteredAppSubject) ||
		strings.ContainsRune(owner.AccountID, '\x00') || strings.ContainsRune(owner.RegisteredAppSubject, '\x00') {
		return ManagedOwner{}, ErrManagedOwnerInvalid
	}
	return owner, nil
}

func managedOwnerRoot(dataRootRef string, owner ManagedOwner) (string, ManagedOwner, error) {
	dataRootRef = filepath.Clean(strings.TrimSpace(dataRootRef))
	if dataRootRef == "." || dataRootRef == "" || !filepath.IsAbs(dataRootRef) {
		return "", ManagedOwner{}, ErrManagedOwnerInvalid
	}
	normalized, err := owner.normalized()
	if err != nil {
		return "", ManagedOwner{}, err
	}
	segments := []string{dataRootRef, managedStorageDirectory, "v1", "accounts"}
	segments = append(segments, encodeManagedComponent(normalized.AccountID)...)
	segments = append(segments, "subjects")
	segments = append(segments, encodeManagedComponent(normalized.RegisteredAppSubject)...)
	root := filepath.Join(segments...)
	if !within(dataRootRef, root) {
		return "", ManagedOwner{}, ErrManagedOwnerInvalid
	}
	if err := materializeRoot(dataRootRef, root); err != nil {
		return "", ManagedOwner{}, ErrManagedOwnerInvalid
	}
	return root, normalized, nil
}

var managedBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// encodeManagedComponent is injective and host case/normalization independent.
// Chunking keeps every physical component below common 255-byte limits.
func encodeManagedComponent(value string) []string {
	raw := []byte(value)
	segments := make([]string, 0, (len(raw)+119)/120)
	for len(raw) > 120 {
		segments = append(segments, "c"+managedBase32.EncodeToString(raw[:120]))
		raw = raw[120:]
	}
	segments = append(segments, "f"+managedBase32.EncodeToString(raw))
	return segments
}
