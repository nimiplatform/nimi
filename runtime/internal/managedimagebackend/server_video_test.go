package managedimagebackend

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"
	"unsafe"

	"google.golang.org/grpc"
)

type fakeVideoEngine struct {
	mu          sync.Mutex
	loads       int
	generates   int
	cancels     int
	candidate   VideoCandidate
	generateErr error
	started     chan struct{}
	release     chan struct{}
	startOnce   sync.Once
	cancelOnce  sync.Once
}

func (f *fakeVideoEngine) Load(VideoModelRequest) (bool, error) {
	f.mu.Lock()
	f.loads++
	f.mu.Unlock()
	return false, nil
}

func (f *fakeVideoEngine) Generate(_ VideoGenerateRequest, progress func(VideoGenerateProgress)) (VideoCandidate, error) {
	f.mu.Lock()
	f.generates++
	f.mu.Unlock()
	if progress != nil {
		progress(VideoGenerateProgress{CurrentStep: 2, TotalSteps: 8})
	}
	if f.started != nil {
		f.startOnce.Do(func() { close(f.started) })
	}
	if f.release != nil {
		<-f.release
	}
	return f.candidate, f.generateErr
}

func (f *fakeVideoEngine) Cancel() error {
	f.mu.Lock()
	f.cancels++
	f.mu.Unlock()
	if f.release != nil {
		f.cancelOnce.Do(func() { close(f.release) })
	}
	return nil
}

func (f *fakeVideoEngine) Free() error { return nil }

func TestManagedVideoClientRejectsProtocolVersionMismatch(t *testing.T) {
	if err := ensureVideoDescriptors(); err != nil {
		t.Fatal(err)
	}
	response := videoOperationResult(true, "loaded", "", false, "test")
	setUint32Field(response, "protocol_version", VideoProtocolVersion+1)
	if _, err := readVideoLoadResult(response); VideoErrorKindOf(err) != VideoErrorProtocolMismatch {
		t.Fatalf("protocol mismatch error = %v", err)
	}
}

func TestManagedVideoProtocolRoundTripAndCompatibilityGate(t *testing.T) {
	engine := &fakeVideoEngine{}
	server := &Server{driver: &fakeBackendDriver{}, videoEngine: engine, videoPackage: videoPackageIdentity{Name: "old-package"}}
	address, stop := startVideoTestServer(t, server)
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := LoadVideoModel(ctx, validVideoModelRequest(address))
	if VideoErrorKindOf(err) != VideoErrorEngineIncompatible {
		t.Fatalf("compatibility gate error = %v", err)
	}
	engine.mu.Lock()
	loads := engine.loads
	engine.mu.Unlock()
	if loads != 0 {
		t.Fatalf("incompatible package reached FFI load %d times", loads)
	}
}

func TestManagedVideoDiagnosticOverrideAllowsUnpinnedPackage(t *testing.T) {
	t.Setenv(videoFFIAllowUnpinnedEnv, "1")
	engine := &fakeVideoEngine{}
	server := &Server{driver: &fakeBackendDriver{}, videoEngine: engine, videoPackage: videoPackageIdentity{Name: "old-package"}}
	address, stop := startVideoTestServer(t, server)
	defer stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := LoadVideoModel(ctx, validVideoModelRequest(address)); err != nil {
		t.Fatalf("diagnostic override load: %v", err)
	}
}

func TestManagedVideoRejectsBadFrameAndAudioPostconditions(t *testing.T) {
	for _, tc := range []struct {
		name      string
		candidate VideoCandidate
	}{
		{name: "bad frame shape", candidate: candidateForVideoTest(32, 32, 5, false)},
		{name: "empty audio", candidate: func() VideoCandidate {
			value := candidateForVideoTest(32, 32, 5, true)
			value.Audio.PCMSamples = nil
			return value
		}()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine := &fakeVideoEngine{candidate: tc.candidate}
			server := &Server{driver: &fakeBackendDriver{}, videoEngine: engine, videoPackage: h3VideoPackageIdentity()}
			address, stop := startVideoTestServer(t, server)
			defer stop()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if _, err := LoadVideoModel(ctx, validVideoModelRequest(address)); err != nil {
				t.Fatalf("LoadVideoModel: %v", err)
			}
			_, err := GenerateVideo(ctx, validVideoGenerateRequest(address))
			if VideoErrorKindOf(err) != VideoErrorPostcondition {
				t.Fatalf("postcondition error = %v", err)
			}
		})
	}
}

