package managedimagebackend

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

type fakeBackendDriver struct {
	loads     []loadModelState
	generates []imageGenerateState
	frees     []loadModelState
}

func (f *fakeBackendDriver) LoadModel(state loadModelState) (*LoadModelDiagnostics, error) {
	f.loads = append(f.loads, state)
	return nil, nil
}

func (f *fakeBackendDriver) GenerateImage(_ context.Context, _ loadModelState, req imageGenerateState, onProgress func(imageGenerateProgress) error) (*ImageGenerateDiagnostics, error) {
	f.generates = append(f.generates, req)
	if onProgress != nil {
		if err := onProgress(imageGenerateProgress{CurrentStep: 2, TotalSteps: 8, ProgressPercent: 25}); err != nil {
			return nil, err
		}
	}
	if err := os.WriteFile(req.Dst, []byte("png"), 0o600); err != nil {
		return nil, err
	}
	return nil, nil
}

func (f *fakeBackendDriver) Free(state loadModelState) error {
	f.frees = append(f.frees, state)
	return nil
}

type shutdownTrackingBackendDriver struct {
	fakeBackendDriver
	shutdownCalled chan struct{}
}

func (f *shutdownTrackingBackendDriver) Shutdown() error {
	close(f.shutdownCalled)
	return nil
}

func TestServerServeShutsDownBackendDriverOnContextCancel(t *testing.T) {
	driver := &shutdownTrackingBackendDriver{shutdownCalled: make(chan struct{})}
	server := &Server{driver: driver}
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)

	go func() {
		errCh <- server.Serve(ctx, "127.0.0.1:0")
	}()
	cancel()

	select {
	case err := <-errCh:
		if err == nil || err != context.Canceled {
			t.Fatalf("Serve error = %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Serve did not return after context cancellation")
	}
	select {
	case <-driver.shutdownCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("expected backend driver shutdown on server exit")
	}
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
	defer func() { _ = listener.Close() }()
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
	if _, err := LoadModel(ctx, LoadModelRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolManagedWrapper,
		ModelsRoot:     tempDir,
		ModelPath:      modelPath,
		Components: []ComponentBinding{
			{OccurrenceID: "vae", Order: 0, Role: "vae", ComponentKind: "vae", EngineSlot: "vae_path", Path: "resolved/ae.safetensors", Required: true},
		},
		DiffusionFA: true,
	}); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	if _, err := GenerateImage(ctx, ImageRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolManagedWrapper,
		Mode:           ImageRequestModeTextToImage,
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
		Protocol:       ProtocolManagedWrapper,
		ModelsRoot:     tempDir,
		ModelPath:      modelPath,
		Components: []ComponentBinding{
			{OccurrenceID: "vae", Role: "vae", ComponentKind: "vae", EngineSlot: "vae_path", Path: "resolved/ae.safetensors", Required: true},
		},
	}); err != nil {
		t.Fatalf("FreeModel: %v", err)
	}

	if len(driver.loads) != 1 {
		t.Fatalf("expected one load, got %d", len(driver.loads))
	}
	if got := driver.loads[0].Options.ComponentsBySlot()["vae_path"]; got != vaePath {
		t.Fatalf("unexpected resolved VAE path: %q", got)
	}
	if len(driver.loads[0].Options.Components) != 1 || driver.loads[0].Options.Components[0].OccurrenceID != "vae" ||
		driver.loads[0].Options.DiffusionFA == nil || !*driver.loads[0].Options.DiffusionFA {
		t.Fatalf("backend lost ordered component metadata: %+v", driver.loads[0].Options.Components)
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
	message := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	setStringField(message, "ModelPath", t.TempDir())
	setStringField(message, "ModelFile", "model.gguf")
	optionsField := modelOptionsMessageDescriptor.Fields().ByName(protoreflect.Name("Options"))
	message.Mutable(optionsField).List().Append(protoreflect.ValueOfString("unknown_option:value"))
	_, err := decodeLoadModelState(message)
	if err == nil {
		t.Fatal("expected raw managed wrapper option to fail-close")
	}
	if !strings.Contains(err.Error(), "does not accept direct gosd options") {
		t.Fatalf("unexpected parse error: %v", err)
	}
}

