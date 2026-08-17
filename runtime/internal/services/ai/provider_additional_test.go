package ai

import (
	"io"
	"log/slog"
	"os"
	"testing"

	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestServicePublicSettersAndAccessors(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	if svc.CloudProvider() == nil {
		t.Fatalf("cloud provider accessor should return non-nil")
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

	_, err := New(logger, nil, nil, runtimecfg.Config{
		ModelCatalogCustomDir: invalidPath,
	})
	if err == nil {
		t.Fatal("expected custom speech catalog init failure")
	}
}
