package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func TestDefaultLocalAIConfig(t *testing.T) {
	cfg := DefaultLocalAIConfig()
	if cfg.Kind != EngineLocalAI {
		t.Errorf("expected kind %s, got %s", EngineLocalAI, cfg.Kind)
	}
	if cfg.Port != 1234 {
		t.Errorf("expected port 1234, got %d", cfg.Port)
	}
	if cfg.Version != "3.12.1" {
		t.Errorf("expected version 3.12.1, got %s", cfg.Version)
	}
	if cfg.HealthPath != "/readyz" {
		t.Errorf("expected health path /readyz, got %s", cfg.HealthPath)
	}
	if cfg.MaxRestarts != 5 {
		t.Errorf("expected max restarts 5, got %d", cfg.MaxRestarts)
	}
	if cfg.StartupTimeout != 120*time.Second {
		t.Errorf("expected startup timeout 120s, got %s", cfg.StartupTimeout)
	}
}

func TestDefaultNexaConfig(t *testing.T) {
	cfg := DefaultNexaConfig()
	if cfg.Kind != EngineNexa {
		t.Errorf("expected kind %s, got %s", EngineNexa, cfg.Kind)
	}
	if cfg.Port != 8000 {
		t.Errorf("expected port 8000, got %d", cfg.Port)
	}
	if cfg.HealthPath != "/" {
		t.Errorf("expected health path /, got %s", cfg.HealthPath)
	}
	if cfg.HealthResponse != "Nexa SDK is running" {
		t.Errorf("expected health response, got %s", cfg.HealthResponse)
	}
}

func TestEngineConfigEndpoint(t *testing.T) {
	cfg := EngineConfig{Port: 5678}
	if got := cfg.Endpoint(); got != "http://127.0.0.1:5678" {
		t.Errorf("expected http://127.0.0.1:5678, got %s", got)
	}
}

