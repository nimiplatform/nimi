package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestInstallVerifiedModelDownloadsManagedBundle(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelBytes := []byte("verified-gguf")
	modelHash := sha256.Sum256(modelBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/nimiplatform/demo-verified/resolve/main/model.gguf" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(modelBytes)
	}))
	defer server.Close()

	svc := newTestService(t)
	svc.hfDownloadBaseURL = server.URL
	svc.verified = []*runtimev1.LocalVerifiedModelDescriptor{
		{
			TemplateId:     "verified.chat.demo",
			Title:          "Demo Verified",
			ModelId:        "local/demo-verified",
			LogicalModelId: "nimi/demo-verified",
			Repo:           "nimiplatform/demo-verified",
			Revision:       "main",
			Capabilities:   []string{"chat"},
			Engine:         "llama",
			Entry:          "model.gguf",
			Files:          []string{"model.gguf"},
			License:        "apache-2.0",
			Hashes: map[string]string{
				"model.gguf": "sha256:" + hex.EncodeToString(modelHash[:]),
			},
		},
	}

	resp, err := svc.InstallVerifiedModel(context.Background(), &runtimev1.InstallVerifiedModelRequest{
		TemplateId: "verified.chat.demo",
	})
	if err != nil {
		t.Fatalf("install verified model: %v", err)
	}
	model := resp.GetModel()
	if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("status = %s", model.GetStatus())
	}
	modelDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), "nimi/demo-verified")
	modelPath := filepath.Join(modelDir, "model.gguf")
	manifestPath := filepath.Join(modelDir, "manifest.json")
	if _, err := os.Stat(modelPath); err != nil {
		t.Fatalf("expected downloaded model at %s: %v", modelPath, err)
	}
	manifestRaw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	if got := manifest["integrity_mode"]; got != "verified" {
		t.Fatalf("integrity_mode = %#v", got)
	}
	transfers, err := svc.ListLocalTransfers(context.Background(), &runtimev1.ListLocalTransfersRequest{})
	if err != nil {
		t.Fatalf("list transfers: %v", err)
	}
	if len(transfers.GetTransfers()) == 0 {
		t.Fatal("expected download transfer session")
	}
	transfer := transfers.GetTransfers()[0]
	if transfer.GetSessionKind() != "download" {
		t.Fatalf("sessionKind = %q", transfer.GetSessionKind())
	}
	if transfer.GetState() != "completed" {
		t.Fatalf("state = %q", transfer.GetState())
	}
	if transfer.GetLocalModelId() != model.GetLocalModelId() {
		t.Fatalf("localModelId = %q want %q", transfer.GetLocalModelId(), model.GetLocalModelId())
	}
}

func TestInstallLocalModelDownloadsManagedBundleWhenSupervised(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelBytes := []byte("manual-gguf")
	modelHash := sha256.Sum256(modelBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/owner/manual-chat/resolve/main/model.gguf" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(modelBytes)
	}))
	defer server.Close()

	svc := newTestService(t)
	svc.hfDownloadBaseURL = server.URL

	resp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/manual-chat",
		Repo:         "owner/manual-chat",
		Revision:     "main",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf"},
		License:      "apache-2.0",
		Hashes: map[string]string{
			"model.gguf": "sha256:" + hex.EncodeToString(modelHash[:]),
		},
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if resp.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("status = %s", resp.GetModel().GetStatus())
	}
	modelDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), "nimi/local-manual-chat")
	if _, err := os.Stat(filepath.Join(modelDir, "model.gguf")); err != nil {
		t.Fatalf("expected downloaded model file: %v", err)
	}
}
