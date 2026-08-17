package engine

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

const engineVideoExecutionHost EngineKind = "video-execution-host"

type managerVideoInvocationSubstrate struct {
	manager *Manager
	logger  *slog.Logger
	config  VideoExecutionHostConfig

	mu         sync.RWMutex
	currentKey string
	address    string
}

func newManagerVideoInvocationSubstrate(manager *Manager, logger *slog.Logger, config VideoExecutionHostConfig) *managerVideoInvocationSubstrate {
	if logger == nil {
		logger = slog.Default()
	}
	config.Environment = cloneStringMap(config.Environment)
	return &managerVideoInvocationSubstrate{manager: manager, logger: logger, config: config}
}

func (s *managerVideoInvocationSubstrate) Ensure(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan, validateContent func() error, progress localexecution.VideoProgressFunc) (bool, error) {
	if s == nil || s.manager == nil {
		return false, fmt.Errorf("video execution manager is unavailable")
	}
	key := strings.TrimSpace(plan.ProcessKey())
	if key == "" {
		return false, fmt.Errorf("video invocation process key is required")
	}
	s.mu.RLock()
	currentKey := s.currentKey
	s.mu.RUnlock()
	if currentKey == key && s.Healthy() {
		if validateContent != nil {
			if err := validateContent(); err != nil {
				return false, err
			}
		}
		if progress != nil {
			progress(localexecution.VideoExecutionProgress{Stage: localexecution.VideoExecutionStageReused, FrameCount: int32(plan.FrameCount())})
		}
		return true, nil
	}
	if err := s.stopProcess(); err != nil {
		return false, fmt.Errorf("stop prior video substrate: %w", err)
	}
	if progress != nil {
		progress(localexecution.VideoExecutionProgress{Stage: localexecution.VideoExecutionStageLoading, FrameCount: int32(plan.FrameCount())})
	}
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
	if err := s.manager.StartEngine(context.Background(), engineConfig); err != nil {
		return false, fmt.Errorf("start video substrate: %w", err)
	}
	if err := ctx.Err(); err != nil {
		_ = s.stopProcess()
		return false, err
	}
	if !s.Healthy() {
		_ = s.stopProcess()
		return false, fmt.Errorf("video substrate did not become healthy")
	}
	loadRequest := videoLoadRequest(address, plan)
	diagnostics, err := managedimagebackend.LoadVideoModel(ctx, loadRequest)
	if err != nil {
		healthy := s.Healthy()
		_ = s.stopProcess()
		if !healthy && ctx.Err() == nil {
			return false, executionFailure(localexecution.FailureProcessCrash, fmt.Errorf("video substrate exited while loading model: %w", err))
		}
		return false, fmt.Errorf("load video model: %w", err)
	}
	s.mu.Lock()
	s.currentKey = key
	s.address = address
	s.mu.Unlock()
	if progress != nil {
		stage := localexecution.VideoExecutionStageReady
		if diagnostics != nil && diagnostics.Reused {
			stage = localexecution.VideoExecutionStageReused
		}
		progress(localexecution.VideoExecutionProgress{Stage: stage, FrameCount: int32(plan.FrameCount())})
	}
	return diagnostics != nil && diagnostics.Reused, nil
}