func TestStableDiffusionCPPEnvironmentAddsExecutableDirOnDarwin(t *testing.T) {
	originalGOOS := managedImageBackendGOOS
	managedImageBackendGOOS = "darwin"
	t.Cleanup(func() {
		managedImageBackendGOOS = originalGOOS
	})

	env, err := stableDiffusionCPPEnvironment("/tmp/managed-image/sd-cli", []string{
		"FOO=bar",
		"DYLD_LIBRARY_PATH=/opt/lib",
		"DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib",
	}, "")
	if err != nil {
		t.Fatalf("stableDiffusionCPPEnvironment: %v", err)
	}

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

	env, err := stableDiffusionCPPEnvironment("/tmp/managed-image/sd-cli", []string{
		"DYLD_LIBRARY_PATH=/tmp/managed-image:/opt/lib",
	}, "")
	if err != nil {
		t.Fatalf("stableDiffusionCPPEnvironment: %v", err)
	}

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

	env, err := stableDiffusionCPPEnvironment("/tmp/managed-image/sd-cli", []string{"FOO=bar"}, "")
	if err != nil {
		t.Fatalf("stableDiffusionCPPEnvironment: %v", err)
	}
	if env != nil {
		t.Fatalf("expected nil environment override on non-darwin host, got %#v", env)
	}
}

func TestStableDiffusionCPPEnvironmentAddsManagedCUDAPathOnWindows(t *testing.T) {
	originalGOOS := managedImageBackendGOOS
	managedImageBackendGOOS = "windows"
	t.Cleanup(func() {
		managedImageBackendGOOS = originalGOOS
	})

	cudaRuntimeDir := writeManagedImageCUDARuntimeFixtures(t)
	env, err := stableDiffusionCPPEnvironment(`C:\managed-image\sd-server.exe`, []string{
		"Path=C:\\Windows\\System32",
	}, cudaRuntimeDir)
	if err != nil {
		t.Fatalf("stableDiffusionCPPEnvironment: %v", err)
	}

	if got := envValue(env, "PATH"); !strings.HasPrefix(got, cudaRuntimeDir+string(os.PathListSeparator)) {
		t.Fatalf("expected PATH to prepend CUDA runtime dir, got %q", got)
	}
	if strings.Count(envValue(env, "PATH"), cudaRuntimeDir) != 1 {
		t.Fatalf("expected CUDA runtime dir once in PATH, got %q", envValue(env, "PATH"))
	}
}

func TestStableDiffusionCPPEnvironmentRejectsIncompleteManagedCUDAPathOnWindows(t *testing.T) {
	originalGOOS := managedImageBackendGOOS
	managedImageBackendGOOS = "windows"
	t.Cleanup(func() {
		managedImageBackendGOOS = originalGOOS
	})

	cudaRuntimeDir := t.TempDir()
	for _, artifact := range stableDiffusionCPPCUDARequiredArtifacts[:len(stableDiffusionCPPCUDARequiredArtifacts)-1] {
		if err := os.WriteFile(filepath.Join(cudaRuntimeDir, artifact), []byte("dll"), 0o755); err != nil {
			t.Fatalf("write %s: %v", artifact, err)
		}
	}

	_, err := stableDiffusionCPPEnvironment(`C:\managed-image\sd-server.exe`, []string{
		"PATH=C:\\Windows\\System32",
	}, cudaRuntimeDir)
	if err == nil {
		t.Fatal("expected incomplete CUDA runtime dir to fail")
	}
	if !strings.Contains(err.Error(), "shared CUDA dependency DLL set is incomplete") {
		t.Fatalf("unexpected CUDA runtime dir error: %v", err)
	}
}

func TestParseManagedImageOptionsSupportsBooleanAccelerationFlags(t *testing.T) {
	message := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	setStringField(message, "ModelPath", "/tmp/models")
	setStringField(message, "ModelFile", "model.gguf")
	setBoolField(message, "diffusion_fa", true)
	setBoolField(message, "offload_to_cpu", true)
	state, err := decodeLoadModelState(message)
	if err != nil {
		t.Fatalf("decodeLoadModelState: %v", err)
	}
	if state.Options.OffloadParamsToCPU == nil || !*state.Options.OffloadParamsToCPU {
		t.Fatalf("expected offload_to_cpu=true, got %#v", state.Options.OffloadParamsToCPU)
	}
	if state.Options.DiffusionFA == nil || !*state.Options.DiffusionFA {
		t.Fatalf("expected diffusion_fa=true, got %#v", state.Options.DiffusionFA)
	}
}

