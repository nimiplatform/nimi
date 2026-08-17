package managedimagebackend

import (
	"context"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/dynamicpb"
)

type ServerConfig struct {
	ListenAddress     string
	Driver            string
	BackendExecutable string
	WorkingDir        string
	CUDARuntimeDir    string
}

type backendDriver interface {
	LoadModel(loadModelState) (*LoadModelDiagnostics, error)
	GenerateImage(context.Context, loadModelState, imageGenerateState, func(imageGenerateProgress) error) (*ImageGenerateDiagnostics, error)
	Free(loadModelState) error
}

type backendShutdownDriver interface {
	Shutdown() error
}

type loadModelState struct {
	ModelsRoot string
	ModelPath  string
	Options    managedImageOptions
	CFGScale   float32
	Threads    int32
}

type imageGenerateState struct {
	Mode           ImageRequestMode
	Width          int32
	Height         int32
	Step           int32
	Seed           int32
	PositivePrompt string
	NegativePrompt string
	Dst            string
	Src            string
	Mask           string
	ReferenceImage []byte
	CFGScale       float32
	Sampler        string
	Scheduler      string
}

type imageGenerateProgress struct {
	CurrentStep     int32
	TotalSteps      int32
	ProgressPercent int32
}

type managedImageOptions struct {
	Components         []managedImageComponent
	DiffusionFA        *bool
	OffloadParamsToCPU *bool
	FlowShift          float32
	QwenImageZeroCondT bool
}

type managedImageComponent struct {
	OccurrenceID  string `json:"occurrence_id,omitempty"`
	Order         int32  `json:"order,omitempty"`
	Role          string `json:"role,omitempty"`
	ComponentKind string `json:"component_kind,omitempty"`
	EngineSlot    string `json:"engine_slot"`
	Path          string `json:"path"`
	Required      bool   `json:"required,omitempty"`
}

func (options managedImageOptions) ComponentsBySlot() map[string]string {
	components := make(map[string]string, len(options.Components))
	for _, component := range options.Components {
		slot := strings.TrimSpace(component.EngineSlot)
		path := strings.TrimSpace(component.Path)
		if slot == "" || path == "" {
			continue
		}
		components[slot] = path
	}
	return components
}

type Server struct {
	driver       backendDriver
	videoEngine  videoEngine
	videoPackage videoPackageIdentity

	mu     sync.RWMutex
	loaded *loadModelState

	videoGenerateMu sync.Mutex
	videoStateMu    sync.Mutex
	videoLoaded     bool
	activeVideoDone chan struct{}
}

func RunServer(ctx context.Context, cfg ServerConfig) error {
	driver, err := newBackendDriver(cfg)
	if err != nil {
		return err
	}
	video, videoErr := newStableDiffusionVideoEngine(cfg.BackendExecutable)
	if videoErr != nil {
		_ = shutdownBackendDriver(driver)
		return videoErr
	}
	server := &Server{
		driver:       driver,
		videoEngine:  video,
		videoPackage: resolveVideoPackageIdentity(cfg.BackendExecutable),
	}
	return server.Serve(ctx, strings.TrimSpace(cfg.ListenAddress))
}

