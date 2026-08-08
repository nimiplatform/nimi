//go:build windows

package managedimagebackend

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	sdCancelAll        = 0
	sdCancelReset      = 2
	maxFFIVideoFrames  = 512
	maxFFIAudioSamples = 1 << 30
)

type stableDiffusionVideoFFI struct {
	dll *syscall.LazyDLL

	ctxParamsInit   *syscall.LazyProc
	videoParamsInit *syscall.LazyProc
	newContext      *syscall.LazyProc
	freeContext     *syscall.LazyProc
	supportsVideo   *syscall.LazyProc
	generateVideo   *syscall.LazyProc
	setProgress     *syscall.LazyProc
	cancelGenerate  *syscall.LazyProc
	freeImages      *syscall.LazyProc
	freeAudio       *syscall.LazyProc
	strToSample     *syscall.LazyProc
	strToScheduler  *syscall.LazyProc

	operationMu sync.Mutex
	ctxMu       sync.RWMutex
	ctx         uintptr
	loadedKey   string
	loadedModel VideoModelRequest
	canceled    atomic.Bool

	progressMu       sync.RWMutex
	progress         func(VideoGenerateProgress)
	progressCallback uintptr
}

func newStableDiffusionVideoEngine(executablePath string) (videoEngine, error) {
	directory := filepath.Dir(strings.TrimSpace(executablePath))
	dllPath := filepath.Join(directory, "stable-diffusion.dll")
	cursor := directory
	for depth := 0; depth < 4; depth++ {
		candidate := filepath.Join(cursor, "stable-diffusion.dll")
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			dllPath = candidate
			break
		}
		parent := filepath.Dir(cursor)
		if parent == cursor {
			break
		}
		cursor = parent
	}
	dll := syscall.NewLazyDLL(dllPath)
	engine := &stableDiffusionVideoFFI{
		dll:             dll,
		ctxParamsInit:   dll.NewProc("sd_ctx_params_init"),
		videoParamsInit: dll.NewProc("sd_vid_gen_params_init"),
		newContext:      dll.NewProc("new_sd_ctx"),
		freeContext:     dll.NewProc("free_sd_ctx"),
		supportsVideo:   dll.NewProc("sd_ctx_supports_video_generation"),
		generateVideo:   dll.NewProc("generate_video"),
		setProgress:     dll.NewProc("sd_set_progress_callback"),
		cancelGenerate:  dll.NewProc("sd_cancel_generation"),
		freeImages:      dll.NewProc("free_sd_images"),
		freeAudio:       dll.NewProc("free_sd_audio"),
		strToSample:     dll.NewProc("str_to_sample_method"),
		strToScheduler:  dll.NewProc("str_to_scheduler"),
	}
	engine.progressCallback = syscall.NewCallback(func(step, steps, _time, _data uintptr) uintptr {
		engine.progressMu.RLock()
		callback := engine.progress
		engine.progressMu.RUnlock()
		if callback != nil {
			callback(VideoGenerateProgress{CurrentStep: int32(step), TotalSteps: int32(steps)})
		}
		return 0
	})
	return engine, nil
}

