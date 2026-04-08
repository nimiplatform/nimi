package managedimagebackend

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
)

type fakeBackendDriver struct {
	loads     []loadModelState
	generates []imageGenerateState
	frees     []loadModelState
}

func (f *fakeBackendDriver) LoadModel(state loadModelState) error {
	f.loads = append(f.loads, state)
	return nil
}

func (f *fakeBackendDriver) GenerateImage(_ context.Context, _ loadModelState, req imageGenerateState) error {
	f.generates = append(f.generates, req)
	if err := os.WriteFile(req.Dst, []byte("png"), 0o600); err != nil {
		return err
	}
	return nil
}

func (f *fakeBackendDriver) Free(state loadModelState) error {
	f.frees = append(f.frees, state)
	return nil
}

func TestServerLoadGenerateAndFree(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}
	driver := &fakeBackendDriver{}
	server := &Server{driver: driver}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	grpcServer := grpc.NewServer(grpc.UnknownServiceHandler(server.handleUnknownMethod))
	defer grpcServer.Stop()
	go func() {
		_ = grpcServer.Serve(listener)
	}()

	tempDir := t.TempDir()
	modelDir := filepath.Join(tempDir, "resolved")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatalf("mkdir model dir: %v", err)
	}
	modelPath := filepath.Join(modelDir, "model.gguf")
	vaePath := filepath.Join(modelDir, "ae.safetensors")
	if err := os.WriteFile(modelPath, []byte("gguf"), 0o600); err != nil {
		t.Fatalf("write model path: %v", err)
	}
	if err := os.WriteFile(vaePath, []byte("vae"), 0o600); err != nil {
		t.Fatalf("write vae path: %v", err)
	}
	destinationPath := filepath.Join(tempDir, "artifact.png")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := LoadModel(ctx, LoadModelRequest{
		BackendAddress: listener.Addr().String(),
		ModelsRoot:     tempDir,
		ModelPath:      modelPath,
		Options: []string{
			"diffusion_model",
			"sampler:euler",
			"vae_path:resolved/ae.safetensors",
		},
		CFGScale: 1,
	}); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	if err := GenerateImage(ctx, ImageRequest{
		BackendAddress: listener.Addr().String(),
		Dst:            destinationPath,
		PositivePrompt: "orange cat",
		Width:          512,
		Height:         512,
		Step:           8,
	}); err != nil {
		t.Fatalf("GenerateImage: %v", err)
	}
	if err := FreeModel(ctx, LoadModelRequest{
		BackendAddress: listener.Addr().String(),
		ModelsRoot:     tempDir,
		ModelPath:      modelPath,
		Options:        []string{"diffusion_model"},
		CFGScale:       1,
	}); err != nil {
		t.Fatalf("FreeModel: %v", err)
	}

	if len(driver.loads) != 1 {
		t.Fatalf("expected one load, got %d", len(driver.loads))
	}
	if got := driver.loads[0].Options.VAEPath; got != vaePath {
		t.Fatalf("unexpected resolved VAE path: %q", got)
	}
	if len(driver.generates) != 1 {
		t.Fatalf("expected one generate, got %d", len(driver.generates))
	}
	if len(driver.frees) != 1 {
		t.Fatalf("expected one free, got %d", len(driver.frees))
	}
	if _, err := os.Stat(destinationPath); err != nil {
		t.Fatalf("expected generated artifact: %v", err)
	}
}

func TestParseManagedImageOptionsRejectsUnsupportedKeys(t *testing.T) {
	_, err := parseManagedImageOptions("D:\\models", []string{"unknown_option:value"})
	if err == nil {
		t.Fatal("expected unsupported managed image option to fail-close")
	}
	if !strings.Contains(err.Error(), "unsupported managed image option") {
		t.Fatalf("unexpected parse error: %v", err)
	}
}

func TestStableDiffusionCPPEnvironmentAddsExecutableDirOnDarwin(t *testing.T) {
	originalGOOS := managedImageBackendGOOS
	managedImageBackendGOOS = "darwin"
	t.Cleanup(func() {
		managedImageBackendGOOS = originalGOOS
	})

	env := stableDiffusionCPPEnvironment("/tmp/managed-image/sd-cli", []string{
		"FOO=bar",
		"DYLD_LIBRARY_PATH=/opt/lib",
		"DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib",
	})

	if got := envValue(env, "DYLD_LIBRARY_PATH"); got != "/tmp/managed-image:/opt/lib" {
		t.Fatalf("unexpected DYLD_LIBRARY_PATH: %q", got)
	}
	if got := envValue(env, "DYLD_FALLBACK_LIBRARY_PATH"); got != "/tmp/managed-image:/usr/local/lib" {
		t.Fatalf("unexpected DYLD_FALLBACK_LIBRARY_PATH: %q", got)
	}
}

func TestStableDiffusionCPPEnvironmentAvoidsDuplicateExecutableDir(t *testing.T) {
	originalGOOS := managedImageBackendGOOS
	managedImageBackendGOOS = "darwin"
	t.Cleanup(func() {
		managedImageBackendGOOS = originalGOOS
	})

	env := stableDiffusionCPPEnvironment("/tmp/managed-image/sd-cli", []string{
		"DYLD_LIBRARY_PATH=/tmp/managed-image:/opt/lib",
	})

	if got := envValue(env, "DYLD_LIBRARY_PATH"); got != "/tmp/managed-image:/opt/lib" {
		t.Fatalf("unexpected deduplicated DYLD_LIBRARY_PATH: %q", got)
	}
}

func TestStableDiffusionCPPEnvironmentSkipsNonDarwin(t *testing.T) {
	originalGOOS := managedImageBackendGOOS
	managedImageBackendGOOS = "linux"
	t.Cleanup(func() {
		managedImageBackendGOOS = originalGOOS
	})

	if env := stableDiffusionCPPEnvironment("/tmp/managed-image/sd-cli", []string{"FOO=bar"}); env != nil {
		t.Fatalf("expected nil environment override on non-darwin host, got %#v", env)
	}
}

func TestParseManagedImageOptionsSupportsBooleanAccelerationFlags(t *testing.T) {
	options, err := parseManagedImageOptions("/tmp/models", []string{
		"diffusion_model",
		"offload_params_to_cpu:true",
		"diffusion_fa:true",
	})
	if err != nil {
		t.Fatalf("parseManagedImageOptions: %v", err)
	}
	if options.OffloadParamsToCPU == nil || !*options.OffloadParamsToCPU {
		t.Fatalf("expected offload_params_to_cpu=true, got %#v", options.OffloadParamsToCPU)
	}
	if options.DiffusionFA == nil || !*options.DiffusionFA {
		t.Fatalf("expected diffusion_fa=true, got %#v", options.DiffusionFA)
	}
}

func envValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}