func TestItoa(t *testing.T) {
	tests := []struct {
		input int
		want  string
	}{
		{0, "0"},
		{1, "1"},
		{1234, "1234"},
		{-5, "-5"},
		{8000, "8000"},
	}
	for _, tt := range tests {
		if got := itoa(tt.input); got != tt.want {
			t.Errorf("itoa(%d) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// --- Registry tests ---

func TestRegistryCRUD(t *testing.T) {
	dir := t.TempDir()

	reg, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	// Empty initially.
	if len(reg.List()) != 0 {
		t.Fatalf("expected empty registry, got %d entries", len(reg.List()))
	}

	// Get returns nil for missing entry.
	if got := reg.Get(EngineLocalAI, "3.12.1"); got != nil {
		t.Fatalf("expected nil for missing entry, got %+v", got)
	}

	// Put an entry.
	entry := &RegistryEntry{
		Engine:      EngineLocalAI,
		Version:     "3.12.1",
		BinaryPath:  "/tmp/local-ai",
		SHA256:      "abc123",
		Platform:    "darwin/arm64",
		InstalledAt: "2026-01-01T00:00:00Z",
	}
	if err := reg.Put(entry); err != nil {
		t.Fatalf("Put: %v", err)
	}

	// Get the entry.
	got := reg.Get(EngineLocalAI, "3.12.1")
	if got == nil {
		t.Fatal("expected entry, got nil")
	}
	if got.BinaryPath != "/tmp/local-ai" {
		t.Errorf("expected binary path /tmp/local-ai, got %s", got.BinaryPath)
	}
	if got.SHA256 != "abc123" {
		t.Errorf("expected sha256 abc123, got %s", got.SHA256)
	}

	// List returns the entry.
	if len(reg.List()) != 1 {
		t.Errorf("expected 1 entry, got %d", len(reg.List()))
	}

	// Remove the entry.
	if err := reg.Remove(EngineLocalAI, "3.12.1"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if got := reg.Get(EngineLocalAI, "3.12.1"); got != nil {
		t.Errorf("expected nil after remove, got %+v", got)
	}
}

func TestRegistryPersistence(t *testing.T) {
	dir := t.TempDir()

	reg1, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	if err := reg1.Put(&RegistryEntry{
		Engine:     EngineLocalAI,
		Version:    "1.0.0",
		BinaryPath: "/tmp/test",
		Platform:   "linux/amd64",
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	// Load from disk in a new registry instance.
	reg2, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry reload: %v", err)
	}

	got := reg2.Get(EngineLocalAI, "1.0.0")
	if got == nil {
		t.Fatal("expected persisted entry, got nil")
	}
	if got.BinaryPath != "/tmp/test" {
		t.Errorf("expected binary path /tmp/test, got %s", got.BinaryPath)
	}
}

func TestRegistryAtomicWrite(t *testing.T) {
	dir := t.TempDir()

	reg, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	if err := reg.Put(&RegistryEntry{
		Engine:  EngineNexa,
		Version: "sys",
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	// Verify no .tmp file remains.
	tmpPath := filepath.Join(dir, "registry.json.tmp")
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Errorf("expected no tmp file, but it exists")
	}

	// Verify actual file exists.
	jsonPath := filepath.Join(dir, "registry.json")
	if _, err := os.Stat(jsonPath); err != nil {
		t.Errorf("expected registry.json to exist: %v", err)
	}
}

// --- Download URL tests ---

func TestLocalAIDownloadURL(t *testing.T) {
	url, err := localAIDownloadURL("3.12.1")
	if err != nil {
		t.Fatalf("localAIDownloadURL: %v", err)
	}
	if url == "" {
		t.Fatal("expected non-empty URL")
	}

	expectedPrefix := "https://github.com/mudler/LocalAI/releases/download/v3.12.1/"
	if len(url) < len(expectedPrefix) || url[:len(expectedPrefix)] != expectedPrefix {
		t.Errorf("unexpected URL prefix: %s", url)
	}
}

func TestLocalAIAssetName(t *testing.T) {
	name, err := localAIAssetName("3.12.1")
	if err != nil {
		t.Fatalf("localAIAssetName: %v", err)
	}
	if name == "" {
		t.Fatal("expected non-empty asset name")
	}

	if !strings.Contains(name, "v3.12.1") {
		t.Fatalf("asset name must contain version, got %s", name)
	}
	if !strings.Contains(name, runtime.GOOS) {
		t.Fatalf("asset name must contain GOOS=%s, got %s", runtime.GOOS, name)
	}
	if !strings.Contains(name, runtime.GOARCH) {
		t.Fatalf("asset name must contain GOARCH=%s, got %s", runtime.GOARCH, name)
	}
}

func TestLocalAIExpectedSHA256(t *testing.T) {
	const version = "3.12.1"
	const asset = "local-ai-v3.12.1-darwin-arm64"
	const expectedHash = "aac7f1248948cf2e6b2ce1c86a311601b1e37154914397f602b1f6f4bfe2de00"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3.12.1/LocalAI-v3.12.1-checksums.txt" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(strings.Join([]string{
			"fc8483b895154d3c4e7149d6d480cb18837a3ae42a208f687a89db20802d78d1  LocalAI-v3.12.1-source.tar.gz",
			expectedHash + "  " + asset,
		}, "\n")))
	}))
	defer server.Close()

	originalBaseURL := localAIReleaseBaseURL
	originalClient := localAIReleaseHTTPClient
	localAIReleaseBaseURL = server.URL
	localAIReleaseHTTPClient = server.Client()
	t.Cleanup(func() {
		localAIReleaseBaseURL = originalBaseURL
		localAIReleaseHTTPClient = originalClient
	})

	hash, err := localAIExpectedSHA256(version, asset)
	if err != nil {
		t.Fatalf("localAIExpectedSHA256: %v", err)
	}
	if hash != expectedHash {
		t.Fatalf("checksum mismatch: got=%s want=%s", hash, expectedHash)
	}
}