func (engine *stableDiffusionVideoFFI) Load(request VideoModelRequest) (bool, error) {
	if engine == nil {
		return false, videoError(VideoErrorLoad, fmt.Errorf("stable-diffusion video FFI is unavailable"))
	}
	if err := engine.dll.Load(); err != nil {
		return false, videoError(VideoErrorLoad, fmt.Errorf("load stable-diffusion video DLL: %w", err))
	}
	for _, proc := range []*syscall.LazyProc{engine.ctxParamsInit, engine.videoParamsInit, engine.newContext, engine.freeContext, engine.supportsVideo, engine.generateVideo, engine.setProgress, engine.cancelGenerate, engine.freeImages, engine.freeAudio, engine.strToSample, engine.strToScheduler} {
		if err := proc.Find(); err != nil {
			return false, videoError(VideoErrorEngineIncompatible, fmt.Errorf("stable-diffusion video export %s unavailable: %w", proc.Name, err))
		}
	}
	if err := validateVideoModelRecipe(request); err != nil {
		return false, err
	}
	for _, option := range []struct {
		label string
		value string
		count int32
	}{
		{label: "sample method", value: request.SampleMethod, count: sdSampleMethodCount},
		{label: "scheduler", value: request.Scheduler, count: sdSchedulerCount},
	} {
		if _, _, err := engine.convertVideoRecipeToken(option.label, option.value, option.count); err != nil {
			return false, err
		}
	}
	if request.ConditioningMode != "fl2va-t2va" && request.ConditioningMode != "ref2va-image" {
		return false, videoError(VideoErrorLoad, fmt.Errorf("managed H3 video conditioning mode is unsupported"))
	}
	for label, path := range map[string]string{
		"diffusion": request.selectedDiffusionPath(),
		"encoder":   request.EncoderPath,
		"video VAE": request.VideoVAEPath,
		"audio VAE": request.AudioVAEPath,
	} {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return false, videoError(VideoErrorLoad, fmt.Errorf("%s model path is not canonical absolute", label))
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return false, videoError(VideoErrorLoad, fmt.Errorf("%s model path unavailable", label))
		}
	}

	engine.operationMu.Lock()
	defer engine.operationMu.Unlock()
	engine.ctxMu.RLock()
	reused := engine.ctx != 0 && engine.loadedKey == request.ProcessKey
	engine.ctxMu.RUnlock()
	if reused {
		return true, nil
	}
	engine.freeContextLocked()

	var params sdCtxParams
	engine.ctxParamsInit.Call(uintptr(unsafe.Pointer(&params)))
	stringsToKeep := make([]*byte, 0, 5)
	setCString := func(target *uintptr, value string) error {
		pointer, err := syscall.BytePtrFromString(value)
		if err != nil {
			return err
		}
		stringsToKeep = append(stringsToKeep, pointer)
		*target = uintptr(unsafe.Pointer(pointer))
		return nil
	}
	for target, value := range map[*uintptr]string{
		&params.DiffusionModelPath: request.selectedDiffusionPath(),
		&params.LLMPath:            request.EncoderPath,
		&params.VAEPath:            request.VideoVAEPath,
		&params.AudioVAEPath:       request.AudioVAEPath,
	} {
		if err := setCString(target, value); err != nil {
			return false, videoError(VideoErrorLoad, fmt.Errorf("encode video model path: %w", err))
		}
	}
	if err := applyVideoContextRecipe(&params, request); err != nil {
		return false, err
	}
	if backendSpec := videoParamsBackendSpec(request.OffloadToCPU); backendSpec != "" {
		// Floor CLI maps --offload-to-cpu by prepending the "*=cpu" backend
		// assignment spec to params_backend (examples/common/common.cpp:775-777
		// @ c6beeef3), not the bare literal "cpu".
		if err := setCString(&params.ParamsBackend, backendSpec); err != nil {
			return false, videoError(VideoErrorLoad, fmt.Errorf("encode CPU params backend: %w", err))
		}
	}
	contextPointer, _, _ := engine.newContext.Call(uintptr(unsafe.Pointer(&params)))
	runtime.KeepAlive(stringsToKeep)
	if contextPointer == 0 {
		return false, videoError(VideoErrorLoad, fmt.Errorf("new_sd_ctx returned null"))
	}
	if supported, _, _ := engine.supportsVideo.Call(contextPointer); supported == 0 {
		engine.freeContext.Call(contextPointer)
		return false, videoError(VideoErrorEngineIncompatible, fmt.Errorf("loaded stable-diffusion context does not support video generation"))
	}
	engine.ctxMu.Lock()
	engine.ctx = contextPointer
	engine.loadedKey = request.ProcessKey
	engine.loadedModel = request
	engine.ctxMu.Unlock()
	return false, nil
}

