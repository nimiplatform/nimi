package managedimagebackend

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

type ServerConfig struct {
	ListenAddress     string
	Driver            string
	BackendExecutable string
	WorkingDir        string
}

var managedImageBackendGOOS = runtime.GOOS

type backendDriver interface {
	LoadModel(loadModelState) error
	GenerateImage(context.Context, loadModelState, imageGenerateState) error
	Free(loadModelState) error
}

type loadModelState struct {
	ModelsRoot string
	ModelPath  string
	Options    managedImageOptions
	CFGScale   float32
	Threads    int32
}

type imageGenerateState struct {
	Width          int32
	Height         int32
	Step           int32
	Seed           int32
	PositivePrompt string
	NegativePrompt string
	Dst            string
	Src            string
	EnableParams   string
	RefImages      []string
}

type managedImageOptions struct {
	Sampler            string
	Scheduler          string
	VAEPath            string
	LLMPath            string
	ClipLPath          string
	T5XXLPath          string
	DiffusionFA        *bool
	OffloadParamsToCPU *bool
}

type Server struct {
	driver backendDriver

	mu     sync.RWMutex
	loaded *loadModelState
}

func RunServer(ctx context.Context, cfg ServerConfig) error {
	driver, err := newBackendDriver(cfg)
	if err != nil {
		return err
	}
	server := &Server{driver: driver}
	return server.Serve(ctx, strings.TrimSpace(cfg.ListenAddress))
}

func (s *Server) Serve(ctx context.Context, listenAddress string) error {
	if s == nil || s.driver == nil {
		return fmt.Errorf("managed image backend driver is required")
	}
	if strings.TrimSpace(listenAddress) == "" {
		return fmt.Errorf("managed image backend listen address is required")
	}
	if err := ensureDescriptors(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", strings.TrimSpace(listenAddress))
	if err != nil {
		return fmt.Errorf("listen managed image backend: %w", err)
	}
	defer listener.Close()

	grpcServer := grpc.NewServer(grpc.UnknownServiceHandler(s.handleUnknownMethod))
	defer grpcServer.GracefulStop()

	serveErrCh := make(chan error, 1)
	go func() {
		serveErrCh <- grpcServer.Serve(listener)
	}()

	select {
	case <-ctx.Done():
		grpcServer.GracefulStop()
		<-serveErrCh
		return ctx.Err()
	case err := <-serveErrCh:
		if err == nil {
			return nil
		}
		return fmt.Errorf("serve managed image backend: %w", err)
	}
}

func (s *Server) handleUnknownMethod(_ any, stream grpc.ServerStream) error {
	method, _ := grpc.MethodFromServerStream(stream)
	switch method {
	case backendLoadModelMethod:
		return s.handleLoadModel(stream)
	case backendGenerateImageMethod:
		return s.handleGenerateImage(stream)
	case backendFreeModelMethod:
		return s.handleFree(stream)
	default:
		return fmt.Errorf("unsupported managed image backend method %s", method)
	}
}

func (s *Server) handleLoadModel(stream grpc.ServerStream) error {
	req := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	if err := stream.RecvMsg(req); err != nil {
		return err
	}
	state, err := decodeLoadModelState(req)
	if err != nil {
		return stream.SendMsg(resultMessage(false, err.Error()))
	}
	log.Printf("managed image backend load request model_path=%s options=%s threads=%d cfg_scale=%g",
		strings.TrimSpace(state.ModelPath),
		fmt.Sprintf("sampler=%s scheduler=%s has_vae=%t has_llm=%t has_clip_l=%t has_t5xxl=%t diffusion_fa=%t offload_to_cpu=%t",
			strings.TrimSpace(state.Options.Sampler),
			strings.TrimSpace(state.Options.Scheduler),
			strings.TrimSpace(state.Options.VAEPath) != "",
			strings.TrimSpace(state.Options.LLMPath) != "",
			strings.TrimSpace(state.Options.ClipLPath) != "",
			strings.TrimSpace(state.Options.T5XXLPath) != "",
			state.Options.DiffusionFA != nil && *state.Options.DiffusionFA,
			state.Options.OffloadParamsToCPU != nil && *state.Options.OffloadParamsToCPU,
		),
		state.Threads,
		state.CFGScale,
	)
	if err := s.driver.LoadModel(state); err != nil {
		log.Printf("managed image backend load request failed model_path=%s error=%v",
			strings.TrimSpace(state.ModelPath),
			err,
		)
		return stream.SendMsg(resultMessage(false, err.Error()))
	}
	s.mu.Lock()
	s.loaded = &state
	s.mu.Unlock()
	log.Printf("managed image backend load request completed model_path=%s", strings.TrimSpace(state.ModelPath))
	return stream.SendMsg(resultMessage(true, "loaded"))
}

func (s *Server) handleGenerateImage(stream grpc.ServerStream) error {
	req := dynamicpb.NewMessage(generateImageMessageDescriptor)
	if err := stream.RecvMsg(req); err != nil {
		return err
	}
	imageReq, err := decodeGenerateImageState(req)
	if err != nil {
		return stream.SendMsg(resultMessage(false, err.Error()))
	}
	s.mu.RLock()
	loaded := s.loaded
	s.mu.RUnlock()
	if loaded == nil {
		return stream.SendMsg(resultMessage(false, "managed image model is not loaded"))
	}
	if err := s.driver.GenerateImage(stream.Context(), *loaded, imageReq); err != nil {
		return stream.SendMsg(resultMessage(false, err.Error()))
	}
	return stream.SendMsg(resultMessage(true, "generated"))
}

func (s *Server) handleFree(stream grpc.ServerStream) error {
	req := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	if err := stream.RecvMsg(req); err != nil {
		return err
	}
	state, err := decodeLoadModelState(req)
	if err != nil {
		return stream.SendMsg(resultMessage(false, err.Error()))
	}
	if err := s.driver.Free(state); err != nil {
		return stream.SendMsg(resultMessage(false, err.Error()))
	}
	s.mu.Lock()
	s.loaded = nil
	s.mu.Unlock()
	return stream.SendMsg(resultMessage(true, "freed"))
}

func newBackendDriver(cfg ServerConfig) (backendDriver, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Driver)) {
	case "stable-diffusion.cpp":
		return newStableDiffusionCPPDriver(cfg.BackendExecutable, cfg.WorkingDir)
	default:
		return nil, fmt.Errorf("unsupported managed image backend driver %q", cfg.Driver)
	}
}

