//go:build !windows

package managedimagebackend

import "fmt"

type unsupportedVideoEngine struct{}

func newStableDiffusionVideoEngine(string) (videoEngine, error) {
	return unsupportedVideoEngine{}, nil
}

func (unsupportedVideoEngine) Load(VideoModelRequest) (bool, error) {
	return false, videoError(VideoErrorEngineIncompatible, fmt.Errorf("stable-diffusion video FFI requires Windows x64"))
}

func (unsupportedVideoEngine) Generate(VideoGenerateRequest, func(VideoGenerateProgress)) (VideoCandidate, error) {
	return VideoCandidate{}, videoError(VideoErrorEngineIncompatible, fmt.Errorf("stable-diffusion video FFI requires Windows x64"))
}

func (unsupportedVideoEngine) Cancel() error { return nil }
func (unsupportedVideoEngine) Free() error   { return nil }
