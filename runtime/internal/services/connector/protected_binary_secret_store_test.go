package connector

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestProtectedBinarySecretStoreRoundTripsOpaqueConnectorPayload(t *testing.T) {
	binaryStore := newConnectorBinarySecretStore()
	store, err := NewProtectedBinarySecretStore(binaryStore)
	if err != nil {
		t.Fatalf("NewProtectedBinarySecretStore: %v", err)
	}
	connectorID := "provider-account-alpha"
	payload := "{\"apiKey\":\"sk-\x00-密钥\",\"header\":\"opaque\\nvalue\"}"
	if err := store.WriteSecret(connectorID, payload); err != nil {
		t.Fatalf("WriteSecret: %v", err)
	}
	if strings.Contains(binaryStore.lastStoreName, connectorID) || !strings.HasPrefix(binaryStore.lastStoreName, "conn-v1-") || len(binaryStore.lastStoreName) > 64 {
		t.Fatalf("connector logical name must be fixed, opaque, and Windows-store compatible: %q", binaryStore.lastStoreName)
	}
	loaded, ok, err := store.ReadSecret(connectorID)
	if err != nil {
		t.Fatalf("ReadSecret: %v", err)
	}
	if !ok || loaded != payload {
		t.Fatalf("opaque connector payload mismatch: ok=%v payload=%q", ok, loaded)
	}
	if protectedConnectorSecretName("provider-account-beta") == binaryStore.lastStoreName {
		t.Fatal("distinct connector IDs must not share a logical secret name")
	}
}

func TestProtectedBinarySecretStoreMapsMissingAndDeleteIdempotently(t *testing.T) {
	binaryStore := newConnectorBinarySecretStore()
	store, err := NewProtectedBinarySecretStore(binaryStore)
	if err != nil {
		t.Fatalf("NewProtectedBinarySecretStore: %v", err)
	}
	secret, ok, err := store.ReadSecret("missing-connector")
	if err != nil || ok || secret != "" {
		t.Fatalf("missing protected secret must map to connector absence: ok=%v secret=%q err=%v", ok, secret, err)
	}
	if err := store.DeleteSecret("missing-connector"); err != nil {
		t.Fatalf("delete of missing protected secret must be idempotent: %v", err)
	}
}

func TestProtectedBinarySecretStoreRejectsNilOrUnavailableCustody(t *testing.T) {
	if _, err := NewProtectedBinarySecretStore(nil); !errors.Is(err, ErrProtectedConnectorCustodyRequired) {
		t.Fatalf("nil protected store must fail closed: %v", err)
	}
	binaryStore := newConnectorBinarySecretStore()
	binaryStore.err = errors.New("synthetic protected store failure")
	store, err := NewProtectedBinarySecretStore(binaryStore)
	if err != nil {
		t.Fatalf("NewProtectedBinarySecretStore: %v", err)
	}
	if _, _, err := store.ReadSecret("connector-a"); !errors.Is(err, ErrProtectedConnectorCustodyRequired) {
		t.Fatalf("protected store failure must map to custody unavailable: %v", err)
	}
}

type connectorBinarySecretStore struct {
	values        map[string][]byte
	lastStoreName string
	err           error
}

func newConnectorBinarySecretStore() *connectorBinarySecretStore {
	return &connectorBinarySecretStore{values: map[string][]byte{}}
}

func (s *connectorBinarySecretStore) Load(_ context.Context, name string) ([]byte, error) {
	if s.err != nil {
		return nil, s.err
	}
	value, ok := s.values[name]
	if !ok {
		return nil, protectedlocal.ErrProtectedSecretNotFound
	}
	return append([]byte(nil), value...), nil
}

func (s *connectorBinarySecretStore) Store(_ context.Context, name string, value []byte) error {
	if s.err != nil {
		return s.err
	}
	s.lastStoreName = name
	s.values[name] = append([]byte(nil), value...)
	return nil
}

func (s *connectorBinarySecretStore) Delete(_ context.Context, name string) error {
	if s.err != nil {
		return s.err
	}
	if _, ok := s.values[name]; !ok {
		return protectedlocal.ErrProtectedSecretNotFound
	}
	delete(s.values, name)
	return nil
}