func (s *managerVideoInvocationSubstrate) GenerateVideo(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan, progress localexecution.VideoProgressFunc) (localexecution.RawAVCandidate, error) {
	if s == nil || !s.Healthy() {
		return localexecution.RawAVCandidate{}, fmt.Errorf("video substrate is unavailable")
	}
	s.mu.RLock()
	address := s.address
	currentKey := s.currentKey
	s.mu.RUnlock()
	if address == "" || currentKey != plan.ProcessKey() {
		return localexecution.RawAVCandidate{}, fmt.Errorf("video substrate does not hold the captured plan")
	}
	reference, hasReference := plan.ReferenceImage()
	request := managedimagebackend.VideoGenerateRequest{
		BackendAddress: address,
		Prompt:         plan.Prompt(),
		NegativePrompt: plan.NegativePrompt(),
		Width:          planWidth(plan),
		Height:         planHeight(plan),
		FrameCount:     plan.FrameCount(),
		FPS:            plan.FPS(),
		Seed:           plan.Seed(),
		OnProgress: func(value managedimagebackend.VideoGenerateProgress) {
			if progress != nil {
				progress(localexecution.VideoExecutionProgress{Stage: localexecution.VideoExecutionStageGenerating, FrameCount: int32(plan.FrameCount()), CurrentStep: value.CurrentStep, TotalSteps: value.TotalSteps})
			}
		},
	}
	if hasReference {
		request.ReferenceImage = append([]byte(nil), reference.ImageBytes...)
	}
	candidate, err := managedimagebackend.GenerateVideo(ctx, request)
	if err != nil {
		return localexecution.RawAVCandidate{}, err
	}
	return rawAVCandidateFromBackend(candidate), nil
}

func (s *managerVideoInvocationSubstrate) Cancel(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	address := s.address
	s.mu.RUnlock()
	if strings.TrimSpace(address) == "" {
		return nil
	}
	return managedimagebackend.CancelVideo(ctx, address)
}

func (s *managerVideoInvocationSubstrate) Healthy() bool {
	if s == nil || s.manager == nil {
		return false
	}
	info, err := s.manager.EngineStatus(engineVideoExecutionHost)
	return err == nil && info.Status == StatusHealthy && info.PID > 0 && supervisorProcessAlive(info.PID)
}

func (s *managerVideoInvocationSubstrate) Stop() error {
	return s.stopProcess()
}

func (s *managerVideoInvocationSubstrate) stopProcess() error {
	if s == nil || s.manager == nil {
		return nil
	}
	s.mu.Lock()
	s.currentKey = ""
	s.address = ""
	s.mu.Unlock()
	if _, err := s.manager.EngineStatus(engineVideoExecutionHost); err != nil {
		return nil
	}
	return s.manager.StopEngine(engineVideoExecutionHost)
}

func (s *managerVideoInvocationSubstrate) resolveEngineConfig(address string) (EngineConfig, error) {
	if directory := strings.TrimSpace(s.config.BackendDirectory); directory != "" {
		return videoExecutionEngineConfigFromDirectory(directory, address, s.config)
	}
	config, err := s.manager.resolveInstalledImageExecutionEngineConfig(address, ImageExecutionHostConfig{
		PackageSource:   s.config.PackageSource,
		Environment:     s.config.Environment,
		StartupTimeout:  s.config.StartupTimeout,
		ShutdownTimeout: s.config.ShutdownTimeout,
	})
	if err != nil {
		return EngineConfig{}, err
	}
	if isDirectGOSDExecutable(config.BinaryPath) || len(config.CommandArgs) < 2 || config.CommandArgs[0] != "managed-image-backend" || config.CommandArgs[1] != "serve" {
		return EngineConfig{}, fmt.Errorf("installed package does not expose the managed video wrapper")
	}
	config.Kind = engineVideoExecutionHost
	config.MaxRestarts = 1
	return config, nil
}

