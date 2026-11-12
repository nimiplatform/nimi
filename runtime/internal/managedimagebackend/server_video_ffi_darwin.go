//go:build darwin && arm64 && cgo

package managedimagebackend

/*
#include <dlfcn.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Pointer arguments use the pinned 1088 layouts declared on the Go side.
typedef void (*progress_cb)(int, int, float, void *);
typedef void (*log_cb)(int, const char *, void *);

typedef struct {
	void *handle;
	void (*ctx_init)(void *);
	void (*video_init)(void *);
	void *(*new_ctx)(const void *);
	void (*free_ctx)(void *);
	bool (*supports_video)(const void *);
	bool (*generate)(void *, const void *, void **);
	void (*set_progress)(progress_cb, void *);
	void (*set_log)(log_cb, void *);
	void (*cancel)(void *, int);
	void (*free_result)(void *);
	int (*sample)(const char *);
	int (*scheduler)(const char *);
} nimi_sd_video;

extern void nimiSDVideoProgress(uintptr_t, int, int);

static void nimi_sd_progress(int step, int total, float time, void *data) {
	nimiSDVideoProgress((uintptr_t)data, step, total);
}

static void nimi_sd_log(int level, const char *message, void *data) {
	if (level >= 2) {
		fprintf(stderr, "stable-diffusion video: %s", message);
	}
}

static char *nimi_sd_open(nimi_sd_video *api, const char *path) {
	api->handle = dlopen(path, RTLD_NOW | RTLD_LOCAL | RTLD_FIRST);
	if (api->handle == NULL) {
		return strdup(dlerror());
	}
#define LOAD(member, symbol) do {                                  \
	api->member = dlsym(api->handle, #symbol);                     \
	if (api->member == NULL) {                                    \
		dlclose(api->handle);                                     \
		api->handle = NULL;                                       \
		return strdup("missing stable-diffusion export " #symbol); \
	}                                                             \
} while (0)
	LOAD(ctx_init, sd_ctx_params_init);
	LOAD(video_init, sd_vid_gen_params_init);
	LOAD(new_ctx, new_sd_ctx);
	LOAD(free_ctx, free_sd_ctx);
	LOAD(supports_video, sd_ctx_supports_video_generation);
	LOAD(generate, generate_video);
	LOAD(set_progress, sd_set_progress_callback);
	LOAD(set_log, sd_set_log_callback);
	LOAD(cancel, sd_cancel_generation);
	LOAD(free_result, free_sd_video_generation_result);
	LOAD(sample, str_to_sample_method);
	LOAD(scheduler, str_to_scheduler);
#undef LOAD
	api->set_log(nimi_sd_log, NULL);
	return NULL;
}

static void nimi_sd_close(nimi_sd_video *api) {
	api->set_log(NULL, NULL);
	dlclose(api->handle);
	api->handle = NULL;
}

static void nimi_sd_ctx_init(nimi_sd_video *api, void *params) { api->ctx_init(params); }
static void nimi_sd_video_init(nimi_sd_video *api, void *params) { api->video_init(params); }
static void *nimi_sd_new_ctx(nimi_sd_video *api, const void *params) { return api->new_ctx(params); }
static bool nimi_sd_supports_video(nimi_sd_video *api, const void *ctx) { return api->supports_video(ctx); }
static void nimi_sd_free_ctx(nimi_sd_video *api, void *ctx) { api->free_ctx(ctx); }
static void nimi_sd_cancel(nimi_sd_video *api, void *ctx, int mode) { api->cancel(ctx, mode); }
static void nimi_sd_free_result(nimi_sd_video *api, void *result) { api->free_result(result); }
static int nimi_sd_token(nimi_sd_video *api, bool sample, const char *token) {
	return sample ? api->sample(token) : api->scheduler(token);
}

static void *nimi_sd_generate(nimi_sd_video *api, void *ctx, const void *params, uintptr_t progress) {
	void *result = NULL;
	if (progress != 0) {
		api->set_progress(nimi_sd_progress, (void *)progress);
	}
	bool ok = api->generate(ctx, params, &result);
	if (progress != 0) {
		api->set_progress(NULL, NULL);
	}
	if (!ok && result != NULL) {
		api->free_result(result);
		result = NULL;
	}
	return result;
}
*/
import "C"

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/cgo"
	"strings"
	"sync"
	"unsafe"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

const macOSVideoLibraryName = "libstable-diffusion.dylib"

// The signed macOS release build supplies the exact library and source archive
// identities before it signs the Runtime executable.
var macOSProductVideoLibrarySHA256 string
var macOSProductVideoArchiveSHA256 string

// @nimi-authority: rule.nimi.runtime.local-compute.r067
type darwinVideoEngine struct {
	developmentLibraryPath string
	archiveSHA256          string
	api                    C.nimi_sd_video

	operationMu sync.Mutex
	stateMu     sync.Mutex
	ctx         unsafe.Pointer
	model       VideoModelRequest
	active      bool
	canceled    bool
}

