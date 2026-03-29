package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"gopkg.in/yaml.v3"
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
		Version:  "b8575",
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
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/expected-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		t.Fatalf("expected UNHEALTHY, got %s", started.GetModel().GetStatus())
	}
	if !strings.Contains(started.GetModel().GetHealthDetail(), `missing expected model "expected-model"`) {
		t.Fatalf("expected exact-model mismatch detail, got %q", started.GetModel().GetHealthDetail())
	}
	if !strings.Contains(started.GetModel().GetHealthDetail(), "available_models=other-model") {
		t.Fatalf("expected available model listing, got %q", started.GetModel().GetHealthDetail())
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
	var entries []managedLlamaConfigEntry
	if err := yaml.Unmarshal(raw, &entries); err != nil {
		t.Fatalf("unmarshal generated config: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 config entry, got %d", len(entries))
	}
	if entries[0].Name != "test-chat" {
		t.Fatalf("unexpected llama model name: %q", entries[0].Name)
	}
	if entries[0].Backend != "llama-cpp" {
		t.Fatalf("unexpected backend: %q", entries[0].Backend)
	}
	if entries[0].Parameters.Model != "local-test-chat/weights/model.gguf" {
		t.Fatalf("unexpected relative model path: %q", entries[0].Parameters.Model)
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

	if _, err := svc.RemoveLocalModel(context.Background(), &runtimev1.RemoveLocalModelRequest{
		LocalModelId: second.GetLocalModelId(),
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
	entries = nil
	if err := yaml.Unmarshal(remainingRaw, &entries); err != nil {
		t.Fatalf("unmarshal generated config after removal: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "test-chat" {
		t.Fatalf("expected only first model to remain after removal, got %+v", entries)
	}

	if first.GetLocalModelId() == "" {
		t.Fatalf("expected non-empty first local model id")
	}
}

func TestSyncManagedLlamaAssetsSkipsExternalEndpointOnlyModels(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	mgr := &registrarTestEngineManager{}
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetEngineManager(mgr)

	if _, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/external-only",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Endpoint:     "https://example.com/v1",
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
	first := &runtimev1.LocalModelRecord{
		LocalModelId: "local-conflict-a",
		ModelId:      "local/conflict-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "./weights/model-a.gguf",
		License:      "apache-2.0",
		Source: &runtimev1.LocalModelSource{
			Repo:     "test/conflict-a",
			Revision: "main",
		},
		Endpoint:    defaultLocalEndpoint,
		Status:      runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		InstalledAt: nowISO(),
		UpdatedAt:   nowISO(),
	}
	second := &runtimev1.LocalModelRecord{
		LocalModelId: "local-conflict-b",
		ModelId:      "llama/conflict-model",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Entry:        "./weights/model-b.gguf",
		License:      "apache-2.0",
		Source: &runtimev1.LocalModelSource{
			Repo:     "test/conflict-b",
			Revision: "main",
		},
		Endpoint:    defaultLocalEndpoint,
		Status:      runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
		InstalledAt: nowISO(),
		UpdatedAt:   nowISO(),
	}
	svc.models[first.GetLocalModelId()] = first
	svc.models[second.GetLocalModelId()] = second
	svc.setModelRuntimeModeLocked(first.GetLocalModelId(), runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	svc.setModelRuntimeModeLocked(second.GetLocalModelId(), runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)

	registrations, rendered, err := svc.buildManagedLlamaRegistrations()
	if err != nil {
		t.Fatalf("build llama registrations: %v", err)
	}
	if !strings.Contains(registrations[first.GetLocalModelId()].Problem, "name conflict") {
		t.Fatalf("expected first registration conflict problem, got %+v", registrations[first.GetLocalModelId()])
	}
	if !strings.Contains(registrations[second.GetLocalModelId()].Problem, "name conflict") {
		t.Fatalf("expected second registration conflict problem, got %+v", registrations[second.GetLocalModelId()])
	}

	var entries []managedLlamaConfigEntry
	if err := yaml.Unmarshal(rendered, &entries); err != nil {
		t.Fatalf("unmarshal rendered config: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected no rendered config entries after name conflict, got %+v", entries)
	}
}

func TestManagedMediaDiffusersBackendPlatformSupport(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedMediaDiffusersBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedMediaDiffusersBackendHealth(true, "daemon-managed image backend active")

	writeManagedLlamaManifest(t, modelsPath, "local/image-model", "./weights/image-model.gguf", []string{"image"})
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
		"options": []any{"diffusion_model"},
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	installed := installManagedLlamaModelForRegistrarTest(t, svc, "local/image-model", "./weights/image-model.gguf", []string{"image"}, "", engineConfig)

	registration := svc.managedLlamaRegistrationForModel(installed)
	if registration.Problem != "" {
		t.Fatalf("expected supported image registration, got problem %q", registration.Problem)
	}
	if registration.Backend != "stablediffusion-ggml" {
		t.Fatalf("unexpected image backend: %q", registration.Backend)
	}
	if !registration.DynamicProfile {
		t.Fatalf("expected dynamic profile registration")
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

func TestManagedLlamaRegistrationForDynamicProfileRecomputesWhenImageBackendRecovers(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedMediaDiffusersBackendConfig(true, "127.0.0.1:50052")

	writeManagedLlamaManifest(t, modelsPath, "local/image-model", "./weights/image-model.gguf", []string{"image"})
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
		"options": []any{"diffusion_model"},
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	installed := installManagedLlamaModelForRegistrarTest(t, svc, "local/image-model", "./weights/image-model.gguf", []string{"image"}, "", engineConfig)

	if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
		t.Fatalf("sync managed llama assets: %v", err)
	}
	stale := svc.managedLlamaRegistrations[installed.GetLocalModelId()]
	if stale.Problem != "managed diffusers backend unavailable" {
		t.Fatalf("expected cached unavailable registration, got %+v", stale)
	}

	svc.SetManagedMediaDiffusersBackendHealth(true, "daemon-managed image backend active")

	registration := svc.managedLlamaRegistrationForModel(installed)
	if registration.Problem != "" {
		t.Fatalf("expected recomputed image registration after backend recovery, got problem %q", registration.Problem)
	}
	if !registration.DynamicProfile {
		t.Fatalf("expected dynamic profile registration")
	}
}

func installManagedLlamaModelForRegistrarTest(t *testing.T, svc *Service, modelID string, entry string, capabilities []string, endpoint string, engineConfig *structpb.Struct) *runtimev1.LocalModelRecord {
	t.Helper()
	req := &runtimev1.InstallLocalModelRequest{
		ModelId:      modelID,
		Capabilities: capabilities,
		Engine:       "llama",
		Entry:        entry,
		Endpoint:     endpoint,
		EngineConfig: engineConfig,
	}
	if strings.TrimSpace(endpoint) == "" {
		return mustInstallSupervisedLocalModel(t, svc, req)
	}
	return mustInstallAttachedLocalModel(t, svc, req)
}

func writeManagedLlamaManifest(t *testing.T, modelsPath string, modelID string, entry string, capabilities []string) {
	t.Helper()
	modelSlug := slugifyLocalModelID(modelID)
	cleanEntry := strings.TrimPrefix(filepath.Clean(strings.TrimSpace(entry)), "."+string(filepath.Separator))
	if cleanEntry == "" || cleanEntry == "." {
		cleanEntry = "weights/model.gguf"
	}

	entryPath := filepath.Join(modelsPath, modelSlug, cleanEntry)
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create manifest entry dir: %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("test-model"), 0o644); err != nil {
		t.Fatalf("write manifest entry: %v", err)
	}

	manifestPath := filepath.Join(modelsPath, "resolved", "nimi", modelSlug, "manifest.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	manifest := map[string]any{
		"model_id":         modelID,
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