func TestLocalAIExpectedSHA256MissingAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("aac7f1248948cf2e6b2ce1c86a311601b1e37154914397f602b1f6f4bfe2de00  local-ai-v3.12.1-darwin-arm64\n"))
	}))
	defer server.Close()

	originalBaseURL := localAIReleaseBaseURL
	originalClient := localAIReleaseHTTPClient
	localAIReleaseBaseURL = server.URL
	localAIReleaseHTTPClient = server.Client()
	t.Cleanup(func() {
		localAIReleaseBaseURL = originalBaseURL
		localAIReleaseHTTPClient = originalClient
	})

	_, err := localAIExpectedSHA256("3.12.1", "local-ai-v3.12.1-linux-amd64")
	if err == nil {
		t.Fatal("expected missing checksum error")
	}
	if !errors.Is(err, ErrEngineBinaryDownloadFailed) {
		t.Fatalf("expected ErrEngineBinaryDownloadFailed, got %v", err)
	}
}

func TestPlatformString(t *testing.T) {
	ps := PlatformString()
	if ps == "" {
		t.Fatal("expected non-empty platform string")
	}
	if ps != runtime.GOOS+"/"+runtime.GOARCH {
		t.Errorf("expected %s/%s, got %s", runtime.GOOS, runtime.GOARCH, ps)
	}
}

// --- Health probe tests ---

func TestProbeHealthSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("ok"))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/readyz", "")
	if err != nil {
		t.Errorf("expected healthy, got error: %v", err)
	}
}

func TestProbeHealthBodyMatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Nexa SDK is running"))
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/", "Nexa SDK is running")
	if err != nil {
		t.Errorf("expected healthy, got error: %v", err)
	}
}

func TestProbeHealthBodyMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("something else"))
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/", "Nexa SDK is running")
	if err == nil {
		t.Error("expected error for body mismatch, got nil")
	}
}

func TestProbeHealthServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/readyz", "")
	if err == nil {
		t.Error("expected error for 500 status, got nil")
	}
}

func TestProbeHealthUnreachable(t *testing.T) {
	err := ProbeHealth(context.Background(), "http://127.0.0.1:59999", "/readyz", "")
	if err == nil {
		t.Error("expected error for unreachable server, got nil")
	}
}

func TestProbeSupervisorHealthTCP(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen tcp: %v", err)
	}
	defer listener.Close()

	cfg := EngineConfig{
		Kind:           engineLocalAIImageBackend,
		HealthMode:     HealthModeTCP,
		Address:        listener.Addr().String(),
		HealthInterval: 100 * time.Millisecond,
	}
	if err := probeSupervisorHealth(context.Background(), cfg); err != nil {
		t.Fatalf("probeSupervisorHealth(tcp): %v", err)
	}
}

func TestWaitHealthySuccess(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := WaitHealthy(context.Background(), server.URL, "/readyz", "", 50*time.Millisecond, 5*time.Second)
	if err != nil {
		t.Errorf("expected healthy after retries, got error: %v", err)
	}
	if callCount < 3 {
		t.Errorf("expected at least 3 calls, got %d", callCount)
	}
}

func TestWaitHealthyTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	err := WaitHealthy(context.Background(), server.URL, "/readyz", "", 50*time.Millisecond, 200*time.Millisecond)
	if err == nil {
		t.Error("expected timeout error, got nil")
	}
}

func TestWaitHealthyCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	err := WaitHealthy(ctx, server.URL, "/readyz", "", 50*time.Millisecond, 5*time.Second)
	if err == nil {
		t.Error("expected cancel error, got nil")
	}
}

// --- Port resolution tests ---

func TestPortAvailable(t *testing.T) {
	// Port 0 should find an available port.
	if !portAvailable(0) {
		t.Skip("port 0 not available (unusual system)")
	}
}

