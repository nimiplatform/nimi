package localservice

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestHealMissingMmprojEngineConfig(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	bundleRoot := filepath.Join(modelsRoot, "resolved", "nimi", "gemma-test")
	if err := os.MkdirAll(bundleRoot, 0o755); err != nil {
		t.Fatalf("mkdir bundle root: %v", err)
	}
	entryPath := filepath.Join(bundleRoot, "model.gguf")
	if err := os.WriteFile(entryPath, []byte("GGUF-entry"), 0o600); err != nil {
		t.Fatalf("write entry: %v", err)
	}
	mmprojPath := filepath.Join(bundleRoot, "mmproj-BF16.gguf")
	if err := os.WriteFile(mmprojPath, []byte("GGUF-mmproj"), 0o600); err != nil {
		t.Fatalf("write mmproj: %v", err)
	}

	record := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "local-asset-1",
		AssetId:        "local-import/gemma-test",
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Engine:         "llama",
		Entry:          "model.gguf",
		Files:          []string{"model.gguf"},
		Capabilities:   []string{"text.generate", "text.generate.vision"},
		LogicalModelId: "nimi/gemma-test",
		Source: &runtimev1.LocalAssetSource{
			Repo:     "file://" + filepath.ToSlash(filepath.Join(bundleRoot, "asset.manifest.json")),
			Revision: "local",
		},
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if healed := healMissingMmprojEngineConfig(modelsRoot, record, logger); !healed {
		t.Fatal("expected mmproj self-heal to update record")
	}
	if got := normalizeStringSlice(record.GetFiles()); len(got) != 2 || !stringSlicesEqual(got, []string{"mmproj-BF16.gguf", "model.gguf"}) {
		t.Fatalf("record files = %v, want bundle to include entry and mmproj", got)
	}
	cfg, err := engine.ExtractManagedLlamaEngineConfig(record.GetEngineConfig())
	if err != nil {
		t.Fatalf("extract healed engine config: %v", err)
	}
	if got, want := cfg.Mmproj, "resolved/nimi/gemma-test/mmproj-BF16.gguf"; got != want {
		t.Fatalf("healed mmproj = %q, want %q", got, want)
	}
}