func (engine *stableDiffusionVideoFFI) Generate(request VideoGenerateRequest, progress func(VideoGenerateProgress)) (VideoCandidate, error) {
	engine.operationMu.Lock()
	defer engine.operationMu.Unlock()
	engine.ctxMu.RLock()
	contextPointer := engine.ctx
	model := engine.loadedModel
	engine.ctxMu.RUnlock()
	if contextPointer == 0 {
		return VideoCandidate{}, videoError(VideoErrorLoad, fmt.Errorf("stable-diffusion video context is not loaded"))
	}

	engine.canceled.Store(false)
	engine.cancelGenerate.Call(contextPointer, sdCancelReset)
	engine.progressMu.Lock()
	engine.progress = progress
	engine.progressMu.Unlock()
	engine.setProgress.Call(engine.progressCallback, 0)
	defer func() {
		engine.setProgress.Call(0, 0)
		engine.progressMu.Lock()
		engine.progress = nil
		engine.progressMu.Unlock()
	}()

	var params sdVideoGenParams
	engine.videoParamsInit.Call(uintptr(unsafe.Pointer(&params)))
	prompt, err := syscall.BytePtrFromString(request.Prompt)
	if err != nil {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("encode video prompt: %w", err))
	}
	negative, err := syscall.BytePtrFromString(request.NegativePrompt)
	if err != nil {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("encode video negative prompt: %w", err))
	}
	params.Prompt = uintptr(unsafe.Pointer(prompt))
	params.NegativePrompt = uintptr(unsafe.Pointer(negative))
	params.Width = int32(request.Width)
	params.Height = int32(request.Height)
	params.Seed = request.Seed
	params.VideoFrames = int32(request.FrameCount)
	params.FPS = int32(request.FPS)
	if err := applyVideoGenerateRecipe(&params, model, func(label, value string, count int32) (int32, bool, error) {
		return engine.convertVideoRecipeToken(label, value, count)
	}); err != nil {
		return VideoCandidate{}, err
	}
	if (model.ConditioningMode == "ref2va-image") != (len(request.ReferenceImage) > 0) {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("video conditioning payload does not match loaded route"))
	}

	if request.ReferenceImage != nil {
		reference, pixels, err := decodeFFIReferenceImage(request.ReferenceImage)
		if err != nil {
			return VideoCandidate{}, err
		}
		params.RefImages = uintptr(unsafe.Pointer(&reference))
		params.RefImagesCount = 1
		defer runtime.KeepAlive(pixels)
		defer runtime.KeepAlive(reference)
	}

	var framesOut unsafe.Pointer
	var frameCountOut int32
	var audioOut unsafe.Pointer
	success, _, _ := engine.generateVideo.Call(
		contextPointer,
		uintptr(unsafe.Pointer(&params)),
		uintptr(unsafe.Pointer(&framesOut)),
		uintptr(unsafe.Pointer(&frameCountOut)),
		uintptr(unsafe.Pointer(&audioOut)),
	)
	runtime.KeepAlive(prompt)
	runtime.KeepAlive(negative)
	if framesOut != nil {
		defer engine.freeImages.Call(uintptr(framesOut), uintptr(frameCountOut))
	}
	if audioOut != nil {
		defer engine.freeAudio.Call(uintptr(audioOut))
	}
	if success == 0 {
		if engine.canceled.Load() {
			return VideoCandidate{}, videoError(VideoErrorCanceled, fmt.Errorf("stable-diffusion video generation canceled"))
		}
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("generate_video returned false"))
	}
	candidate, err := copyFFIVideoCandidate(framesOut, frameCountOut, audioOut, request.FPS)
	if err != nil {
		return VideoCandidate{}, err
	}
	return candidate, nil
}

func (engine *stableDiffusionVideoFFI) Cancel() error {
	if engine == nil {
		return nil
	}
	engine.canceled.Store(true)
	engine.ctxMu.RLock()
	contextPointer := engine.ctx
	engine.ctxMu.RUnlock()
	if contextPointer != 0 {
		engine.cancelGenerate.Call(contextPointer, sdCancelAll)
	}
	return nil
}

func (engine *stableDiffusionVideoFFI) Free() error {
	if engine == nil {
		return nil
	}
	_ = engine.Cancel()
	engine.operationMu.Lock()
	defer engine.operationMu.Unlock()
	engine.freeContextLocked()
	return nil
}