type stableDiffusionCPPDriver struct {
	executablePath       string
	serverExecutablePath string
	workingDir           string
	httpClient           *http.Client
	commandFactory       managedImageCommandFactory
	readinessProbe       managedImageReadinessProbe
	generateRequester    managedImageGenerateRequester

	mu       sync.Mutex
	resident *stableDiffusionCPPResident
}

func newStableDiffusionCPPDriver(executablePath string, workingDir string) (backendDriver, error) {
	trimmedExecutable := strings.TrimSpace(executablePath)
	if trimmedExecutable == "" {
		return nil, fmt.Errorf("managed image backend executable is required")
	}
	if _, err := os.Stat(trimmedExecutable); err != nil {
		return nil, fmt.Errorf("managed image backend executable unavailable: %w", err)
	}
	resolvedWorkingDir := strings.TrimSpace(workingDir)
	if resolvedWorkingDir == "" {
		resolvedWorkingDir = filepath.Dir(trimmedExecutable)
	}
	serverExecutablePath, err := resolveStableDiffusionCPPServerExecutable(trimmedExecutable)
	if err != nil {
		return nil, err
	}
	return &stableDiffusionCPPDriver{
		executablePath:       trimmedExecutable,
		serverExecutablePath: serverExecutablePath,
		workingDir:           resolvedWorkingDir,
		httpClient:           &http.Client{},
		commandFactory:       defaultManagedImageCommandFactory,
		readinessProbe:       defaultStableDiffusionCPPReadinessProbe,
		generateRequester:    defaultStableDiffusionCPPGenerateRequester,
	}, nil
}

