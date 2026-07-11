package catalog

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveTextContextMetadataUsesCatalogCapacity(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	metadata, err := resolver.ResolveTextContextMetadataForSubject("", "local", "gemma-4-e2b-it-local")
	if err != nil {
		t.Fatalf("ResolveTextContextMetadataForSubject: %v", err)
	}
	if metadata.Provider != "local" || metadata.ModelID != "gemma-4-e2b-it-local" {
		t.Fatalf("resolved identity = %+v", metadata)
	}
	if metadata.ContextWindowTokens != 32768 {
		t.Fatalf("context window = %d, want 32768", metadata.ContextWindowTokens)
	}
	if metadata.CatalogVersion == "" || metadata.ModelRevision == "" {
		t.Fatalf("catalog identity incomplete: %+v", metadata)
	}
}

func TestEveryBuiltInRemoteTextModelHasCatalogContextCapacity(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	textModelCount := 0
	for _, provider := range resolver.ListProviders() {
		if provider.Provider == "local" {
			continue
		}
		models, _, listErr := resolver.ListModelsForProvider(provider.Provider)
		if listErr != nil {
			t.Fatalf("ListModelsForProvider(%s): %v", provider.Provider, listErr)
		}
		for _, model := range models {
			if !modelHasCapability(model, "text.generate") {
				if model.ContextWindowTokens != 0 {
					t.Fatalf("non-text model %s/%s carries context_window_tokens=%d", provider.Provider, model.ModelID, model.ContextWindowTokens)
				}
				continue
			}
			textModelCount++
			if model.ContextWindowTokens == 0 {
				t.Fatalf("text model %s/%s has no catalog-authored context_window_tokens", provider.Provider, model.ModelID)
			}
			metadata, resolveErr := resolver.ResolveTextContextMetadataForSubject("", provider.Provider, model.ModelID)
			if resolveErr != nil {
				t.Fatalf("ResolveTextContextMetadataForSubject(%s/%s): %v", provider.Provider, model.ModelID, resolveErr)
			}
			if metadata.ContextWindowTokens != model.ContextWindowTokens {
				t.Fatalf("resolved capacity for %s/%s = %d, catalog row = %d", provider.Provider, model.ModelID, metadata.ContextWindowTokens, model.ContextWindowTokens)
			}
		}
	}
	if textModelCount == 0 {
		t.Fatal("expected built-in remote text.generate rows")
	}
}

func TestResolveTextContextMetadataUsesRealCloudCatalogCapacity(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	metadata, err := resolver.ResolveTextContextMetadataForSubject("", "openai", "gpt-5.5")
	if err != nil {
		t.Fatalf("ResolveTextContextMetadataForSubject: %v", err)
	}
	if metadata.Provider != "openai" || metadata.ModelID != "gpt-5.5" {
		t.Fatalf("resolved cloud identity = %+v", metadata)
	}
	if metadata.ContextWindowTokens != 8192 {
		t.Fatalf("cloud context window = %d, want conservative catalog floor 8192", metadata.ContextWindowTokens)
	}
	if metadata.CatalogVersion == "" || metadata.ModelRevision == "" {
		t.Fatalf("cloud catalog identity incomplete: %+v", metadata)
	}
}

func TestResolveTextContextMetadataPreservesSourceModelOverrides(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	tests := []struct {
		provider string
		model    string
		want     uint64
	}{
		{provider: "stepfun", model: "step-1-8k", want: 8192},
		{provider: "stepfun", model: "step-2-16k", want: 16384},
		{provider: "qianfan", model: "ernie-4.5-turbo-32k", want: 32768},
		{provider: "volcengine", model: "doubao-1.5-pro", want: 262144},
	}
	for _, tt := range tests {
		t.Run(tt.provider+"/"+tt.model, func(t *testing.T) {
			metadata, resolveErr := resolver.ResolveTextContextMetadataForSubject("", tt.provider, tt.model)
			if resolveErr != nil {
				t.Fatalf("ResolveTextContextMetadataForSubject: %v", resolveErr)
			}
			if metadata.ContextWindowTokens != tt.want {
				t.Fatalf("context window = %d, want %d", metadata.ContextWindowTokens, tt.want)
			}
		})
	}
}

func TestResolveTextContextMetadataFailsClosedWithoutCatalogCapacity(t *testing.T) {
	customDir := t.TempDir()
	fixture := []byte(`version: 1
provider: openai
catalog_version: missing-context-fixture-v1
inventory_mode: static_source
models:
  - model_id: missing-context-fixture
    provider: openai
    model_type: chat
    updated_at: 2026-07-11
    capabilities: [text.generate]
    fitness:
      context_length: 8192
    pricing:
      unit: token
      input: unknown
      output: unknown
      currency: USD
      as_of: 2026-07-11
      notes: Test-only remote overlay row intentionally missing the remote context authority while forging local-only fitness metadata.
    source_ref:
      url: https://example.invalid/missing-context-fixture
      retrieved_at: 2026-07-11
      note: Test-only fixture.
voices: []
`)
	if err := os.WriteFile(filepath.Join(customDir, "openai.yaml"), fixture, 0o600); err != nil {
		t.Fatalf("write missing-capacity fixture: %v", err)
	}

	resolver, err := NewResolver(ResolverConfig{CustomDir: customDir})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveTextContextMetadataForSubject("", "openai", "missing-context-fixture")
	if !errors.Is(err, ErrModelContextWindowUnavailable) {
		t.Fatalf("expected remote fitness.context_length to remain inadmissible and return ErrModelContextWindowUnavailable, got %v", err)
	}
}
