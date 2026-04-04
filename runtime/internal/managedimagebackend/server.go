package managedimagebackend

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

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
	VAEPath            string
	LLMPath            string
	ClipLPath          string
	T5XXLPath          string
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
	if err := s.driver.LoadModel(state); err != nil {
		return stream.SendMsg(resultMessage(false, err.Error()))
	}
	s.mu.Lock()
	s.loaded = &state
	s.mu.Unlock()
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
	executablePath string
	workingDir     string
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
	return &stableDiffusionCPPDriver{
		executablePath: trimmedExecutable,
		workingDir:     resolvedWorkingDir,
	}, nil
}

func (d *stableDiffusionCPPDriver) LoadModel(state loadModelState) error {
	if d == nil {
		return fmt.Errorf("managed image backend driver unavailable")
	}
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

func (d *stableDiffusionCPPDriver) GenerateImage(ctx context.Context, loaded loadModelState, req imageGenerateState) error {
	if d == nil {
		return fmt.Errorf("managed image backend driver unavailable")
	}
	if len(req.RefImages) > 0 {
		return fmt.Errorf("stable-diffusion.cpp runtime wrapper does not support ref_images")
	}
	if strings.TrimSpace(req.EnableParams) != "" {
		return fmt.Errorf("stable-diffusion.cpp runtime wrapper does not support enable parameters")
	}
	if strings.TrimSpace(req.Dst) == "" {
		return fmt.Errorf("managed image destination is required")
	}
	if err := os.MkdirAll(filepath.Dir(strings.TrimSpace(req.Dst)), 0o755); err != nil {
		return fmt.Errorf("create managed image destination: %w", err)
	}

	args := []string{
		"--diffusion-model", loaded.ModelPath,
		"-p", req.PositivePrompt,
		"-o", req.Dst,
	}
	if strings.TrimSpace(req.NegativePrompt) != "" {
		args = append(args, "-n", strings.TrimSpace(req.NegativePrompt))
	}
	if req.Width > 0 {
		args = append(args, "-W", strconv.Itoa(int(req.Width)))
	}
	if req.Height > 0 {
		args = append(args, "-H", strconv.Itoa(int(req.Height)))
	}
	if req.Step > 0 {
		args = append(args, "--steps", strconv.Itoa(int(req.Step)))
	}
	if req.Seed != 0 {
		args = append(args, "-s", strconv.Itoa(int(req.Seed)))
	}
	if loaded.CFGScale > 0 {
		args = append(args, "--cfg-scale", strconv.FormatFloat(float64(loaded.CFGScale), 'f', -1, 32))
	}
	if strings.TrimSpace(loaded.Options.Sampler) != "" {
		args = append(args, "--sampling-method", strings.TrimSpace(loaded.Options.Sampler))
	}
	if strings.TrimSpace(loaded.Options.VAEPath) != "" {
		args = append(args, "--vae", strings.TrimSpace(loaded.Options.VAEPath))
	}
	if strings.TrimSpace(loaded.Options.LLMPath) != "" {
		args = append(args, "--llm", strings.TrimSpace(loaded.Options.LLMPath))
	}
	if strings.TrimSpace(loaded.Options.ClipLPath) != "" {
		args = append(args, "--clip_l", strings.TrimSpace(loaded.Options.ClipLPath))
	}
	if strings.TrimSpace(loaded.Options.T5XXLPath) != "" {
		args = append(args, "--t5xxl", strings.TrimSpace(loaded.Options.T5XXLPath))
	}
	if strings.TrimSpace(req.Src) != "" {
		args = append(args, "-i", strings.TrimSpace(req.Src))
	}

	command := exec.CommandContext(ctx, d.executablePath, args...)
	command.Dir = d.workingDir
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			return fmt.Errorf("stable-diffusion.cpp generate failed: %w", err)
		}
		return fmt.Errorf("stable-diffusion.cpp generate failed: %s", message)
	}
	info, statErr := os.Stat(strings.TrimSpace(req.Dst))
	if statErr != nil {
		return fmt.Errorf("managed image destination unavailable: %w", statErr)
	}
	if info.Size() <= 0 {
		return fmt.Errorf("managed image destination is empty")
	}
	return nil
}

func (d *stableDiffusionCPPDriver) Free(_ loadModelState) error {
	return nil
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
		case "sampler":
			if !hasValue || strings.TrimSpace(value) == "" {
				return managedImageOptions{}, fmt.Errorf("managed image option sampler requires a value")
			}
			parsed.Sampler = strings.TrimSpace(value)
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
