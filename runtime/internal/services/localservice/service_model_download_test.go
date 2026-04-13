package localservice

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestInstallManagedDownloadedModelInfersEmbeddingKindWhenUnspecified(t *testing.T) {
	svc := newTestService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Qwen/Qwen3-Embedding-8B-GGUF/resolve/main/Qwen3-Embedding-8B-Q4_K_M.gguf" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(validTestGGUF())
	}))
	defer server.Close()

	svc.hfDownloadBaseURL = server.URL

	record, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID:      "local/qwen3-embedding-8b",
		kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		capabilities: []string{"text.embed"},
		engine:       "llama",
		entry:        "Qwen3-Embedding-8B-Q4_K_M.gguf",
		files:        []string{"Qwen3-Embedding-8B-Q4_K_M.gguf"},
		license:      "apache-2.0",
		repo:         "Qwen/Qwen3-Embedding-8B-GGUF",
		revision:     "main",
		hashes:       map[string]string{},
		mode:         runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
	})
	if err != nil {
		t.Fatalf("installManagedDownloadedModel: %v", err)
	}
	if got := record.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING {
		t.Fatalf("record kind mismatch: got=%s want=%s", got, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING)
	}
	if got := record.GetCapabilities(); len(got) != 1 || got[0] != "text.embed" {
		t.Fatalf("record capabilities mismatch: %#v", got)
	}

	manifestPath := runtimeManagedAssetManifestPath(
		resolveLocalModelsPath(svc.localModelsPath),
		filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local/qwen3-embedding-8b"))),
	)
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if want := []byte(`"kind": "embedding"`); !bytes.Contains(raw, want) {
		t.Fatalf("manifest kind missing embedding token: %s", string(raw))
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(manifestPath), "Qwen3-Embedding-8B-Q4_K_M.gguf")); err != nil {
		t.Fatalf("managed embedding file missing: %v", err)
	}
}