func TestParseManagedImageOptionsSupportsIdeogram4Components(t *testing.T) {
	modelsRoot := t.TempDir()
	mainUncond := filepath.Join(modelsRoot, "ideogram4-uncond.gguf")
	vae := filepath.Join(modelsRoot, "ae.safetensors")
	llm := filepath.Join(modelsRoot, "Qwen3-VL-8B-Instruct-Q8_0.gguf")
	for _, path := range []string{mainUncond, vae, llm} {
		if err := os.WriteFile(path, []byte("model"), 0o600); err != nil {
			t.Fatalf("write component fixture %s: %v", path, err)
		}
	}

	options, err := normalizeStableDiffusionCPPComponents([]managedImageComponent{
		{OccurrenceID: "uncond", Role: "uncond", ComponentKind: "uncond_diffusion", EngineSlot: "uncond_diffusion_model", Path: mainUncond},
		{OccurrenceID: "vae", Role: "vae", ComponentKind: "vae", EngineSlot: "vae_path", Path: vae},
		{OccurrenceID: "text", Role: "text_encoder", ComponentKind: "text_encoder", EngineSlot: "llm_path", Path: llm},
	})
	if err != nil {
		t.Fatalf("normalizeStableDiffusionCPPComponents: %v", err)
	}

	components := (managedImageOptions{Components: options}).ComponentsBySlot()
	if got := components["uncond_diffusion_model"]; got != mainUncond {
		t.Fatalf("unexpected uncond_diffusion_model path: %q", got)
	}
	if got := components["vae_path"]; got != vae {
		t.Fatalf("unexpected vae_path: %q", got)
	}
	if got := components["llm_path"]; got != llm {
		t.Fatalf("unexpected llm_path: %q", got)
	}
}

func TestParseManagedImageOptionsRejectsUnsupportedStableDiffusionSlot(t *testing.T) {
	_, err := normalizeStableDiffusionCPPComponents([]managedImageComponent{{OccurrenceID: "unknown", EngineSlot: "unsupported_tensor_path", Path: filepath.Join(t.TempDir(), "model.gguf")}})
	if err == nil {
		t.Fatal("expected unsupported stable-diffusion slot to fail-close")
	}
	if !strings.Contains(err.Error(), `unsupported managed image component slot "unsupported_tensor_path"`) {
		t.Fatalf("unexpected parse error: %v", err)
	}
}

func TestParseManagedImageOptionsRejectsDuplicateComponentSlot(t *testing.T) {
	modelsRoot := t.TempDir()
	vaePath := filepath.Join(modelsRoot, "ae.safetensors")
	if err := os.WriteFile(vaePath, []byte("vae"), 0o600); err != nil {
		t.Fatalf("write vae fixture: %v", err)
	}

	_, err := normalizeStableDiffusionCPPComponents([]managedImageComponent{
		{OccurrenceID: "vae-one", Order: 0, Role: "vae", EngineSlot: "vae_path", Path: vaePath},
		{OccurrenceID: "vae-two", Order: 1, Role: "vae", EngineSlot: "vae_path", Path: vaePath},
	})
	if err == nil {
		t.Fatal("expected duplicate component slot to fail-close")
	}
	if !strings.Contains(err.Error(), `duplicate managed image component slot "vae_path"`) {
		t.Fatalf("unexpected duplicate slot error: %v", err)
	}
}

func TestStableDiffusionCPPResidentStartupArgsIncludeUncondDiffusionModel(t *testing.T) {
	modelPath, _ := writeManagedImageModelFixtures(t)
	uncondPath := filepath.Join(t.TempDir(), "ideogram4-uncond.gguf")
	if err := os.WriteFile(uncondPath, []byte("uncond"), 0o600); err != nil {
		t.Fatalf("write uncond fixture: %v", err)
	}

	args, err := stableDiffusionCPPResidentStartupArgs(stableDiffusionCPPResidentConfig{
		ModelPath: modelPath,
		Components: []managedImageComponent{
			{OccurrenceID: "uncond", Role: "uncond", EngineSlot: "uncond_diffusion_model", Path: uncondPath},
		},
	}, 8188)
	if err != nil {
		t.Fatalf("startup args: %v", err)
	}

	if got := strings.Join(args, " "); !strings.Contains(got, "--uncond-diffusion-model "+uncondPath) {
		t.Fatalf("expected uncond diffusion model arg, got %q", got)
	}
}

func TestStableDiffusionCPPResidentStartupArgsRejectsInvalidComponents(t *testing.T) {
	modelPath, _ := writeManagedImageModelFixtures(t)
	cases := []struct {
		name      string
		component managedImageComponent
		want      string
	}{
		{
			name:      "unknown slot",
			component: managedImageComponent{EngineSlot: "other_model", Path: "other.gguf"},
			want:      `unsupported managed image component slot "other_model"`,
		},
		{
			name:      "empty slot",
			component: managedImageComponent{Path: "other.gguf"},
			want:      "managed image component slot is required",
		},
		{
			name:      "empty path",
			component: managedImageComponent{OccurrenceID: "vae", EngineSlot: "vae_path"},
			want:      `managed image component path is required for slot "vae_path"`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := stableDiffusionCPPResidentStartupArgs(stableDiffusionCPPResidentConfig{
				ModelPath:  modelPath,
				Components: []managedImageComponent{tc.component},
			}, 8188)
			if err == nil {
				t.Fatal("expected invalid component to fail startup args")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("unexpected startup args error: %v", err)
			}
		})
	}
}

