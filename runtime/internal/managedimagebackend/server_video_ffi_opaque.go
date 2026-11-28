//go:build (windows && amd64) || (darwin && arm64 && cgo)

package managedimagebackend

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
)

// The 1147 C API owns options, contexts, tensors and results.
type sdTensorAudio struct {
	SampleRate uint32
	Data       uintptr
}

type sdGenerationProgress struct {
	Stage, Detail, Unit *byte
	SamplePass          int32
	Completed, Total    int64
}

type sdVideoAPI struct {
	lastError   func() string
	contextOpts func() uintptr
	videoOpts   func() uintptr
	freeOpts    func(uintptr)
	setString   func(uintptr, string, string) int32
	setBool     func(uintptr, string, bool) int32
	setInt      func(uintptr, string, int64) int32
	setFloat    func(uintptr, string, float64) int32
	setFloats   func(uintptr, string, *float32, uintptr) int32
	setTensor   func(uintptr, string, uintptr) int32
	setTensors  func(uintptr, string, *uintptr, uintptr) int32
	createCtx   func(uintptr, *uintptr) int32
	freeCtx     func(uintptr)
	supports    func(uintptr) bool
	generate    func(uintptr, uintptr, *uintptr) int32
	setProgress func(uintptr, uintptr, uintptr)
	cancel      func(uintptr, int32)
	resultKind  func(uintptr) int32
	imageCount  func(uintptr) uintptr
	imageAt     func(uintptr, uintptr) uintptr
	resultAudio func(uintptr) *sdTensorAudio
	resultFPS   func(uintptr) int32
	freeResult  func(uintptr)
	newTensor   func(int32, uintptr, *int64, *byte, uintptr) uintptr
	freeTensor  func(uintptr)
	tensorType  func(uintptr) int32
	tensorRank  func(uintptr) uintptr
	tensorDim   func(uintptr, uintptr) int64
	tensorBytes func(uintptr) uintptr
	tensorData  func(uintptr) unsafe.Pointer
}

func (api *sdVideoAPI) bind(find func(string) (uintptr, error)) error {
	for _, export := range []struct {
		name string
		fn   any
	}{
		{"sd_get_last_error", &api.lastError},
		{"sd_ctx_opt_create", &api.contextOpts}, {"sd_vid_gen_opt_create", &api.videoOpts}, {"sd_opt_free", &api.freeOpts},
		{"sd_opt_set_string", &api.setString}, {"sd_opt_set_bool", &api.setBool}, {"sd_opt_set_int", &api.setInt},
		{"sd_opt_set_float", &api.setFloat}, {"sd_opt_set_floats", &api.setFloats},
		{"sd_opt_set_tensor", &api.setTensor}, {"sd_opt_set_tensors", &api.setTensors},
		{"sd_ctx_create", &api.createCtx}, {"sd_ctx_free", &api.freeCtx}, {"sd_ctx_supports_video_generation", &api.supports},
		{"sd_generate_video", &api.generate}, {"sd_set_generation_progress_callback", &api.setProgress}, {"sd_cancel_generation", &api.cancel},
		{"sd_result_get_kind", &api.resultKind}, {"sd_result_get_image_count", &api.imageCount}, {"sd_result_get_image", &api.imageAt},
		{"sd_result_get_audio", &api.resultAudio}, {"sd_result_get_fps", &api.resultFPS}, {"sd_result_free", &api.freeResult},
		{"sd_tensor_create", &api.newTensor}, {"sd_tensor_free", &api.freeTensor},
		{"sd_tensor_type", &api.tensorType}, {"sd_tensor_rank", &api.tensorRank}, {"sd_tensor_dim", &api.tensorDim},
		{"sd_tensor_byte_size", &api.tensorBytes}, {"sd_tensor_data", &api.tensorData},
	} {
		address, err := find(export.name)
		if err != nil {
			return fmt.Errorf("load stable-diffusion video export %s: %w", export.name, err)
		}
		purego.RegisterFunc(export.fn, address)
	}
	return nil
}

func (api *sdVideoAPI) failure(kind, action string, status int32) error {
	return videoError(kind, fmt.Errorf("stable-diffusion %s (status %d): %s", action, status, api.lastError()))
}