func TestResolvePort(t *testing.T) {
	// Port 0 should resolve to something.
	port, err := resolvePort(0)
	if err != nil {
		t.Fatalf("resolvePort(0): %v", err)
	}
	if port < 0 {
		t.Errorf("expected non-negative port, got %d", port)
	}
}

// --- Download tests (with httptest mock) ---

func TestDownloadFromURLSuccess(t *testing.T) {
	fakeBinary := []byte("#!/bin/sh\necho hello\n")
	hasher := sha256.New()
	hasher.Write(fakeBinary)
	expectedHash := hex.EncodeToString(hasher.Sum(nil))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(fakeBinary)))
		w.WriteHeader(http.StatusOK)
		w.Write(fakeBinary)
	}))
	defer server.Close()

	destDir := filepath.Join(t.TempDir(), "engines", "test")
	binaryPath, hash, err := downloadFromURL(server.URL+"/fake-binary", destDir, "test-binary")
	if err != nil {
		t.Fatalf("downloadFromURL: %v", err)
	}

	if hash != expectedHash {
		t.Errorf("SHA256 mismatch: got %s, want %s", hash, expectedHash)
	}

	if filepath.Base(binaryPath) != "test-binary" {
		t.Errorf("unexpected binary name: %s", filepath.Base(binaryPath))
	}

	info, err := os.Stat(binaryPath)
	if err != nil {
		t.Fatalf("stat binary: %v", err)
	}
	if info.Mode().Perm()&0o755 != 0o755 {
		t.Errorf("expected 0755 permissions, got %o", info.Mode().Perm())
	}
	if info.Size() != int64(len(fakeBinary)) {
		t.Errorf("expected size %d, got %d", len(fakeBinary), info.Size())
	}

	// No .download residue.
	tmpPath := binaryPath + ".download"
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Errorf("expected no .download tmp file, but it exists")
	}
}

func TestDownloadFromURLHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	destDir := filepath.Join(t.TempDir(), "engines", "test")
	_, _, err := downloadFromURL(server.URL+"/missing", destDir, "test-binary")
	if err == nil {
		t.Fatal("expected error for HTTP 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("expected error to mention 404, got: %v", err)
	}

	// No residual files.
	entries, _ := os.ReadDir(destDir)
	for _, e := range entries {
		t.Errorf("unexpected residual file: %s", e.Name())
	}
}