func TestStableDiffusionCPPResidentStartupArgsIgnoresComponentOptionOrder(t *testing.T) {
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	llmPath := filepath.Join(t.TempDir(), "Qwen3-VL-8B-Instruct-Q8_0.gguf")
	if err := os.WriteFile(llmPath, []byte("llm"), 0o600); err != nil {
		t.Fatalf("write llm fixture: %v", err)
	}

	first, err := stableDiffusionCPPResidentStartupArgs(stableDiffusionCPPResidentConfig{
		ModelPath: modelPath,
		Components: []managedImageComponent{
			{OccurrenceID: "text", Role: "text", EngineSlot: "llm_path", Path: llmPath},
			{OccurrenceID: "vae", Role: "vae", EngineSlot: "vae_path", Path: vaePath},
		},
	}, 8188)
	if err != nil {
		t.Fatalf("startup args first: %v", err)
	}
	second, err := stableDiffusionCPPResidentStartupArgs(stableDiffusionCPPResidentConfig{
		ModelPath: modelPath,
		Components: []managedImageComponent{
			{OccurrenceID: "vae", Role: "vae", EngineSlot: "vae_path", Path: vaePath},
			{OccurrenceID: "text", Role: "text", EngineSlot: "llm_path", Path: llmPath},
		},
	}, 8188)
	if err != nil {
		t.Fatalf("startup args second: %v", err)
	}
	if strings.Join(first, "\x00") != strings.Join(second, "\x00") {
		t.Fatalf("expected deterministic startup args, got first=%v second=%v", first, second)
	}
}

func TestStableDiffusionCPPResidentFingerprintIgnoresComponentOptionOrder(t *testing.T) {
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	llmPath := filepath.Join(t.TempDir(), "Qwen3-VL-8B-Instruct-Q8_0.gguf")
	if err := os.WriteFile(llmPath, []byte("llm"), 0o600); err != nil {
		t.Fatalf("write llm fixture: %v", err)
	}

	first, err := stableDiffusionCPPResidentConfigFromLoad(loadModelState{
		ModelPath: modelPath,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{OccurrenceID: "text", Role: "text", EngineSlot: "llm_path", Path: llmPath},
				{OccurrenceID: "vae", Role: "vae", EngineSlot: "vae_path", Path: vaePath},
			},
		},
	})
	if err != nil {
		t.Fatalf("config first: %v", err)
	}
	second, err := stableDiffusionCPPResidentConfigFromLoad(loadModelState{
		ModelPath: modelPath,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{OccurrenceID: "vae", Role: "vae", EngineSlot: "vae_path", Path: vaePath},
				{OccurrenceID: "text", Role: "text", EngineSlot: "llm_path", Path: llmPath},
			},
		},
	})
	if err != nil {
		t.Fatalf("config second: %v", err)
	}

	if fmt.Sprintf("%#v", first.Components) != fmt.Sprintf("%#v", second.Components) {
		t.Fatalf("expected canonical component ordering, got first=%#v second=%#v", first.Components, second.Components)
	}
	firstFingerprint, err := stableDiffusionCPPResidentFingerprint(first)
	if err != nil {
		t.Fatalf("fingerprint first: %v", err)
	}
	secondFingerprint, err := stableDiffusionCPPResidentFingerprint(second)
	if err != nil {
		t.Fatalf("fingerprint second: %v", err)
	}
	if firstFingerprint != secondFingerprint {
		t.Fatalf("expected identical fingerprints for same component set, got %q and %q", firstFingerprint, secondFingerprint)
	}
}

func TestStableDiffusionCPPResidentRejectsDuplicateComponentSlot(t *testing.T) {
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	_, vaePath2 := writeManagedImageModelFixtures(t)

	err := validateManagedImageLoadState(loadModelState{
		ModelPath: modelPath,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{OccurrenceID: "vae-one", Order: 0, Role: "vae", EngineSlot: "vae_path", Path: vaePath},
				{OccurrenceID: "vae-two", Order: 1, Role: "vae", EngineSlot: "vae_path", Path: vaePath2},
			},
		},
	})
	if err == nil {
		t.Fatal("expected duplicate component slot to fail-close")
	}
	if !strings.Contains(err.Error(), `duplicate managed image component slot "vae_path"`) {
		t.Fatalf("unexpected duplicate slot error: %v", err)
	}
}

