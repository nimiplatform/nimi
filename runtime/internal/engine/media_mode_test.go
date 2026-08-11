package engine

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResolveConfiguredMediaModeRequiresExplicitMode(t *testing.T) {
	_, err := resolveConfiguredMediaMode(DefaultMediaConfig())
	if err == nil || !strings.Contains(err.Error(), "media bootstrap mode is required") {
		t.Fatalf("expected missing media mode error, got %v", err)
	}
}

func TestEnsureMediaDoesNotMaterializeHiddenDependencies(t *testing.T) {
	baseDir := t.TempDir()
	cfg := DefaultMediaConfig()
	cfg.MediaMode = MediaModePipelineSupervised
	cfg.MediaHostAcceleratorPlane = "cpu"
	runtimeWorkRoot := filepath.Join(baseDir, "runtime-work")
	_, err := ensureMedia(context.Background(), runtimeWorkRoot, cfg)
	if err == nil {
		t.Fatal("expected media startup to fail closed without selected sources")
	}
	if strings.Contains(err.Error(), "ensure uv") || strings.Contains(err.Error(), "install media dependencies") {
		t.Fatalf("media startup attempted hidden materialization: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(baseDir, "uv")); !os.IsNotExist(statErr) {
		t.Fatalf("media startup created uv root or unexpected stat error: %v", statErr)
	}
	if _, statErr := os.Stat(runtimeWorkRoot); !os.IsNotExist(statErr) {
		t.Fatalf("media startup created work state before an activated profile was admitted: %v", statErr)
	}
}

func TestEnsureMediaUsesActivatedImmutableProfileAndExternalRuntimeCaches(t *testing.T) {
	profileRoot := t.TempDir()
	runtimeWorkRoot := filepath.Join(t.TempDir(), "runtime-work")
	cfg := DefaultMediaConfig()
	cfg.MediaMode = MediaModePipelineSupervised
	cfg.MediaHostPackageSetRoot = profileRoot
	cfg.MediaHostAcceleratorPlane = "cpu"
	pythonPath := managedPythonPath(profileRoot)
	if err := os.MkdirAll(filepath.Dir(pythonPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pythonPath, []byte("python"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profileRoot, "media_server.py"), []byte(mediaServerScript), 0o444); err != nil {
		t.Fatal(err)
	}
	ready, err := ensureMedia(context.Background(), runtimeWorkRoot, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if ready.BinaryPath != pythonPath {
		t.Fatalf("media activated profile binary path = %q, want %q", ready.BinaryPath, pythonPath)
	}
	if got := supervisorCommandExecutablePath(ready); got != managedPythonLaunchPath(profileRoot) {
		t.Fatalf("media launch path = %q, want %q", got, managedPythonLaunchPath(profileRoot))
	}
	wantWorkRoot := filepath.Join(runtimeWorkRoot, "media-driver")
	if ready.WorkingDir != wantWorkRoot {
		t.Fatalf("media Runtime-owned working root = %q, want %q", ready.WorkingDir, wantWorkRoot)
	}
	for _, key := range []string{"HF_HOME", "HF_HUB_CACHE", "TRANSFORMERS_CACHE", "DIFFUSERS_CACHE"} {
		path := ready.CommandEnv[key]
		insideProfile, pathErr := mediaPathWithinRoot(profileRoot, path)
		if pathErr != nil {
			t.Fatalf("compare %s cache path: %v", key, pathErr)
		}
		if insideProfile {
			t.Fatalf("%s cache path escaped into immutable profile: %q", key, path)
		}
		if _, statErr := os.Stat(path); statErr != nil {
			t.Fatalf("%s cache path is not ready: %v", key, statErr)
		}
	}
	if ready.CommandEnv["PYTHONDONTWRITEBYTECODE"] != "1" || ready.CommandEnv["PYTHONNOUSERSITE"] != "1" {
		t.Fatalf("media immutable profile guards missing: %+v", ready.CommandEnv)
	}
	mergedEnv := mergeSupervisorCommandEnv([]string{
		"PYTHONPATH=ambient-modules",
		"PYTHONHOME=ambient-home",
		"NIMI_TEST_MEDIA_ENV_PRESERVED=kept",
	}, ready.CommandEnv)
	for _, key := range []string{"PYTHONPATH", "PYTHONHOME"} {
		if got := supervisorEnvValue(mergedEnv, key); got != "" {
			t.Fatalf("media child inherited %s = %q", key, got)
		}
	}
	if got := supervisorEnvValue(mergedEnv, "NIMI_TEST_MEDIA_ENV_PRESERVED"); got != "kept" {
		t.Fatalf("media child discarded unrelated host environment = %q", got)
	}
	if ready.CommandEnv["NIMI_MEDIA_DEVICE"] != "cpu" {
		t.Fatalf("media device = %q, want verified host plane cpu", ready.CommandEnv["NIMI_MEDIA_DEVICE"])
	}
	if _, statErr := os.Stat(filepath.Join(profileRoot, "cache")); !os.IsNotExist(statErr) {
		t.Fatalf("media startup wrote a cache into the immutable profile: %v", statErr)
	}
	cudaConfig := cfg
	cudaConfig.MediaHostAcceleratorPlane = " CUDA "
	cudaReady, err := ensureMedia(context.Background(), runtimeWorkRoot, cudaConfig)
	if err != nil {
		t.Fatalf("ensure CUDA media profile: %v", err)
	}
	if cudaReady.MediaHostAcceleratorPlane != "cuda" || cudaReady.CommandEnv["NIMI_MEDIA_DEVICE"] != "cuda" {
		t.Fatalf("CUDA media plane was not normalized and projected: %+v", cudaReady)
	}
}

func TestEnsureMediaRejectsDriftedProfileDriverAndProfileLocalWorkRoot(t *testing.T) {
	profileRoot := t.TempDir()
	cfg := DefaultMediaConfig()
	cfg.MediaMode = MediaModePipelineSupervised
	cfg.MediaHostPackageSetRoot = profileRoot
	cfg.MediaHostAcceleratorPlane = "cpu"
	pythonPath := managedPythonPath(profileRoot)
	if err := os.MkdirAll(filepath.Dir(pythonPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pythonPath, []byte("python"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profileRoot, "media_server.py"), []byte("print('drift')\n"), 0o444); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureMedia(context.Background(), t.TempDir(), cfg); err == nil || !strings.Contains(err.Error(), "content drift") {
		t.Fatalf("expected drifted promoted Driver to fail closed, got %v", err)
	}
	if err := os.Chmod(filepath.Join(profileRoot, "media_server.py"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profileRoot, "media_server.py"), []byte(mediaServerScript), 0o444); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureMedia(context.Background(), filepath.Join(profileRoot, "work"), cfg); err == nil || !strings.Contains(err.Error(), "outside the activated dependency profile") {
		t.Fatalf("expected profile-local media work root to fail closed, got %v", err)
	}
}

func TestEnsureMediaRejectsMissingOrUnsupportedHostAcceleratorPlane(t *testing.T) {
	for _, plane := range []string{"", "metal", "cuda:0"} {
		cfg := DefaultMediaConfig()
		cfg.MediaMode = MediaModePipelineSupervised
		cfg.MediaHostAcceleratorPlane = plane
		if _, err := ensureMedia(context.Background(), t.TempDir(), cfg); err == nil || !strings.Contains(err.Error(), "must be cpu or cuda") {
			t.Fatalf("accelerator plane %q should fail closed, got %v", plane, err)
		}
	}
}

func TestResolveConfiguredMediaModeRejectsSelectionMismatch(t *testing.T) {
	selection := ImageSupervisedMatrixSelection{
		Matched:        true,
		EntryID:        "macos-apple-silicon-gguf",
		ProductState:   ImageProductStateSupported,
		BackendClass:   ImageBackendClassNativeBinary,
		ControlPlane:   ImageControlPlaneRuntime,
		ExecutionPlane: EngineMedia,
		Entry: &ImageSupervisedMatrixEntry{
			EntryID:        "macos-apple-silicon-gguf",
			ProductState:   ImageProductStateSupported,
			BackendClass:   ImageBackendClassNativeBinary,
			ControlPlane:   ImageControlPlaneRuntime,
			ExecutionPlane: EngineMedia,
		},
	}
	_, err := resolveConfiguredMediaMode(EngineConfig{
		Kind:                     EngineMedia,
		MediaMode:                MediaModePipelineSupervised,
		ImageSupervisedSelection: &selection,
	})
	if err == nil || !strings.Contains(err.Error(), "does not match image supervised selection mode") {
		t.Fatalf("expected selection mismatch error, got %v", err)
	}
}

func TestResolveConfiguredMediaModeAllowsExplicitPipelineModeWithoutSelection(t *testing.T) {
	mode, err := resolveConfiguredMediaMode(EngineConfig{
		Kind:      EngineMedia,
		MediaMode: MediaModePipelineSupervised,
	})
	if err != nil {
		t.Fatalf("resolveConfiguredMediaMode: %v", err)
	}
	if mode != MediaModePipelineSupervised {
		t.Fatalf("expected pipeline_supervised, got %q", mode)
	}
}

func TestMediaModeFromSelectionMapsNativeSafetensorsToProxyExecution(t *testing.T) {
	selection := ImageSupervisedMatrixSelection{
		Matched:        true,
		EntryID:        "linux-x64-nvidia-safetensors-native",
		ProductState:   ImageProductStateSupported,
		BackendClass:   ImageBackendClassNativeBinary,
		BackendFamily:  ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:   ImageControlPlaneRuntime,
		ExecutionPlane: EngineMedia,
		Entry: &ImageSupervisedMatrixEntry{
			EntryID:        "linux-x64-nvidia-safetensors-native",
			AssetFamily:    ImageAssetFamilySafetensorsNativeImage,
			ProductState:   ImageProductStateSupported,
			BackendClass:   ImageBackendClassNativeBinary,
			BackendFamily:  ImageBackendFamilyStableDiffusionGGML,
			ControlPlane:   ImageControlPlaneRuntime,
			ExecutionPlane: EngineMedia,
		},
	}

	mode, err := MediaModeFromSelection(selection)
	if err != nil {
		t.Fatalf("MediaModeFromSelection: %v", err)
	}
	if mode != MediaModeProxyExecution {
		t.Fatalf("expected proxy_execution, got %q", mode)
	}
}

func TestMediaServerRequiresExplicitMode(t *testing.T) {
	if currentGOOS() == "windows" {
		t.Skip("media server mode subprocess assertions are not stable on Windows")
	}
	pythonPath, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	scriptPath := writeMediaServerScriptForTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "--port", "0")
	cmd.Env = mediaServerTestEnv("PYTHONUNBUFFERED=1")
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatal("expected media server to fail without NIMI_MEDIA_MODE")
	}
	if !strings.Contains(string(output), "NIMI_MEDIA_MODE is required") {
		t.Fatalf("expected strict mode parse failure, got %q", string(output))
	}
}

func TestMediaServerRejectsInvalidMode(t *testing.T) {
	if currentGOOS() == "windows" {
		t.Skip("media server mode subprocess assertions are not stable on Windows")
	}
	pythonPath, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	scriptPath := writeMediaServerScriptForTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "--port", "0")
	cmd.Env = mediaServerTestEnv("PYTHONUNBUFFERED=1", "NIMI_MEDIA_MODE=invalid_mode")
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatal("expected media server to fail for invalid NIMI_MEDIA_MODE")
	}
	if !strings.Contains(string(output), "invalid NIMI_MEDIA_MODE") {
		t.Fatalf("expected invalid mode failure, got %q", string(output))
	}
}

