package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/types/known/structpb"
)

type registrarTestEngineManager struct {
	statusErr error
	stopErr   error
	startErr  error

	startCalls int
	stopCalls  int
}

func (m *registrarTestEngineManager) ListEngines() []EngineInfo {
	return []EngineInfo{}
}

func (m *registrarTestEngineManager) EnsureEngine(_ context.Context, _ string, _ string) error {
	return nil
}

func (m *registrarTestEngineManager) StartEngine(_ context.Context, _ string, _ int, _ string) error {
	m.startCalls++
	return m.startErr
}

func (m *registrarTestEngineManager) StartEngineWithConfig(_ context.Context, _ engine.EngineConfig) error {
	m.startCalls++
	return m.startErr
}

func (m *registrarTestEngineManager) StopEngine(_ string) error {
	m.stopCalls++
	return m.stopErr
}

func (m *registrarTestEngineManager) EngineStatus(_ string) (EngineInfo, error) {
	if m.statusErr != nil {
		return EngineInfo{}, m.statusErr
	}
	return EngineInfo{
		Engine:   "llama",
		Version:  engine.DefaultLlamaConfig().Version,
		Status:   "healthy",
		Port:     1234,
		Endpoint: "http://127.0.0.1:1234",
	}, nil
}

func TestLocalStartLocalModelRequiresExactManagedLlamaModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"other-model"}]}`))
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/expected-model",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected UNHEALTHY, got %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), `missing expected model "expected-model"`) {
		t.Fatalf("expected exact-model mismatch detail, got %q", started.GetAsset().GetHealthDetail())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "available_models=other-model") {
		t.Fatalf("expected available model listing, got %q", started.GetAsset().GetHealthDetail())
	}
}

func TestWaitForManagedEnginePortReleaseWaitsUntilLoopbackPortIsFree(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	time.AfterFunc(200*time.Millisecond, func() {
		_ = ln.Close()
	})

	startedAt := time.Now()
	if err := waitForManagedEnginePortRelease(context.Background(), port, 2*time.Second); err != nil {
		t.Fatalf("waitForManagedEnginePortRelease: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed < 150*time.Millisecond {
		t.Fatalf("expected wait to observe delayed release, elapsed=%s", elapsed)
	}
}

func TestWaitForManagedEnginePortReleaseTimesOutWhenPortStaysOccupied(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	port := ln.Addr().(*net.TCPAddr).Port
	err = waitForManagedEnginePortRelease(context.Background(), port, 250*time.Millisecond)
	if err == nil {
		t.Fatal("expected occupied port to time out")
	}
	if !strings.Contains(err.Error(), "remained unavailable") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSyncManagedLlamaAssetsWritesConfigAndRestartsOnlyOnChange(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	mgr := &registrarTestEngineManager{statusErr: errors.New("engine llama not started")}
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetEngineManager(mgr)

	writeManagedLlamaManifest(t, modelsPath, "local/test-chat", "./weights/model.gguf", []string{"chat"})
	first := installManagedLlamaModelForRegistrarTest(t, svc, "local/test-chat", "./weights/model.gguf", []string{"chat"}, "", nil)

	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	configText := string(raw)
	for _, want := range []string{
		"version = 1",
		"[test-chat]",
		"model = " + filepath.Join(modelsPath, "resolved", "nimi", "local-test-chat", "weights", "model.gguf"),
		"load-on-startup = true",
	} {
		if !strings.Contains(configText, want) {
			t.Fatalf("expected managed llama preset to contain %q, got:\n%s", want, configText)
		}
	}
	if mgr.startCalls != 0 || mgr.stopCalls != 0 {
		t.Fatalf("expected no restart while engine is not started, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	mgr.statusErr = nil
	writeManagedLlamaManifest(t, modelsPath, "local/second-chat", "./weights/model-2.gguf", []string{"chat"})
	second := installManagedLlamaModelForRegistrarTest(t, svc, "local/second-chat", "./weights/model-2.gguf", []string{"chat"}, "", nil)
	if mgr.startCalls != 1 || mgr.stopCalls != 1 {
		t.Fatalf("expected one controlled restart on config change, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
		t.Fatalf("sync llama assets without changes: %v", err)
	}
	if mgr.startCalls != 1 || mgr.stopCalls != 1 {
		t.Fatalf("expected no restart when config fingerprint is unchanged, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	if _, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{
		LocalAssetId: second.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("remove managed local model: %v", err)
	}
	if mgr.startCalls != 2 || mgr.stopCalls != 2 {
		t.Fatalf("expected second controlled restart after removal, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	remainingRaw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read generated config after removal: %v", err)
	}
	remainingText := string(remainingRaw)
	if !strings.Contains(remainingText, "[test-chat]") || strings.Contains(remainingText, "[second-chat]") {
		t.Fatalf("expected only first model to remain after removal, got:\n%s", remainingText)
	}

	if first.GetLocalAssetId() == "" {
		t.Fatalf("expected non-empty first local model id")
	}
}

func TestSetManagedSpeechEndpointSyncsSupervisedSpeechProjection(t *testing.T) {
	svc := newTestService(t)

	supervised := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-managed",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
	})
	attached := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-attached",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		endpoint:     "https://speech.example.com/v1",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-speech-supervised",
		Engine:       "speech",
		Capabilities: []string{"audio.synthesize"},
		LocalModelId: supervised.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install supervised speech service: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-speech-attached",
		Engine:       "speech",
		Capabilities: []string{"audio.synthesize"},
		LocalModelId: attached.GetLocalAssetId(),
		Endpoint:     "https://speech.example.com/v1",
	}); err != nil {
		t.Fatalf("install attached speech service: %v", err)
	}

	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	supervisedModel := svc.modelByID(supervised.GetLocalAssetId())
	if supervisedModel == nil {
		t.Fatal("expected supervised speech model to exist")
	}
	if got := supervisedModel.GetEndpoint(); got != "http://127.0.0.1:18330/v1" {
		t.Fatalf("supervised speech model endpoint = %q", got)
	}

	attachedModel := svc.modelByID(attached.GetLocalAssetId())
	if attachedModel == nil {
		t.Fatal("expected attached speech model to exist")
	}
	if got := attachedModel.GetEndpoint(); got != "https://speech.example.com/v1" {
		t.Fatalf("attached speech model endpoint must stay explicit, got %q", got)
	}

	supervisedService := svc.serviceByID("svc-speech-supervised")
	if supervisedService == nil {
		t.Fatal("expected supervised speech service to exist")
	}
	if got := supervisedService.GetEndpoint(); got != "http://127.0.0.1:18330/v1" {
		t.Fatalf("supervised speech service endpoint = %q", got)
	}

	attachedService := svc.serviceByID("svc-speech-attached")
	if attachedService == nil {
		t.Fatal("expected attached speech service to exist")
	}
	if got := attachedService.GetEndpoint(); got != "https://speech.example.com/v1" {
		t.Fatalf("attached speech service endpoint must stay explicit, got %q", got)
	}
}

func TestSyncManagedLlamaAssetsSkipsExternalEndpointOnlyModels(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	mgr := &registrarTestEngineManager{}
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetEngineManager(mgr)

	if _, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/external-only",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "https://example.com/v1",
	}); err != nil {
		t.Fatalf("install external llama model: %v", err)
	}

	if _, err := os.Stat(configPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected no generated config for external endpoint model, stat err=%v", err)
	}
	if mgr.startCalls != 0 || mgr.stopCalls != 0 {
		t.Fatalf("expected no restart for external endpoint model, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}
}

func TestBuildManagedLlamaRegistrationsRejectsManagedNameConflicts(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)

	writeManagedLlamaManifest(t, modelsPath, "local/conflict-model", "./weights/model-a.gguf", []string{"chat"})
	writeManagedLlamaManifest(t, modelsPath, "llama/conflict-model", "./weights/model-b.gguf", []string{"chat"})
	firstManifestPath := filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID("local/conflict-model"), "asset.manifest.json")
	secondManifestPath := filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID("llama/conflict-model"), "asset.manifest.json")
	first := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "local-conflict-a",
		AssetId:        "local/conflict-model",
		LogicalModelId: "nimi/" + slugifyLocalModelID("local/conflict-model"),
		Capabilities:   []string{"chat"},
		Engine:         "llama",
		Entry:          "./weights/model-a.gguf",
		License:        "apache-2.0",
		Source:         &runtimev1.LocalAssetSource{Repo: "file://" + filepath.ToSlash(firstManifestPath), Revision: "local"},
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		InstalledAt:    nowISO(),
		UpdatedAt:      nowISO(),
	}
	second := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "local-conflict-b",
		AssetId:        "llama/conflict-model",
		LogicalModelId: "nimi/" + slugifyLocalModelID("llama/conflict-model"),
		Capabilities:   []string{"chat"},
		Engine:         "llama",
		Entry:          "./weights/model-b.gguf",
		License:        "apache-2.0",
		Source:         &runtimev1.LocalAssetSource{Repo: "file://" + filepath.ToSlash(secondManifestPath), Revision: "local"},
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		InstalledAt:    nowISO(),
		UpdatedAt:      nowISO(),
	}
	svc.assets[first.GetLocalAssetId()] = first
	svc.assets[second.GetLocalAssetId()] = second
	svc.setModelRuntimeModeLocked(first.GetLocalAssetId(), runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	svc.setModelRuntimeModeLocked(second.GetLocalAssetId(), runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)

	registrations, rendered, err := svc.buildManagedLlamaRegistrations()
	if err != nil {
		t.Fatalf("build llama registrations: %v", err)
	}
	if !strings.Contains(registrations[first.GetLocalAssetId()].Problem, "name conflict") {
		t.Fatalf("expected first registration conflict problem, got %+v", registrations[first.GetLocalAssetId()])
	}
	if !strings.Contains(registrations[second.GetLocalAssetId()].Problem, "name conflict") {
		t.Fatalf("expected second registration conflict problem, got %+v", registrations[second.GetLocalAssetId()])
	}

	if strings.TrimSpace(string(rendered)) != "" {
		t.Fatalf("expected no rendered config entries after name conflict, got %q", string(rendered))
	}
}

func TestManagedImageBackendPlatformSupport(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "daemon-managed image backend active")

	modelID := "local/image-model"
	writeManagedLlamaManifest(t, modelsPath, modelID, "./weights/image-model.gguf", []string{"image"})
	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      modelID,
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "./weights/image-model.gguf",
		repo:         "file://" + filepath.ToSlash(filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")),
		revision:     "local",
	})
	svc.mu.Lock()
	stored := cloneLocalAsset(svc.assets[installed.GetLocalAssetId()])
	stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
	svc.assets[installed.GetLocalAssetId()] = stored
	svc.mu.Unlock()

	registration := svc.managedLlamaRegistrationForModel(installed)
	if registration.Managed {
		t.Fatalf("image assets must not register with llama control plane anymore: %+v", registration)
	}
}

func TestBuildManagedLlamaRegistrationsExcludesManagedMediaImageAssets(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "daemon-managed image backend active")

	modelID := "local/image-media-model"
	writeManagedLlamaManifest(t, modelsPath, modelID, "./weights/image-model.gguf", []string{"image"})
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	record := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      modelID,
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "./weights/image-model.gguf",
		repo:         "file://" + filepath.ToSlash(filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")),
		revision:     "local",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	stored := cloneLocalAsset(svc.assets[record.GetLocalAssetId()])
	stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
	stored.PreferredEngine = "llama"
	svc.assets[record.GetLocalAssetId()] = stored
	svc.mu.Unlock()

	registrations, rendered, err := svc.buildManagedLlamaRegistrations()
	if err != nil {
		t.Fatalf("build managed llama registrations: %v", err)
	}
	if _, ok := registrations[record.GetLocalAssetId()]; ok {
		t.Fatalf("image asset must not appear in managed llama registrations: %+v", registrations[record.GetLocalAssetId()])
	}
	if len(rendered) != 0 {
		t.Fatalf("image assets should not be rendered into static llama config")
	}
}

func TestManagedLlamaModelProbeSucceededForDynamicProfileWhenEndpointResponds(t *testing.T) {
	registration := managedLlamaRegistration{
		Backend:        "stablediffusion-ggml",
		DynamicProfile: true,
	}
	probe := endpointProbeResult{
		healthy:   false,
		responded: true,
		detail:    "probe response missing valid models",
	}
	if !managedLlamaModelProbeSucceeded(probe, registration) {
		t.Fatalf("dynamic profile should be considered healthy when llama endpoint responds")
	}
}

func TestManagedLlamaRegistrationForManagedImageStaysDetachedFromLlama(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")

	modelID := "local/image-model"
	writeManagedLlamaManifest(t, modelsPath, modelID, "./weights/image-model.gguf", []string{"image"})
	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      modelID,
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "./weights/image-model.gguf",
		repo:         "file://" + filepath.ToSlash(filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")),
		revision:     "local",
	})
	svc.mu.Lock()
	stored := cloneLocalAsset(svc.assets[installed.GetLocalAssetId()])
	stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
	svc.assets[installed.GetLocalAssetId()] = stored
	svc.mu.Unlock()

	if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
		t.Fatalf("sync managed llama assets: %v", err)
	}
	stale := svc.managedLlamaRegistrations[installed.GetLocalAssetId()]
	if stale.Managed {
		t.Fatalf("managed image should not be cached as llama registration, got %+v", stale)
	}

	svc.SetManagedImageBackendHealth(true, "daemon-managed image backend active")

	registration := svc.managedLlamaRegistrationForModel(installed)
	if registration.Managed {
		t.Fatalf("managed image should remain detached from llama after backend recovery, got %+v", registration)
	}
}

func installManagedLlamaModelForRegistrarTest(t *testing.T, svc *Service, modelID string, entry string, capabilities []string, endpoint string, engineConfig *structpb.Struct) *runtimev1.LocalAssetRecord {
	t.Helper()
	req := installLocalAssetParams{
		assetID:      modelID,
		capabilities: capabilities,
		engine:       "llama",
		entry:        entry,
		endpoint:     endpoint,
		engineConfig: engineConfig,
	}
	if strings.TrimSpace(endpoint) == "" {
		record := mustInstallSupervisedLocalModel(t, svc, req)
		manifestPath := filepath.Join(modelsPathForRegistrarTest(svc), "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")
		svc.mu.Lock()
		stored := cloneLocalAsset(svc.assets[record.GetLocalAssetId()])
		stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
		if stored.Source == nil {
			stored.Source = &runtimev1.LocalAssetSource{}
		}
		stored.Source.Repo = "file://" + filepath.ToSlash(manifestPath)
		if strings.TrimSpace(stored.Source.GetRevision()) == "" {
			stored.Source.Revision = "local"
		}
		svc.assets[record.GetLocalAssetId()] = stored
		svc.mu.Unlock()
		if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
			t.Fatalf("sync managed llama assets after manifest rewrite: %v", err)
		}
		return cloneLocalAsset(stored)
	}
	return mustInstallAttachedLocalModel(t, svc, req)
}

func modelsPathForRegistrarTest(svc *Service) string {
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	return resolveLocalModelsPath(svc.localModelsPath)
}

func writeManagedLlamaManifest(t *testing.T, modelsPath string, modelID string, entry string, capabilities []string) {
	t.Helper()
	modelSlug := slugifyLocalModelID(modelID)
	cleanEntry := strings.TrimPrefix(filepath.Clean(strings.TrimSpace(entry)), "."+string(filepath.Separator))
	if cleanEntry == "" || cleanEntry == "." {
		cleanEntry = "weights/model.gguf"
	}

	entryPath := filepath.Join(modelsPath, "resolved", "nimi", modelSlug, cleanEntry)
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create manifest entry dir: %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("test-model"), 0o644); err != nil {
		t.Fatalf("write manifest entry: %v", err)
	}

	manifestPath := filepath.Join(modelsPath, "resolved", "nimi", modelSlug, "asset.manifest.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	manifest := map[string]any{
		"asset_id":         modelID,
		"kind":             "chat",
		"logical_model_id": "nimi/" + modelSlug,
		"entry":            entry,
		"engine":           "llama",
		"capabilities":     capabilities,
		"files":            []string{cleanEntry},
		"hashes":           map[string]string{"sha256": "deadbeef"},
		"source":           map[string]string{"repo": "test/repo", "revision": "main"},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, raw, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
}

func TestFindMmprojCandidates(t *testing.T) {
	tests := []struct {
		name  string
		files []string
		want  int
	}{
		{"no mmproj", []string{"model.gguf", "tokenizer.json"}, 0},
		{"single mmproj", []string{"model.gguf", "mmproj-vision.gguf"}, 1},
		{"multiple mmproj", []string{"mmproj-a.gguf", "mmproj-b.gguf"}, 2},
		{"non-gguf mmproj ignored", []string{"mmproj.bin"}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := findMmprojCandidates(tt.files)
			if len(got) != tt.want {
				t.Fatalf("findMmprojCandidates(%v) = %v (len %d), want len %d", tt.files, got, len(got), tt.want)
			}
		})
	}
}

// setupRegistrarTestModel creates the directory layout expected by
// resolveManagedModelEntryAbsolutePath for a given assetId and entry.
func setupRegistrarTestModel(t *testing.T, modelsPath string, assetID string, entry string) {
	t.Helper()
	slug := slugifyLocalModelID(assetID)
	modelDir := filepath.Join(modelsPath, slug)
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	modelFile := filepath.Join(modelDir, entry)
	// Write enough bytes to pass minManagedGGUFSizeBytes if checked later.
	if err := os.WriteFile(modelFile, make([]byte, 1024), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestInspectManagedLlamaRegistrationMmprojAutoDetect(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")
	if err := os.WriteFile(filepath.Join(modelsPath, slugifyLocalModelID("test/test-model"), "mmproj-vision.gguf"), validTestGGUF(), 0o600); err != nil {
		t.Fatalf("write mmproj companion: %v", err)
	}

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf", "mmproj-vision.gguf"},
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem != "" {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
	if reg.LlamaEngineConfig == nil || reg.LlamaEngineConfig.Mmproj != "test-test-model/mmproj-vision.gguf" {
		t.Fatalf("expected mmproj auto-detected, got %+v", reg.LlamaEngineConfig)
	}
}

func TestInspectManagedLlamaRegistrationMmprojMultipleFailClose(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf", "mmproj-a.gguf", "mmproj-b.gguf"},
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem == "" {
		t.Fatal("expected fail-close for multiple mmproj candidates")
	}
	if !strings.Contains(reg.Problem, "multiple mmproj") {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
}

func TestInspectManagedLlamaRegistrationVisionMissingMmprojFailClose(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat", "text.generate.vision"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf"},
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem == "" {
		t.Fatal("expected fail-close for vision model without mmproj")
	}
	if !strings.Contains(reg.Problem, "text.generate.vision") {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
}

func TestBuildManagedLlamaRegistrationsPrimaryModelFirst(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	mgr := &registrarTestEngineManager{statusErr: errors.New("engine llama not started")}
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetEngineManager(mgr)

	// Install two models whose names sort alphabetically as alpha < beta.
	writeManagedLlamaManifest(t, modelsPath, "local/alpha-model", "./weights/alpha.gguf", []string{"chat"})
	installManagedLlamaModelForRegistrarTest(t, svc, "local/alpha-model", "./weights/alpha.gguf", []string{"chat"}, "", nil)
	writeManagedLlamaManifest(t, modelsPath, "local/beta-model", "./weights/beta.gguf", []string{"chat"})
	installManagedLlamaModelForRegistrarTest(t, svc, "local/beta-model", "./weights/beta.gguf", []string{"chat"}, "", nil)

	// Without primary set, alpha-model comes first (alphabetical).
	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	configText := string(raw)
	if strings.Index(configText, "[alpha-model]") == -1 || strings.Index(configText, "[beta-model]") == -1 {
		t.Fatalf("expected both alpha and beta sections, got:\n%s", configText)
	}
	if strings.Index(configText, "[alpha-model]") > strings.Index(configText, "[beta-model]") {
		t.Fatalf("expected alpha-model first without primary, got:\n%s", configText)
	}

	// Set beta-model as primary and rebuild.
	svc.mu.Lock()
	svc.primaryManagedLlamaModelName = "beta-model"
	svc.mu.Unlock()
	mgr.statusErr = nil
	if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
		t.Fatalf("sync after setting primary: %v", err)
	}

	raw, err = os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config after primary: %v", err)
	}
	configText = string(raw)
	if strings.Index(configText, "[beta-model]") > strings.Index(configText, "[alpha-model]") {
		t.Fatalf("expected beta-model first when set as primary, got:\n%s", configText)
	}
	if !strings.Contains(configText, "[beta-model]\nmodel = "+filepath.Join(modelsPath, "resolved", "nimi", "local-beta-model", "weights", "beta.gguf")+"\nload-on-startup = true") {
		t.Fatalf("expected primary model to load on startup, got:\n%s", configText)
	}
}

func TestBuildManagedLlamaRegistrationsRendersEmbeddingPreset(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)

	writeManagedLlamaManifest(t, modelsPath, "local/qwen-embed", "./weights/embed.gguf", []string{"text.embed"})
	installManagedLlamaModelForRegistrarTest(t, svc, "local/qwen-embed", "./weights/embed.gguf", []string{"text.embed"}, "", nil)

	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	configText := string(raw)
	for _, want := range []string{
		"[qwen-embed]",
		"model = " + filepath.Join(modelsPath, "resolved", "nimi", "local-qwen-embed", "weights", "embed.gguf"),
		"embeddings = true",
	} {
		if !strings.Contains(configText, want) {
			t.Fatalf("expected embedding preset to contain %q, got:\n%s", want, configText)
		}
	}
}

func TestRenderManagedLlamaPresetResolvesMmprojAgainstModelsRoot(t *testing.T) {
	modelsPath := filepath.Join(t.TempDir(), "models")
	modelPath := filepath.Join(modelsPath, "resolved", "nimi", "local-gemma-test", "weights", "model.gguf")
	registrations := []managedLlamaRegistration{
		{
			ExposedModelName:  "gemma-test",
			AbsoluteModelPath: modelPath,
			LlamaEngineConfig: &engine.ManagedLlamaEngineConfig{
				Mmproj: "resolved/nimi/local-gemma-test/mmproj-BF16.gguf",
			},
			Capabilities: []string{"chat", "text.generate.vision"},
		},
	}

	rendered, err := renderManagedLlamaPreset(modelsPath, registrations, "")
	if err != nil {
		t.Fatalf("render preset: %v", err)
	}
	configText := string(rendered)
	wantMmproj := filepath.Join(modelsPath, "resolved", "nimi", "local-gemma-test", "mmproj-BF16.gguf")
	if !strings.Contains(configText, "mmproj = "+wantMmproj) {
		t.Fatalf("expected mmproj to resolve against models root, got:\n%s", configText)
	}
	if strings.Contains(configText, filepath.Join(filepath.Dir(modelPath), "resolved", "nimi", "local-gemma-test", "mmproj-BF16.gguf")) {
		t.Fatalf("preset duplicated bundle root in mmproj path:\n%s", configText)
	}
}

func TestInspectManagedLlamaRegistrationEngineConfigThreaded(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	llamaFields := map[string]*structpb.Value{
		"ctx_size":     structpb.NewNumberValue(4096),
		"cache_type_k": structpb.NewStringValue("q4_0"),
		"flash_attn":   structpb.NewStringValue("auto"),
	}
	engineConfig := &structpb.Struct{
		Fields: map[string]*structpb.Value{
			"llama": structpb.NewStructValue(&structpb.Struct{Fields: llamaFields}),
		},
	}

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "model.gguf",
		Files:        []string{"model.gguf"},
		EngineConfig: engineConfig,
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem != "" {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
	if reg.LlamaEngineConfig == nil {
		t.Fatal("expected LlamaEngineConfig to be set")
	}
	if reg.LlamaEngineConfig.CtxSize != 4096 {
		t.Fatalf("ctx_size=%d, want 4096", reg.LlamaEngineConfig.CtxSize)
	}
	if reg.LlamaEngineConfig.CacheTypeK != "q4_0" {
		t.Fatalf("cache_type_k=%q, want q4_0", reg.LlamaEngineConfig.CacheTypeK)
	}
	if reg.LlamaEngineConfig.FlashAttn != "auto" {
		t.Fatalf("flash_attn=%q, want auto", reg.LlamaEngineConfig.FlashAttn)
	}
}

func TestInspectManagedLlamaRegistrationExplicitMmprojMissingFailClose(t *testing.T) {
	modelsPath := t.TempDir()
	setupRegistrarTestModel(t, modelsPath, "test/test-model", "model.gguf")

	engineConfig, err := structpb.NewStruct(map[string]any{
		"llama": map[string]any{
			"mmproj": "test-test-model/missing-mmproj.gguf",
		},
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "test-id",
		AssetId:      "test/test-model",
		Capabilities: []string{"text.generate", "text.generate.vision"},
		Engine:       "llama",
		Entry:        "model.gguf",
		EngineConfig: engineConfig,
	}

	reg := inspectManagedLlamaModelRegistration(
		model,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		modelsPath, true, false, nil,
	)
	if reg.Problem == "" {
		t.Fatal("expected fail-close for missing explicit mmproj")
	}
	if !strings.Contains(reg.Problem, "missing under models root") {
		t.Fatalf("unexpected problem: %s", reg.Problem)
	}
}