func TestDownloadFromURLHashMismatch(t *testing.T) {
	fakeBinary := []byte("#!/bin/sh\necho hello\n")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(fakeBinary)
	}))
	defer server.Close()

	destDir := filepath.Join(t.TempDir(), "engines", "test")
	_, _, err := downloadFromURLWithExpectedSHA256(server.URL+"/fake-binary", destDir, "test-binary", strings.Repeat("0", 64))
	if err == nil {
		t.Fatal("expected hash mismatch error")
	}
	if !errors.Is(err, ErrEngineBinaryHashMismatch) {
		t.Fatalf("expected ErrEngineBinaryHashMismatch, got %v", err)
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
	if len(engines) != 2 {
		t.Fatalf("expected 2 known engines (localai+nexa), got %d", len(engines))
	}
	seen := map[EngineKind]bool{}
	for _, info := range engines {
		seen[info.Kind] = true
		if info.Status != StatusStopped {
			t.Fatalf("expected stopped status for non-running engine %s, got %s", info.Kind, info.Status)
		}
	}
	if !seen[EngineLocalAI] || !seen[EngineNexa] {
		t.Fatalf("expected list to include localai and nexa, got %+v", engines)
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

func TestManagerEngineEndpointNotStarted(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EngineEndpoint(EngineLocalAI)
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

	_, err = mgr.EngineStatus(EngineLocalAI)
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

// --- Supervisor tests ---

func TestSupervisorInitialStatus(t *testing.T) {
	cfg := DefaultLocalAIConfig()
	sup := NewSupervisor(cfg, nil, nil)

	if sup.Status() != StatusStopped {
		t.Errorf("expected initial status %s, got %s", StatusStopped, sup.Status())
	}
}

func TestSupervisorInfo(t *testing.T) {
	cfg := DefaultLocalAIConfig()
	cfg.Port = 9999
	sup := NewSupervisor(cfg, nil, nil)

	info := sup.Info()
	if info.Kind != EngineLocalAI {
		t.Errorf("expected kind %s, got %s", EngineLocalAI, info.Kind)
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
	if len(engines) != 2 {
		t.Fatalf("expected 2 known engines, got %d", len(engines))
	}
	seen := map[string]bool{}
	for _, info := range engines {
		seen[info.Engine] = true
		if info.Status != string(StatusStopped) {
			t.Fatalf("expected stopped status for non-running engine %s, got %s", info.Engine, info.Status)
		}
	}
	if !seen[string(EngineLocalAI)] || !seen[string(EngineNexa)] {
		t.Fatalf("expected adapter list to include localai and nexa, got %+v", engines)
	}
}

func TestServiceAdapterEngineStatusNotFound(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	_, err = adapter.EngineStatus("localai")
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
	err = adapter.StopEngine("localai")
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestManagerApplyLocalAIPaths(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	configPath := filepath.Join(t.TempDir(), "localai-models.yaml")
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
		t.Fatalf("write localai models config: %v", err)
	}

	mgr.SetLocalAIPaths("/data/models", configPath)
	cfg := mgr.applyLocalAIPaths(DefaultLocalAIConfig())
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
	if got, want := cfg.BackendsPath, filepath.Join(homeDir, ".nimi", "runtime", "localai-backends"); got != want {
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
		{"localai", EngineLocalAI, false},
		{"nexa", EngineNexa, false},
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

// --- Supervisor process lifecycle tests ---
// These tests use real processes via shell scripts and require unix signals.

// writeTestScript creates an executable shell script in t.TempDir() and returns its path.
func writeTestScript(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test-engine.sh")
	content := "#!/bin/sh\n" + body + "\n"
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("write test script: %v", err)
	}
	return path
}

// testSupervisorCfg returns an EngineConfig with short timeouts for testing.
func testSupervisorCfg(scriptPath string) EngineConfig {
	return EngineConfig{
		Kind:             EngineLocalAI,
		BinaryPath:       scriptPath,
		Port:             0,
		Version:          "test",
		HealthPath:       "/readyz",
		StartupTimeout:   500 * time.Millisecond,
		HealthInterval:   100 * time.Millisecond,
		MaxRestarts:      2,
		RestartBaseDelay: 50 * time.Millisecond,
		ShutdownTimeout:  1 * time.Second,
	}
}

// testLogger returns a slog.Logger that discards output.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

// waitForStatus polls sup.Status() until it matches or timeout.
func waitForStatus(sup *Supervisor, want EngineStatus, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if sup.Status() == want {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return sup.Status() == want
}

func TestSupervisorStartStop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)
	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sup.Stop()

	info := sup.Info()
	if info.PID <= 0 {
		t.Errorf("expected PID > 0, got %d", info.PID)
	}
	if info.Status != StatusStarting && info.Status != StatusUnhealthy && info.Status != StatusHealthy {
		t.Errorf("expected status starting/unhealthy/healthy, got %s", info.Status)
	}

	pid := info.PID
	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if sup.Status() != StatusStopped {
		t.Errorf("expected status stopped after Stop, got %s", sup.Status())
	}

	// Verify process is dead.
	time.Sleep(50 * time.Millisecond)
	if err := syscall.Kill(pid, 0); err == nil {
		t.Errorf("expected process %d to be dead after Stop", pid)
	}
}

func TestSupervisorStartAlreadyRunning(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)
	cfg.StartupTimeout = 5 * time.Second // long enough to race
	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()

	// Start in goroutine — it blocks on WaitHealthy.
	errCh := make(chan error, 1)
	go func() {
		errCh <- sup.Start(ctx)
	}()
	defer sup.Stop()

	// Wait for status to become Starting (process spawned, health check in progress).
	if !waitForStatus(sup, StatusStarting, 3*time.Second) {
		t.Fatal("timed out waiting for starting status")
	}

	// Second Start should fail with "already running".
	err := sup.Start(ctx)
	if err == nil {
		t.Fatal("expected error for already running, got nil")
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("expected 'already running' error, got: %v", err)
	}

	// Wait for the first Start to finish (will fail health check).
	<-errCh
}

func TestSupervisorCrashRestart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	script := writeTestScript(t, "exit 1")
	cfg := testSupervisorCfg(script)
	cfg.MaxRestarts = 10
	cfg.HealthInterval = 500 * time.Millisecond
	cfg.RestartBaseDelay = 10 * time.Millisecond
	cfg.StartupTimeout = 200 * time.Millisecond

	// Use a channel to wait for at least 2 "starting" state transitions.
	startingCh := make(chan struct{}, 10)
	onState := func(kind EngineKind, status EngineStatus, detail string) {
		if status == StatusStarting {
			select {
			case startingCh <- struct{}{}:
			default:
			}
		}
	}

	sup := NewSupervisor(cfg, testLogger(), onState)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sup.Stop()

	// First "starting" from initial spawn.
	select {
	case <-startingCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for first starting callback")
	}

	// Second "starting" from crash→restart.
	select {
	case <-startingCh:
	case <-time.After(8 * time.Second):
		t.Fatal("timed out waiting for restart starting callback — crash restart did not trigger")
	}
}

func TestSupervisorStopCancelsPendingRestart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	script := writeTestScript(t, "exit 1")
	cfg := testSupervisorCfg(script)
	cfg.MaxRestarts = 5
	cfg.RestartBaseDelay = 500 * time.Millisecond
	cfg.StartupTimeout = 100 * time.Millisecond

	var startingCount atomic.Int32
	onState := func(kind EngineKind, status EngineStatus, detail string) {
		if status == StatusStarting {
			startingCount.Add(1)
		}
	}

	sup := NewSupervisor(cfg, testLogger(), onState)
	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	if !waitForStatus(sup, StatusUnhealthy, 2*time.Second) {
		t.Fatalf("expected unhealthy before stop, got %s", sup.Status())
	}

	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	startingAfterStop := startingCount.Load()

	time.Sleep(1200 * time.Millisecond)
	if got := startingCount.Load(); got != startingAfterStop {
		t.Fatalf("unexpected restart after stop: before=%d after=%d", startingAfterStop, got)
	}
}

func TestSupervisorMaxRestartsExhausted(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	script := writeTestScript(t, "exit 1")
	cfg := testSupervisorCfg(script)
	cfg.MaxRestarts = 1
	cfg.RestartBaseDelay = 10 * time.Millisecond

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sup.Stop()

	// Wait for max restarts to be exhausted.
	if !waitForStatus(sup, StatusUnhealthy, 5*time.Second) {
		t.Errorf("expected status unhealthy after max restarts, got %s", sup.Status())
	}
}

func TestSupervisorGracefulShutdown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)
	cfg.ShutdownTimeout = 5 * time.Second

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	pid := sup.Info().PID

	start := time.Now()
	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	elapsed := time.Since(start)

	if sup.Status() != StatusStopped {
		t.Errorf("expected status stopped, got %s", sup.Status())
	}
	// Graceful: should finish well before ShutdownTimeout.
	if elapsed > 4*time.Second {
		t.Errorf("expected graceful shutdown in < 4s, took %s", elapsed)
	}

	// Process should be dead.
	time.Sleep(50 * time.Millisecond)
	if err := syscall.Kill(pid, 0); err == nil {
		t.Errorf("expected process %d to be dead after graceful stop", pid)
	}
}

