package connector

import (
	"errors"
	"sync"
)

var ErrProtectedConnectorCustodyRequired = errors.New("protected connector custody required")

type SecretStore interface {
	WriteSecret(connectorID string, payload string) error
	ReadSecret(connectorID string) (string, bool, error)
	DeleteSecret(connectorID string) error
}

type unavailableSecretStore struct{}

func newUnavailableSecretStore() SecretStore {
	return unavailableSecretStore{}
}

func (unavailableSecretStore) WriteSecret(string, string) error {
	return ErrProtectedConnectorCustodyRequired
}

func (unavailableSecretStore) ReadSecret(string) (string, bool, error) {
	return "", false, ErrProtectedConnectorCustodyRequired
}

func (unavailableSecretStore) DeleteSecret(string) error {
	return ErrProtectedConnectorCustodyRequired
}

type memorySecretStore struct {
	mu      sync.Mutex
	secrets map[string]string
}

func newMemorySecretStore() SecretStore {
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
