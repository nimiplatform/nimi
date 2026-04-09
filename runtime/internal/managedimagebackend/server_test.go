package managedimagebackend

import (
	"context"
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
		"sampler:euler",
		"scheduler:discrete",
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
	if got := strings.TrimSpace(options.Sampler); got != "euler" {
		t.Fatalf("expected sampler=euler, got %q", got)
	}
	if got := strings.TrimSpace(options.Scheduler); got != "discrete" {
		t.Fatalf("expected scheduler=discrete, got %q", got)
	}
}

func TestStableDiffusionCPPDriverUsesResidentServerAndWritesArtifact(t *testing.T) {
	cliPath, serverPath := writeManagedImageExecutableFixtures(t)
	modelPath, vaePath := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath))
	if err != nil {
		t.Fatalf("newStableDiffusionCPPDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }
	driver.generateRequester = func(_ context.Context, _ *http.Client, endpoint string, loaded loadModelState, req imageGenerateState) ([]byte, error) {
		if endpoint == "" {
			t.Fatal("expected resident endpoint")
		}
		if got := strings.TrimSpace(loaded.Options.Sampler); got != "euler" {
			t.Fatalf("unexpected sampler passed to resident request: %q", got)
		}
		if got := strings.TrimSpace(loaded.Options.Scheduler); got != "discrete" {
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
		CFGScale:  1,
		Options: managedImageOptions{
			VAEPath:     vaePath,
			Sampler:     "euler",
			Scheduler:   "discrete",
			DiffusionFA: boolPtr(true),
		},
	}
	if err := driver.LoadModel(state); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	dst := filepath.Join(t.TempDir(), "artifact.png")
	if err := driver.GenerateImage(context.Background(), state, imageGenerateState{
		Dst:            dst,
		PositivePrompt: "orange cat",
		Width:          512,
		Height:         512,
		Step:           15,
	}); err != nil {
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

func TestStableDiffusionCPPDriverCacheHitSkipsRestartForCFGAndSamplerChanges(t *testing.T) {
	cliPath, _ := writeManagedImageExecutableFixtures(t)
	modelPath, _ := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath))
	if err != nil {
		t.Fatalf("newStableDiffusionCPPDriver: %v", err)
	}
	driver := driverAny.(*stableDiffusionCPPDriver)

	commandState := &fakeManagedImageCommandFactoryState{}
	driver.commandFactory = commandState.factory
	driver.readinessProbe = func(context.Context, *http.Client, string) error { return nil }

	var captured loadModelState
	driver.generateRequester = func(_ context.Context, _ *http.Client, _ string, loaded loadModelState, _ imageGenerateState) ([]byte, error) {
		captured = loaded
		return []byte("png"), nil
	}

	initial := loadModelState{
		ModelPath: modelPath,
		CFGScale:  1,
		Options: managedImageOptions{
			Sampler:   "euler",
			Scheduler: "discrete",
		},
	}
	updated := loadModelState{
		ModelPath: modelPath,
		CFGScale:  7.5,
		Options: managedImageOptions{
			Sampler:   "heun",
			Scheduler: "karras",
		},
	}
	if err := driver.LoadModel(initial); err != nil {
		t.Fatalf("LoadModel(initial): %v", err)
	}
	if err := driver.LoadModel(updated); err != nil {
		t.Fatalf("LoadModel(updated): %v", err)
	}
	if commandState.startCount != 1 {
		t.Fatalf("expected cfg/sampler-only changes to avoid restart, got starts=%d", commandState.startCount)
	}
	if err := driver.GenerateImage(context.Background(), updated, imageGenerateState{
		Dst: filepath.Join(t.TempDir(), "artifact.png"),
	}); err != nil {
		t.Fatalf("GenerateImage(updated): %v", err)
	}
	if got := strings.TrimSpace(captured.Options.Sampler); got != "heun" {
		t.Fatalf("expected request-time sampler from updated load state, got %q", got)
	}
	if got := strings.TrimSpace(captured.Options.Scheduler); got != "karras" {
		t.Fatalf("expected request-time scheduler from updated load state, got %q", got)
	}
	if captured.CFGScale != 7.5 {
		t.Fatalf("expected request-time cfg_scale from updated load state, got %v", captured.CFGScale)
	}
}

func TestBuildStableDiffusionCPPGenerateRequestIncludesScheduler(t *testing.T) {
	path, payload, err := buildStableDiffusionCPPGenerateRequest(loadModelState{
		CFGScale: 7.5,
		Options: managedImageOptions{
			Sampler:   "heun",
			Scheduler: "karras",
		},
	}, imageGenerateState{
		PositivePrompt: "orange cat",
		Width:          512,
		Height:         512,
		Step:           15,
	}, "")
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

func TestStableDiffusionCPPDriverConfigChangeRestartsResident(t *testing.T) {
	cliPath, _ := writeManagedImageExecutableFixtures(t)
	modelPath, vaePath := writeManagedImageModelFixtures(t)
	_, vaePath2 := writeManagedImageModelFixtures(t)

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath))
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

	if err := driver.LoadModel(loadModelState{
		ModelPath: modelPath,
		Options:   managedImageOptions{VAEPath: vaePath},
	}); err != nil {
		t.Fatalf("LoadModel(first): %v", err)
	}
	firstCommand := commandState.commands[0]
	if err := driver.LoadModel(loadModelState{
		ModelPath: modelPath,
		Options:   managedImageOptions{VAEPath: vaePath2},
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

	driverAny, err := newStableDiffusionCPPDriver(cliPath, filepath.Dir(cliPath))
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
	if err := driver.LoadModel(state); err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	if err := driver.Free(state); err != nil {
		t.Fatalf("Free: %v", err)
	}
	if len(commandState.commands) != 1 || !commandState.commands[0].interrupted() {
		t.Fatal("expected free to stop the resident command")
	}
}

func TestStableDiffusionCPPDriverGenerateWithoutLoadFailsClosed(t *testing.T) {
	driver := &stableDiffusionCPPDriver{}
	err := driver.GenerateImage(context.Background(), loadModelState{}, imageGenerateState{
		Dst: filepath.Join(t.TempDir(), "artifact.png"),
	})
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

func boolPtr(value bool) *bool {
	return &value
}

type fakeManagedImageCommandFactoryState struct {
	mu          sync.Mutex
	startCount  int
	executables []string
	args        [][]string
	commands    []*fakeManagedImageCommand
}

func (s *fakeManagedImageCommandFactoryState) factory(_ context.Context, executablePath string, args []string, _ string, _ []string) (managedImageCommand, io.ReadCloser, io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	command := newFakeManagedImageCommand()
	s.startCount++
	s.executables = append(s.executables, executablePath)
	s.args = append(s.args, append([]string(nil), args...))
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
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}