func TestSupervisorForceKill(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	// Script traps SIGTERM and ignores it, forcing SIGKILL.
	script := writeTestScript(t, "trap '' TERM; sleep 60")
	cfg := testSupervisorCfg(script)
	cfg.ShutdownTimeout = 500 * time.Millisecond

	sup := NewSupervisor(cfg, testLogger(), nil)

	ctx := context.Background()
	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	pid := sup.Info().PID

	if err := sup.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	if sup.Status() != StatusStopped {
		t.Errorf("expected status stopped after force kill, got %s", sup.Status())
	}

	// Process should be dead after SIGKILL.
	time.Sleep(50 * time.Millisecond)
	if err := syscall.Kill(pid, 0); err == nil {
		t.Errorf("expected process %d to be dead after SIGKILL", pid)
	}
}

// --- Command construction tests ---

func TestLocalAICommandArgs(t *testing.T) {
	cfg := EngineConfig{
		Kind:       EngineLocalAI,
		BinaryPath: "/usr/local/bin/local-ai",
		Port:       5555,
	}
	cmd := localAICommand(cfg)
	args := strings.Join(cmd.Args[1:], " ")

	for _, want := range []string{"run", "--address", ":5555", "--disable-web-ui", "--log-level", "info"} {
		if !strings.Contains(args, want) {
			t.Errorf("expected args to contain %q, got: %s", want, args)
		}
	}
	if strings.Contains(args, "--models-path") {
		t.Error("expected no --models-path when ModelsPath is empty")
	}
	if strings.Contains(args, "--models-config-file") {
		t.Error("expected no --models-config-file when ModelsConfigPath is empty")
	}
	if strings.Contains(args, "--backends-path") {
		t.Error("expected no --backends-path when BackendsPath is empty")
	}
	if strings.Contains(args, "--external-backends") {
		t.Error("expected no --external-backends when ExternalBackends is empty")
	}

	// With ModelsPath.
	cfg.ModelsPath = "/data/models"
	cfg.ModelsConfigPath = "/data/runtime/localai-models.yaml"
	cfg.BackendsPath = "/data/runtime/localai-backends"
	cfg.ExternalBackends = []string{"llama-cpp", "whisper-ggml"}
	cfg.ExternalGRPCBackends = []string{"stablediffusion-ggml:127.0.0.1:50052"}
	cmd2 := localAICommand(cfg)
	args2 := strings.Join(cmd2.Args[1:], " ")
	if !strings.Contains(args2, "--models-path") || !strings.Contains(args2, "/data/models") {
		t.Errorf("expected --models-path /data/models, got: %s", args2)
	}
	if !strings.Contains(args2, "--models-config-file") || !strings.Contains(args2, "/data/runtime/localai-models.yaml") {
		t.Errorf("expected --models-config-file /data/runtime/localai-models.yaml, got: %s", args2)
	}
	if !strings.Contains(args2, "--backends-path") || !strings.Contains(args2, "/data/runtime/localai-backends") {
		t.Errorf("expected --backends-path /data/runtime/localai-backends, got: %s", args2)
	}
	if !strings.Contains(args2, "--external-backends") || !strings.Contains(args2, "llama-cpp,whisper-ggml") {
		t.Errorf("expected --external-backends llama-cpp,whisper-ggml, got: %s", args2)
	}
	if !strings.Contains(args2, "--external-grpc-backends") || !strings.Contains(args2, "stablediffusion-ggml:127.0.0.1:50052") {
		t.Errorf("expected --external-grpc-backends stablediffusion-ggml:127.0.0.1:50052, got: %s", args2)
	}
}