type opaqueVideoEngine struct {
	open    func(*sdVideoAPI) (func(), error)
	backend string
	api     sdVideoAPI
	close   func()

	operationMu sync.Mutex
	stateMu     sync.Mutex
	ctx         uintptr
	model       VideoModelRequest
	active      bool
	canceled    bool

	progressMu      sync.RWMutex
	progressContext context.Context
	progress        func(VideoGenerateProgress)
	callback        uintptr
}

func (e *opaqueVideoEngine) Load(model VideoModelRequest) (bool, error) {
	if err := validateVideoModelRecipe(model); err != nil {
		return false, err
	}
	encoderKey := "llm_path"
	if model.RecipeID == "wan22-ti2v-5b" {
		encoderKey = "t5xxl_path"
	}
	paths := map[string]string{"diffusion_model_path": model.DiffusionPath, encoderKey: model.EncoderPath, "vae_path": model.VideoVAEPath}
	if model.AudioVAEPath != "" {
		paths["audio_vae_path"] = model.AudioVAEPath
	}
	for key, path := range paths {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.ContainsRune(path, 0) {
			return false, videoError(VideoErrorLoad, fmt.Errorf("%s is not a canonical absolute path", key))
		}
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			return false, videoError(VideoErrorLoad, fmt.Errorf("%s is unavailable", key))
		}
	}

	e.operationMu.Lock()
	defer e.operationMu.Unlock()
	if e.ctx != 0 && e.model.ProcessKey == model.ProcessKey {
		return true, nil
	}
	if e.close == nil {
		closeLibrary, err := e.open(&e.api)
		if err != nil {
			return false, videoError(VideoErrorEngineIncompatible, err)
		}
		e.close = closeLibrary
		if e.callback == 0 {
			e.callback = purego.NewCallback(e.reportProgress)
		}
	}

	// The native diagnostics are thread-local.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	api := &e.api
	opts := api.contextOpts()
	if opts == 0 {
		return false, api.failure(VideoErrorLoad, "create video context options", 6)
	}
	defer api.freeOpts(opts)
	if e.backend != "" {
		paths["backend"] = e.backend
	}
	if model.OffloadToCPU {
		paths["params_backend"] = videoParamsBackendSpec(true)
	}
	paths["rng_type"], paths["sampler_rng_type"] = model.RNG, model.RNG
	for key, value := range paths {
		if status := api.setString(opts, key, value); status != 0 {
			return false, api.failure(VideoErrorLoad, "set "+key, status)
		}
	}
	if status := api.setBool(opts, "diffusion_flash_attn", model.DiffusionFlashAttention); status != 0 {
		return false, api.failure(VideoErrorLoad, "set diffusion_flash_attn", status)
	}
	if e.ctx != 0 {
		api.freeCtx(e.ctx)
		e.ctx = 0
	}
	var ctx uintptr
	if status := api.createCtx(opts, &ctx); status != 0 {
		return false, api.failure(VideoErrorLoad, "create video context", status)
	}
	if !api.supports(ctx) {
		err := api.failure(VideoErrorEngineIncompatible, "probe video model", 5)
		api.freeCtx(ctx)
		return false, err
	}
	e.ctx, e.model = ctx, model
	return false, nil
}

