package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPortAvailable(t *testing.T) {
	// Port 0 should find an available port.
	if !portAvailable(0) {
		t.Skip("port 0 not available (unusual system)")
	}
}

// --- Manager tests ---

func TestNewManager(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// ListEngines should include known engines even when not running.
	engines := mgr.ListEngines()
	if len(engines) != 3 {
		t.Fatalf("expected 3 known engines (llama+media+speech), got %d", len(engines))
	}
	seen := map[EngineKind]bool{}
	for _, info := range engines {
		seen[info.Kind] = true
		if info.Status != StatusStopped {
			t.Fatalf("expected stopped status for non-running engine %s, got %s", info.Kind, info.Status)
		}
	}
	if !seen[EngineLlama] || !seen[EngineMedia] || !seen[EngineSpeech] {
		t.Fatalf("expected list to include llama, media, and speech, got %+v", engines)
	}
	if mgr.logger == nil {
		t.Fatal("expected NewManager to install a default logger when nil is provided")
	}
}

func TestManagerStopAllEmpty(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// StopAll on empty manager should not panic.
	mgr.StopAll()
}

func TestManagerBeginEngineStartGuardsConcurrentStarts(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	if err := mgr.beginEngineStart(EngineLlama); err != nil {
		t.Fatalf("first beginEngineStart: %v", err)
	}
	if err := mgr.beginEngineStart(EngineLlama); err == nil {
		t.Fatal("expected concurrent start guard to reject second begin")
	}

	mgr.finishEngineStart(EngineLlama)
	if err := mgr.beginEngineStart(EngineLlama); err != nil {
		t.Fatalf("beginEngineStart after finish: %v", err)
	}
	mgr.finishEngineStart(EngineLlama)
}

func TestManagerStopAllRemovesStoppedSupervisors(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	mgr.supervisors[EngineMedia] = NewSupervisor(EngineConfig{Kind: EngineMedia, ShutdownTimeout: time.Second}, nil, nil)
	mgr.supervisors[engineManagedImageBackend] = NewSupervisor(EngineConfig{Kind: engineManagedImageBackend, ShutdownTimeout: time.Second}, nil, nil)

	mgr.StopAll()

	if len(mgr.supervisors) != 0 {
		t.Fatalf("expected StopAll to clear stopped supervisors, got %d entries", len(mgr.supervisors))
	}
}

func TestManagerStopEngineRemovesSupervisor(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	sup := NewSupervisor(EngineConfig{Kind: EngineMedia, ShutdownTimeout: time.Second}, nil, nil)
	mgr.supervisors[EngineMedia] = sup

	if err := mgr.StopEngine(EngineMedia); err != nil {
		t.Fatalf("StopEngine: %v", err)
	}
	if _, exists := mgr.supervisors[EngineMedia]; exists {
		t.Fatal("expected stopped supervisor to be removed from manager map")
	}
}

func TestManagerStopEngineLlamaRemovesImageBackendSupervisor(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	mgr.supervisors[EngineLlama] = NewSupervisor(EngineConfig{Kind: EngineLlama, ShutdownTimeout: time.Second}, nil, nil)
	mgr.supervisors[engineManagedImageBackend] = NewSupervisor(EngineConfig{Kind: engineManagedImageBackend, ShutdownTimeout: time.Second}, nil, nil)

	if err := mgr.StopEngine(EngineLlama); err != nil {
		t.Fatalf("StopEngine llama: %v", err)
	}
	if _, exists := mgr.supervisors[EngineLlama]; exists {
		t.Fatal("expected llama supervisor to be removed from manager map")
	}
	if _, exists := mgr.supervisors[engineManagedImageBackend]; !exists {
		t.Fatal("expected managed image backend supervisor to remain managed independently from llama")
	}
}