func TestDetectLocalAIExternalBackends(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "localai-models.yaml")
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
		t.Fatalf("write localai models config: %v", err)
	}

	if got, want := strings.Join(detectLocalAIExternalBackends(configPath), ","), "llama-cpp,whisper-ggml"; got != want {
		t.Fatalf("detectLocalAIExternalBackends mismatch: got=%q want=%q", got, want)
	}
}

func TestDiscoverInstalledLocalAIBackendRunPathPrefersAlias(t *testing.T) {
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

	discovered, err := discoverInstalledLocalAIBackendRunPath(backendsPath, "stablediffusion-ggml")
	if err != nil {
		t.Fatalf("discoverInstalledLocalAIBackendRunPath: %v", err)
	}
	if discovered != runPath {
		t.Fatalf("run path mismatch: got=%q want=%q", discovered, runPath)
	}
}

func TestNexaCommandArgs(t *testing.T) {
	cfg := EngineConfig{
		Kind:       EngineNexa,
		BinaryPath: "/usr/local/bin/nexa",
		Port:       9000,
	}
	cmd := nexaCommand(cfg)
	args := strings.Join(cmd.Args[1:], " ")

	for _, want := range []string{"server", "--host", "127.0.0.1", "--port", "9000"} {
		if !strings.Contains(args, want) {
			t.Errorf("expected args to contain %q, got: %s", want, args)
		}
	}
}