func TestValidateManagedImageLoadStateAllowsRoleScopedOccurrenceOrdinals(t *testing.T) {
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	llmPath := filepath.Join(t.TempDir(), "Qwen3-4B-Q4_K_M.gguf")
	if err := os.WriteFile(llmPath, []byte("llm"), 0o600); err != nil {
		t.Fatalf("write llm fixture: %v", err)
	}

	err := validateManagedImageLoadState(loadModelState{
		ModelPath: modelPath,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{
					OccurrenceID:  "companion.text-encoder",
					Order:         0,
					Role:          "text_encoder",
					ComponentKind: "chat",
					EngineSlot:    "llm_path",
					Path:          llmPath,
					Required:      true,
				},
				{
					OccurrenceID:  "companion.vae",
					Order:         0,
					Role:          "vae",
					ComponentKind: "vae",
					EngineSlot:    "vae_path",
					Path:          vaePath,
					Required:      true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("role-scoped occurrence ordinals must remain independent: %v", err)
	}
}

func TestValidateManagedImageLoadStateRejectsDuplicateOrdinalWithinRole(t *testing.T) {
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	err := validateManagedImageLoadState(loadModelState{
		ModelPath: modelPath,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{OccurrenceID: "vae.primary", Order: 0, Role: "vae", EngineSlot: "vae_path", Path: vaePath},
				{OccurrenceID: "vae.secondary", Order: 0, Role: "vae", EngineSlot: "vae_path", Path: vaePath},
			},
		},
	})
	if err == nil || !strings.Contains(err.Error(), `duplicate managed image component order 0 for role "vae"`) {
		t.Fatalf("duplicate role-scoped ordinal error = %v", err)
	}
}

func TestValidateManagedImageLoadStateRejectsInvalidComponentStates(t *testing.T) {
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	missingPath := filepath.Join(t.TempDir(), "missing.safetensors")
	cases := []struct {
		name       string
		components []managedImageComponent
		want       string
	}{
		{
			name:       "unknown slot",
			components: []managedImageComponent{{EngineSlot: "other_model", Path: vaePath}},
			want:       `unsupported managed image component slot "other_model"`,
		},
		{
			name:       "empty slot",
			components: []managedImageComponent{{Path: vaePath}},
			want:       "managed image component slot is required",
		},
		{
			name:       "empty path",
			components: []managedImageComponent{{OccurrenceID: "vae", EngineSlot: "vae_path"}},
			want:       `managed image component path is required for slot "vae_path"`,
		},
		{
			name:       "missing file",
			components: []managedImageComponent{{OccurrenceID: "vae", EngineSlot: "vae_path", Path: missingPath}},
			want:       "managed image option path unavailable",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateManagedImageLoadState(loadModelState{
				ModelPath: modelPath,
				Options:   managedImageOptions{Components: tc.components},
			})
			if err == nil {
				t.Fatal("expected invalid component state to fail")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("unexpected validation error: %v", err)
			}
		})
	}
}