func (d *stableDiffusionCPPDriver) LoadModel(state loadModelState) error {
	if d == nil {
		return fmt.Errorf("managed image backend driver unavailable")
	}
	if err := validateManagedImageLoadState(state); err != nil {
		return err
	}
	config := stableDiffusionCPPResidentConfigFromLoad(state)
	fingerprint, err := stableDiffusionCPPResidentFingerprint(config)
	if err != nil {
		return err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	if d.resident != nil && d.resident.fingerprint == fingerprint && !d.resident.hasExited() {
		log.Printf("managed image resident cache hit fingerprint=%s endpoint=%s startup_flags=%s",
			fingerprint,
			d.resident.endpoint,
			d.resident.startupSummary,
		)
		return nil
	}
	if d.resident != nil {
		log.Printf("managed image resident restart reason=config_changed old_fingerprint=%s new_fingerprint=%s",
			d.resident.fingerprint,
			fingerprint,
		)
		if err := d.stopResidentLocked("config_changed"); err != nil {
			return err
		}
	}

	resident, err := d.startResidentLocked(config, fingerprint)
	if err != nil {
		return err
	}
	d.resident = resident
	return nil
}

func (d *stableDiffusionCPPDriver) GenerateImage(ctx context.Context, loaded loadModelState, req imageGenerateState) error {
	if d == nil {
		return fmt.Errorf("managed image backend driver unavailable")
	}
	if strings.TrimSpace(req.Dst) == "" {
		return fmt.Errorf("managed image destination is required")
	}
	if err := os.MkdirAll(filepath.Dir(strings.TrimSpace(req.Dst)), 0o755); err != nil {
		return fmt.Errorf("create managed image destination: %w", err)
	}

	d.mu.Lock()
	resident := d.resident
	d.mu.Unlock()
	if resident == nil || resident.hasExited() {
		return fmt.Errorf("managed image resident server is not loaded")
	}

	startedAt := time.Now()
	log.Printf("managed image resident request start endpoint=%s model_path=%s width=%d height=%d step=%d cfg_scale=%g sampler=%s scheduler=%s reused_resident=%t",
		resident.endpoint,
		strings.TrimSpace(loaded.ModelPath),
		req.Width,
		req.Height,
		req.Step,
		loaded.CFGScale,
		strings.TrimSpace(loaded.Options.Sampler),
		strings.TrimSpace(loaded.Options.Scheduler),
		true,
	)

	payload, err := d.generateRequester(ctx, d.httpClient, resident.endpoint, loaded, req)
	durationMs := time.Since(startedAt).Milliseconds()
	if err != nil {
		log.Printf("managed image resident request failed endpoint=%s model_path=%s duration_ms=%d error=%v",
			resident.endpoint,
			strings.TrimSpace(loaded.ModelPath),
			durationMs,
			err,
		)
		return err
	}
	if len(payload) == 0 {
		return fmt.Errorf("managed image destination is empty")
	}
	if err := os.WriteFile(strings.TrimSpace(req.Dst), payload, 0o600); err != nil {
		return fmt.Errorf("write managed image destination: %w", err)
	}
	log.Printf("managed image resident request completed endpoint=%s model_path=%s duration_ms=%d dst=%s bytes=%d",
		resident.endpoint,
		strings.TrimSpace(loaded.ModelPath),
		durationMs,
		strings.TrimSpace(req.Dst),
		len(payload),
	)
	return nil
}

func streamManagedImageCommandOutput(reader io.ReadCloser, stream string, label string, capture *managedImageLogCapture, wg *sync.WaitGroup) {
	defer wg.Done()
	if reader == nil {
		return
	}
	defer reader.Close()
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitManagedImageLogToken)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if capture != nil {
			capture.Append(line)
		}
		log.Printf("%s output stream=%s line=%s", defaultManagedImageString(strings.TrimSpace(label), "managed image resident"), stream, line)
	}
	if err := scanner.Err(); err != nil {
		log.Printf("%s output read failed stream=%s error=%v", defaultManagedImageString(strings.TrimSpace(label), "managed image resident"), stream, err)
	}
}

