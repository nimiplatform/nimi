package engine

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/png"
	"log/slog"
	"math"
	"net"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

type managerImageInvocationSubstrate struct {
	manager *Manager
	logger  *slog.Logger
	config  ImageExecutionHostConfig

	mu         sync.RWMutex
	currentKey string
	address    string
	protocol   managedimagebackend.Protocol
}

func newManagerImageInvocationSubstrate(manager *Manager, logger *slog.Logger, config ImageExecutionHostConfig) *managerImageInvocationSubstrate {
	if logger == nil {
		logger = slog.Default()
	}
	config.Environment = cloneStringMap(config.Environment)
	return &managerImageInvocationSubstrate{manager: manager, logger: logger, config: config}
}

func (s *managerImageInvocationSubstrate) Ensure(
	ctx context.Context,
	plan *capabilitydriver.ImageInvocationPlan,
	validateContent func() error,
	progress localexecution.ImageProgressFunc,
) (bool, error) {
	if s == nil || s.manager == nil {
		return false, fmt.Errorf("image execution manager is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	key := strings.TrimSpace(plan.ProcessKey())
	if key == "" {
		return false, fmt.Errorf("image invocation process key is required")
	}
	s.mu.RLock()
	currentKey := s.currentKey
	s.mu.RUnlock()
	if key == currentKey && s.Healthy() {
		if validateContent != nil {
			if err := validateContent(); err != nil {
				return false, err
			}
		}
		if progress != nil {
			progress(localexecution.ImageExecutionProgress{
				Stage:         localexecution.ImageExecutionStageReused,
				ArtifactCount: int32(plan.ImageCount()),
			})
		}
		return true, nil
	}

	if err := s.stopProcess(); err != nil {
		return false, fmt.Errorf("stop prior image substrate: %w", err)
	}
	if progress != nil {
		progress(localexecution.ImageExecutionProgress{
			Stage:         localexecution.ImageExecutionStageLoading,
			ArtifactCount: int32(plan.ImageCount()),
		})
	}
	// This is the replacement boundary: no prior process can retain the old
	// plan, and captured bytes are re-hashed immediately before a new substrate
	// is allowed to receive their paths.
	if validateContent != nil {
		if err := validateContent(); err != nil {
			return false, err
		}
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}

	address, err := reserveImageExecutionAddress()
	if err != nil {
		return false, err
	}
	engineConfig, err := s.resolveEngineConfig(address)
	if err != nil {
		return false, err
	}
	// Supervisor lifetime is Host-owned, not request-owned. Terminal Job
	// cancellation must not silently orphan the resident process monitor.
	if err := s.manager.StartEngine(context.Background(), engineConfig); err != nil {
		return false, fmt.Errorf("start image substrate: %w", err)
	}
	if err := ctx.Err(); err != nil {
		_ = s.stopProcess()
		return false, err
	}
	if !s.Healthy() {
		_ = s.stopProcess()
		return false, fmt.Errorf("image substrate did not become healthy")
	}

	protocol := imageExecutionProtocol(engineConfig.BinaryPath)
	loadRequest, err := imageLoadRequest(address, plan, protocol)
	if err != nil {
		_ = s.stopProcess()
		return false, err
	}
	if _, err := managedimagebackend.LoadModel(ctx, loadRequest); err != nil {
		processHealthy := s.Healthy()
		_ = s.stopProcess()
		if !processHealthy && ctx.Err() == nil {
			return false, executionFailure(localexecution.FailureProcessCrash, fmt.Errorf("image substrate exited while loading model: %w", err))
		}
		return false, plan.TranslateFailure(capabilitydriver.ImageBackendFailureLoad, err)
	}
	s.mu.Lock()
	s.currentKey = key
	s.address = address
	s.protocol = protocol
	s.mu.Unlock()
	if progress != nil {
		progress(localexecution.ImageExecutionProgress{
			Stage:         localexecution.ImageExecutionStageReady,
			ArtifactCount: int32(plan.ImageCount()),
		})
	}
	return false, nil
}

func (s *managerImageInvocationSubstrate) GenerateImage(
	ctx context.Context,
	plan *capabilitydriver.ImageInvocationPlan,
	index int32,
	progress localexecution.ImageProgressFunc,
) (localexecution.ImageArtifact, error) {
	if s == nil || s.manager == nil || !s.Healthy() {
		return localexecution.ImageArtifact{}, fmt.Errorf("image substrate is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.RLock()
	address := s.address
	currentKey := s.currentKey
	protocol := s.protocol
	s.mu.RUnlock()
	if strings.TrimSpace(address) == "" || currentKey != plan.ProcessKey() {
		return localexecution.ImageArtifact{}, fmt.Errorf("image substrate does not hold the captured plan")
	}
	workRoot := strings.TrimSpace(s.config.WorkRoot)
	if workRoot == "" {
		workRoot = s.manager.imageExecutionWorkRoot()
	}
	if !filepath.IsAbs(workRoot) {
		return localexecution.ImageArtifact{}, fmt.Errorf("image execution work root must be absolute")
	}
	if err := os.MkdirAll(workRoot, 0o700); err != nil {
		return localexecution.ImageArtifact{}, fmt.Errorf("create image execution work root: %w", err)
	}
	workDir, err := os.MkdirTemp(workRoot, "invocation-*")
	if err != nil {
		return localexecution.ImageArtifact{}, fmt.Errorf("create image invocation workspace: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()
	request, err := imageGenerateRequest(address, protocol, plan)
	if err != nil {
		return localexecution.ImageArtifact{}, err
	}
	destination := filepath.Join(workDir, fmt.Sprintf("artifact-%d.png", index))
	constraints, ok := plan.ResultConstraints().(capabilitydriver.StableDiffusionCPPResultConstraints)
	if !ok {
		return localexecution.ImageArtifact{}, fmt.Errorf("image result constraints are unavailable")
	}
	width, height := constraints.Width(), constraints.Height()
	startedAt := time.Now()
	request.Dst = destination
	var translatedProgressErr error
	request.OnProgress = func(backendProgress managedimagebackend.ImageGenerateProgress) error {
		translated, translateErr := plan.TranslateProgress(capabilitydriver.ImageBackendProgressObservation{
			CurrentStep: backendProgress.CurrentStep, TotalSteps: backendProgress.TotalSteps, ProgressPercent: backendProgress.ProgressPercent,
		})
		if translateErr != nil {
			translatedProgressErr = plan.TranslateFailure(capabilitydriver.ImageBackendFailureProgress, translateErr)
			return translatedProgressErr
		}
		if progress != nil {
			progress(localexecution.ImageExecutionProgress{
				Stage: localexecution.ImageExecutionStageGenerating, ArtifactIndex: index, ArtifactCount: int32(plan.ImageCount()),
				CurrentStep: translated.CurrentStep, TotalSteps: translated.TotalSteps, ProgressPercent: translated.ProgressPercent,
			})
		}
		return nil
	}
	_, err = managedimagebackend.GenerateImage(ctx, request)
	computeMS := time.Since(startedAt).Milliseconds()
	if err != nil {
		if translatedProgressErr != nil {
			return localexecution.ImageArtifact{}, translatedProgressErr
		}
		return localexecution.ImageArtifact{}, plan.TranslateFailure(capabilitydriver.ImageBackendFailureGenerate, err)
	}
	payload, err := os.ReadFile(destination)
	if err != nil {
		return localexecution.ImageArtifact{}, plan.TranslateFailure(capabilitydriver.ImageBackendFailureResult, fmt.Errorf("read generated image artifact: %w", err))
	}
	if len(payload) == 0 {
		return localexecution.ImageArtifact{}, plan.TranslateFailure(capabilitydriver.ImageBackendFailureResult, fmt.Errorf("generated image artifact is empty"))
	}
	decoded, format, decodeErr := image.DecodeConfig(bytes.NewReader(payload))
	if decodeErr != nil {
		return localexecution.ImageArtifact{}, plan.TranslateFailure(capabilitydriver.ImageBackendFailureResult, fmt.Errorf("decode generated PNG artifact: %w", decodeErr))
	}
	if format != "png" {
		return localexecution.ImageArtifact{}, plan.TranslateFailure(capabilitydriver.ImageBackendFailureResult, fmt.Errorf("generated image artifact format %q is not PNG", format))
	}
	if decoded.Width != width || decoded.Height != height {
		return localexecution.ImageArtifact{}, plan.TranslateFailure(capabilitydriver.ImageBackendFailureResult, fmt.Errorf(
			"generated image dimensions %dx%d do not match captured plan %dx%d",
			decoded.Width, decoded.Height, width, height,
		))
	}
	translated, err := plan.TranslateArtifact(capabilitydriver.ImageBackendArtifactObservation{
		Index: index, Payload: payload, Format: format, Width: decoded.Width, Height: decoded.Height,
	})
	if err != nil {
		return localexecution.ImageArtifact{}, plan.TranslateFailure(capabilitydriver.ImageBackendFailureResult, err)
	}
	return localexecution.ImageArtifact{Index: translated.Index, Bytes: translated.Payload, MediaType: translated.MediaType, ComputeMS: computeMS}, nil
}

func (s *managerImageInvocationSubstrate) Healthy() bool {
	if s == nil || s.manager == nil {
		return false
	}
	info, err := s.manager.EngineStatus(engineImageExecutionHost)
	return err == nil && info.Status == StatusHealthy && info.PID > 0 && supervisorProcessAlive(info.PID)
}

func (s *managerImageInvocationSubstrate) Stop() error {
	if s == nil {
		return nil
	}
	return s.stopProcess()
}

func (s *managerImageInvocationSubstrate) stopProcess() error {
	if s == nil || s.manager == nil {
		return nil
	}
	s.mu.Lock()
	s.currentKey = ""
	s.address = ""
	s.mu.Unlock()
	if _, err := s.manager.EngineStatus(engineImageExecutionHost); err != nil {
		return nil
	}
	return s.manager.StopEngine(engineImageExecutionHost)
}

func (s *managerImageInvocationSubstrate) resolveEngineConfig(address string) (EngineConfig, error) {
	if directory := strings.TrimSpace(s.config.BackendDirectory); directory != "" {
		return imageExecutionEngineConfigFromDirectory(directory, address, s.config)
	}
	return s.manager.resolveInstalledImageExecutionEngineConfig(address, s.config)
}

func (m *Manager) resolveInstalledImageExecutionEngineConfig(address string, config ImageExecutionHostConfig) (EngineConfig, error) {
	if m == nil {
		return EngineConfig{}, fmt.Errorf("image execution manager is unavailable")
	}
	m.mu.RLock()
	backendsPath := strings.TrimSpace(m.managedImageBackendsPath)
	sharedDependenciesPath := strings.TrimSpace(m.sharedAcceleratorDependenciesPath)
	m.mu.RUnlock()
	resolved, err := resolveInstalledManagedImageBackendConfig(backendsPath, sharedDependenciesPath, &ManagedImageBackendConfig{
		Mode:            ManagedImageBackendOfficial,
		BackendName:     "stablediffusion-ggml",
		PackageSource:   strings.TrimSpace(config.PackageSource),
		Address:         address,
		StartupTimeout:  config.StartupTimeout,
		ShutdownTimeout: config.ShutdownTimeout,
	})
	if err != nil {
		return EngineConfig{}, err
	}
	// Package-entrypoint installations are the gosd substrate itself. Resolve
	// its executable and SD_LIBRARY explicitly instead of depending on a shell
	// to choose execution content after Host admission.
	if strings.EqualFold(filepath.Base(strings.TrimSpace(resolved.Command)), managedImageBackendRunScript) {
		directory := filepath.Dir(strings.TrimSpace(resolved.Command))
		return imageExecutionEngineConfigFromDirectory(directory, address, config)
	}
	engineConfig, err := managedImageBackendEngineConfig(resolved)
	if err != nil {
		return EngineConfig{}, err
	}
	engineConfig.Kind = engineImageExecutionHost
	engineConfig.MaxRestarts = 1
	return engineConfig, nil
}

func imageExecutionEngineConfigFromDirectory(directory string, address string, config ImageExecutionHostConfig) (EngineConfig, error) {
	if strings.TrimSpace(directory) == "" {
		return EngineConfig{}, fmt.Errorf("image backend directory is required")
	}
	canonicalDirectory, err := filepath.Abs(filepath.Clean(strings.TrimSpace(directory)))
	if err != nil {
		return EngineConfig{}, fmt.Errorf("canonicalize image backend directory: %w", err)
	}
	if !filepath.IsAbs(canonicalDirectory) {
		return EngineConfig{}, fmt.Errorf("image backend directory must be absolute")
	}
	if resolved, resolveErr := filepath.EvalSymlinks(canonicalDirectory); resolveErr == nil {
		canonicalDirectory = resolved
	}
	info, err := os.Stat(canonicalDirectory)
	if err != nil {
		return EngineConfig{}, fmt.Errorf("image backend directory is unavailable: %w", err)
	}
	if !info.IsDir() {
		return EngineConfig{}, fmt.Errorf("image backend path is not a directory")
	}

	executable, err := resolveImageExecutionExecutable(canonicalDirectory, config.ExecutablePath)
	if err != nil {
		return EngineConfig{}, err
	}
	libraryHint := strings.TrimSpace(config.LibraryPath)
	if libraryHint == "" {
		libraryHint = strings.TrimSpace(config.Environment["SD_LIBRARY"])
	}
	if libraryHint == "" {
		libraryHint = strings.TrimSpace(os.Getenv("SD_LIBRARY"))
	}
	library, err := resolveImageExecutionLibrary(canonicalDirectory, libraryHint)
	if err != nil {
		return EngineConfig{}, err
	}

	host, portText, err := net.SplitHostPort(strings.TrimSpace(address))
	if err != nil || host != "127.0.0.1" {
		return EngineConfig{}, fmt.Errorf("image substrate address must be explicit IPv4 loopback: %q", address)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 {
		return EngineConfig{}, fmt.Errorf("image substrate address has an invalid port: %q", address)
	}
	environment := cloneStringMap(config.Environment)
	if environment == nil {
		environment = make(map[string]string)
	}
	environment["SD_LIBRARY"] = library
	libraryDirectory := filepath.Join(canonicalDirectory, "lib")
	if libraryInfo, statErr := os.Stat(libraryDirectory); statErr == nil && libraryInfo.IsDir() {
		switch goruntime.GOOS {
		case "darwin":
			environment["DYLD_LIBRARY_PATH"] = prependImageExecutionPath(libraryDirectory, environment["DYLD_LIBRARY_PATH"], os.Getenv("DYLD_LIBRARY_PATH"))
		case "windows":
			environment["PATH"] = prependImageExecutionPath(libraryDirectory, environment["PATH"], os.Getenv("PATH"))
		default:
			environment["LD_LIBRARY_PATH"] = prependImageExecutionPath(libraryDirectory, environment["LD_LIBRARY_PATH"], os.Getenv("LD_LIBRARY_PATH"))
		}
	}
	if repair := filepath.Join(canonicalDirectory, "nimi-metal-language-repair.dylib"); goruntime.GOOS == "darwin" {
		if repairInfo, statErr := os.Stat(repair); statErr == nil && repairInfo.Mode().IsRegular() {
			environment["DYLD_INSERT_LIBRARIES"] = prependImageExecutionPath(repair, environment["DYLD_INSERT_LIBRARIES"], os.Getenv("DYLD_INSERT_LIBRARIES"))
		}
	}
	startupTimeout := config.StartupTimeout
	if startupTimeout <= 0 {
		startupTimeout = 45 * time.Second
	}
	shutdownTimeout := config.ShutdownTimeout
	if shutdownTimeout <= 0 {
		shutdownTimeout = 10 * time.Second
	}
	return EngineConfig{
		Kind:             engineImageExecutionHost,
		Port:             port,
		Address:          address,
		HealthMode:       HealthModeTCP,
		BinaryPath:       executable,
		CommandArgs:      []string{"--addr", address},
		CommandEnv:       environment,
		WorkingDir:       canonicalDirectory,
		StartupTimeout:   startupTimeout,
		HealthInterval:   15 * time.Second,
		ShutdownTimeout:  shutdownTimeout,
		RestartBaseDelay: time.Second,
		MaxRestarts:      1,
	}, nil
}

func isDirectGOSDExecutable(path string) bool {
	name := strings.ToLower(strings.TrimSpace(filepath.Base(path)))
	return name == "stablediffusion-ggml" || name == "stablediffusion-ggml.exe"
}

func resolveImageExecutionExecutable(directory string, hint string) (string, error) {
	if value := strings.TrimSpace(hint); value != "" {
		if !filepath.IsAbs(value) {
			value = filepath.Join(directory, value)
		}
		return requireImageExecutionExecutable(value)
	}
	for _, name := range []string{"stablediffusion-ggml", "stablediffusion-ggml.exe"} {
		if path, err := requireImageExecutionExecutable(filepath.Join(directory, name)); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("image substrate executable was not found in %s", directory)
}

func requireImageExecutionExecutable(path string) (string, error) {
	canonical, err := requireImageExecutionFile(path, "image substrate executable")
	if err != nil {
		return "", err
	}
	if goruntime.GOOS != "windows" {
		info, statErr := os.Stat(canonical)
		if statErr != nil {
			return "", fmt.Errorf("image substrate executable is unavailable: %w", statErr)
		}
		if info.Mode().Perm()&0o111 == 0 {
			return "", fmt.Errorf("image substrate executable lacks execute permission")
		}
	}
	return canonical, nil
}

func resolveImageExecutionLibrary(directory string, hint string) (string, error) {
	if value := strings.TrimSpace(hint); value != "" {
		if !filepath.IsAbs(value) {
			value = filepath.Join(directory, value)
		}
		return requireImageExecutionFile(value, "SD_LIBRARY")
	}
	for _, name := range imageExecutionLibraryCandidates() {
		if path, err := requireImageExecutionFile(filepath.Join(directory, name), "SD_LIBRARY"); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("SD_LIBRARY was not found in %s", directory)
}

func imageExecutionLibraryCandidates() []string {
	candidates := make([]string, 0, 9)
	if goruntime.GOOS == "linux" && (goruntime.GOARCH == "amd64" || goruntime.GOARCH == "386") {
		cpuInfo, _ := os.ReadFile("/proc/cpuinfo")
		flags := " " + strings.ToLower(string(cpuInfo)) + " "
		for _, candidate := range []struct {
			flag string
			name string
		}{
			{flag: " avx512f ", name: "libgosd-avx512.so"},
			{flag: " avx2 ", name: "libgosd-avx2.so"},
			{flag: " avx ", name: "libgosd-avx.so"},
		} {
			if strings.Contains(flags, candidate.flag) {
				candidates = append(candidates, candidate.name)
			}
		}
	}
	return append(candidates,
		"libgosd-fallback.so",
		"libgosd.so",
		filepath.Join("lib", "libgosd-fallback.so"),
		filepath.Join("lib", "libgosd.so"),
		"gosd.dll",
	)
}

func requireImageExecutionFile(path string, label string) (string, error) {
	canonical, err := filepath.Abs(filepath.Clean(strings.TrimSpace(path)))
	if err != nil {
		return "", fmt.Errorf("canonicalize %s: %w", label, err)
	}
	if !filepath.IsAbs(canonical) {
		return "", fmt.Errorf("%s must be absolute", label)
	}
	if resolved, resolveErr := filepath.EvalSymlinks(canonical); resolveErr == nil {
		canonical = resolved
	}
	info, err := os.Stat(canonical)
	if err != nil {
		return "", fmt.Errorf("%s is unavailable: %w", label, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", label)
	}
	return canonical, nil
}

func prependImageExecutionPath(value string, configured string, inherited string) string {
	base := strings.TrimSpace(configured)
	if base == "" {
		base = strings.TrimSpace(inherited)
	}
	if base == "" {
		return value
	}
	return value + string(os.PathListSeparator) + base
}

func reserveImageExecutionAddress() (string, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("reserve image substrate loopback address: %w", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		return "", fmt.Errorf("release image substrate loopback address: %w", err)
	}
	return address, nil
}

func imageExecutionProtocol(binaryPath string) managedimagebackend.Protocol {
	if isDirectGOSDExecutable(binaryPath) {
		return managedimagebackend.ProtocolDirectGOSD
	}
	return managedimagebackend.ProtocolManagedWrapper
}

func imageLoadRequest(address string, plan *capabilitydriver.ImageInvocationPlan, protocol managedimagebackend.Protocol) (managedimagebackend.LoadModelRequest, error) {
	if plan == nil {
		return managedimagebackend.LoadModelRequest{}, fmt.Errorf("image invocation plan is required")
	}
	load, ok := plan.LoadPlan().(capabilitydriver.StableDiffusionCPPLoadPlan)
	if !ok {
		return managedimagebackend.LoadModelRequest{}, fmt.Errorf("image load plan variant is unsupported")
	}
	main := load.Main()
	request := managedimagebackend.LoadModelRequest{
		BackendAddress: address,
		Protocol:       protocol,
		ModelsRoot:     imageInvocationModelsRoot(main.AbsolutePath()),
		ModelPath:      main.AbsolutePath(),
		Threads:        int32(load.Threads()),
	}
	if protocol == managedimagebackend.ProtocolDirectGOSD {
		if load.QwenImageZeroCondT() {
			return managedimagebackend.LoadModelRequest{}, fmt.Errorf("direct gosd cannot express the Qwen Image Edit 2511 load contract")
		}
		request.DirectOptions = directGOSDImageLoadOptions(load)
		request.DirectCFGScale = float32(load.CFGScale())
		return request, nil
	}
	if protocol != managedimagebackend.ProtocolManagedWrapper {
		return managedimagebackend.LoadModelRequest{}, fmt.Errorf("image execution protocol is unsupported")
	}
	request.DiffusionFA = load.DiffusionFlashAttention()
	request.OffloadToCPU = load.OffloadParamsToCPU()
	request.FlowShift = float32(load.FlowShift())
	request.QwenImageZeroCondT = load.QwenImageZeroCondT()
	request.Components = []managedimagebackend.ComponentBinding{
		{
			OccurrenceID:  "text-encoder",
			Order:         0,
			Role:          "text_encoder",
			ComponentKind: "auxiliary",
			EngineSlot:    "llm_path",
			Path:          load.TextEncoder().AbsolutePath(),
			Required:      true,
		},
		{
			OccurrenceID:  "vae",
			Order:         0,
			Role:          "vae",
			ComponentKind: "vae",
			EngineSlot:    "vae_path",
			Path:          load.VAE().AbsolutePath(),
			Required:      true,
		},
	}
	if uncond, exists := load.UncondDiffusion(); exists {
		request.Components = append(request.Components, managedimagebackend.ComponentBinding{
			OccurrenceID:  "uncond-diffusion",
			Order:         0,
			Role:          "uncond_diffusion_model",
			ComponentKind: "image",
			EngineSlot:    "uncond_diffusion_model",
			Path:          uncond.AbsolutePath(),
			Required:      true,
		})
	}
	return request, nil
}

func directGOSDImageLoadOptions(load capabilitydriver.StableDiffusionCPPLoadPlan) []string {
	options := []string{
		"diffusion_model",
		"llm_path:" + load.TextEncoder().AbsolutePath(),
		"vae_path:" + load.VAE().AbsolutePath(),
		"diffusion_fa:" + strconv.FormatBool(load.DiffusionFlashAttention()),
		"offload_params_to_cpu:" + strconv.FormatBool(load.OffloadParamsToCPU()),
	}
	if uncond, exists := load.UncondDiffusion(); exists {
		options = append(options, "uncond_diffusion_model:"+uncond.AbsolutePath())
	}
	if load.FlowShift() > 0 {
		options = append(options, "flow_shift:"+strconv.FormatFloat(load.FlowShift(), 'g', -1, 64))
	}
	if sampler := strings.TrimSpace(load.Sampler()); sampler != "" {
		options = append(options, "sampler:"+sampler)
	}
	if scheduler := strings.TrimSpace(load.Scheduler()); scheduler != "" {
		options = append(options, "scheduler:"+scheduler)
	}
	return options
}

func imageGenerateRequest(address string, protocol managedimagebackend.Protocol, plan *capabilitydriver.ImageInvocationPlan) (managedimagebackend.ImageRequest, error) {
	requestPlan := plan.RequestPlan()
	if requestPlan == nil || requestPlan.Seed() < math.MinInt32 || requestPlan.Seed() > math.MaxInt32 {
		return managedimagebackend.ImageRequest{}, fmt.Errorf("image request plan is invalid")
	}
	load, ok := plan.LoadPlan().(capabilitydriver.StableDiffusionCPPLoadPlan)
	if !ok {
		return managedimagebackend.ImageRequest{}, fmt.Errorf("image load plan variant is unsupported")
	}
	request := managedimagebackend.ImageRequest{
		BackendAddress: address, Protocol: protocol,
		ModelsRoot: imageInvocationModelsRoot(load.Main().AbsolutePath()), ModelPath: load.Main().AbsolutePath(),
		CFGScale: float32(requestPlan.CFGScale()), Sampler: requestPlan.Sampler(), Scheduler: requestPlan.Scheduler(),
		Width: int32(requestPlan.Width()), Height: int32(requestPlan.Height()), Step: int32(requestPlan.Steps()), Seed: int32(requestPlan.Seed()),
		PositivePrompt: requestPlan.Prompt(), NegativePrompt: requestPlan.NegativePrompt(),
	}
	switch typed := requestPlan.(type) {
	case capabilitydriver.StableDiffusionCPPTextToImageRequestPlan:
		request.Mode = managedimagebackend.ImageRequestModeTextToImage
	case capabilitydriver.StableDiffusionCPPInstructionEditRequestPlan:
		source := typed.SourceImage()
		if source.SourceIdentity == "" || source.SourceIdentity != strings.TrimSpace(source.SourceIdentity) || len(source.ImageBytes) == 0 {
			return managedimagebackend.ImageRequest{}, fmt.Errorf("image instruction-edit source is incomplete")
		}
		request.Mode = managedimagebackend.ImageRequestModeInstructionEdit
		request.ReferenceImage = append([]byte(nil), source.ImageBytes...)
	default:
		return managedimagebackend.ImageRequest{}, fmt.Errorf("image request plan variant is unsupported")
	}
	return request, nil
}

func imageInvocationModelsRoot(mainModelPath string) string {
	volume := filepath.VolumeName(mainModelPath)
	return volume + string(filepath.Separator)
}

func (m *Manager) imageExecutionWorkRoot() string {
	if m == nil {
		return ""
	}
	m.mu.RLock()
	runtimeWorkRoot := strings.TrimSpace(m.runtimeWorkRoot)
	baseDir := strings.TrimSpace(m.baseDir)
	m.mu.RUnlock()
	if runtimeWorkRoot != "" {
		return filepath.Join(runtimeWorkRoot, "image-execution")
	}
	return filepath.Join(baseDir, ".runtime-work", "image-execution")
}