func TestStableDiffusionCPPDriverUsesResidentServerAndWritesArtifact(t *testing.T) {
	cliPath, serverPath := writeManagedImageExecutableFixtures(t)
	modelPath, vaePath := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath), "")
	if err != nil {
		t.Fatalf("newStableDiffusionCPPDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }
	driver.generateRequester = func(_ context.Context, _ *http.Client, endpoint string, _ loadModelState, req imageGenerateState) ([]byte, error) {
		if endpoint == "" {
			t.Fatal("expected resident endpoint")
		}
		if got := strings.TrimSpace(req.Sampler); got != "euler" {
			t.Fatalf("unexpected sampler passed to resident request: %q", got)
		}
		if got := strings.TrimSpace(req.Scheduler); got != "discrete" {
			t.Fatalf("unexpected scheduler passed to resident request: %q", got)
		}
		if got := strings.TrimSpace(req.PositivePrompt); got != "orange cat" {
			t.Fatalf("unexpected prompt: %q", got)
		}
		return []byte("png"), nil
	}

	state := loadModelState{
		ModelPath: modelPath,
		Threads:   4,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{OccurrenceID: "vae", EngineSlot: "vae_path", Path: vaePath},
			},
			DiffusionFA: testBoolPtr(true),
		},
	}
	if _, err := driver.LoadModel(state); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	dst := filepath.Join(t.TempDir(), "artifact.png")
	if _, err := driver.GenerateImage(context.Background(), state, imageGenerateState{
		Mode:           ImageRequestModeTextToImage,
		Dst:            dst,
		PositivePrompt: "orange cat",
		Sampler:        "euler",
		Scheduler:      "discrete",
		Width:          512,
		Height:         512,
		Step:           15,
	}, nil); err != nil {
		t.Fatalf("GenerateImage: %v", err)
	}

	if commandState.startCount != 1 {
		t.Fatalf("expected one resident start, got %d", commandState.startCount)
	}
	if got := commandState.executables[0]; got != serverPath {
		t.Fatalf("expected sd-server executable, got %q want %q", got, serverPath)
	}
	if got := strings.Join(commandState.args[0], " "); strings.Contains(got, "sd-cli") {
		t.Fatalf("expected resident server args, got %q", got)
	}
	if got := strings.Join(commandState.args[0], " "); !strings.Contains(got, "--diffusion-model "+modelPath) {
		t.Fatalf("expected diffusion model arg, got %q", got)
	}
	if got := strings.Join(commandState.args[0], " "); !strings.Contains(got, "--vae "+vaePath) {
		t.Fatalf("expected vae arg, got %q", got)
	}
	if payload, err := os.ReadFile(dst); err != nil {
		t.Fatalf("read artifact: %v", err)
	} else if string(payload) != "png" {
		t.Fatalf("unexpected artifact payload: %q", string(payload))
	}
}

func TestStableDiffusionCPPDriverPassesManagedCUDAPathToResidentCommand(t *testing.T) {
	originalGOOS := managedImageBackendGOOS
	managedImageBackendGOOS = "windows"
	t.Cleanup(func() {
		managedImageBackendGOOS = originalGOOS
	})

	cliPath, _ := writeManagedImageExecutableFixtures(t)
	modelPath, _ := writeManagedImageModelFixtures(t)
	cudaRuntimeDir := writeManagedImageCUDARuntimeFixtures(t)

	driverAny, err := newBackendDriver(ServerConfig{
		Driver:            "stable-diffusion.cpp",
		BackendExecutable: cliPath,
		WorkingDir:        filepath.Dir(cliPath),
		CUDARuntimeDir:    cudaRuntimeDir,
	})
	if err != nil {
		t.Fatalf("newBackendDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }

	if _, err := driver.LoadModel(loadModelState{ModelPath: modelPath}); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}

	if len(commandState.envs) != 1 {
		t.Fatalf("expected one resident env capture, got %d", len(commandState.envs))
	}
	if got := envValue(commandState.envs[0], "PATH"); !strings.HasPrefix(got, cudaRuntimeDir+string(os.PathListSeparator)) {
		t.Fatalf("expected resident PATH to prepend CUDA runtime dir, got %q", got)
	}
}

func TestStableDiffusionCPPDriverRequestSamplingDoesNotRestartResident(t *testing.T) {
	cliPath, _ := writeManagedImageExecutableFixtures(t)
	modelPath, _ := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath), "")
	if err != nil {
		t.Fatalf("newStableDiffusionCPPDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }

	var captured imageGenerateState
	driver.generateRequester = func(_ context.Context, _ *http.Client, _ string, _ loadModelState, request imageGenerateState) ([]byte, error) {
		captured = request
		return []byte("png"), nil
	}

	initial := loadModelState{ModelPath: modelPath}
	updated := loadModelState{ModelPath: modelPath}
	if _, err := driver.LoadModel(initial); err != nil {
		t.Fatalf("LoadModel(initial): %v", err)
	}
	if _, err := driver.LoadModel(updated); err != nil {
		t.Fatalf("LoadModel(updated): %v", err)
	}
	if commandState.startCount != 1 {
		t.Fatalf("expected cfg/sampler-only changes to avoid restart, got starts=%d", commandState.startCount)
	}
	if _, err := driver.GenerateImage(context.Background(), updated, imageGenerateState{
		Mode: ImageRequestModeTextToImage, Dst: filepath.Join(t.TempDir(), "artifact.png"),
		CFGScale: 7.5, Sampler: "heun", Scheduler: "karras",
	}, nil); err != nil {
		t.Fatalf("GenerateImage(updated): %v", err)
	}
	if got := strings.TrimSpace(captured.Sampler); got != "heun" {
		t.Fatalf("expected request-time sampler from updated load state, got %q", got)
	}
	if got := strings.TrimSpace(captured.Scheduler); got != "karras" {
		t.Fatalf("expected request-time scheduler from updated load state, got %q", got)
	}
	if captured.CFGScale != 7.5 {
		t.Fatalf("expected request-time cfg_scale from updated load state, got %v", captured.CFGScale)
	}
}

func TestBuildStableDiffusionCPPGenerateRequestIncludesScheduler(t *testing.T) {
	path, payload, err := buildStableDiffusionCPPGenerateRequest(loadModelState{}, imageGenerateState{
		Mode:           ImageRequestModeTextToImage,
		PositivePrompt: "orange cat",
		CFGScale:       7.5,
		Sampler:        "heun",
		Scheduler:      "karras",
		Width:          512,
		Height:         512,
		Step:           15,
	})
	if err != nil {
		t.Fatalf("buildStableDiffusionCPPGenerateRequest: %v", err)
	}
	if path != "/sdapi/v1/txt2img" {
		t.Fatalf("unexpected path: %q", path)
	}
	if got := strings.TrimSpace(fmt.Sprint(payload["sampler_name"])); got != "heun" {
		t.Fatalf("unexpected sampler_name: %q", got)
	}
	if got := strings.TrimSpace(fmt.Sprint(payload["scheduler"])); got != "karras" {
		t.Fatalf("unexpected scheduler: %q", got)
	}
}

func TestBuildStableDiffusionCPPGenerateRequestPreservesExplicitZeroOptions(t *testing.T) {
	_, payload, err := buildStableDiffusionCPPGenerateRequest(loadModelState{}, imageGenerateState{
		Mode:           ImageRequestModeTextToImage,
		PositivePrompt: "orange cat",
		CFGScale:       0,
		Seed:           0,
	})
	if err != nil {
		t.Fatalf("buildStableDiffusionCPPGenerateRequest: %v", err)
	}
	if got, ok := payload["cfg_scale"]; !ok || got != float32(0) {
		t.Fatalf("expected explicit cfg_scale=0, got value=%v present=%t", got, ok)
	}
	if got, ok := payload["seed"]; !ok || got != int32(0) {
		t.Fatalf("expected explicit seed=0, got value=%v present=%t", got, ok)
	}
}

func TestStableDiffusionCPPGenerateResponseRejectsAmbiguousArtifactCarriers(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("png"))
	for _, response := range []stableDiffusionCPPGenerateResponse{
		{Images: []string{encoded}, Data: []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		}{{B64JSON: encoded}}},
		{Images: []string{encoded, encoded}},
		{Data: []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		}{{B64JSON: encoded, URL: "/artifact.png"}}},
	} {
		if _, err := response.payload(context.Background(), nil, "http://127.0.0.1:1"); err == nil {
			t.Fatalf("ambiguous backend response was accepted: %+v", response)
		}
	}
}

