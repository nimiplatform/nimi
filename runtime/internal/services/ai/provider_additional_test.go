package ai

import (
	"io"
	"log/slog"
	"os"
	"testing"

	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func TestServicePublicSettersAndAccessors(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	constructed, err := New(logger, nil, nil, nil, nil, runtimecfg.Config{})
	if err != nil {
		t.Fatalf("New should not fail with default config: %v", err)
	}
	if constructed == nil {
		t.Fatalf("New should return service instance")
	}
	svc := newTestService(logger)
	if svc.CloudProvider() == nil {
		t.Fatalf("cloud provider accessor should return non-nil")
	}
	if err := constructed.RebindNonProductionConnectorStore(connectorStore); err != nil {
		t.Fatalf("rebind non-production connector store: %v", err)
	}
	if constructed.connStore != connectorStore || constructed.remoteTextHost == nil || constructed.remoteEmbedHost == nil || constructed.remoteMediaHost == nil {
		t.Fatalf("connector store rebind did not rebuild all remote Hosts")
	}
	if svc.SpeechCatalogResolver() == nil {
		t.Fatalf("speech catalog resolver should return non-nil")
	}
}

func TestNewFailsOnInvalidCustomSpeechCatalog(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	invalidDir := t.TempDir()
	invalidPath := invalidDir + ".file"
	if err := os.WriteFile(invalidPath, []byte("not-a-directory"), 0o600); err != nil {
		t.Fatalf("seed invalid custom dir path: %v", err)
	}

	_, err := New(logger, nil, nil, nil, nil, runtimecfg.Config{
		ModelCatalogCustomDir: invalidPath,
	})
	if err == nil {
		t.Fatal("expected custom speech catalog init failure")
	}
}
