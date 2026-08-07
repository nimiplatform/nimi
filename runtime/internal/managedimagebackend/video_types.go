package managedimagebackend

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const (
	VideoProtocolVersion uint32 = 1

	backendLoadVideoModelMethod = "/backend.Backend/LoadVideoModel"
	backendGenerateVideoMethod  = "/backend.Backend/GenerateVideo"
	backendCancelVideoMethod    = "/backend.Backend/CancelVideo"
)

const (
	VideoErrorProtocolMismatch   = "protocol_mismatch"
	VideoErrorEngineIncompatible = "engine_incompatible"
	VideoErrorLoad               = "load"
	VideoErrorInference          = "inference"
	VideoErrorPostcondition      = "postcondition"
	VideoErrorCanceled           = "canceled"
)

// VideoError preserves the wrapper-private failure kind across the dynamic
// gRPC protocol. Callers must not infer success from a partial AV payload.
type VideoError struct {
	Kind string
	Err  error
}

func (e *VideoError) Error() string {
	if e == nil || e.Err == nil {
		return "managed video operation failed"
	}
	return e.Err.Error()
}

func (e *VideoError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func VideoErrorKindOf(err error) string {
	var target *VideoError
	if errors.As(err, &target) {
		return target.Kind
	}
	return ""
}

func videoError(kind string, err error) error {
	if err == nil {
		err = fmt.Errorf("managed video operation failed")
	}
	return &VideoError{Kind: strings.TrimSpace(kind), Err: err}
}

type VideoModelRequest struct {
	BackendAddress          string
	ProcessKey              string
	FL2VADiffusionPath      string
	Ref2VADiffusionPath     string
	EncoderPath             string
	VideoVAEPath            string
	AudioVAEPath            string
	ConditioningMode        string
	CFGScale                float64
	FlowShift               float64
	SampleMethod            string
	Scheduler               string
	DiffusionFlashAttention bool
	OffloadToCPU            bool
	RNG                     string
}

func (request VideoModelRequest) selectedDiffusionPath() string {
	if request.ConditioningMode == "ref2va-image" {
		return request.Ref2VADiffusionPath
	}
	return request.FL2VADiffusionPath
}

type VideoLoadDiagnostics struct {
	Reused          bool
	PackageIdentity string
}

type VideoGenerateRequest struct {
	BackendAddress string
	Width          int
	Height         int
	FrameCount     int
	FPS            int
	Seed           int64
	Prompt         string
	NegativePrompt string
	ReferenceImage []byte
	OnProgress     func(VideoGenerateProgress)
}

type VideoGenerateProgress struct {
	CurrentStep int32
	TotalSteps  int32
}

type VideoFrame struct {
	RGBBytes []byte
	Width    int
	Height   int
}

type VideoAudio struct {
	PCMSamples []float32
	Channels   int
	SampleRate int
}

type VideoCandidate struct {
	Frames     []VideoFrame
	FrameCount int
	FPS        int
	Audio      VideoAudio
	ComputeMS  int64
}

// videoEngine is the narrow in-process C API seam. Tests inject fakes; the
// production implementation is the Windows stable-diffusion.dll adapter.
type videoEngine interface {
	Load(VideoModelRequest) (bool, error)
	Generate(VideoGenerateRequest, func(VideoGenerateProgress)) (VideoCandidate, error)
	Cancel() error
	Free() error
}

func validateVideoCandidate(req VideoGenerateRequest, candidate VideoCandidate) error {
	if req.Width <= 0 || req.Height <= 0 || req.FrameCount <= 0 || req.FPS != 24 {
		return videoError(VideoErrorPostcondition, fmt.Errorf("managed video request has invalid postcondition shape"))
	}
	if candidate.FrameCount != req.FrameCount || len(candidate.Frames) != req.FrameCount || candidate.FPS != req.FPS {
		return videoError(VideoErrorPostcondition, fmt.Errorf("managed video frame count/fps postcondition failed: got frames=%d/%d fps=%d want=%d/%d/%d", len(candidate.Frames), candidate.FrameCount, candidate.FPS, req.FrameCount, req.FrameCount, req.FPS))
	}
	frameBytes, overflow := checkedVideoByteCount(req.Width, req.Height, 3)
	if overflow {
		return videoError(VideoErrorPostcondition, fmt.Errorf("managed video frame dimensions overflow"))
	}
	for index, frame := range candidate.Frames {
		if frame.Width != req.Width || frame.Height != req.Height || len(frame.RGBBytes) != frameBytes {
			return videoError(VideoErrorPostcondition, fmt.Errorf("managed video frame %d shape postcondition failed", index))
		}
	}
	if candidate.Audio.Channels != 2 || candidate.Audio.SampleRate != 32000 || len(candidate.Audio.PCMSamples) == 0 || len(candidate.Audio.PCMSamples)%2 != 0 {
		return videoError(VideoErrorPostcondition, fmt.Errorf("managed video audio postcondition failed: samples=%d channels=%d sample_rate=%d", len(candidate.Audio.PCMSamples), candidate.Audio.Channels, candidate.Audio.SampleRate))
	}
	return nil
}

func checkedVideoByteCount(width, height, channels int) (int, bool) {
	if width <= 0 || height <= 0 || channels <= 0 {
		return 0, true
	}
	value := int64(width) * int64(height) * int64(channels)
	if value <= 0 || int64(int(value)) != value {
		return 0, true
	}
	return int(value), false
}

func contextVideoError(ctx context.Context, fallback error) error {
	if ctx != nil && ctx.Err() != nil {
		return videoError(VideoErrorCanceled, ctx.Err())
	}
	return fallback
}
