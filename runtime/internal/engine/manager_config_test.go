package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
	"unicode/utf8"
)

func TestPortAvailable(t *testing.T) {
	// Port 0 should find an available port.
	if !portAvailable(0) {
		t.Skip("port 0 not available (unusual system)")
	}
}

// --- Manager tests ---

// testManagedRoots returns absolute K-CFG-018 data-plane roots backed by
// distinct temp directories for engine manager construction in tests.
func testManagedRoots(t *testing.T) ManagedRoots {
	t.Helper()
	return ManagedRoots{
		Environments: t.TempDir(),
		Dependencies: t.TempDir(),
	}
}

func TestNewManager(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
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

func TestEnsureEngineLlamaDoesNotMaterializeMissingDependency(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EnsureEngine(context.Background(), DefaultLlamaConfig())
	if !errors.Is(err, ErrEngineBinaryDependencyNotReady) {
		t.Fatalf("EnsureEngine should fail closed without materializing llama dependency, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(mgr.baseDir, string(EngineLlama))); !os.IsNotExist(statErr) {
		t.Fatalf("EnsureEngine created llama package directory or unexpected stat error: %v", statErr)
	}
}

func TestStartEngineLlamaRequiresMaterializedDependency(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	err = mgr.StartEngine(context.Background(), DefaultLlamaConfig())
	if !errors.Is(err, ErrEngineBinaryDependencyNotReady) {
		t.Fatalf("StartEngine should require materialized llama dependency, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(mgr.baseDir, string(EngineLlama))); !os.IsNotExist(statErr) {
		t.Fatalf("StartEngine created llama package directory or unexpected stat error: %v", statErr)
	}
}

func TestManagerStopAllEmpty(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// StopAll on empty manager should not panic.
	mgr.StopAll()
}

func TestManagerBeginEngineStartGuardsConcurrentStarts(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
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
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
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
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
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
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
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
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EngineEndpoint(EngineLlama)
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestManagerEngineStatusNotStarted(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EngineStatus(EngineLlama)
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

// TestManagerStartEngineStopsSupersededUnhealthySupervisor is the regression
// guard for bug B (double-spawn): when StartEngine replaces a non-healthy
// supervisor for the same engine, it must stop the old supervisor — killing its
// process and halting its crash/restart loop — so two supervision cycles never
// spawn the same engine concurrently and race for the same port.
func TestManagerStartEngineStopsSupersededUnhealthySupervisor(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}
	setSupervisorTestHome(t)

	mgr, err := NewManager(testLogger(), testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// Seed a non-healthy supervisor with a real, alive child process — the
	// state the unhealthy speech supervisor sits in after a failed startup.
	priorScript := writeTestScript(t, "sleep 60")
	priorCfg := testSupervisorCfg(priorScript)
	priorCfg.StartupTimeout = 200 * time.Millisecond
	priorCfg.MaxRestarts = 1
	prior := NewSupervisor(priorCfg, testLogger(), nil)
	if err := prior.Start(context.Background()); err != nil {
		t.Fatalf("prior supervisor Start: %v", err)
	}
	priorPID := prior.Info().PID
	t.Cleanup(func() {
		if testProcessAlive(priorPID) {
			_ = signalSupervisorProcessDirect(priorPID, syscall.SIGKILL)
		}
	})
	prior.SetStateForTesting(StatusUnhealthy, time.Time{})
	mgr.SetSupervisorForTesting(EngineMedia, prior)

	// StartEngine for the same engine: the superseded unhealthy supervisor must
	// be stopped (its process killed) before the replacement spawns.
	nextScript := writeTestScript(t, "sleep 60")
	nextCfg := testSupervisorCfg(nextScript)
	nextCfg.Kind = EngineMedia
	nextCfg.StartupTimeout = 500 * time.Millisecond
	nextCfg.MaxRestarts = 1
	if err := mgr.StartEngine(context.Background(), nextCfg); err != nil {
		t.Fatalf("StartEngine: %v", err)
	}
	t.Cleanup(func() { _ = mgr.StopEngine(EngineMedia) })

	if !waitForCondition(3*time.Second, func() bool {
		return !testProcessAlive(priorPID)
	}) {
		t.Fatalf("expected superseded supervisor process %d to be killed by StartEngine", priorPID)
	}

	info, err := mgr.EngineStatus(EngineMedia)
	if err != nil {
		t.Fatalf("EngineStatus: %v", err)
	}
	if info.PID <= 0 || info.PID == priorPID {
		t.Fatalf("expected a fresh supervised process after supersede, got pid %d", info.PID)
	}
}

func TestManagerStartEngineFailsClosedWhenSupersededSupervisorStopFails(t *testing.T) {
	setSupervisorTestHome(t)

	mgr, err := NewManager(testLogger(), testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	executablePath, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}

	priorCfg := testSupervisorCfg(executablePath)
	priorCfg.CommandArgs = []string{"-test.run=^TestSupervisorHelperProcess$", "--", "sleep"}
	priorCfg.CommandEnv = map[string]string{"GO_WANT_SUPERVISOR_HELPER_PROCESS": "1"}
	priorCfg.StartupTimeout = 100 * time.Millisecond
	priorCfg.MaxRestarts = 1
	priorCfg.ExecutionHostIdentity = "prior-host"
	prior := NewSupervisor(priorCfg, testLogger(), nil)
	if err := prior.Start(context.Background()); err != nil {
		t.Fatalf("prior supervisor Start: %v", err)
	}
	t.Cleanup(func() { _ = prior.Stop() })
	prior.SetStateForTesting(StatusUnhealthy, time.Time{})
	process := prior.currentProcess()
	if process == nil {
		t.Fatal("prior supervisor has no tracked process")
	}
	process.recordLifecycleError(errors.New("injected process-tree cleanup failure"))
	mgr.SetSupervisorForTesting(EngineMedia, prior)

	nextCfg := testSupervisorCfg(executablePath)
	nextCfg.CommandArgs = []string{"-test.run=^TestSupervisorHelperProcess$", "--", "sleep"}
	nextCfg.CommandEnv = map[string]string{"GO_WANT_SUPERVISOR_HELPER_PROCESS": "1"}
	nextCfg.StartupTimeout = 100 * time.Millisecond
	nextCfg.MaxRestarts = 1
	nextCfg.ExecutionHostIdentity = "replacement-host"
	err = mgr.StartEngine(context.Background(), nextCfg)
	if err == nil {
		t.Fatal("StartEngine replaced a supervisor whose process tree did not stop cleanly")
	}
	if !strings.Contains(err.Error(), "stop superseded engine supervisor") {
		t.Fatalf("StartEngine error=%v, want superseded stop failure", err)
	}

	mgr.mu.RLock()
	managed := mgr.supervisors[EngineMedia]
	mgr.mu.RUnlock()
	if managed != prior {
		t.Fatal("failed supersede did not retain the poisoned prior supervisor")
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
	sup.setStatus(StatusUnhealthy, "startup health failed: speech catalog not ready")
	info = sup.Info()
	if info.Detail != "startup health failed: speech catalog not ready" {
		t.Fatalf("expected supervisor status detail, got %q", info.Detail)
	}
	sup.setStatus(StatusUnhealthy, strings.Repeat("语", 2_000))
	info = sup.Info()
	if len(info.Detail) > 4_096 || !utf8.ValidString(info.Detail) {
		t.Fatalf("expected bounded UTF-8 supervisor detail, bytes=%d valid=%t", len(info.Detail), utf8.ValidString(info.Detail))
	}
}

// --- ServiceAdapter tests ---

func TestServiceAdapterListEnginesEmpty(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
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
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
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
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	err = adapter.StopEngine("llama")
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestApplySpeechPathsPreservesCapabilityScopedDriverRoots(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	mgr.SetSpeechPaths("models", "tts-default", "asr-default")

	tests := []struct {
		name    string
		config  EngineConfig
		wantTTS string
		wantASR string
	}{
		{
			name: "transcription Host",
			config: EngineConfig{
				Kind:                         EngineSpeech,
				SpeechHostPackageSetRoot:     "asr-exact",
				SpeechQwen3ASRPackageSetRoot: "asr-exact",
			},
			wantASR: "asr-exact",
		},
		{
			name: "synthesis Host",
			config: EngineConfig{
				Kind:                         EngineSpeech,
				SpeechHostPackageSetRoot:     "tts-exact",
				SpeechQwen3TTSPackageSetRoot: "tts-exact",
			},
			wantTTS: "tts-exact",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := mgr.applySpeechPaths(test.config)
			if got.SpeechQwen3TTSPackageSetRoot != test.wantTTS || got.SpeechQwen3ASRPackageSetRoot != test.wantASR {
				t.Fatalf("speech Driver roots = tts %q asr %q, want tts %q asr %q", got.SpeechQwen3TTSPackageSetRoot, got.SpeechQwen3ASRPackageSetRoot, test.wantTTS, test.wantASR)
			}
		})
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
		Detail:    "ready",
		StartedAt: now,
	}
	dto := supervisorInfoToDTO(info)

	if dto.StartedAt != "2026-03-01T12:00:00Z" {
		t.Errorf("expected RFC3339 StartedAt, got %s", dto.StartedAt)
	}
	if dto.LastHealthyAt != "" {
		t.Errorf("expected empty LastHealthyAt for zero time, got %s", dto.LastHealthyAt)
	}
	if dto.Detail != "ready" {
		t.Errorf("expected status detail pass-through, got %q", dto.Detail)
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
