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

	loadRequest, err := imageLoadRequest(address, plan)
	if err != nil {
		_ = s.stopProcess()
		return false, err
	}
	// The native gosd protocol predates the Runtime wrapper's ordered
	// ComponentBinding extension. Its exact components are carried by the
	// Driver-formed main path plus ordered option/prompt instructions; sending
	// the wrapper-only field to that legacy descriptor can collide with an
	// incompatible private field number.
	if isDirectGOSDExecutable(engineConfig.BinaryPath) {
		loadRequest.Components = nil
	}
	if _, err := managedimagebackend.LoadModel(ctx, loadRequest); err != nil {
		processHealthy := s.Healthy()
		_ = s.stopProcess()
		if !processHealthy && ctx.Err() == nil {
			return false, executionFailure(localexecution.FailureProcessCrash, fmt.Errorf("image substrate exited while loading model: %w", err))
		}
		return false, fmt.Errorf("load image model: %w", err)
	}
	s.mu.Lock()
	s.currentKey = key
	s.address = address
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
	s.mu.RUnlock()
	if strings.TrimSpace(address) == "" || currentKey != plan.ProcessKey() {
		return localexecution.ImageArtifact{}, fmt.Errorf("image substrate does not hold the captured plan")
	}
	if plan.Seed() < math.MinInt32 || plan.Seed() > math.MaxInt32 {
		return localexecution.ImageArtifact{}, fmt.Errorf("image seed is outside the substrate range")
	}
	if err := validateImageSubstrateInputPath(plan.InputImage()); err != nil {
		return localexecution.ImageArtifact{}, err
	}
	if err := validateImageSubstrateInputPath(plan.Mask()); err != nil {
		return localexecution.ImageArtifact{}, err
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
	destination := filepath.Join(workDir, fmt.Sprintf("artifact-%d.png", index))
	width, height := plan.Size()
	startedAt := time.Now()
	_, err = managedimagebackend.GenerateImage(ctx, managedimagebackend.ImageRequest{
		BackendAddress: address,
		ModelsRoot:     imageInvocationModelsRoot(plan.MainModelPath()),
		ModelPath:      plan.MainModelPath(),
		Width:          int32(width),
		Height:         int32(height),
		Step:           int32(plan.Steps()),
		Seed:           int32(plan.Seed()),
		PositivePrompt: imageInvocationPrompt(plan),
		NegativePrompt: plan.NegativePrompt(),
		Dst:            destination,
		Src:            plan.InputImage(),
		EnableParams:   imageInvocationEnableParameters(plan),
		OnProgress: func(backendProgress managedimagebackend.ImageGenerateProgress) {
			if progress != nil {
				progress(localexecution.ImageExecutionProgress{
					Stage:         localexecution.ImageExecutionStageGenerating,
					ArtifactIndex: index,
					ArtifactCount: int32(plan.ImageCount()),
				})
			}
		},
	})
	computeMS := time.Since(startedAt).Milliseconds()
	if err != nil {
		return localexecution.ImageArtifact{}, err
	}
	payload, err := os.ReadFile(destination)
	if err != nil {
		return localexecution.ImageArtifact{}, fmt.Errorf("read generated image artifact: %w", err)
	}
	if len(payload) == 0 {
		return localexecution.ImageArtifact{}, fmt.Errorf("generated image artifact is empty")
	}
	decoded, format, decodeErr := image.DecodeConfig(bytes.NewReader(payload))
	if decodeErr != nil {
		return localexecution.ImageArtifact{}, fmt.Errorf("decode generated PNG artifact: %w", decodeErr)
	}
	if format != "png" {
		return localexecution.ImageArtifact{}, fmt.Errorf("generated image artifact format %q is not PNG", format)
	}
	if decoded.Width != width || decoded.Height != height {
		return localexecution.ImageArtifact{}, fmt.Errorf(
			"generated image dimensions %dx%d do not match captured plan %dx%d",
			decoded.Width, decoded.Height, width, height,
		)
	}
	return localexecution.ImageArtifact{Index: index, Bytes: payload, ComputeMS: computeMS}, nil
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

func imageLoadRequest(address string, plan *capabilitydriver.ImageInvocationPlan) (managedimagebackend.LoadModelRequest, error) {
	if plan == nil {
		return managedimagebackend.LoadModelRequest{}, fmt.Errorf("image invocation plan is required")
	}
	components := []managedimagebackend.ComponentBinding{
		{
			OccurrenceID:  capabilitydriver.StableDiffusionTextEncoderRequirementID,
			Role:          "text_encoder",
			ComponentKind: "chat",
			EngineSlot:    "llm_path",
			Path:          plan.TextEncoderPath(),
			Required:      true,
		},
		{
			OccurrenceID:  capabilitydriver.StableDiffusionVAERequirementID,
			Role:          "vae",
			ComponentKind: "vae",
			EngineSlot:    "vae_path",
			Path:          plan.VAEPath(),
			Required:      true,
		},
	}
	if path := strings.TrimSpace(plan.UncondDiffusionPath()); path != "" {
		components = append(components, managedimagebackend.ComponentBinding{
			OccurrenceID:  capabilitydriver.StableDiffusionUncondDiffusionRequirementID,
			Role:          "uncond_diffusion_model",
			ComponentKind: "image",
			EngineSlot:    "uncond_diffusion_model",
			Path:          path,
			Required:      true,
		})
	}
	return managedimagebackend.LoadModelRequest{
		BackendAddress: address,
		ModelsRoot:     imageInvocationModelsRoot(plan.MainModelPath()),
		ModelPath:      plan.MainModelPath(),
		Options:        imageInvocationLoadOptions(plan),
		Components:     components,
		CFGScale:       float32(plan.CFGScale()),
		Threads:        int32(plan.Threads()),
	}, nil
}

func imageInvocationLoadOptions(plan *capabilitydriver.ImageInvocationPlan) []string {
	options := []string{
		"diffusion_model",
		"llm_path:" + plan.TextEncoderPath(),
		"vae_path:" + plan.VAEPath(),
		"diffusion_fa:" + strconv.FormatBool(plan.DiffusionFlashAttention()),
		"offload_params_to_cpu:" + strconv.FormatBool(plan.OffloadParamsToCPU()),
	}
	if path := strings.TrimSpace(plan.UncondDiffusionPath()); path != "" {
		options = append(options, "uncond_diffusion_model:"+path)
	}
	if sampler := strings.TrimSpace(plan.Sampler()); sampler != "" {
		options = append(options, "sampler:"+sampler)
	}
	if scheduler := strings.TrimSpace(plan.Scheduler()); scheduler != "" {
		options = append(options, "scheduler:"+scheduler)
	}
	return options
}

func imageInvocationPrompt(plan *capabilitydriver.ImageInvocationPlan) string {
	if plan == nil {
		return ""
	}
	return plan.Prompt()
}

func imageInvocationEnableParameters(plan *capabilitydriver.ImageInvocationPlan) string {
	if plan == nil || strings.TrimSpace(plan.Mask()) == "" {
		return ""
	}
	return "mask:" + plan.Mask()
}

func imageInvocationModelsRoot(mainModelPath string) string {
	volume := filepath.VolumeName(mainModelPath)
	return volume + string(filepath.Separator)
}

func validateImageSubstrateInputPath(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return fmt.Errorf("image substrate input must be an absolute materialized path")
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("image substrate input is unavailable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("image substrate input is not a regular file")
	}
	return nil
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