func videoExecutionEngineConfigFromDirectory(directory, address string, config VideoExecutionHostConfig) (EngineConfig, error) {
	canonical, err := filepath.Abs(filepath.Clean(strings.TrimSpace(directory)))
	if err != nil || !filepath.IsAbs(canonical) {
		return EngineConfig{}, fmt.Errorf("video backend directory must be absolute")
	}
	if info, statErr := os.Stat(canonical); statErr != nil || !info.IsDir() {
		return EngineConfig{}, fmt.Errorf("video backend directory is unavailable")
	}
	backendExecutable := ""
	for _, candidate := range []string{"sd.exe", "sd-cli.exe", "sd", "sd-cli"} {
		path := filepath.Join(canonical, candidate)
		if info, statErr := os.Stat(path); statErr == nil && info.Mode().IsRegular() {
			backendExecutable = path
			break
		}
	}
	if backendExecutable == "" {
		return EngineConfig{}, fmt.Errorf("video backend executable is unavailable")
	}
	host, portText, err := net.SplitHostPort(strings.TrimSpace(address))
	if err != nil || host != "127.0.0.1" {
		return EngineConfig{}, fmt.Errorf("video substrate address must be explicit IPv4 loopback")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 {
		return EngineConfig{}, fmt.Errorf("video substrate address has invalid port")
	}
	runtimeExecutable := strings.TrimSpace(config.ExecutablePath)
	if runtimeExecutable == "" {
		runtimeExecutable, err = managedImageBackendCurrentExecutable()
		if err != nil {
			return EngineConfig{}, fmt.Errorf("resolve runtime executable: %w", err)
		}
	} else {
		if !filepath.IsAbs(runtimeExecutable) {
			return EngineConfig{}, fmt.Errorf("video wrapper executable must be absolute")
		}
		runtimeExecutable = filepath.Clean(runtimeExecutable)
		if info, statErr := os.Stat(runtimeExecutable); statErr != nil || !info.Mode().IsRegular() {
			return EngineConfig{}, fmt.Errorf("video wrapper executable is unavailable")
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
		Kind: engineVideoExecutionHost, Port: port, Address: address, HealthMode: HealthModeTCP,
		BinaryPath:  runtimeExecutable,
		CommandArgs: []string{"managed-image-backend", "serve", "--listen", address, "--driver", "stable-diffusion.cpp", "--backend-executable", backendExecutable, "--working-dir", canonical},
		CommandEnv:  cloneStringMap(config.Environment), WorkingDir: canonical,
		StartupTimeout: startupTimeout, HealthInterval: 15 * time.Second, ShutdownTimeout: shutdownTimeout,
		RestartBaseDelay: time.Second, MaxRestarts: 1,
	}, nil
}

func videoLoadRequest(address string, plan *capabilitydriver.VideoInvocationPlan) managedimagebackend.VideoModelRequest {
	bindings := make(map[string]string, len(plan.ExactBindings()))
	for _, binding := range plan.ExactBindings() {
		bindings[binding.RequirementID] = binding.AbsolutePath
	}
	return managedimagebackend.VideoModelRequest{
		BackendAddress: address, ProcessKey: plan.ProcessKey(),
		FL2VADiffusionPath: bindings[capabilitydriver.StableDiffusionVideoFL2VARequirementID], Ref2VADiffusionPath: bindings[capabilitydriver.StableDiffusionVideoRef2VARequirementID],
		EncoderPath: plan.EncoderPath(), VideoVAEPath: plan.VideoVAEPath(), AudioVAEPath: plan.AudioVAEPath(), ConditioningMode: string(plan.ConditioningMode()),
		CFGScale: plan.CFGScale(), FlowShift: plan.FlowShift(), SampleMethod: plan.SampleMethod(), Scheduler: plan.Scheduler(),
		DiffusionFlashAttention: plan.DiffusionFlashAttention(), OffloadToCPU: plan.OffloadToCPU(), RNG: plan.RNG(),
	}
}

func rawAVCandidateFromBackend(input managedimagebackend.VideoCandidate) localexecution.RawAVCandidate {
	output := localexecution.RawAVCandidate{FrameCount: input.FrameCount, FPS: input.FPS, ComputeMS: input.ComputeMS}
	output.Frames = make([]localexecution.RawVideoFrame, 0, len(input.Frames))
	for _, frame := range input.Frames {
		output.Frames = append(output.Frames, localexecution.RawVideoFrame{RGBBytes: append([]byte(nil), frame.RGBBytes...), Width: frame.Width, Height: frame.Height})
	}
	output.Audio = localexecution.RawAudio{PCMSamples: append([]float32(nil), input.Audio.PCMSamples...), Channels: input.Audio.Channels, SampleRate: input.Audio.SampleRate}
	return output
}

func planWidth(plan *capabilitydriver.VideoInvocationPlan) int { width, _ := plan.Size(); return width }
func planHeight(plan *capabilitydriver.VideoInvocationPlan) int {
	_, height := plan.Size()
	return height
}
