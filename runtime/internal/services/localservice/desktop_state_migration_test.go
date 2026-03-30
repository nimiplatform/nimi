package localservice

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestDesktopLocalRuntimeMigrationAdoptsManagedModelIntoRuntimeState(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	oldModelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	oldModelDir := filepath.Join(oldModelsRoot, "resolved", "nimi", "local-import-qwen")
	if err := os.MkdirAll(oldModelDir, 0o755); err != nil {
		t.Fatalf("mkdir old model dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(oldModelDir, "Qwen3-4B-Q4_K_M.gguf"), validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write gguf: %v", err)
	}
	manifestPayload := map[string]any{
		"model_id":         "local/local-import/Qwen3-4B-Q4_K_M",
		"logical_model_id": "nimi/local-import-qwen",
		"engine":           "llama",
		"entry":            "Qwen3-4B-Q4_K_M.gguf",
		"capabilities":     []string{"chat"},
		"source": map[string]any{
			"repo":     "local-import/qwen3-4b-q4-k-m",
			"revision": "import",
		},
		"integrity_mode": "local_unverified",
	}
	manifestRaw, err := json.Marshal(manifestPayload)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(oldModelDir, "manifest.json"), manifestRaw, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	statePath := filepath.Join(homeDir, ".nimi", "data", "state.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		t.Fatalf("mkdir state dir: %v", err)
	}
	desktopState := map[string]any{
		"version": 1,
		"models": []map[string]any{
			{
				"localModelId":   "file:local-import-qwen3-4b-q4-k-m",
				"modelId":        "local/local-import/Qwen3-4B-Q4_K_M",
				"logicalModelId": "nimi/local-import-qwen",
				"capabilities":   []string{"chat"},
				"engine":         "llama",
				"entry":          "Qwen3-4B-Q4_K_M.gguf",
				"files":          []string{"Qwen3-4B-Q4_K_M.gguf"},
				"license":        "unknown",
				"source": map[string]any{
					"repo":     "local-import/qwen3-4b-q4-k-m",
					"revision": "import",
				},
				"hashes":      map[string]string{},
				"endpoint":    "",
				"status":      "installed",
				"installedAt": "2026-03-29T12:00:00Z",
				"updatedAt":   "2026-03-29T12:00:00Z",
			},
		},
		"audits": []map[string]any{
			{
				"id":           "audit_desktop_import",
				"eventType":    "runtime_model_imported",
				"occurredAt":   "2026-03-29T12:00:01Z",
				"modelId":      "local/local-import/Qwen3-4B-Q4_K_M",
				"localModelId": "file:local-import-qwen3-4b-q4-k-m",
			},
		},
	}
	stateRaw, err := json.Marshal(desktopState)
	if err != nil {
		t.Fatalf("marshal desktop state: %v", err)
	}
	if err := os.WriteFile(statePath, stateRaw, 0o644); err != nil {
		t.Fatalf("write desktop state: %v", err)
	}

	svc, err := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, "", 0)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	t.Cleanup(func() { svc.Close() })

	resp, err := svc.ListLocalModels(context.Background(), &runtimev1.ListLocalModelsRequest{})
	if err != nil {
		t.Fatalf("list local models: %v", err)
	}
	if len(resp.GetModels()) != 1 {
		t.Fatalf("expected one migrated model, got %d", len(resp.GetModels()))
	}
	model := resp.GetModels()[0]
	if model.GetModelId() != "local/local-import/Qwen3-4B-Q4_K_M" {
		t.Fatalf("unexpected model id: %s", model.GetModelId())
	}
	if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("expected installed status after migration normalization, got %s", model.GetStatus())
	}
	if mode := svc.modelRuntimeMode(model.GetLocalModelId()); mode != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected supervised runtime mode, got %s", mode)
	}

	newManifestPath := filepath.Join(homeDir, ".nimi", "models", "resolved", "nimi", "local-import-qwen", "manifest.json")
	if _, err := os.Stat(newManifestPath); err != nil {
		t.Fatalf("expected migrated manifest under runtime models root: %v", err)
	}
	markerPath := filepath.Join(homeDir, ".nimi", "runtime", "desktop-local-runtime-migrated.v1")
	if _, err := os.Stat(markerPath); err != nil {
		t.Fatalf("expected migration marker: %v", err)
	}

	auditResp, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{})
	if err != nil {
		t.Fatalf("list local audits: %v", err)
	}
	if len(auditResp.GetEvents()) == 0 {
		t.Fatalf("expected migrated audit entries")
	}
}
