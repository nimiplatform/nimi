//go:build windows

package managedimagebackend

import (
	"fmt"
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
	sdCancelAll   = 0
	sdCancelReset = 2
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
	freeVideoResult *syscall.LazyProc
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

// callVideoVoid invokes exports whose C signatures return void; syscall's
// last-error result is not part of their contract.
func callVideoVoid(proc *syscall.LazyProc, args ...uintptr) {
	_, _, _ = proc.Call(args...)
}

func newStableDiffusionVideoEngine(executablePath string, _ videoPackageIdentity) (videoEngine, error) {
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
		freeVideoResult: dll.NewProc("free_sd_video_generation_result"),
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
	for _, proc := range []*syscall.LazyProc{engine.ctxParamsInit, engine.videoParamsInit, engine.newContext, engine.freeContext, engine.supportsVideo, engine.generateVideo, engine.setProgress, engine.cancelGenerate, engine.freeVideoResult, engine.strToSample, engine.strToScheduler} {
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
	wan := request.RecipeID == "wan22-ti2v-5b"
	if request.RecipeID != "minimax-h3" && request.RecipeID != "hyperflow-h3-flash" && !wan || wan && request.ConditioningMode != "wan22-text" && request.ConditioningMode != "wan22-first-image" || !wan && request.ConditioningMode != "fl2va-t2va" && request.ConditioningMode != "ref2va-image" {
		return false, videoError(VideoErrorLoad, fmt.Errorf("managed H3 video conditioning mode is unsupported"))
	}
	paths := map[string]string{
		"diffusion": request.DiffusionPath,
		"encoder":   request.EncoderPath,
		"video VAE": request.VideoVAEPath,
	}
	if !wan {
		paths["audio VAE"] = request.AudioVAEPath
	} else if request.AudioVAEPath != "" {
		return false, videoError(VideoErrorLoad, fmt.Errorf("Wan2.2 does not use an audio VAE"))
	}
	for label, path := range paths {
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
	callVideoVoid(engine.ctxParamsInit, uintptr(unsafe.Pointer(&params)))
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
	modelPaths := map[*uintptr]string{
		&params.DiffusionModelPath: request.DiffusionPath,
		&params.VAEPath:            request.VideoVAEPath,
	}
	if wan {
		modelPaths[&params.T5XXLPath] = request.EncoderPath
	} else {
		modelPaths[&params.LLMPath] = request.EncoderPath
		modelPaths[&params.AudioVAEPath] = request.AudioVAEPath
	}
	for target, value := range modelPaths {
		if err := setCString(target, value); err != nil {
			return false, videoError(VideoErrorLoad, fmt.Errorf("encode video model path: %w", err))
		}
	}
	if err := applyVideoContextRecipe(&params, request); err != nil {
		return false, err
	}
	if backendSpec := videoParamsBackendSpec(request.OffloadToCPU); backendSpec != "" {
		// The selected CLI maps --offload-to-cpu to the "*=cpu" parameter
		// backend assignment, not the bare device name "cpu".
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
		callVideoVoid(engine.freeContext, contextPointer)
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
	callVideoVoid(engine.cancelGenerate, contextPointer, sdCancelReset)
	engine.progressMu.Lock()
	engine.progress = progress
	engine.progressMu.Unlock()
	callVideoVoid(engine.setProgress, engine.progressCallback, 0)
	defer func() {
		callVideoVoid(engine.setProgress, 0, 0)
		engine.progressMu.Lock()
		engine.progress = nil
		engine.progressMu.Unlock()
	}()

	var params sdVideoGenParams
	callVideoVoid(engine.videoParamsInit, uintptr(unsafe.Pointer(&params)))
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
	// HyperFlow's fixed six-step schedule already includes video flow shift.
	var customSigmas [7]float32
	if model.RecipeID == "hyperflow-h3-flash" {
		customSigmas = hyperFlowVideoSigmas()
		params.SampleParams.CustomSigmas = uintptr(unsafe.Pointer(&customSigmas[0]))
		params.SampleParams.CustomSigmasCount = int32(len(customSigmas))
	}
	wan := model.RecipeID == "wan22-ti2v-5b"
	if request.AudioRequired == wan || ((model.ConditioningMode == "ref2va-image" || model.ConditioningMode == "wan22-first-image") != (len(request.ReferenceImage) > 0)) {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("video conditioning payload does not match loaded route"))
	}

	if request.ReferenceImage != nil {
		reference, pixels, err := decodeFFIReferenceImage(request.ReferenceImage)
		if err != nil {
			return VideoCandidate{}, err
		}
		if wan {
			params.InitImage = reference
		} else {
			params.RefImages = uintptr(unsafe.Pointer(&reference))
			params.RefImagesCount = 1
		}
		defer runtime.KeepAlive(pixels)
		defer runtime.KeepAlive(reference)
	}

	var resultOut *sdVideoGenerationResult
	success, _, _ := engine.generateVideo.Call(contextPointer, uintptr(unsafe.Pointer(&params)), uintptr(unsafe.Pointer(&resultOut)))
	runtime.KeepAlive(prompt)
	runtime.KeepAlive(negative)
	runtime.KeepAlive(customSigmas)
	if resultOut != nil {
		defer callVideoVoid(engine.freeVideoResult, uintptr(unsafe.Pointer(resultOut)))
	}

	if success == 0 {
		if engine.canceled.Load() {
			return VideoCandidate{}, videoError(VideoErrorCanceled, fmt.Errorf("stable-diffusion video generation canceled"))
		}
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("generate_video returned false"))
	}
	// Report the engine's effective frame rate. The public H3 postcondition
	// rejects changes to its fixed 24 FPS contract instead of relabeling frames.
	if resultOut == nil {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("generate_video returned no result"))
	}
	candidate, err := copyFFIVideoCandidate(resultOut.Frames, resultOut.FrameCount, resultOut.Audio, int(resultOut.FPS))
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
		callVideoVoid(engine.cancelGenerate, contextPointer, sdCancelAll)
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
		callVideoVoid(engine.freeContext, contextPointer)
	}
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
