//go:build !(windows && amd64) && !(darwin && arm64 && cgo)

package managedimagebackend

import (
	"context"
	"fmt"
)

type unsupportedVideoEngine struct{}

func newStableDiffusionVideoEngine(string, videoPackageIdentity) (videoEngine, error) {
	return unsupportedVideoEngine{}, nil
}

func (unsupportedVideoEngine) Load(VideoModelRequest) (bool, error) {
	return false, videoError(VideoErrorEngineIncompatible, fmt.Errorf("stable-diffusion video FFI requires Windows x64 or Apple Silicon with cgo"))
}

func (unsupportedVideoEngine) Generate(context.Context, VideoGenerateRequest, func(VideoGenerateProgress)) (VideoCandidate, error) {
	return VideoCandidate{}, videoError(VideoErrorEngineIncompatible, fmt.Errorf("stable-diffusion video FFI requires Windows x64 or Apple Silicon with cgo"))
}

func (unsupportedVideoEngine) Cancel() error { return nil }
func (unsupportedVideoEngine) Free() error   { return nil }