func TestManagerEngineEndpointNotStarted(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EngineEndpoint(EngineLlama)
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestManagerEngineStatusNotStarted(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EngineStatus(EngineLlama)
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

// --- Supervisor tests ---

func TestSupervisorInitialStatus(t *testing.T) {
	cfg := DefaultLlamaConfig()
	sup := NewSupervisor(cfg, nil, nil)

	if sup.Status() != StatusStopped {
		t.Errorf("expected initial status %s, got %s", StatusStopped, sup.Status())
	}
}

func TestSupervisorInfo(t *testing.T) {
	cfg := DefaultLlamaConfig()
	cfg.Port = 9999
	sup := NewSupervisor(cfg, nil, nil)

	info := sup.Info()
	if info.Kind != EngineLlama {
		t.Errorf("expected kind %s, got %s", EngineLlama, info.Kind)
	}
	if info.Port != 9999 {
		t.Errorf("expected port 9999, got %d", info.Port)
	}
	if info.Status != StatusStopped {
		t.Errorf("expected status %s, got %s", StatusStopped, info.Status)
	}
}

// --- ServiceAdapter tests ---

func TestServiceAdapterListEnginesEmpty(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	engines := adapter.ListEngines()
	if len(engines) != 3 {
		t.Fatalf("expected 3 known engines, got %d", len(engines))
	}
	seen := map[string]bool{}
	for _, info := range engines {
		seen[info.Engine] = true
		if info.Status != string(StatusStopped) {
			t.Fatalf("expected stopped status for non-running engine %s, got %s", info.Engine, info.Status)
		}
	}
	if !seen[string(EngineLlama)] || !seen[string(EngineMedia)] || !seen[string(EngineSpeech)] {
		t.Fatalf("expected adapter list to include llama, media, and speech, got %+v", engines)
	}
}

func TestServiceAdapterEngineStatusNotFound(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	_, err = adapter.EngineStatus("llama")
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestServiceAdapterStopEngineNotFound(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	err = adapter.StopEngine("llama")
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestManagerApplyLlamaPaths(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte(`
- name: model-a
  backend: llama-cpp
  parameters:
    model: model-a.gguf
- name: model-b
  backend: whisper-ggml
  parameters:
    model: model-b.bin
`), 0o644); err != nil {
		t.Fatalf("write llama models config: %v", err)
	}

	mgr.SetLlamaPaths("/data/models", configPath)
	cfg := mgr.applyLlamaPaths(DefaultLlamaConfig())
	if cfg.ModelsPath != "/data/models" {
		t.Fatalf("models path mismatch: %q", cfg.ModelsPath)
	}
	if cfg.ModelsConfigPath != configPath {
		t.Fatalf("models config path mismatch: %q", cfg.ModelsConfigPath)
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("resolve home dir: %v", err)
	}
	if got, want := cfg.BackendsPath, filepath.Join(homeDir, ".nimi", "runtime", "llama-backends"); got != want {
		t.Fatalf("backends path mismatch: got=%q want=%q", got, want)
	}
	if got, want := strings.Join(cfg.ExternalBackends, ","), "llama-cpp,whisper-ggml"; got != want {
		t.Fatalf("external backends mismatch: got=%q want=%q", got, want)
	}
}

func TestParseEngineKind(t *testing.T) {
	tests := []struct {
		input string
		want  EngineKind
		err   bool
	}{
		{"llama", EngineLlama, false},
		{"media", EngineMedia, false},
		{"managed-image-backend", engineManagedImageBackend, false},
		{"media-diffusers-backend", engineManagedImageBackend, false},
		{"speech", EngineSpeech, false},
		{"sidecar", EngineKind("sidecar"), false},
		{"media.diffusers", "", true},
		{"unknown", "", true},
		{"", "", true},
	}
	for _, tt := range tests {
		got, err := parseEngineKind(tt.input)
		if (err != nil) != tt.err {
			t.Errorf("parseEngineKind(%q): err=%v, wantErr=%v", tt.input, err, tt.err)
		}
		if got != tt.want {
			t.Errorf("parseEngineKind(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestRestartJitterCap(t *testing.T) {
	tests := []struct {
		name  string
		delay time.Duration
		want  time.Duration
	}{
		{name: "zero", delay: 0, want: 0},
		{name: "short delay stays bounded", delay: 10 * time.Millisecond, want: 10 * time.Millisecond},
		{name: "sub-second delay stays bounded", delay: 500 * time.Millisecond, want: 500 * time.Millisecond},
		{name: "long delay caps at one second", delay: 3 * time.Second, want: time.Second},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := restartJitterCap(tt.delay); got != tt.want {
				t.Fatalf("restartJitterCap(%s) = %s, want %s", tt.delay, got, tt.want)
			}
		})
	}
}

// --- Command construction tests ---

func TestLlamaCommandArgs(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte("version = 1\n\n[managed-qwen]\nmodel = /data/models/qwen/qwen3.gguf\n"), 0o644); err != nil {
		t.Fatalf("write llama config: %v", err)
	}

	cfg := EngineConfig{
		Kind:             EngineLlama,
		BinaryPath:       "/usr/local/bin/llama-server",
		Port:             5555,
		ModelsPath:       "/data/models",
		ModelsConfigPath: configPath,
	}
	cmd, err := llamaCommand(cfg)
	if err != nil {
		t.Fatalf("llamaCommand: %v", err)
	}
	args := strings.Join(cmd.Args[1:], " ")

	for _, want := range []string{"--host", "127.0.0.1", "--port", "5555", "--reasoning", "off", "--models-preset", configPath} {
		if !strings.Contains(args, want) {
			t.Errorf("expected args to contain %q, got: %s", want, args)
		}
	}
	for _, wantMissing := range []string{"--models-config-file", "--backends-path", "--external-backends", "--alias"} {
		if strings.Contains(args, wantMissing) {
			t.Errorf("expected no %s for router llama-server, got: %s", wantMissing, args)
		}
	}
	if strings.Contains(args, "--model ") {
		t.Errorf("expected router llama-server to avoid explicit --model target, got: %s", args)
	}
}

func TestDetectLlamaExternalBackends(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte(`
- name: model-a
  backend: llama-cpp
- name: model-b
  backend: whisper-ggml
- name: model-c
  backend: llama-cpp
- name: model-d
  backend: ""
`), 0o644); err != nil {
		t.Fatalf("write llama models config: %v", err)
	}

	if got, want := strings.Join(detectLlamaExternalBackends(configPath), ","), "llama-cpp,whisper-ggml"; got != want {
		t.Fatalf("detectLlamaExternalBackends mismatch: got=%q want=%q", got, want)
	}
}

func TestDetectLlamaExternalBackendsReturnsNilOnInvalidYaml(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models-invalid.yaml")
	if err := os.WriteFile(configPath, []byte(":\n- not-valid"), 0o644); err != nil {
		t.Fatalf("write invalid llama models config: %v", err)
	}

	if got := detectLlamaExternalBackends(configPath); got != nil {
		t.Fatalf("expected nil external backends for invalid yaml, got %v", got)
	}
}

func TestDetectLlamaExternalBackendsAcceptsManagedPresetFormat(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte("version = 1\n\n[managed-qwen]\nmodel = /data/models/qwen/qwen3.gguf\nload-on-startup = true\n"), 0o644); err != nil {
		t.Fatalf("write llama preset config: %v", err)
	}

	if got := detectLlamaExternalBackends(configPath); got != nil {
		t.Fatalf("expected nil external backends for managed preset, got %v", got)
	}
}

func TestResolveManagedLlamaModelEntryAcceptsManagedPresetFormat(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte("version = 1\n\n[managed-qwen]\nmodel = /data/models/qwen/qwen3.gguf\nctx-size = 8192\ncache-type-k = q4_0\nflash-attn = on\n"), 0o644); err != nil {
		t.Fatalf("write llama preset config: %v", err)
	}

	modelPath, alias, params, err := resolveManagedLlamaModelEntry(EngineConfig{
		Kind:             EngineLlama,
		ModelsPath:       "/data/models",
		ModelsConfigPath: configPath,
	})
	if err != nil {
		t.Fatalf("resolveManagedLlamaModelEntry: %v", err)
	}
	if modelPath != "/data/models/qwen/qwen3.gguf" {
		t.Fatalf("model path mismatch: got=%q", modelPath)
	}
	if alias != "managed-qwen" {
		t.Fatalf("alias mismatch: got=%q", alias)
	}
	if params.CtxSize != 8192 {
		t.Fatalf("ctx-size mismatch: got=%d", params.CtxSize)
	}
	if params.CacheTypeK != "q4_0" {
		t.Fatalf("cache-type-k mismatch: got=%q", params.CacheTypeK)
	}
	if params.FlashAttn != "on" {
		t.Fatalf("flash-attn mismatch: got=%q", params.FlashAttn)
	}
}