func newStableDiffusionVideoEngine(executablePath string, identity videoPackageIdentity) (videoEngine, error) {
	return &darwinVideoEngine{
		developmentLibraryPath: filepath.Join(filepath.Dir(executablePath), macOSVideoLibraryName),
		archiveSHA256:          identity.ArchiveSHA256,
	}, nil
}

func (e *darwinVideoEngine) libraryPath() (string, error) {
	if protectedlocal.MacOSTeamID == "" && macOSProductVideoLibrarySHA256 == "" && macOSProductVideoArchiveSHA256 == "" {
		return e.developmentLibraryPath, nil
	}
	if macOSProductVideoArchiveSHA256 == "" || e.archiveSHA256 != macOSProductVideoArchiveSHA256 {
		return "", fmt.Errorf("managed video archive does not match the bundled macOS dylib")
	}
	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve installed Runtime executable: %w", err)
	}
	if executable != protectedlocal.MacOSRuntimeExecutablePath {
		return "", fmt.Errorf("bundled video dylib requires the installed macOS Runtime")
	}
	library := filepath.Join(filepath.Dir(executable), "..", "..", "Frameworks", macOSVideoLibraryName)
	if err := verifyMacOSProductVideoLibrary(library, macOSProductVideoLibrarySHA256); err != nil {
		return "", err
	}
	return library, nil
}

func verifyMacOSProductVideoLibrary(path, expectedSHA256 string) error {
	if len(expectedSHA256) != sha256.Size*2 {
		return fmt.Errorf("bundled macOS video dylib identity is missing")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect bundled macOS video dylib: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("bundled macOS video dylib is not a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open bundled macOS video dylib: %w", err)
	}
	defer func() { _ = file.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hash bundled macOS video dylib: %w", err)
	}
	if fmt.Sprintf("%x", hash.Sum(nil)) != expectedSHA256 {
		return fmt.Errorf("bundled macOS video dylib SHA-256 mismatch")
	}
	return nil
}

func (e *darwinVideoEngine) Load(request VideoModelRequest) (bool, error) {
	if request.RecipeID != "hyperflow-h3-flash" {
		return false, videoError(VideoErrorEngineIncompatible, fmt.Errorf("video recipe %q is unavailable on Apple Silicon", request.RecipeID))
	}
	if err := validateVideoModelRecipe(request); err != nil {
		return false, err
	}
	for label, path := range map[string]string{
		"diffusion": request.DiffusionPath,
		"encoder":   request.EncoderPath,
		"video VAE": request.VideoVAEPath,
		"audio VAE": request.AudioVAEPath,
	} {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.ContainsRune(path, 0) {
			return false, videoError(VideoErrorLoad, fmt.Errorf("%s model path is not canonical absolute", label))
		}
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			return false, videoError(VideoErrorLoad, fmt.Errorf("%s model path unavailable", label))
		}
	}

	e.operationMu.Lock()
	defer e.operationMu.Unlock()
	if e.ctx != nil && e.model.ProcessKey == request.ProcessKey {
		return true, nil
	}
	if e.api.handle == nil {
		libraryPath, err := e.libraryPath()
		if err != nil {
			return false, videoError(VideoErrorEngineIncompatible, err)
		}
		path := C.CString(libraryPath)
		defer C.free(unsafe.Pointer(path))
		if message := C.nimi_sd_open(&e.api, path); message != nil {
			defer C.free(unsafe.Pointer(message))
			return false, videoError(VideoErrorEngineIncompatible, fmt.Errorf("load stable-diffusion video dylib: %s", C.GoString(message)))
		}
	}
	e.freeContext()

	raw := C.malloc(C.size_t(unsafe.Sizeof(sdCtxParams{})))
	defer C.free(raw)
	C.nimi_sd_ctx_init(&e.api, raw)
	params := (*sdCtxParams)(raw)
	for target, value := range map[*uintptr]string{
		&params.DiffusionModelPath: request.DiffusionPath,
		&params.LLMPath:            request.EncoderPath,
		&params.VAEPath:            request.VideoVAEPath,
		&params.AudioVAEPath:       request.AudioVAEPath,
		&params.Backend:            "metal",
	} {
		pointer := unsafe.Pointer(C.CString(value))
		defer C.free(pointer)
		*target = uintptr(pointer)
	}
	if err := applyVideoContextRecipe(params, request); err != nil {
		return false, err
	}
	if value := videoParamsBackendSpec(request.OffloadToCPU); value != "" {
		pointer := unsafe.Pointer(C.CString(value))
		defer C.free(pointer)
		params.ParamsBackend = uintptr(pointer)
	}
	ctx := C.nimi_sd_new_ctx(&e.api, raw)
	if ctx == nil {
		return false, videoError(VideoErrorLoad, fmt.Errorf("new_sd_ctx returned null"))
	}
	if !C.nimi_sd_supports_video(&e.api, ctx) {
		C.nimi_sd_free_ctx(&e.api, ctx)
		return false, videoError(VideoErrorEngineIncompatible, fmt.Errorf("loaded stable-diffusion context does not support video generation"))
	}
	e.stateMu.Lock()
	e.ctx = ctx
	e.model = request
	e.stateMu.Unlock()
	return false, nil
}

