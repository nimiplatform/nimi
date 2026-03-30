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

func TestInstallLocalModelDownloadFailureQuarantinesNewBundleWithoutDeletingDownloadedBytes(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
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
	_ = mustInstallAttachedLocalModel(t, svc, &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/manual-chat",
		Repo:         "owner/manual-chat",
		Revision:     "main",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Endpoint:     "http://127.0.0.1:11434/v1",
	})

	_, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
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
	if err == nil {
		t.Fatal("expected install local model to fail on duplicate registration")
	}

	modelDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), "nimi/local-manual-chat")
	if _, statErr := os.Stat(modelDir); !os.IsNotExist(statErr) {
		t.Fatalf("managed model dir should not remain after failed install, stat err=%v", statErr)
	}
	quarantineDirs := managedModelQuarantineDirsForTest(t, svc)
	if len(quarantineDirs) != 1 {
		t.Fatalf("expected one quarantine dir, got %d", len(quarantineDirs))
	}
	if _, statErr := os.Stat(filepath.Join(quarantineDirs[0], "model.gguf")); statErr != nil {
		t.Fatalf("quarantined bundle should retain downloaded model file: %v", statErr)
	}
	if len(svc.audits) == 0 || svc.audits[0].GetEventType() != "runtime_model_bundle_quarantined" {
		t.Fatalf("expected quarantine audit event, got %#v", svc.audits)
	}
}

func TestInstallLocalModelDownloadFailureRestoresExistingManagedBundle(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	oldBytes := []byte("old-managed-gguf")
	newBytes := []byte("new-managed-gguf")
	modelHash := sha256.Sum256(newBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/owner/manual-chat/resolve/main/model.gguf" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(newBytes)
	}))
	defer server.Close()

	svc := newTestService(t)
	svc.hfDownloadBaseURL = server.URL
	modelDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), "nimi/local-manual-chat")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatalf("mkdir model dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.gguf"), oldBytes, 0o644); err != nil {
		t.Fatalf("write old managed model: %v", err)
	}
	record := mustInstallAttachedLocalModel(t, svc, &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/manual-chat",
		Repo:         "owner/manual-chat",
		Revision:     "main",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Endpoint:     "http://127.0.0.1:11434/v1",
	})
	svc.rewriteManagedLocalModelSourceRepo(record.GetLocalModelId(), filepath.Join(modelDir, "manifest.json"))

	_, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
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
	if err == nil {
		t.Fatal("expected install local model to fail on duplicate registration")
	}

	currentBytes, readErr := os.ReadFile(filepath.Join(modelDir, "model.gguf"))
	if readErr != nil {
		t.Fatalf("read restored managed model: %v", readErr)
	}
	if string(currentBytes) != string(oldBytes) {
		t.Fatalf("existing managed bundle should be restored, got=%q want=%q", string(currentBytes), string(oldBytes))
	}
	quarantineDirs := managedModelQuarantineDirsForTest(t, svc)
	if len(quarantineDirs) != 1 {
		t.Fatalf("expected one quarantine dir, got %d", len(quarantineDirs))
	}
	quarantinedBytes, readErr := os.ReadFile(filepath.Join(quarantineDirs[0], "model.gguf"))
	if readErr != nil {
		t.Fatalf("read quarantined bundle: %v", readErr)
	}
	if string(quarantinedBytes) != string(newBytes) {
		t.Fatalf("expected quarantined new bundle bytes, got=%q want=%q", string(quarantinedBytes), string(newBytes))
	}
}