func (s *Server) Serve(ctx context.Context, listenAddress string) (returnErr error) {
	if s == nil || s.driver == nil {
		return fmt.Errorf("managed image backend driver is required")
	}
	defer func() {
		if err := shutdownVideoEngine(s.videoEngine); err != nil && returnErr == nil {
			returnErr = fmt.Errorf("shutdown managed video engine: %w", err)
		}
		if err := shutdownBackendDriver(s.driver); err != nil && returnErr == nil {
			returnErr = fmt.Errorf("shutdown managed image backend driver: %w", err)
		}
	}()
	if strings.TrimSpace(listenAddress) == "" {
		return fmt.Errorf("managed image backend listen address is required")
	}
	if err := ensureDescriptors(); err != nil {
		return err
	}
	if err := ensureVideoDescriptors(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", strings.TrimSpace(listenAddress))
	if err != nil {
		return fmt.Errorf("listen managed image backend: %w", err)
	}
	defer func() { _ = listener.Close() }()

	grpcServer := grpc.NewServer(
		grpc.MaxRecvMsgSize(managedVideoMaxMessageBytes),
		grpc.MaxSendMsgSize(managedVideoMaxMessageBytes),
		grpc.UnknownServiceHandler(s.handleUnknownMethod),
	)
	defer grpcServer.GracefulStop()

	serveErrCh := make(chan error, 1)
	go func() {
		serveErrCh <- grpcServer.Serve(listener)
	}()

	select {
	case <-ctx.Done():
		// Cooperative video cancellation must precede GracefulStop; otherwise
		// an active FFI call would keep its stream handler alive indefinitely.
		if s.videoEngine != nil {
			_ = s.videoEngine.Cancel()
		}
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

func shutdownBackendDriver(driver backendDriver) error {
	shutdownDriver, ok := driver.(backendShutdownDriver)
	if !ok {
		return nil
	}
	return shutdownDriver.Shutdown()
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
	case backendLoadVideoModelMethod:
		return s.handleLoadVideoModel(stream)
	case backendGenerateVideoMethod:
		return s.handleGenerateVideo(stream)
	case backendCancelVideoMethod:
		return s.handleCancelVideo(stream)
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
		return stream.SendMsg(resultMessage(false, err.Error(), nil))
	}
	log.Printf("managed image backend load request model_path=%s components=%d threads=%d diffusion_fa=%t offload_to_cpu=%t",
		strings.TrimSpace(state.ModelPath),
		len(state.Options.ComponentsBySlot()),
		state.Threads,
		state.Options.DiffusionFA != nil && *state.Options.DiffusionFA,
		state.Options.OffloadParamsToCPU != nil && *state.Options.OffloadParamsToCPU,
	)
	diag, err := s.driver.LoadModel(state)
	if err != nil {
		log.Printf("managed image backend load request failed model_path=%s error=%v",
			strings.TrimSpace(state.ModelPath),
			err,
		)
		return stream.SendMsg(resultMessage(false, err.Error(), nil))
	}
	s.mu.Lock()
	s.loaded = &state
	s.mu.Unlock()
	log.Printf("managed image backend load request completed model_path=%s", strings.TrimSpace(state.ModelPath))
	return stream.SendMsg(resultMessage(true, "loaded", diag))
}

func (s *Server) handleGenerateImage(stream grpc.ServerStream) error {
	req := dynamicpb.NewMessage(generateImageMessageDescriptor)
	if err := stream.RecvMsg(req); err != nil {
		return err
	}
	imageReq, err := decodeGenerateImageState(req)
	if err != nil {
		return stream.SendMsg(generateImageTerminalEvent(false, err.Error(), nil))
	}
	s.mu.RLock()
	loaded := s.loaded
	s.mu.RUnlock()
	if loaded == nil {
		return stream.SendMsg(generateImageTerminalEvent(false, "managed image model is not loaded", nil))
	}
	diag, err := s.driver.GenerateImage(stream.Context(), *loaded, imageReq, func(progress imageGenerateProgress) error {
		return stream.SendMsg(generateImageProgressEvent(progress))
	})
	if err != nil {
		return stream.SendMsg(generateImageTerminalEvent(false, err.Error(), diag))
	}
	return stream.SendMsg(generateImageTerminalEvent(true, "generated", diag))
}

func (s *Server) handleFree(stream grpc.ServerStream) error {
	req := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	if err := stream.RecvMsg(req); err != nil {
		return err
	}
	state, err := decodeLoadModelState(req)
	if err != nil {
		return stream.SendMsg(resultMessage(false, err.Error(), nil))
	}
	if err := s.driver.Free(state); err != nil {
		return stream.SendMsg(resultMessage(false, err.Error(), nil))
	}
	s.mu.Lock()
	s.loaded = nil
	s.mu.Unlock()
	return stream.SendMsg(resultMessage(true, "freed", nil))
}
