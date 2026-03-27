package connector

import (
	"errors"
	"fmt"
	"sync"

	keyring "github.com/zalando/go-keyring"
)

const (
	connectorSecretServicePrefix = "nimi/runtime/connector"
	connectorSecretAccount       = "api-key"
)

type connectorSecretStore interface {
	Write(connectorID string, apiKey string) error
	Read(connectorID string) (string, bool, error)
	Delete(connectorID string) error
}

type osKeychainSecretStore struct{}

func newOSKeychainSecretStore() connectorSecretStore {
	return osKeychainSecretStore{}
}

func (osKeychainSecretStore) Write(connectorID string, apiKey string) error {
	if err := keyring.Set(connectorSecretServiceName(connectorID), connectorSecretAccount, apiKey); err != nil {
		return fmt.Errorf("secure store write failed: %w", err)
	}
	return nil
}

func (osKeychainSecretStore) Read(connectorID string) (string, bool, error) {
	secret, err := keyring.Get(connectorSecretServiceName(connectorID), connectorSecretAccount)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("secure store read failed: %w", err)
	}
	return secret, true, nil
}

func (osKeychainSecretStore) Delete(connectorID string) error {
	err := keyring.Delete(connectorSecretServiceName(connectorID), connectorSecretAccount)
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("secure store delete failed: %w", err)
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

func (m *memorySecretStore) Write(connectorID string, apiKey string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.secrets[connectorID] = apiKey
	return nil
}

func (m *memorySecretStore) Read(connectorID string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	secret, ok := m.secrets[connectorID]
	return secret, ok, nil
}

func (m *memorySecretStore) Delete(connectorID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.secrets, connectorID)
	return nil
}

// NewConnectorStoreWithMemorySecrets is a test helper that avoids depending on the host OS keychain.
func NewConnectorStoreWithMemorySecrets(basePath string) *ConnectorStore {
	return newConnectorStore(basePath, newMemorySecretStore())
}
