package modelregistry

import (
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRegistrySaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "model-registry.json")

	registry := New()
	now := time.Now().UTC().Round(time.Millisecond)
	registry.Upsert(Entry{
		ModelID:      "qwen-max",
		Version:      "v1",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate", "text.embed"},
		LastHealthAt: now,
		Source:       "alibaba",
		ProviderHint: ProviderHintAlibaba,
	})
	registry.Upsert(Entry{
		ModelID:      "deepseek-v3",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		Source:       "bytedance",
		ProviderHint: ProviderHintBytedance,
	})

	if err := registry.SaveToFile(path); err != nil {
		t.Fatalf("save registry: %v", err)
	}

	loaded, err := NewFromFile(path)
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}

	item, exists := loaded.Get("qwen-max")
	if !exists {
		t.Fatalf("qwen-max must exist")
	}
	if item.ProviderHint != ProviderHintAlibaba {
		t.Fatalf("provider hint mismatch: got=%s", item.ProviderHint)
	}
	if item.LastHealthAt.IsZero() {
		t.Fatalf("last health must be restored")
	}

	item, exists = loaded.Get("deepseek-v3")
	if !exists {
		t.Fatalf("deepseek-v3 must exist")
	}
	if item.ProviderHint != ProviderHintBytedance {
		t.Fatalf("provider hint mismatch: got=%s", item.ProviderHint)
	}
}