func (e *darwinVideoEngine) Generate(request VideoGenerateRequest, progress func(VideoGenerateProgress)) (VideoCandidate, error) {
	e.operationMu.Lock()
	defer e.operationMu.Unlock()
	if e.ctx == nil {
		return VideoCandidate{}, videoError(VideoErrorLoad, fmt.Errorf("stable-diffusion video context is not loaded"))
	}
	if !request.AudioRequired || (e.model.ConditioningMode == "ref2va-image") != (len(request.ReferenceImage) > 0) {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("video conditioning payload does not match loaded route"))
	}
	if strings.ContainsRune(request.Prompt, 0) || strings.ContainsRune(request.NegativePrompt, 0) {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("video prompts contain a NUL byte"))
	}

	raw := C.malloc(C.size_t(unsafe.Sizeof(sdVideoGenParams{})))
	defer C.free(raw)
	C.nimi_sd_video_init(&e.api, raw)
	params := (*sdVideoGenParams)(raw)
	prompt := unsafe.Pointer(C.CString(request.Prompt))
	defer C.free(prompt)
	negative := unsafe.Pointer(C.CString(request.NegativePrompt))
	defer C.free(negative)
	params.Prompt, params.NegativePrompt = uintptr(prompt), uintptr(negative)
	params.Width, params.Height = int32(request.Width), int32(request.Height)
	params.Seed, params.VideoFrames, params.FPS = request.Seed, int32(request.FrameCount), int32(request.FPS)
	if err := applyVideoGenerateRecipe(params, e.model, e.convertToken); err != nil {
		return VideoCandidate{}, err
	}
	sigmas := hyperFlowVideoSigmas()
	sigmaBytes := C.CBytes(unsafe.Slice((*byte)(unsafe.Pointer(&sigmas[0])), int(unsafe.Sizeof(sigmas))))
	defer C.free(sigmaBytes)
	params.SampleParams.CustomSigmas = uintptr(sigmaBytes)
	params.SampleParams.CustomSigmasCount = int32(len(sigmas))

	if len(request.ReferenceImage) > 0 {
		reference, pixels, err := decodeFFIReferenceImage(request.ReferenceImage)
		if err != nil {
			return VideoCandidate{}, err
		}
		reference.Data = C.CBytes(pixels)
		defer C.free(reference.Data)
		ref := C.malloc(C.size_t(unsafe.Sizeof(reference)))
		defer C.free(ref)
		*(*sdImage)(ref) = reference
		params.RefImages, params.RefImagesCount = uintptr(ref), 1
	}

	var handle cgo.Handle
	if progress != nil {
		handle = cgo.NewHandle(progress)
		defer handle.Delete()
	}
	e.stateMu.Lock()
	e.canceled = false
	e.active = true
	C.nimi_sd_cancel(&e.api, e.ctx, 2) // SD_CANCEL_RESET
	e.stateMu.Unlock()
	result := C.nimi_sd_generate(&e.api, e.ctx, raw, C.uintptr_t(handle))
	if result != nil {
		defer C.nimi_sd_free_result(&e.api, result)
	}
	e.stateMu.Lock()
	canceled := e.canceled
	e.active = false
	e.stateMu.Unlock()
	if canceled {
		return VideoCandidate{}, videoError(VideoErrorCanceled, fmt.Errorf("stable-diffusion video generation canceled"))
	}
	if result == nil {
		return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("generate_video returned no result"))
	}
	video := (*sdVideoGenerationResult)(result)
	return copyFFIVideoCandidate(video.Frames, video.FrameCount, video.Audio, int(video.FPS))
}

func (e *darwinVideoEngine) convertToken(label, value string, count int32) (int32, bool, error) {
	if value == "" || value == "engine-default" {
		return 0, false, nil
	}
	token := C.CString(value)
	defer C.free(unsafe.Pointer(token))
	result := int32(C.nimi_sd_token(&e.api, C.bool(label == "sample method"), token))
	if result < 0 || result >= count {
		return 0, false, videoError(VideoErrorLoad, fmt.Errorf("managed video %s is unsupported", label))
	}
	return result, true, nil
}

func (e *darwinVideoEngine) Cancel() error {
	e.stateMu.Lock()
	defer e.stateMu.Unlock()
	if e.active {
		e.canceled = true
		C.nimi_sd_cancel(&e.api, e.ctx, 0) // SD_CANCEL_ALL
	}
	return nil
}

func (e *darwinVideoEngine) freeContext() {
	e.stateMu.Lock()
	ctx := e.ctx
	e.ctx = nil
	e.model = VideoModelRequest{}
	e.stateMu.Unlock()
	if ctx != nil {
		C.nimi_sd_free_ctx(&e.api, ctx)
	}
}

func (e *darwinVideoEngine) Free() error {
	_ = e.Cancel()
	e.operationMu.Lock()
	defer e.operationMu.Unlock()
	e.freeContext()
	if e.api.handle != nil {
		C.nimi_sd_close(&e.api)
	}
	return nil
}
