package connector

import (
	"errors"
	"fmt"
	"sync"

	keyring "github.com/zalando/go-keyring"
)

const (
	connectorSecretServicePrefix = "nimi/runtime/connector"
	connectorSecretAccount       = "credential-payload"
	legacyConnectorSecretAccount = "api-key"
)

type connectorSecretStore interface {
	WriteSecret(connectorID string, payload string) error
	ReadSecret(connectorID string) (string, bool, error)
	DeleteSecret(connectorID string) error
}

type osKeychainSecretStore struct{}

func newOSKeychainSecretStore() connectorSecretStore {
	return osKeychainSecretStore{}
}

func (osKeychainSecretStore) WriteSecret(connectorID string, payload string) error {
	if err := keyring.Set(connectorSecretServiceName(connectorID), connectorSecretAccount, payload); err != nil {
		return fmt.Errorf("secure store write failed: %w", err)
	}
	return nil
}

func (osKeychainSecretStore) ReadSecret(connectorID string) (string, bool, error) {
	secret, err := keyring.Get(connectorSecretServiceName(connectorID), connectorSecretAccount)
	if err != nil {
		if !errors.Is(err, keyring.ErrNotFound) {
			return "", false, fmt.Errorf("secure store read failed: %w", err)
		}
		legacySecret, legacyErr := keyring.Get(connectorSecretServiceName(connectorID), legacyConnectorSecretAccount)
		if legacyErr != nil {
			if errors.Is(legacyErr, keyring.ErrNotFound) {
				return "", false, nil
			}
			return "", false, fmt.Errorf("secure store read failed: %w", legacyErr)
		}
		return legacySecret, true, nil
	}
	return secret, true, nil
}

func (osKeychainSecretStore) DeleteSecret(connectorID string) error {
	err := keyring.Delete(connectorSecretServiceName(connectorID), connectorSecretAccount)
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("secure store delete failed: %w", err)
	}
	legacyErr := keyring.Delete(connectorSecretServiceName(connectorID), legacyConnectorSecretAccount)
	if legacyErr != nil && !errors.Is(legacyErr, keyring.ErrNotFound) {
		return fmt.Errorf("secure store delete failed: %w", legacyErr)
	}
	return nil
}

func connectorSecretServiceName(connectorID string) string {
	return connectorSecretServicePrefix + "/" + connectorID
}

type memorySecretStore struct {
	mu      sync.Mutex
	secrets map[string]string
}

func newMemorySecretStore() connectorSecretStore {
	return &memorySecretStore{secrets: make(map[string]string)}
}

func (m *memorySecretStore) WriteSecret(connectorID string, payload string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.secrets[connectorID] = payload
	return nil
}

func (m *memorySecretStore) ReadSecret(connectorID string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	secret, ok := m.secrets[connectorID]
	return secret, ok, nil
}

func (m *memorySecretStore) DeleteSecret(connectorID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.secrets, connectorID)
	return nil
}

// NewConnectorStoreWithMemorySecrets is a test helper that avoids depending on the host OS keychain.
func NewConnectorStoreWithMemorySecrets(basePath string) *ConnectorStore {
	return newConnectorStore(basePath, newMemorySecretStore())
}