func splitManagedImageLogToken(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i := 0; i < len(data); i++ {
		switch data[i] {
		case '\n':
			return i + 1, data[:i], nil
		case '\r':
			if i+1 < len(data) && data[i+1] == '\n' {
				return i + 2, data[:i], nil
			}
			return i + 1, data[:i], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func stableDiffusionCPPEnvironment(executablePath string, base []string) []string {
	if managedImageBackendGOOS != "darwin" {
		return nil
	}
	executableDir := strings.TrimSpace(filepath.Dir(strings.TrimSpace(executablePath)))
	if executableDir == "" || executableDir == "." {
		return nil
	}
	env := append([]string(nil), base...)
	env = upsertPathListEnv(env, "DYLD_LIBRARY_PATH", executableDir)
	env = upsertPathListEnv(env, "DYLD_FALLBACK_LIBRARY_PATH", executableDir)
	return env
}

func upsertPathListEnv(env []string, key string, value string) []string {
	trimmedKey := strings.TrimSpace(key)
	trimmedValue := strings.TrimSpace(value)
	if trimmedKey == "" || trimmedValue == "" {
		return env
	}
	prefix := trimmedKey + "="
	for index, entry := range env {
		if !strings.HasPrefix(entry, prefix) {
			continue
		}
		current := strings.TrimSpace(strings.TrimPrefix(entry, prefix))
		env[index] = prefix + prependPathListValue(current, trimmedValue)
		return env
	}
	return append(env, prefix+trimmedValue)
}

func prependPathListValue(current string, prepend string) string {
	trimmedPrepend := strings.TrimSpace(prepend)
	if trimmedPrepend == "" {
		return strings.TrimSpace(current)
	}
	trimmedCurrent := strings.TrimSpace(current)
	if trimmedCurrent == "" {
		return trimmedPrepend
	}
	for _, candidate := range strings.Split(trimmedCurrent, string(os.PathListSeparator)) {
		if strings.TrimSpace(candidate) == trimmedPrepend {
			return trimmedCurrent
		}
	}
	return trimmedPrepend + string(os.PathListSeparator) + trimmedCurrent
}

func (d *stableDiffusionCPPDriver) Free(_ loadModelState) error {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.stopResidentLocked("explicit_free")
}

type managedImageCommand interface {
	Start() error
	Wait() error
	Interrupt() error
	Kill() error
}

type managedImageCommandFactory func(ctx context.Context, executablePath string, args []string, workingDir string, env []string) (managedImageCommand, io.ReadCloser, io.ReadCloser, error)
type managedImageReadinessProbe func(ctx context.Context, client *http.Client, endpoint string) error
type managedImageGenerateRequester func(ctx context.Context, client *http.Client, endpoint string, loaded loadModelState, req imageGenerateState) ([]byte, error)

type execManagedImageCommand struct {
	cmd *exec.Cmd
}

func (c *execManagedImageCommand) Start() error {
	if c == nil || c.cmd == nil {
		return fmt.Errorf("managed image command is unavailable")
	}
	return c.cmd.Start()
}

func (c *execManagedImageCommand) Wait() error {
	if c == nil || c.cmd == nil {
		return fmt.Errorf("managed image command is unavailable")
	}
	return c.cmd.Wait()
}

func (c *execManagedImageCommand) Interrupt() error {
	if c == nil || c.cmd == nil || c.cmd.Process == nil {
		return nil
	}
	return c.cmd.Process.Signal(os.Interrupt)
}

func (c *execManagedImageCommand) Kill() error {
	if c == nil || c.cmd == nil || c.cmd.Process == nil {
		return nil
	}
	return c.cmd.Process.Kill()
}

type stableDiffusionCPPResidentConfig struct {
	ModelPath          string `json:"model_path"`
	VAEPath            string `json:"vae_path,omitempty"`
	LLMPath            string `json:"llm_path,omitempty"`
	ClipLPath          string `json:"clip_l_path,omitempty"`
	T5XXLPath          string `json:"t5xxl_path,omitempty"`
	DiffusionFA        bool   `json:"diffusion_fa,omitempty"`
	OffloadParamsToCPU bool   `json:"offload_params_to_cpu,omitempty"`
	Threads            int32  `json:"threads,omitempty"`
}

type stableDiffusionCPPResident struct {
	fingerprint    string
	endpoint       string
	startupArgs    []string
	startupSummary string
	command        managedImageCommand
	cancel         context.CancelFunc
	logCapture     *managedImageLogCapture

	done chan struct{}

	mu      sync.RWMutex
	exited  bool
	exitErr error
}

type managedImageLogCapture struct {
	mu      sync.Mutex
	builder strings.Builder
}

func (c *managedImageLogCapture) Append(line string) {
	if c == nil {
		return
	}
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.builder.Len() > 0 {
		c.builder.WriteString("\n")
	}
	c.builder.WriteString(trimmed)
}

func (c *managedImageLogCapture) String() string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.TrimSpace(c.builder.String())
}

func (r *stableDiffusionCPPResident) markExited(err error) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.exited = true
	r.exitErr = err
	r.mu.Unlock()
	close(r.done)
}

func (r *stableDiffusionCPPResident) hasExited() bool {
	if r == nil {
		return true
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.exited
}

func (r *stableDiffusionCPPResident) wait(timeout time.Duration) bool {
	if r == nil {
		return true
	}
	if timeout <= 0 {
		<-r.done
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-r.done:
		return true
	case <-timer.C:
		return false
	}
}

func (r *stableDiffusionCPPResident) stop(timeout time.Duration) error {
	if r == nil {
		return nil
	}
	if r.cancel != nil {
		r.cancel()
	}
	if r.command != nil {
		_ = r.command.Interrupt()
	}
	if r.wait(timeout) {
		return nil
	}
	if r.command != nil {
		_ = r.command.Kill()
	}
	if r.wait(timeout) {
		return nil
	}
	return fmt.Errorf("timed out stopping managed image resident process")
}

func validateManagedImageLoadState(state loadModelState) error {
	if strings.TrimSpace(state.ModelPath) == "" {
		return fmt.Errorf("managed image model path is required")
	}
	if _, err := os.Stat(strings.TrimSpace(state.ModelPath)); err != nil {
		return fmt.Errorf("managed image model path unavailable: %w", err)
	}
	for _, path := range []string{
		state.Options.VAEPath,
		state.Options.LLMPath,
		state.Options.ClipLPath,
		state.Options.T5XXLPath,
	} {
		if strings.TrimSpace(path) == "" {
			continue
		}
		if _, err := os.Stat(strings.TrimSpace(path)); err != nil {
			return fmt.Errorf("managed image option path unavailable: %w", err)
		}
	}
	return nil
}

func stableDiffusionCPPResidentConfigFromLoad(state loadModelState) stableDiffusionCPPResidentConfig {
	return stableDiffusionCPPResidentConfig{
		ModelPath:          strings.TrimSpace(state.ModelPath),
		VAEPath:            strings.TrimSpace(state.Options.VAEPath),
		LLMPath:            strings.TrimSpace(state.Options.LLMPath),
		ClipLPath:          strings.TrimSpace(state.Options.ClipLPath),
		T5XXLPath:          strings.TrimSpace(state.Options.T5XXLPath),
		DiffusionFA:        state.Options.DiffusionFA != nil && *state.Options.DiffusionFA,
		OffloadParamsToCPU: state.Options.OffloadParamsToCPU != nil && *state.Options.OffloadParamsToCPU,
		Threads:            state.Threads,
	}
}

func stableDiffusionCPPResidentFingerprint(config stableDiffusionCPPResidentConfig) (string, error) {
	raw, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("marshal managed image resident config: %w", err)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func stableDiffusionCPPResidentStartupArgs(config stableDiffusionCPPResidentConfig, port int) []string {
	args := []string{
		"--listen-ip", "127.0.0.1",
		"--listen-port", strconv.Itoa(port),
		"--diffusion-model", config.ModelPath,
	}
	if config.Threads != 0 {
		args = append(args, "--threads", strconv.Itoa(int(config.Threads)))
	}
	if config.DiffusionFA {
		args = append(args, "--diffusion-fa")
	}
	if config.OffloadParamsToCPU {
		args = append(args, "--offload-to-cpu")
	}
	if config.VAEPath != "" {
		args = append(args, "--vae", config.VAEPath)
	}
	if config.LLMPath != "" {
		args = append(args, "--llm", config.LLMPath)
	}
	if config.ClipLPath != "" {
		args = append(args, "--clip_l", config.ClipLPath)
	}
	if config.T5XXLPath != "" {
		args = append(args, "--t5xxl", config.T5XXLPath)
	}
	return args
}

func stableDiffusionCPPResidentStartupSummary(config stableDiffusionCPPResidentConfig) string {
	return fmt.Sprintf("threads=%d diffusion_fa=%t offload_to_cpu=%t has_vae=%t has_llm=%t has_clip_l=%t has_t5xxl=%t",
		config.Threads,
		config.DiffusionFA,
		config.OffloadParamsToCPU,
		config.VAEPath != "",
		config.LLMPath != "",
		config.ClipLPath != "",
		config.T5XXLPath != "",
	)
}

func resolveStableDiffusionCPPServerExecutable(executablePath string) (string, error) {
	trimmed := strings.TrimSpace(executablePath)
	if trimmed == "" {
		return "", fmt.Errorf("managed image backend executable is required")
	}
	dir := filepath.Dir(trimmed)
	candidates := []string{"sd-server", "sd-server.exe"}
	base := strings.ToLower(filepath.Base(trimmed))
	if base == "sd-server" || base == "sd-server.exe" {
		return trimmed, nil
	}
	for _, candidate := range candidates {
		resolved := filepath.Join(dir, candidate)
		if _, err := os.Stat(resolved); err == nil {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("managed image resident executable not found next to %s", trimmed)
}

func defaultManagedImageCommandFactory(ctx context.Context, executablePath string, args []string, workingDir string, env []string) (managedImageCommand, io.ReadCloser, io.ReadCloser, error) {
	command := exec.CommandContext(ctx, executablePath, args...)
	command.Dir = workingDir
	if len(env) > 0 {
		command.Env = env
	}
	stdoutPipe, err := command.StdoutPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("capture stable-diffusion.cpp stdout: %w", err)
	}
	stderrPipe, err := command.StderrPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("capture stable-diffusion.cpp stderr: %w", err)
	}
	return &execManagedImageCommand{cmd: command}, stdoutPipe, stderrPipe, nil
}

func (d *stableDiffusionCPPDriver) startResidentLocked(config stableDiffusionCPPResidentConfig, fingerprint string) (*stableDiffusionCPPResident, error) {
	if d == nil {
		return nil, fmt.Errorf("managed image backend driver unavailable")
	}
	port, err := reserveManagedImageLoopbackPort()
	if err != nil {
		return nil, err
	}
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)
	startupArgs := stableDiffusionCPPResidentStartupArgs(config, port)
	startupSummary := stableDiffusionCPPResidentStartupSummary(config)
	env := stableDiffusionCPPEnvironment(d.serverExecutablePath, os.Environ())
	processCtx, cancel := context.WithCancel(context.Background())
	command, stdoutPipe, stderrPipe, err := d.commandFactory(processCtx, d.serverExecutablePath, startupArgs, d.workingDir, env)
	if err != nil {
		cancel()
		return nil, err
	}
	startedAt := time.Now()
	log.Printf("managed image resident process start executable=%s endpoint=%s fingerprint=%s startup_flags=%s",
		strings.TrimSpace(d.serverExecutablePath),
		endpoint,
		fingerprint,
		startupSummary,
	)
	if err := command.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start stable-diffusion.cpp resident server: %w", err)
	}
	resident := &stableDiffusionCPPResident{
		fingerprint:    fingerprint,
		endpoint:       endpoint,
		startupArgs:    append([]string(nil), startupArgs...),
		startupSummary: startupSummary,
		command:        command,
		cancel:         cancel,
		logCapture:     &managedImageLogCapture{},
		done:           make(chan struct{}),
	}
	var streamWG sync.WaitGroup
	streamWG.Add(2)
	go streamManagedImageCommandOutput(stdoutPipe, "stdout", "managed image resident", resident.logCapture, &streamWG)
	go streamManagedImageCommandOutput(stderrPipe, "stderr", "managed image resident", resident.logCapture, &streamWG)
	go func() {
		err := command.Wait()
		streamWG.Wait()
		resident.markExited(err)
		if err != nil {
			log.Printf("managed image resident process exited endpoint=%s fingerprint=%s error=%v",
				endpoint,
				fingerprint,
				err,
			)
			return
		}
		log.Printf("managed image resident process exited endpoint=%s fingerprint=%s", endpoint, fingerprint)
	}()

	readyCtx, readyCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer readyCancel()
	if err := d.readinessProbe(readyCtx, d.httpClient, endpoint); err != nil {
		_ = resident.stop(5 * time.Second)
		message := strings.TrimSpace(resident.logCapture.String())
		if message == "" {
			return nil, fmt.Errorf("wait for stable-diffusion.cpp resident server: %w", err)
		}
		return nil, fmt.Errorf("wait for stable-diffusion.cpp resident server: %w: %s", err, message)
	}
	log.Printf("managed image resident process ready endpoint=%s fingerprint=%s duration_ms=%d startup_flags=%s",
		endpoint,
		fingerprint,
		time.Since(startedAt).Milliseconds(),
		startupSummary,
	)
	return resident, nil
}

func (d *stableDiffusionCPPDriver) stopResidentLocked(reason string) error {
	if d == nil || d.resident == nil {
		return nil
	}
	resident := d.resident
	d.resident = nil
	startedAt := time.Now()
	log.Printf("managed image resident process stop endpoint=%s fingerprint=%s reason=%s",
		resident.endpoint,
		resident.fingerprint,
		defaultManagedImageString(strings.TrimSpace(reason), "unspecified"),
	)
	if err := resident.stop(5 * time.Second); err != nil {
		log.Printf("managed image resident process stop failed endpoint=%s fingerprint=%s duration_ms=%d error=%v",
			resident.endpoint,
			resident.fingerprint,
			time.Since(startedAt).Milliseconds(),
			err,
		)
		return err
	}
	log.Printf("managed image resident process stopped endpoint=%s fingerprint=%s duration_ms=%d",
		resident.endpoint,
		resident.fingerprint,
		time.Since(startedAt).Milliseconds(),
	)
	return nil
}

func reserveManagedImageLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("reserve managed image loopback port: %w", err)
	}
	defer listener.Close()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("resolve managed image loopback port: unexpected address type %T", listener.Addr())
	}
	return address.Port, nil
}