// --- Adapter/DTO conversion tests ---

func TestResolveEngineConfigOverrides(t *testing.T) {
	// Default values.
	cfg, err := resolveEngineConfig("localai", "", 0)
	if err != nil {
		t.Fatalf("resolveEngineConfig: %v", err)
	}
	if cfg.Version != "3.12.1" {
		t.Errorf("expected default version 3.12.1, got %s", cfg.Version)
	}
	if cfg.Port != 1234 {
		t.Errorf("expected default port 1234, got %d", cfg.Port)
	}

	// Override version and port.
	cfg2, err := resolveEngineConfig("localai", "2.0", 9999)
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
		Kind:      EngineLocalAI,
		Version:   "3.12.1",
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

	cfg := DefaultLocalAIConfig()
	cfg.BinaryPath = binaryPath
	sup := NewSupervisor(cfg, nil, nil)

	info := sup.Info()
	if info.BinarySizeBytes != int64(len(content)) {
		t.Errorf("expected BinarySizeBytes %d, got %d", len(content), info.BinarySizeBytes)
	}

	// Non-existent path → 0.
	cfg2 := DefaultLocalAIConfig()
	cfg2.BinaryPath = filepath.Join(dir, "nonexistent")
	sup2 := NewSupervisor(cfg2, nil, nil)
	info2 := sup2.Info()
	if info2.BinarySizeBytes != 0 {
		t.Errorf("expected BinarySizeBytes 0 for missing path, got %d", info2.BinarySizeBytes)
	}
}

// --- Port conflict resolution test ---

func TestResolvePortOccupied(t *testing.T) {
	// Occupy a port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	addr := ln.Addr().(*net.TCPAddr)
	occupiedPort := addr.Port

	resolved, err := resolvePort(occupiedPort)
	if err != nil {
		t.Fatalf("resolvePort(%d): %v", occupiedPort, err)
	}
	if resolved == occupiedPort {
		t.Errorf("expected different port than occupied %d, got %d", occupiedPort, resolved)
	}
	if resolved < occupiedPort+1 {
		t.Errorf("expected resolved port > %d, got %d", occupiedPort, resolved)
	}
}

// --- State change callback test ---

func TestSupervisorStateCallback(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("supervisor process tests require unix signals")
	}

	script := writeTestScript(t, "sleep 60")
	cfg := testSupervisorCfg(script)

	var mu sync.Mutex
	var states []EngineStatus

	onState := func(kind EngineKind, status EngineStatus, detail string) {
		mu.Lock()
		states = append(states, status)
		mu.Unlock()
	}

	sup := NewSupervisor(cfg, testLogger(), onState)
	ctx := context.Background()

	if err := sup.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sup.Stop()

	// Give callbacks time to fire.
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	stateCopy := make([]EngineStatus, len(states))
	copy(stateCopy, states)
	mu.Unlock()

	hasStarting := false
	for _, s := range stateCopy {
		if s == StatusStarting {
			hasStarting = true
			break
		}
	}
	if !hasStarting {
		t.Errorf("expected at least 'starting' state in callbacks, got: %v", stateCopy)
	}
}