func TestStableDiffusionCPPDriverConfigChangeRestartsResident(t *testing.T) {
	cliPath, _ := writeManagedImageExecutableFixtures(t)
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	_, vaePath2 := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath), "")
	if err != nil {
		t.Fatalf("newStableDiffusionCPPDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }
	driver.generateRequester = func(_ context.Context, _ *http.Client, _ string, _ loadModelState, _ imageGenerateState) ([]byte, error) {
		return []byte("png"), nil
	}

	if _, err := driver.LoadModel(loadModelState{
		ModelPath: modelPath,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{OccurrenceID: "vae", EngineSlot: "vae_path", Path: vaePath},
			},
		},
	}); err != nil {
		t.Fatalf("LoadModel(first): %v", err)
	}
	firstCommand := commandState.commands[0]
	if _, err := driver.LoadModel(loadModelState{
		ModelPath: modelPath,
		Options: managedImageOptions{
			Components: []managedImageComponent{
				{OccurrenceID: "vae", EngineSlot: "vae_path", Path: vaePath2},
			},
		},
	}); err != nil {
		t.Fatalf("LoadModel(second): %v", err)
	}

	if commandState.startCount != 2 {
		t.Fatalf("expected changed resident config to restart, got starts=%d", commandState.startCount)
	}
	if !firstCommand.interrupted() {
		t.Fatal("expected first resident command to be interrupted on restart")
	}
}