func (engine *stableDiffusionVideoFFI) freeContextLocked() {
	engine.ctxMu.Lock()
	contextPointer := engine.ctx
	engine.ctx = 0
	engine.loadedKey = ""
	engine.loadedModel = VideoModelRequest{}
	engine.ctxMu.Unlock()
	if contextPointer != 0 {
		engine.freeContext.Call(contextPointer)
	}
}

func decodeFFIReferenceImage(encoded []byte) (sdImage, []byte, error) {
	decoded, _, err := image.Decode(bytes.NewReader(encoded))
	if err != nil {
		return sdImage{}, nil, videoError(VideoErrorInference, fmt.Errorf("decode reference image: %w", err))
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	count, overflow := checkedVideoByteCount(width, height, 3)
	if overflow {
		return sdImage{}, nil, videoError(VideoErrorInference, fmt.Errorf("reference image shape overflows"))
	}
	pixels := make([]byte, count)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			r, g, b, _ := decoded.At(bounds.Min.X+x, bounds.Min.Y+y).RGBA()
			offset := (y*width + x) * 3
			pixels[offset] = byte(r >> 8)
			pixels[offset+1] = byte(g >> 8)
			pixels[offset+2] = byte(b >> 8)
		}
	}
	return sdImage{Width: uint32(width), Height: uint32(height), Channel: 3, Data: unsafe.Pointer(&pixels[0])}, pixels, nil
}

func copyFFIVideoCandidate(framesPointer unsafe.Pointer, frameCount int32, audioPointer unsafe.Pointer, fps int) (VideoCandidate, error) {
	if framesPointer == nil || frameCount <= 0 || frameCount > maxFFIVideoFrames {
		return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned invalid video frame array"))
	}
	frames := unsafe.Slice((*sdImage)(framesPointer), int(frameCount))
	candidate := VideoCandidate{Frames: make([]VideoFrame, 0, len(frames)), FrameCount: int(frameCount), FPS: fps}
	for index, frame := range frames {
		count, overflow := checkedVideoByteCount(int(frame.Width), int(frame.Height), int(frame.Channel))
		if overflow || frame.Channel != 3 || frame.Data == nil {
			return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned invalid frame %d", index))
		}
		payload := unsafe.Slice((*byte)(frame.Data), count)
		candidate.Frames = append(candidate.Frames, VideoFrame{RGBBytes: append([]byte(nil), payload...), Width: int(frame.Width), Height: int(frame.Height)})
	}
	if audioPointer == nil {
		return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned no audio"))
	}
	audio := *(*sdAudio)(audioPointer)
	totalSamples := audio.SampleCount * uint64(audio.Channels)
	if audio.Data == nil || totalSamples == 0 || totalSamples > maxFFIAudioSamples {
		return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("stable-diffusion returned invalid audio"))
	}
	samples := unsafe.Slice((*float32)(audio.Data), int(totalSamples))
	candidate.Audio = VideoAudio{PCMSamples: append([]float32(nil), samples...), Channels: int(audio.Channels), SampleRate: int(audio.SampleRate)}
	return candidate, nil
}

func (engine *stableDiffusionVideoFFI) convertVideoRecipeToken(label, value string, count int32) (int32, bool, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "engine-default" {
		return 0, false, nil
	}
	pointer, err := syscall.BytePtrFromString(value)
	if err != nil {
		return 0, false, videoError(VideoErrorLoad, fmt.Errorf("encode video %s: %w", label, err))
	}
	proc := engine.strToScheduler
	if label == "sample method" {
		proc = engine.strToSample
	}
	converted, _, _ := proc.Call(uintptr(unsafe.Pointer(pointer)))
	runtime.KeepAlive(pointer)
	result := int32(converted)
	if result < 0 || result >= count {
		return 0, false, videoError(VideoErrorLoad, fmt.Errorf("managed H3 video %s is unsupported", label))
	}
	return result, true, nil
}
