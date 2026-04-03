package engine

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
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
	pythonPath, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	scriptPath := writeMediaServerScriptForTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "--port", "0")
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatal("expected media server to fail without NIMI_MEDIA_MODE")
	}
	if !strings.Contains(string(output), "NIMI_MEDIA_MODE is required") {
		t.Fatalf("expected strict mode parse failure, got %q", string(output))
	}
}

func TestMediaServerRejectsInvalidMode(t *testing.T) {
	pythonPath, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	scriptPath := writeMediaServerScriptForTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "--port", "0")
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "NIMI_MEDIA_MODE=invalid_mode")
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatal("expected media server to fail for invalid NIMI_MEDIA_MODE")
	}
	if !strings.Contains(string(output), "invalid NIMI_MEDIA_MODE") {
		t.Fatalf("expected invalid mode failure, got %q", string(output))
	}
}

func TestMediaServerStartsWithValidProxyMode(t *testing.T) {
	pythonPath, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	llamaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"data":[{"id":"managed-image-model"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer llamaServer.Close()

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
		os.Environ(),
		"PYTHONUNBUFFERED=1",
		"NIMI_MEDIA_MODE=proxy_execution",
		"NIMI_MEDIA_LLAMA_BASE_URL="+llamaServer.URL+"/v1",
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
			if readErr == nil && resp.StatusCode == http.StatusOK && strings.Contains(string(body), `"ready": true`) {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected proxy mode media server to report healthy at %s", healthURL)
		}
		time.Sleep(50 * time.Millisecond)
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