func TestStableDiffusionCPPDriverFreeStopsResident(t *testing.T) {
	cliPath, _ := writeManagedImageExecutableFixtures(t)
	modelPath, _ := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath), "")
	if err != nil {
		t.Fatalf("newStableDiffusionCPPDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }
	driver.generateRequester = func(_ context.Context, _ *http.Client, _ string, _ loadModelState, _ imageGenerateState) ([]byte, error) {
		return []byte("png"), nil
	}

	state := loadModelState{ModelPath: modelPath}
	if _, err := driver.LoadModel(state); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	if err := driver.Free(state); err != nil {
		t.Fatalf("Free: %v", err)
	}
	if len(commandState.commands) != 1 || !commandState.commands[0].interrupted() {
		t.Fatal("expected free to stop the resident command")
	}
}

func TestStableDiffusionCPPDriverShutdownStopsResident(t *testing.T) {
	cliPath, _ := writeManagedImageExecutableFixtures(t)
	modelPath, _ := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath), "")
	if err != nil {
		t.Fatalf("newStableDiffusionCPPDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }

	if _, err := driver.LoadModel(loadModelState{ModelPath: modelPath}); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	shutdownDriver, ok := any(driver).(interface{ Shutdown() error })
	if !ok {
		t.Fatal("expected stableDiffusionCPPDriver to expose shutdown")
	}
	if err := shutdownDriver.Shutdown(); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if len(commandState.commands) != 1 || !commandState.commands[0].interrupted() {
		t.Fatal("expected shutdown to stop the resident command")
	}
}

func TestStableDiffusionCPPDriverGenerateWithoutLoadFailsClosed(t *testing.T) {
	driver := &stableDiffusionCPPDriver{}
	_, err := driver.GenerateImage(context.Background(), loadModelState{}, imageGenerateState{
		Dst: filepath.Join(t.TempDir(), "artifact.png"),
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "not loaded") {
		t.Fatalf("expected generate without load failure, got %v", err)
	}
}

func writeManagedImageExecutableFixtures(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	cliPath := filepath.Join(dir, "sd-cli")
	serverPath := filepath.Join(dir, "sd-server")
	for _, path := range []string{cliPath, serverPath} {
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatalf("write executable fixture %s: %v", path, err)
		}
	}
	return cliPath, serverPath
}

func writeManagedImageModelFixtures(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "model.gguf")
	vaePath := filepath.Join(dir, "ae.safetensors")
	if err := os.WriteFile(modelPath, []byte("gguf"), 0o600); err != nil {
		t.Fatalf("write model fixture: %v", err)
	}
	if err := os.WriteFile(vaePath, []byte("vae"), 0o600); err != nil {
		t.Fatalf("write vae fixture: %v", err)
	}
	return modelPath, vaePath
}

func writeManagedImageCUDARuntimeFixtures(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, artifact := range stableDiffusionCPPCUDARequiredArtifacts {
		if err := os.WriteFile(filepath.Join(dir, artifact), []byte("dll"), 0o755); err != nil {
			t.Fatalf("write CUDA fixture %s: %v", artifact, err)
		}
	}
	return dir
}

func testBoolPtr(value bool) *bool {
	return &value
}

type fakeManagedImageCommandFactoryState struct {
	mu          sync.Mutex
	startCount  int
	executables []string
	args        [][]string
	envs        [][]string
	commands    []*fakeManagedImageCommand
}

func (s *fakeManagedImageCommandFactoryState) factory(_ context.Context, executablePath string, args []string, _ string, env []string) (managedImageCommand, io.ReadCloser, io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	command := newFakeManagedImageCommand()
	s.startCount++
	s.executables = append(s.executables, executablePath)
	s.args = append(s.args, append([]string(nil), args...))
	s.envs = append(s.envs, append([]string(nil), env...))
	s.commands = append(s.commands, command)
	return command, io.NopCloser(strings.NewReader("")), io.NopCloser(strings.NewReader("")), nil
}

type fakeManagedImageCommand struct {
	mu         sync.Mutex
	waitOnce   sync.Once
	done       chan struct{}
	wasStopped bool
}

func newFakeManagedImageCommand() *fakeManagedImageCommand {
	return &fakeManagedImageCommand{done: make(chan struct{})}
}

func (c *fakeManagedImageCommand) Start() error {
	return nil
}

func (c *fakeManagedImageCommand) Wait() error {
	<-c.done
	return nil
}

func (c *fakeManagedImageCommand) Interrupt() error {
	c.mu.Lock()
	c.wasStopped = true
	c.mu.Unlock()
	c.waitOnce.Do(func() {
		close(c.done)
	})
	return nil
}

func (c *fakeManagedImageCommand) Kill() error {
	return c.Interrupt()
}

func (c *fakeManagedImageCommand) interrupted() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.wasStopped
}

func envValue(env []string, key string) string {
	for _, entry := range env {
		name, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		if strings.EqualFold(name, key) {
			return value
		}
	}
	return ""
}