func (e *opaqueVideoEngine) Generate(ctx context.Context, request VideoGenerateRequest, progress func(VideoGenerateProgress)) (VideoCandidate, error) {
	e.operationMu.Lock()
	defer e.operationMu.Unlock()
	if e.ctx == 0 {
		return VideoCandidate{}, videoError(VideoErrorLoad, fmt.Errorf("stable-diffusion video context is not loaded"))
	}
	model := e.model
	wan := model.RecipeID == "wan22-ti2v-5b"
	if request.AudioRequired == wan || (model.ConditioningMode == "ref2va-image" || model.ConditioningMode == "wan22-first-image") != (len(request.ReferenceImage) > 0) {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("video conditioning payload does not match loaded route"))
	}

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	api := &e.api
	opts := api.videoOpts()
	if opts == 0 {
		return VideoCandidate{}, api.failure(VideoErrorInference, "create video generation options", 6)
	}
	defer api.freeOpts(opts)
	if err := api.configureVideo(opts, model, request); err != nil {
		return VideoCandidate{}, err
	}
	if len(request.ReferenceImage) > 0 {
		if err := api.setReferenceImage(opts, request.ReferenceImage, wan); err != nil {
			return VideoCandidate{}, err
		}
	}

	e.progressMu.Lock()
	e.progressContext, e.progress = ctx, progress
	e.progressMu.Unlock()
	api.setProgress(e.ctx, e.callback, 0)
	defer func() {
		api.setProgress(e.ctx, 0, 0)
		e.progressMu.Lock()
		e.progressContext, e.progress = nil, nil
		e.progressMu.Unlock()
	}()
	e.stateMu.Lock()
	if err := ctx.Err(); err != nil {
		e.stateMu.Unlock()
		return VideoCandidate{}, videoError(VideoErrorCanceled, err)
	}
	e.active, e.canceled = true, false
	e.stateMu.Unlock()
	var result uintptr
	status := api.generate(e.ctx, opts, &result)
	e.stateMu.Lock()
	e.active = false
	canceled := e.canceled
	e.stateMu.Unlock()
	if result != 0 {
		defer api.freeResult(result)
	}
	if ctx.Err() != nil || canceled || status == 10 { // SD_STATUS_CANCELLED
		return VideoCandidate{}, videoError(VideoErrorCanceled, fmt.Errorf("stable-diffusion video generation canceled"))
	}
	if status != 0 || result == 0 {
		return VideoCandidate{}, api.failure(VideoErrorInference, "generate video", status)
	}
	return api.copyVideo(result, request)
}

func (api *sdVideoAPI) configureVideo(opts uintptr, model VideoModelRequest, request VideoGenerateRequest) error {
	for key, value := range map[string]string{"prompt": request.Prompt, "negative_prompt": request.NegativePrompt, "sample.method": model.SampleMethod, "sample.scheduler": model.Scheduler} {
		if key == "sample.method" || key == "sample.scheduler" {
			if value == "" || value == "engine-default" {
				continue
			}
		}
		if strings.ContainsRune(value, 0) {
			return videoError(VideoErrorInference, fmt.Errorf("video option %s contains a NUL byte", key))
		}
		if status := api.setString(opts, key, value); status != 0 {
			return api.failure(VideoErrorInference, "set "+key, status)
		}
	}
	values := map[string]int64{"width": int64(request.Width), "height": int64(request.Height), "fps": int64(request.FPS), "video_frames": int64(request.FrameCount), "seed": request.Seed}
	if model.SampleSteps > 0 {
		values["sample.steps"] = int64(model.SampleSteps)
	}
	for key, value := range values {
		if status := api.setInt(opts, key, value); status != 0 {
			return api.failure(VideoErrorInference, "set "+key, status)
		}
	}
	for key, value := range map[string]float64{"sample.guidance.txt_cfg": model.CFGScale, "sample.flow_shift": model.FlowShift} {
		if status := api.setFloat(opts, key, value); status != 0 {
			return api.failure(VideoErrorInference, "set "+key, status)
		}
	}
	if model.RecipeID == "hyperflow-h3-flash" {
		sigmas := hyperFlowVideoSigmas()
		if status := api.setFloats(opts, "sample.sigmas", &sigmas[0], uintptr(len(sigmas))); status != 0 {
			return api.failure(VideoErrorInference, "set HyperFlow sigmas", status)
		}
	}
	return nil
}

func (api *sdVideoAPI) setReferenceImage(opts uintptr, encoded []byte, firstFrame bool) error {
	image, pixels, err := decodeFFIReferenceImage(encoded)
	if err != nil {
		return err
	}
	shape := [3]int64{3, int64(image.Width), int64(image.Height)}
	tensor := api.newTensor(1, uintptr(len(shape)), &shape[0], &pixels[0], uintptr(len(pixels))) // SD_TENSOR_U8
	if tensor == 0 {
		return api.failure(VideoErrorInference, "create video reference tensor", 6)
	}
	defer api.freeTensor(tensor)
	var status int32
	if firstFrame {
		status = api.setTensor(opts, "init_image", tensor)
	} else {
		status = api.setTensors(opts, "ref_images", &tensor, 1)
	}
	if status != 0 {
		return api.failure(VideoErrorInference, "set video reference", status)
	}
	return nil
}