func TestDiscoverInstalledManagedImageBackendRunPathPrefersAlias(t *testing.T) {
	backendsPath := t.TempDir()
	backendDir := filepath.Join(backendsPath, "metal-stablediffusion-ggml")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	runPath := filepath.Join(backendDir, "run.sh")
	if err := os.WriteFile(runPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write run.sh: %v", err)
	}
	if err := os.WriteFile(filepath.Join(backendDir, "metadata.json"), []byte(`{"name":"metal-stablediffusion-ggml","alias":"stablediffusion-ggml"}`), 0o644); err != nil {
		t.Fatalf("write metadata.json: %v", err)
	}

	discovered, err := discoverInstalledManagedImageBackendRunPath(backendsPath, "stablediffusion-ggml")
	if err != nil {
		t.Fatalf("discoverInstalledManagedImageBackendRunPath: %v", err)
	}
	if discovered != runPath {
		t.Fatalf("run path mismatch: got=%q want=%q", discovered, runPath)
	}
}

func TestDiscoverInstalledManagedImageBackendRunPathRejectsMetaBackendTraversal(t *testing.T) {
	backendsPath := t.TempDir()
	backendDir := filepath.Join(backendsPath, "meta-stablediffusion-ggml")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	runPath := filepath.Join(backendDir, "run.sh")
	if err := os.WriteFile(runPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write run.sh: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(backendDir, "metadata.json"),
		[]byte(`{"name":"meta-stablediffusion-ggml","alias":"stablediffusion-ggml","meta_backend_for":"../escape"}`),
		0o644,
	); err != nil {
		t.Fatalf("write metadata.json: %v", err)
	}
	escapeDir := filepath.Join(backendsPath, "..", "escape")
	if err := os.MkdirAll(escapeDir, 0o755); err != nil {
		t.Fatalf("mkdir escape dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(escapeDir, "run.sh"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write escape run.sh: %v", err)
	}

	_, err := discoverInstalledManagedImageBackendRunPath(backendsPath, "stablediffusion-ggml")
	if err == nil {
		t.Fatal("expected meta_backend_for traversal to be rejected")
	}
}

