package connector

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

const protectedConnectorNameDomain = "nimi.runtime.connector.custody.v1"

type protectedBinarySecretStore struct {
	secrets protectedlocal.BinarySecretStore
}

// NewProtectedBinarySecretStore adapts an already-verified Runtime-private
// binary store to connector custody without introducing a path, environment,
// keyring, or portable credential fallback.
func NewProtectedBinarySecretStore(secrets protectedlocal.BinarySecretStore) (SecretStore, error) {
	if secrets == nil {
		return nil, ErrProtectedConnectorCustodyRequired
	}
	return &protectedBinarySecretStore{secrets: secrets}, nil
}

func (store *protectedBinarySecretStore) WriteSecret(connectorID string, payload string) error {
	name, err := resolveProtectedConnectorSecretName(connectorID)
	if err != nil {
		return err
	}
	if payload == "" {
		return protectedConnectorStoreError("store", errors.New("empty connector secret payload"))
	}
	secret := []byte(payload)
	defer zeroProtectedConnectorBytes(secret)
	if err := store.secrets.Store(context.Background(), name, secret); err != nil {
		return protectedConnectorStoreError("store", err)
	}
	return nil
}

func (store *protectedBinarySecretStore) ReadSecret(connectorID string) (string, bool, error) {
	name, err := resolveProtectedConnectorSecretName(connectorID)
	if err != nil {
		return "", false, err
	}
	secret, err := store.secrets.Load(context.Background(), name)
	if errors.Is(err, protectedlocal.ErrProtectedSecretNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, protectedConnectorStoreError("load", err)
	}
	defer zeroProtectedConnectorBytes(secret)
	if len(secret) == 0 {
		return "", false, protectedConnectorStoreError("load", errors.New("empty connector secret payload"))
	}
	return string(secret), true, nil
}

func (store *protectedBinarySecretStore) DeleteSecret(connectorID string) error {
	name, err := resolveProtectedConnectorSecretName(connectorID)
	if err != nil {
		return err
	}
	if err := store.secrets.Delete(context.Background(), name); err != nil && !errors.Is(err, protectedlocal.ErrProtectedSecretNotFound) {
		return protectedConnectorStoreError("delete", err)
	}
	return nil
}

func resolveProtectedConnectorSecretName(connectorID string) (string, error) {
	normalized := strings.TrimSpace(connectorID)
	if normalized == "" {
		return "", protectedConnectorStoreError("resolve connector", errors.New("connector id is empty"))
	}
	return protectedConnectorSecretName(normalized), nil
}

func protectedConnectorSecretName(connectorID string) string {
	digest := sha256.Sum256([]byte(protectedConnectorNameDomain + "\x00" + strings.TrimSpace(connectorID)))
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(digest[:])
	return "conn-v1-" + strings.ToLower(encoded)
}

func protectedConnectorStoreError(operation string, err error) error {
	return fmt.Errorf("%w: protected connector custody %s: %w", ErrProtectedConnectorCustodyRequired, operation, err)
}

func zeroProtectedConnectorBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