func defaultStableDiffusionCPPReadinessProbe(ctx context.Context, client *http.Client, endpoint string) error {
	if client == nil {
		client = &http.Client{}
	}
	target := strings.TrimRight(strings.TrimSpace(endpoint), "/") + "/v1/models"
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return fmt.Errorf("create readiness request: %w", err)
		}
		resp, err := client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			if err != nil {
				return fmt.Errorf("probe resident readiness: %w", err)
			}
			return fmt.Errorf("probe resident readiness: status %d", resp.StatusCode)
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func defaultStableDiffusionCPPGenerateRequester(ctx context.Context, client *http.Client, endpoint string, loaded loadModelState, req imageGenerateState) ([]byte, error) {
	if client == nil {
		client = &http.Client{}
	}
	if len(req.RefImages) > 0 {
		return nil, fmt.Errorf("stable-diffusion.cpp resident server does not support ref_images")
	}
	maskPath, err := managedImageMaskPath(req.EnableParams)
	if err != nil {
		return nil, err
	}
	path, payload, err := buildStableDiffusionCPPGenerateRequest(loaded, req, maskPath)
	if err != nil {
		return nil, err
	}
	requestBody, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal stable-diffusion.cpp generate request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(strings.TrimSpace(endpoint), "/")+path, strings.NewReader(string(requestBody)))
	if err != nil {
		return nil, fmt.Errorf("create stable-diffusion.cpp generate request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("execute stable-diffusion.cpp generate request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return nil, fmt.Errorf("stable-diffusion.cpp generate request failed: status=%d body=%s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var respBody stableDiffusionCPPGenerateResponse
	if err := json.NewDecoder(response.Body).Decode(&respBody); err != nil {
		return nil, fmt.Errorf("decode stable-diffusion.cpp generate response: %w", err)
	}
	return respBody.payload(ctx, client)
}

type stableDiffusionCPPGenerateResponse struct {
	Images []string `json:"images"`
	Data   []struct {
		B64JSON string `json:"b64_json"`
		URL     string `json:"url"`
	} `json:"data"`
}

func (r stableDiffusionCPPGenerateResponse) payload(ctx context.Context, client *http.Client) ([]byte, error) {
	if len(r.Images) > 0 {
		return decodeManagedImageBase64(r.Images[0])
	}
	if len(r.Data) > 0 {
		if strings.TrimSpace(r.Data[0].B64JSON) != "" {
			return decodeManagedImageBase64(r.Data[0].B64JSON)
		}
		if strings.TrimSpace(r.Data[0].URL) != "" {
			return fetchManagedImageURL(ctx, client, r.Data[0].URL)
		}
	}
	return nil, fmt.Errorf("stable-diffusion.cpp generate response did not include an image artifact")
}

func buildStableDiffusionCPPGenerateRequest(loaded loadModelState, req imageGenerateState, maskPath string) (string, map[string]any, error) {
	payload := map[string]any{
		"prompt": req.PositivePrompt,
	}
	if strings.TrimSpace(req.NegativePrompt) != "" {
		payload["negative_prompt"] = strings.TrimSpace(req.NegativePrompt)
	}
	if req.Width > 0 {
		payload["width"] = req.Width
	}
	if req.Height > 0 {
		payload["height"] = req.Height
	}
	if req.Step > 0 {
		payload["steps"] = req.Step
	}
	if loaded.CFGScale > 0 {
		payload["cfg_scale"] = loaded.CFGScale
	}
	if sampler := strings.TrimSpace(loaded.Options.Sampler); sampler != "" {
		payload["sampler_name"] = sampler
	}
	if scheduler := strings.TrimSpace(loaded.Options.Scheduler); scheduler != "" {
		payload["scheduler"] = scheduler
	}
	payload["seed"] = managedImageGenerateSeed(req.Seed)

	if strings.TrimSpace(req.Src) == "" && maskPath == "" {
		return "/sdapi/v1/txt2img", payload, nil
	}
	if strings.TrimSpace(req.Src) == "" {
		return "", nil, fmt.Errorf("stable-diffusion.cpp resident server requires src when a mask is provided")
	}
	sourceImage, err := loadManagedImageRequestImage(strings.TrimSpace(req.Src))
	if err != nil {
		return "", nil, err
	}
	payload["init_images"] = []string{sourceImage}
	if maskPath != "" {
		maskImage, err := loadManagedImageRequestImage(maskPath)
		if err != nil {
			return "", nil, err
		}
		payload["mask"] = maskImage
	}
	return "/sdapi/v1/img2img", payload, nil
}

func managedImageGenerateSeed(seed int32) int32 {
	if seed != 0 {
		return seed
	}
	return 42
}

func managedImageMaskPath(enableParams string) (string, error) {
	trimmed := strings.TrimSpace(enableParams)
	if trimmed == "" {
		return "", nil
	}
	key, value, hasValue := strings.Cut(trimmed, ":")
	if !hasValue || strings.ToLower(strings.TrimSpace(key)) != "mask" || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("stable-diffusion.cpp resident server does not support enable parameters %q", trimmed)
	}
	return strings.TrimSpace(value), nil
}

func loadManagedImageRequestImage(path string) (string, error) {
	payload, err := os.ReadFile(strings.TrimSpace(path))
	if err != nil {
		return "", fmt.Errorf("read managed image input %s: %w", strings.TrimSpace(path), err)
	}
	if len(payload) == 0 {
		return "", fmt.Errorf("managed image input %s is empty", strings.TrimSpace(path))
	}
	return base64.StdEncoding.EncodeToString(payload), nil
}

func decodeManagedImageBase64(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, fmt.Errorf("managed image payload is empty")
	}
	if strings.HasPrefix(trimmed, "data:") {
		if comma := strings.Index(trimmed, ","); comma >= 0 {
			trimmed = strings.TrimSpace(trimmed[comma+1:])
		}
	}
	payload, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("decode managed image payload: %w", err)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("managed image payload is empty")
	}
	return payload, nil
}

