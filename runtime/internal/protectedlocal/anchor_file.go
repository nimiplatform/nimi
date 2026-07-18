package protectedlocal

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

const (
	anchorEncodingVersion = byte(1)
	anchorEncodedBytes    = 1 + IdentifierBytes + 8 + IdentifierBytes + sha256.Size
)

type Anchor struct {
	LedgerUUID      Identifier
	CommitSequence  uint64
	CommitChainHead Identifier
}

type AnchorStore interface {
	Load(context.Context) (Anchor, error)
	Store(context.Context, Anchor) error
}

type FileAnchorStore struct {
	path   string
	macKey []byte
	random io.Reader
}

func NewFileAnchorStore(path string, macKey []byte) (*FileAnchorStore, error) {
	if !filepath.IsAbs(path) || filepath.Base(path) == "." || filepath.Base(path) == string(filepath.Separator) {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("create anchor store: absolute file path required"))
	}
	if len(macKey) < sha256.Size {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("create anchor store: 32-byte secure-storage key required"))
	}
	return &FileAnchorStore{path: filepath.Clean(path), macKey: append([]byte(nil), macKey...), random: rand.Reader}, nil
}

func (store *FileAnchorStore) Load(ctx context.Context) (Anchor, error) {
	if err := ctx.Err(); err != nil {
		return Anchor{}, fmt.Errorf("load protected-local anchor: %w", err)
	}
	info, err := os.Lstat(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return Anchor{}, ErrAnchorNotFound
	}
	if err != nil {
		return Anchor{}, fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("inspect protected-local anchor: %w", err))
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != anchorEncodedBytes {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("validate protected-local anchor representation: invalid file identity"))
	}
	encoded, err := os.ReadFile(store.path)
	if err != nil {
		return Anchor{}, fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected-local anchor: %w", err))
	}
	anchor, err := store.decode(encoded)
	if err != nil {
		return Anchor{}, err
	}
	return anchor, nil
}

func (store *FileAnchorStore) Store(ctx context.Context, anchor Anchor) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("store protected-local anchor: %w", err)
	}
	if anchor.LedgerUUID == (Identifier{}) || anchor.CommitChainHead == (Identifier{}) {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("store protected-local anchor: empty anchor identity"))
	}
	directory := filepath.Dir(store.path)
	directoryInfo, err := os.Stat(directory)
	if err != nil || !directoryInfo.IsDir() {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "repair_runtime_service", fmt.Errorf("validate protected-local anchor directory: %w", err))
	}
	if info, err := os.Lstat(store.path); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("validate protected-local anchor target: invalid file identity"))
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("inspect protected-local anchor target: %w", err))
	}

	encoded := store.encode(anchor)
	suffix := make([]byte, 12)
	if _, err := io.ReadFull(store.random, suffix); err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate protected-local anchor temporary name: %w", err))
	}
	temporaryPath := fmt.Sprintf("%s.tmp-%x", store.path, suffix)
	file, err := os.OpenFile(temporaryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("create protected-local anchor temporary file: %w", err))
	}
	removeTemporary := true
	defer func() {
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := file.Write(encoded); err != nil {
		_ = file.Close()
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("write protected-local anchor temporary file: %w", err))
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("fsync protected-local anchor temporary file: %w", err))
	}
	if err := file.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close protected-local anchor temporary file: %w", err))
	}
	if err := os.Rename(temporaryPath, store.path); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("atomically replace protected-local anchor: %w", err))
	}
	removeTemporary = false
	if err := syncDirectory(directory); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("fsync protected-local anchor directory: %w", err))
	}
	return nil
}

func (store *FileAnchorStore) encode(anchor Anchor) []byte {
	encoded := make([]byte, anchorEncodedBytes)
	encoded[0] = anchorEncodingVersion
	copy(encoded[1:1+IdentifierBytes], anchor.LedgerUUID[:])
	binary.BigEndian.PutUint64(encoded[1+IdentifierBytes:1+IdentifierBytes+8], anchor.CommitSequence)
	copy(encoded[1+IdentifierBytes+8:1+IdentifierBytes+8+IdentifierBytes], anchor.CommitChainHead[:])
	mac := hmac.New(sha256.New, store.macKey)
	_, _ = mac.Write([]byte("nimi/protected-local/anchor/v1\x00"))
	_, _ = mac.Write(encoded[:anchorEncodedBytes-sha256.Size])
	copy(encoded[anchorEncodedBytes-sha256.Size:], mac.Sum(nil))
	return encoded
}

func (store *FileAnchorStore) decode(encoded []byte) (Anchor, error) {
	if len(encoded) != anchorEncodedBytes || encoded[0] != anchorEncodingVersion {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("decode protected-local anchor: invalid encoding"))
	}
	mac := hmac.New(sha256.New, store.macKey)
	_, _ = mac.Write([]byte("nimi/protected-local/anchor/v1\x00"))
	_, _ = mac.Write(encoded[:anchorEncodedBytes-sha256.Size])
	if subtle.ConstantTimeCompare(mac.Sum(nil), encoded[anchorEncodedBytes-sha256.Size:]) != 1 {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("decode protected-local anchor: authentication failed"))
	}
	var anchor Anchor
	copy(anchor.LedgerUUID[:], encoded[1:1+IdentifierBytes])
	anchor.CommitSequence = binary.BigEndian.Uint64(encoded[1+IdentifierBytes : 1+IdentifierBytes+8])
	copy(anchor.CommitChainHead[:], encoded[1+IdentifierBytes+8:1+IdentifierBytes+8+IdentifierBytes])
	if anchor.LedgerUUID == (Identifier{}) || anchor.CommitChainHead == (Identifier{}) {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", fmt.Errorf("decode protected-local anchor: empty identity"))
	}
	return anchor, nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open directory: %w", err)
	}
	defer func() { _ = directory.Close() }()
	if err := directory.Sync(); err != nil {
		// Windows does not expose directory FlushFileBuffers through os.File.Sync.
		// The anchor file itself has already been synced before the atomic rename.
		if runtime.GOOS == "windows" || errors.Is(err, os.ErrInvalid) {
			return nil
		}
		return fmt.Errorf("sync directory: %w", err)
	}
	return nil
}