func TestManagedVideoCancelReachesEngineAndWaitsForGenerateExit(t *testing.T) {
	engine := &fakeVideoEngine{
		started:     make(chan struct{}),
		release:     make(chan struct{}),
		generateErr: videoError(VideoErrorCanceled, errors.New("canceled by test")),
	}
	server := &Server{driver: &fakeBackendDriver{}, videoEngine: engine, videoPackage: h3VideoPackageIdentity()}
	address, stop := startVideoTestServer(t, server)
	defer stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := LoadVideoModel(ctx, validVideoModelRequest(address)); err != nil {
		t.Fatalf("LoadVideoModel: %v", err)
	}
	generateDone := make(chan error, 1)
	go func() {
		_, err := GenerateVideo(ctx, validVideoGenerateRequest(address))
		generateDone <- err
	}()
	select {
	case <-engine.started:
	case <-time.After(2 * time.Second):
		t.Fatal("video generation did not start")
	}
	if err := CancelVideo(ctx, address); err != nil {
		t.Fatalf("CancelVideo: %v", err)
	}
	engine.mu.Lock()
	cancels := engine.cancels
	engine.mu.Unlock()
	if cancels == 0 {
		t.Fatal("sd_cancel_generation seam was not called")
	}
	select {
	case err := <-generateDone:
		if VideoErrorKindOf(err) != VideoErrorCanceled {
			t.Fatalf("generate cancellation error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("GenerateVideo remained active after CancelVideo returned")
	}
}

func TestStableDiffusionVideoFFILayoutMatchesFloorHeader(t *testing.T) {
	if got := unsafe.Sizeof(sdCtxParams{}); got != 280 {
		t.Fatalf("sizeof(sd_ctx_params_t) = %d", got)
	}
	if got := unsafe.Sizeof(sdVideoGenParams{}); got != 576 {
		t.Fatalf("sizeof(sd_vid_gen_params_t) = %d", got)
	}
	if got := unsafe.Sizeof(sdImage{}); got != 24 {
		t.Fatalf("sizeof(sd_image_t) = %d", got)
	}
	if got := unsafe.Sizeof(sdAudio{}); got != 24 {
		t.Fatalf("sizeof(sd_audio_t) = %d", got)
	}
	ctx := sdCtxParams{}
	for name, got := range map[string]uintptr{
		"llm_path": unsafe.Offsetof(ctx.LLMPath), "diffusion_model_path": unsafe.Offsetof(ctx.DiffusionModelPath),
		"vae_path": unsafe.Offsetof(ctx.VAEPath), "audio_vae_path": unsafe.Offsetof(ctx.AudioVAEPath),
		"rng_type": unsafe.Offsetof(ctx.RNGType), "diffusion_flash_attn": unsafe.Offsetof(ctx.DiffusionFlashAttention),
		"params_backend": unsafe.Offsetof(ctx.ParamsBackend),
	} {
		want := map[string]uintptr{"llm_path": 40, "diffusion_model_path": 56, "vae_path": 88, "audio_vae_path": 96, "rng_type": 184, "diffusion_flash_attn": 202, "params_backend": 240}[name]
		if got != want {
			t.Fatalf("offsetof(sd_ctx_params_t.%s) = %d, want %d", name, got, want)
		}
	}
	video := sdVideoGenParams{}
	for name, got := range map[string]uintptr{
		"prompt": unsafe.Offsetof(video.Prompt), "init_image": unsafe.Offsetof(video.InitImage), "ref_images": unsafe.Offsetof(video.RefImages),
		"width": unsafe.Offsetof(video.Width), "sample_params": unsafe.Offsetof(video.SampleParams), "seed": unsafe.Offsetof(video.Seed),
		"video_frames": unsafe.Offsetof(video.VideoFrames), "vae_tiling_params": unsafe.Offsetof(video.VAETilingParams),
		"cache": unsafe.Offsetof(video.Cache), "hires": unsafe.Offsetof(video.Hires), "circular_x": unsafe.Offsetof(video.CircularX),
	} {
		want := map[string]uintptr{"prompt": 16, "init_image": 40, "ref_images": 88, "width": 148, "sample_params": 160, "seed": 360, "video_frames": 368, "vae_tiling_params": 384, "cache": 416, "hires": 512, "circular_x": 568}[name]
		if got != want {
			t.Fatalf("offsetof(sd_vid_gen_params_t.%s) = %d, want %d", name, got, want)
		}
	}
}

func startVideoTestServer(t *testing.T, server *Server) (string, func()) {
	t.Helper()
	if err := ensureVideoDescriptors(); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcServer := grpc.NewServer(grpc.MaxRecvMsgSize(managedVideoMaxMessageBytes), grpc.MaxSendMsgSize(managedVideoMaxMessageBytes), grpc.UnknownServiceHandler(server.handleUnknownMethod))
	go func() { _ = grpcServer.Serve(listener) }()
	return listener.Addr().String(), func() {
		grpcServer.Stop()
		_ = listener.Close()
	}
}

func h3VideoPackageIdentity() videoPackageIdentity {
	return videoPackageIdentity{Name: "floor-c6beeef", SupportedModelFamilies: []string{"minimax-h3"}}
}

func validVideoModelRequest(address string) VideoModelRequest {
	return VideoModelRequest{
		BackendAddress: address, ProcessKey: "process-key", FL2VADiffusionPath: `D:\models\fl2va.gguf`, Ref2VADiffusionPath: `D:\models\ref2va.gguf`,
		EncoderPath: `D:\models\encoder.gguf`, VideoVAEPath: `D:\models\video.safetensors`, AudioVAEPath: `D:\models\audio.safetensors`, ConditioningMode: "fl2va-t2va",
		CFGScale: 1, FlowShift: 12, DiffusionFlashAttention: true, OffloadToCPU: true, RNG: "cpu",
	}
}

func validVideoGenerateRequest(address string) VideoGenerateRequest {
	return VideoGenerateRequest{BackendAddress: address, Width: 32, Height: 32, FrameCount: 5, FPS: 24, Seed: 7, Prompt: "cat"}
}

func candidateForVideoTest(width, height, frames int, validShape bool) VideoCandidate {
	candidate := VideoCandidate{FrameCount: frames, FPS: 24, Audio: VideoAudio{PCMSamples: []float32{0.1, -0.1}, Channels: 2, SampleRate: 32000}}
	byteCount := width * height * 3
	if !validShape {
		byteCount--
	}
	for index := 0; index < frames; index++ {
		candidate.Frames = append(candidate.Frames, VideoFrame{RGBBytes: make([]byte, byteCount), Width: width, Height: height})
	}
	return candidate
}