// --- Adapter/DTO conversion tests ---

func TestResolveEngineConfigOverrides(t *testing.T) {
	// Default values.
	cfg, err := resolveEngineConfig("llama", "", 0)
	if err != nil {
		t.Fatalf("resolveEngineConfig: %v", err)
	}
	if cfg.Version != defaultLlamaVersion {
		t.Errorf("expected default version %s, got %s", defaultLlamaVersion, cfg.Version)
	}
	if cfg.Port != 1234 {
		t.Errorf("expected default port 1234, got %d", cfg.Port)
	}

	// Override version and port.
	cfg2, err := resolveEngineConfig("llama", "2.0", 9999)
	if err != nil {
		t.Fatalf("resolveEngineConfig: %v", err)
	}
	if cfg2.Version != "2.0" {
		t.Errorf("expected overridden version 2.0, got %s", cfg2.Version)
	}
	if cfg2.Port != 9999 {
		t.Errorf("expected overridden port 9999, got %d", cfg2.Port)
	}
}

func TestSupervisorInfoToDTOTimeFormat(t *testing.T) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	info := SupervisorInfo{
		Kind:      EngineLlama,
		Version:   "b8575",
		Port:      1234,
		Status:    StatusHealthy,
		StartedAt: now,
	}
	dto := supervisorInfoToDTO(info)

	if dto.StartedAt != "2026-03-01T12:00:00Z" {
		t.Errorf("expected RFC3339 StartedAt, got %s", dto.StartedAt)
	}
	if dto.LastHealthyAt != "" {
		t.Errorf("expected empty LastHealthyAt for zero time, got %s", dto.LastHealthyAt)
	}

	// With LastHealthyAt set.
	info.LastHealthyAt = now.Add(5 * time.Minute)
	dto2 := supervisorInfoToDTO(info)
	if dto2.LastHealthyAt != "2026-03-01T12:05:00Z" {
		t.Errorf("expected RFC3339 LastHealthyAt, got %s", dto2.LastHealthyAt)
	}

	// BinarySizeBytes pass-through.
	info.BinarySizeBytes = 12345
	dto3 := supervisorInfoToDTO(info)
	if dto3.BinarySizeBytes != 12345 {
		t.Errorf("expected BinarySizeBytes 12345, got %d", dto3.BinarySizeBytes)
	}
}

func TestSupervisorInfoBinarySizeBytes(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-binary")
	content := []byte("0123456789")
	if err := os.WriteFile(binaryPath, content, 0o755); err != nil {
		t.Fatalf("write fake binary: %v", err)
	}

	cfg := DefaultLlamaConfig()
	cfg.BinaryPath = binaryPath
	sup := NewSupervisor(cfg, nil, nil)

	info := sup.Info()
	if info.BinarySizeBytes != int64(len(content)) {
		t.Errorf("expected BinarySizeBytes %d, got %d", len(content), info.BinarySizeBytes)
	}

	// Non-existent path 閳?0.
	cfg2 := DefaultLlamaConfig()
	cfg2.BinaryPath = filepath.Join(dir, "nonexistent")
	sup2 := NewSupervisor(cfg2, nil, nil)
	info2 := sup2.Info()
	if info2.BinarySizeBytes != 0 {
		t.Errorf("expected BinarySizeBytes 0 for missing path, got %d", info2.BinarySizeBytes)
	}
}

// --- Port conflict resolution test ---

// --- State change callback test ---