func TestMediaServerStartsWithValidProxyMode(t *testing.T) {
	if currentGOOS() == "windows" {
		t.Skip("media server mode subprocess assertions are not stable on Windows")
	}
	pythonPath, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	scriptPath := writeMediaServerScriptForTest(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "--host", "127.0.0.1", "--port", fmt.Sprintf("%d", port))
	cmd.Env = append(
		mediaServerTestEnv(),
		"PYTHONUNBUFFERED=1",
		"NIMI_MEDIA_MODE=proxy_execution",
	)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start media server: %v", err)
	}
	defer func() {
		cancel()
		_ = cmd.Wait()
	}()

	healthURL := fmt.Sprintf("http://127.0.0.1:%d/healthz", port)
	deadline := time.Now().Add(5 * time.Second)
	for {
		resp, err := http.Get(healthURL)
		if err == nil {
			body, readErr := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if readErr == nil && resp.StatusCode == http.StatusServiceUnavailable && strings.Contains(string(body), `"ready": false`) {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected proxy mode media server to report not execution-ready at %s", healthURL)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestMediaServerProxyModeImageGenerateFailsClosed(t *testing.T) {
	if currentGOOS() == "windows" {
		t.Skip("media server mode subprocess assertions are not stable on Windows")
	}
	pythonPath, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}

	scriptPath := writeMediaServerScriptForTest(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "--host", "127.0.0.1", "--port", fmt.Sprintf("%d", port))
	cmd.Env = append(
		mediaServerTestEnv(),
		"PYTHONUNBUFFERED=1",
		"NIMI_MEDIA_MODE=proxy_execution",
	)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start media server: %v", err)
	}
	defer func() {
		cancel()
		_ = cmd.Wait()
	}()

	healthURL := fmt.Sprintf("http://127.0.0.1:%d/healthz", port)
	deadline := time.Now().Add(5 * time.Second)
	for {
		resp, err := http.Get(healthURL)
		if err == nil {
			body, readErr := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if readErr == nil && resp.StatusCode == http.StatusServiceUnavailable && strings.Contains(string(body), `"ready": false`) {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected proxy mode media server to report not execution-ready at %s", healthURL)
		}
		time.Sleep(50 * time.Millisecond)
	}

	req, err := http.NewRequest(
		http.MethodPost,
		fmt.Sprintf("http://127.0.0.1:%d/v1/media/image/generate", port),
		bytes.NewBufferString(`{"model":"local/image","spec":{"prompt":"orange cat"}}`),
	)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request image generate: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", resp.StatusCode, string(body))
	}
	if !strings.Contains(string(body), "fail-closed") {
		t.Fatalf("expected fail-closed detail, got %s", string(body))
	}
}

func writeMediaServerScriptForTest(t *testing.T) string {
	t.Helper()
	scriptPath := filepath.Join(t.TempDir(), "media_server.py")
	if err := os.WriteFile(scriptPath, []byte(mediaServerScript), 0o755); err != nil {
		t.Fatalf("write media server script: %v", err)
	}
	return scriptPath
}

func mediaServerTestEnv(extra ...string) []string {
	env := make([]string, 0, len(os.Environ())+len(extra))
	for _, item := range os.Environ() {
		key, _, ok := strings.Cut(item, "=")
		if ok && key == "NIMI_MEDIA_MODE" {
			continue
		}
		env = append(env, item)
	}
	return append(env, extra...)
}