func fetchManagedImageURL(ctx context.Context, client *http.Client, target string) ([]byte, error) {
	if client == nil {
		client = &http.Client{}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(target), nil)
	if err != nil {
		return nil, fmt.Errorf("create managed image artifact request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("execute managed image artifact request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("managed image artifact request failed: status=%d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 100*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read managed image artifact: %w", err)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("managed image artifact is empty")
	}
	return payload, nil
}

func defaultManagedImageString(value string, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(fallback)
}

func decodeLoadModelState(message *dynamicpb.Message) (loadModelState, error) {
	if message == nil {
		return loadModelState{}, fmt.Errorf("managed image load payload is required")
	}
	modelsRoot := strings.TrimSpace(dynamicMessageStringField(message, "ModelPath"))
	modelPath := resolveManagedImagePath(modelsRoot, dynamicMessageStringField(message, "ModelFile"))
	if strings.TrimSpace(modelPath) == "" {
		return loadModelState{}, fmt.Errorf("managed image model path is required")
	}
	options, err := parseManagedImageOptions(modelsRoot, dynamicMessageStringListField(message, "Options"))
	if err != nil {
		return loadModelState{}, err
	}
	return loadModelState{
		ModelsRoot: modelsRoot,
		ModelPath:  modelPath,
		Options:    options,
		CFGScale:   dynamicMessageFloat32Field(message, "CFGScale"),
		Threads:    dynamicMessageInt32Field(message, "Threads"),
	}, nil
}

func decodeGenerateImageState(message *dynamicpb.Message) (imageGenerateState, error) {
	if message == nil {
		return imageGenerateState{}, fmt.Errorf("managed image request payload is required")
	}
	destination := strings.TrimSpace(dynamicMessageStringField(message, "dst"))
	if destination == "" {
		return imageGenerateState{}, fmt.Errorf("managed image destination is required")
	}
	return imageGenerateState{
		Width:          dynamicMessageInt32Field(message, "width"),
		Height:         dynamicMessageInt32Field(message, "height"),
		Step:           dynamicMessageInt32Field(message, "step"),
		Seed:           dynamicMessageInt32Field(message, "seed"),
		PositivePrompt: strings.TrimSpace(dynamicMessageStringField(message, "positive_prompt")),
		NegativePrompt: strings.TrimSpace(dynamicMessageStringField(message, "negative_prompt")),
		Dst:            destination,
		Src:            strings.TrimSpace(dynamicMessageStringField(message, "src")),
		EnableParams:   strings.TrimSpace(dynamicMessageStringField(message, "EnableParameters")),
		RefImages:      dynamicMessageStringListField(message, "ref_images"),
	}, nil
}

func parseManagedImageOptions(modelsRoot string, options []string) (managedImageOptions, error) {
	var parsed managedImageOptions
	for _, option := range options {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		key, value, hasValue := strings.Cut(trimmed, ":")
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		switch normalizedKey {
		case "diffusion_model":
			continue
		case "offload_params_to_cpu":
			if !hasValue {
				return managedImageOptions{}, fmt.Errorf("managed image option offload_params_to_cpu requires a boolean value")
			}
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "true":
				flag := true
				parsed.OffloadParamsToCPU = &flag
			case "false":
				flag := false
				parsed.OffloadParamsToCPU = &flag
			default:
				return managedImageOptions{}, fmt.Errorf("managed image option offload_params_to_cpu requires true or false")
			}
		case "diffusion_fa":
			if !hasValue {
				return managedImageOptions{}, fmt.Errorf("managed image option diffusion_fa requires a boolean value")
			}
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "true":
				flag := true
				parsed.DiffusionFA = &flag
			case "false":
				flag := false
				parsed.DiffusionFA = &flag
			default:
				return managedImageOptions{}, fmt.Errorf("managed image option diffusion_fa requires true or false")
			}
		case "sampler":
			if !hasValue || strings.TrimSpace(value) == "" {
				return managedImageOptions{}, fmt.Errorf("managed image option sampler requires a value")
			}
			parsed.Sampler = strings.TrimSpace(value)
		case "scheduler":
			if !hasValue || strings.TrimSpace(value) == "" {
				return managedImageOptions{}, fmt.Errorf("managed image option scheduler requires a value")
			}
			parsed.Scheduler = strings.TrimSpace(value)
		case "vae_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.VAEPath = path
		case "llm_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.LLMPath = path
		case "clip_l_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.ClipLPath = path
		case "t5xxl_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.T5XXLPath = path
		default:
			return managedImageOptions{}, fmt.Errorf("unsupported managed image option %q", normalizedKey)
		}
	}
	return parsed, nil
}

