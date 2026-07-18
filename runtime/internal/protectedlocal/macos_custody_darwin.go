//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	macOSLedgerRecordMACKeyName  = "ledger-record-hmac-v1"
	macOSLedgerAnchorSecretName  = "ledger-anchor-v1"
	macOSLedgerRecordMACKeyBytes = 32
	macOSAnchorEncodingBytes     = 8 + IdentifierBytes + 8 + IdentifierBytes
)

type macOSKeychainAnchorStore struct {
	secrets BinarySecretStore
}

func NewMacOSKeychainAnchorStore(secrets BinarySecretStore) (AnchorStore, error) {
	if secrets == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("create macOS Keychain anchor store: custody is required"))
	}
	return &macOSKeychainAnchorStore{secrets: secrets}, nil
}

func (store *macOSKeychainAnchorStore) Load(ctx context.Context) (Anchor, error) {
	encoded, err := store.secrets.Load(ctx, macOSLedgerAnchorSecretName)
	if errors.Is(err, ErrProtectedSecretNotFound) {
		return Anchor{}, ErrAnchorNotFound
	}
	if err != nil {
		return Anchor{}, err
	}
	defer zeroBytes(encoded)
	if len(encoded) != macOSAnchorEncodingBytes || string(encoded[:8]) != "NIMIMA01" {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "repair_runtime_service", fmt.Errorf("decode macOS protected-local anchor: invalid encoding"))
	}
	var anchor Anchor
	copy(anchor.LedgerUUID[:], encoded[8:8+IdentifierBytes])
	anchor.CommitSequence = binary.BigEndian.Uint64(encoded[8+IdentifierBytes : 8+IdentifierBytes+8])
	copy(anchor.CommitChainHead[:], encoded[8+IdentifierBytes+8:])
	if anchor.LedgerUUID == (Identifier{}) || anchor.CommitChainHead == (Identifier{}) {
		return Anchor{}, fail(ReasonProtectedLocalLedgerRollbackDetected, false, "repair_runtime_service", fmt.Errorf("decode macOS protected-local anchor: empty identity"))
	}
	return anchor, nil
}

func (store *macOSKeychainAnchorStore) Store(ctx context.Context, anchor Anchor) error {
	if anchor.LedgerUUID == (Identifier{}) || anchor.CommitChainHead == (Identifier{}) {
		return fail(ReasonProtectedLocalLedgerRollbackDetected, false, "repair_runtime_service", fmt.Errorf("encode macOS protected-local anchor: incomplete anchor"))
	}
	encoded := make([]byte, macOSAnchorEncodingBytes)
	copy(encoded[:8], "NIMIMA01")
	copy(encoded[8:8+IdentifierBytes], anchor.LedgerUUID[:])
	binary.BigEndian.PutUint64(encoded[8+IdentifierBytes:8+IdentifierBytes+8], anchor.CommitSequence)
	copy(encoded[8+IdentifierBytes+8:], anchor.CommitChainHead[:])
	defer zeroBytes(encoded)
	return store.secrets.Store(ctx, macOSLedgerAnchorSecretName, encoded)
}

func LoadMacOSLedgerRecordMACKey(ctx context.Context, secrets BinarySecretStore) ([]byte, error) {
	if secrets == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("load macOS ledger MAC key: custody is required"))
	}
	key, err := secrets.Load(ctx, macOSLedgerRecordMACKeyName)
	if errors.Is(err, ErrProtectedSecretNotFound) {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("load macOS ledger MAC key: installer-provisioned item is missing"))
	}
	if err != nil {
		return nil, err
	}
	if len(key) != macOSLedgerRecordMACKeyBytes {
		zeroBytes(key)
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("load macOS ledger MAC key: invalid size"))
	}
	return key, nil
}
