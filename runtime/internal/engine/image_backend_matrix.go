package engine

import "strings"

type ImageSupervisedBackendFamily string

const (
	ImageSupervisedBackendFamilyUnsupported          ImageSupervisedBackendFamily = "unsupported"
	ImageSupervisedBackendFamilyStableDiffusionGGML  ImageSupervisedBackendFamily = "stablediffusion-ggml"
)

type ImageSupervisedBackendMatrixSelection struct {
	Family         ImageSupervisedBackendFamily
	Supported      bool
	ControlPlane   EngineKind
	ExecutionPlane EngineKind
	Detail         string
}

// ResolveImageSupervisedBackendMatrixSelection returns the canonical runtime
// supervised image backend selection for the provided host tuple.
//
// The current local GGUF image asset contract is bound to the
// stablediffusion-ggml family, supervised by the llama control plane and
// exposed through the media execution plane.
func ResolveImageSupervisedBackendMatrixSelection(
	goos string,
	goarch string,
	gpuVendor string,
	gpuModel string,
) ImageSupervisedBackendMatrixSelection {
	selection := ImageSupervisedBackendMatrixSelection{
		Family:         ImageSupervisedBackendFamilyStableDiffusionGGML,
		Supported:      false,
		ControlPlane:   EngineLlama,
		ExecutionPlane: EngineMedia,
	}
	if LlamaImageSupervisedPlatformSupportedFor(goos, goarch, gpuVendor, gpuModel) {
		selection.Supported = true
		return selection
	}
	detail := strings.TrimSpace(LlamaImageSupervisedPlatformSupportDetailFor(goos, goarch, gpuVendor, gpuModel))
	if detail == "" {
		detail = "managed image supervised mode is unavailable on this host"
	}
	selection.Detail = detail
	return selection
}