func (api *sdVideoAPI) copyVideo(result uintptr, request VideoGenerateRequest) (VideoCandidate, error) {
	invalid := func(media string) (VideoCandidate, error) {
		return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned invalid %s tensor", media))
	}
	if api.resultKind(result) != 2 { // SD_RESULT_VIDEO
		return invalid("video")
	}
	frames := api.imageCount(result)
	frameBytes, overflow := checkedVideoByteCount(request.Width, request.Height, 3)
	fps := int(api.resultFPS(result))
	if overflow || frames == 0 || frames > maxFFIVideoFrames || int(frames) != request.FrameCount || fps != request.FPS {
		return invalid("video")
	}
	// Borrow individual frame tensors to avoid packing a second native copy of the video.
	candidate := VideoCandidate{Frames: make([]VideoFrame, int(frames)), FrameCount: int(frames), FPS: fps}
	for i := range candidate.Frames {
		frame := api.imageAt(result, uintptr(i))
		if frame == 0 || api.tensorType(frame) != 1 || api.tensorRank(frame) != 3 ||
			api.tensorDim(frame, 0) != 3 || api.tensorDim(frame, 1) != int64(request.Width) || api.tensorDim(frame, 2) != int64(request.Height) {
			return invalid("video frame")
		}
		data := api.tensorData(frame)
		if data == nil || api.tensorBytes(frame) != uintptr(frameBytes) {
			return invalid("video frame")
		}
		pixels := unsafe.Slice((*byte)(data), frameBytes)
		candidate.Frames[i] = VideoFrame{RGBBytes: append([]byte(nil), pixels...), Width: request.Width, Height: request.Height}
	}
	if audio := api.resultAudio(result); audio != nil {
		if api.tensorType(audio.Data) != 4 || api.tensorRank(audio.Data) != 2 { // SD_TENSOR_F32
			return invalid("audio")
		}
		channels, frames := api.tensorDim(audio.Data, 0), api.tensorDim(audio.Data, 1)
		data := api.tensorData(audio.Data)
		if channels <= 0 || channels > 2 || frames <= 0 || frames > maxFFIAudioSamples/channels || data == nil || api.tensorBytes(audio.Data) != uintptr(channels*frames*4) {
			return invalid("audio")
		}
		samples := unsafe.Slice((*float32)(data), int(channels*frames))
		candidate.Audio = VideoAudio{PCMSamples: append([]float32(nil), samples...), Channels: int(channels), SampleRate: int(audio.SampleRate)}
	}
	return candidate, nil
}

func (e *opaqueVideoEngine) reportProgress(event *sdGenerationProgress, _ uintptr) uintptr {
	e.progressMu.RLock()
	ctx, callback := e.progressContext, e.progress
	e.progressMu.RUnlock()
	// 1147 ignores cancellation on an idle context. If the request was canceled
	// just before sd_generate_video entered C, interrupt it on its first native event.
	if ctx != nil && ctx.Err() != nil {
		e.api.cancel(e.ctx, 0)
		return 0
	}
	if event == nil || event.Unit == nil || !isVideoStepUnit(event.Unit) || event.Total <= 0 || event.Total > 1<<31-1 || event.Completed < 0 || event.Completed > event.Total {
		return 0
	}
	if callback != nil {
		callback(VideoGenerateProgress{CurrentStep: int32(event.Completed), TotalSteps: int32(event.Total)})
	}
	return 0
}

func isVideoStepUnit(unit *byte) bool {
	for i, expected := range [6]byte{'s', 't', 'e', 'p', 's', 0} {
		if *(*byte)(unsafe.Add(unsafe.Pointer(unit), i)) != expected {
			return false
		}
	}
	return true
}

func (e *opaqueVideoEngine) Cancel() error {
	e.stateMu.Lock()
	defer e.stateMu.Unlock()
	if e.active {
		e.canceled = true
		e.api.cancel(e.ctx, 0) // SD_CANCEL_ALL
	}
	return nil
}

func (e *opaqueVideoEngine) Free() error {
	_ = e.Cancel()
	e.operationMu.Lock()
	defer e.operationMu.Unlock()
	if e.ctx != 0 {
		e.api.freeCtx(e.ctx)
		e.ctx = 0
	}
	if e.close != nil {
		e.close()
		e.close = nil
	}
	return nil
}