func resolveManagedImagePath(modelsRoot string, value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if filepath.IsAbs(trimmed) || strings.TrimSpace(modelsRoot) == "" {
		return trimmed
	}
	return filepath.Join(strings.TrimSpace(modelsRoot), filepath.FromSlash(trimmed))
}

func resolveManagedImageOptionPath(modelsRoot string, value string) (string, error) {
	path := resolveManagedImagePath(modelsRoot, value)
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("managed image option path is required")
	}
	return path, nil
}

func dynamicMessageStringField(message *dynamicpb.Message, fieldName string) string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return ""
	}
	return strings.TrimSpace(message.Get(field).String())
}

func dynamicMessageInt32Field(message *dynamicpb.Message, fieldName string) int32 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return int32(message.Get(field).Int())
}

func dynamicMessageFloat32Field(message *dynamicpb.Message, fieldName string) float32 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return float32(message.Get(field).Float())
}

func dynamicMessageStringListField(message *dynamicpb.Message, fieldName string) []string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return nil
	}
	list := message.Get(field).List()
	values := make([]string, 0, list.Len())
	for index := 0; index < list.Len(); index++ {
		trimmed := strings.TrimSpace(list.Get(index).String())
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}

func resultMessage(success bool, message string) *dynamicpb.Message {
	result := dynamicpb.NewMessage(resultMessageDescriptor)
	if field := result.Descriptor().Fields().ByName(protoreflect.Name("message")); field != nil && strings.TrimSpace(message) != "" {
		result.Set(field, protoreflect.ValueOfString(strings.TrimSpace(message)))
	}
	if field := result.Descriptor().Fields().ByName(protoreflect.Name("success")); field != nil {
		result.Set(field, protoreflect.ValueOfBool(success))
	}
	return result
}
