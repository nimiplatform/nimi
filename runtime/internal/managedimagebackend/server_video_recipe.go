package managedimagebackend

import "fmt"

const (
	sdStdDefaultRNG     = 0
	sdCUDARNG           = 1
	sdCPURNG            = 2
	sdSampleMethodCount = 21
	sdSchedulerCount    = 17
)

// HyperFlow’s fixed six-step schedule already includes the video flow shift.
func hyperFlowVideoSigmas() [7]float32 {
	return [7]float32{1, 0.982655942, 0.914642572, 0.674755692, 0.385223746, 0.159055337, 0}
}

type videoRecipeTokenConverter func(label, value string, count int32) (int32, bool, error)

func videoParamsBackendSpec(offloadToCPU bool) string {
	if offloadToCPU {
		return "*=cpu"
	}
	return ""
}

func applyVideoContextRecipe(params *sdCtxParams, request VideoModelRequest) error {
	if params == nil {
		return videoError(VideoErrorLoad, fmt.Errorf("managed H3 video context parameters are unavailable"))
	}
	rng, err := videoRNGType(request.RNG)
	if err != nil {
		return err
	}
	params.DiffusionFlashAttention = boolByte(request.DiffusionFlashAttention)
	params.RNGType = rng
	params.SamplerRNGType = rng
	return nil
}

func videoRNGType(value string) (int32, error) {
	switch value {
	case "std_default":
		return sdStdDefaultRNG, nil
	case "cuda":
		return sdCUDARNG, nil
	case "cpu":
		return sdCPURNG, nil
	default:
		return 0, videoError(VideoErrorLoad, fmt.Errorf("managed H3 video RNG is invalid"))
	}
}

func applyVideoGenerateRecipe(params *sdVideoGenParams, model VideoModelRequest, convert videoRecipeTokenConverter) error {
	if params == nil || convert == nil {
		return videoError(VideoErrorInference, fmt.Errorf("managed H3 video generation recipe is unavailable"))
	}
	params.SampleParams.Guidance.TextCFG = float32(model.CFGScale)
	params.SampleParams.FlowShift = float32(model.FlowShift)
	if model.SampleSteps > 0 {
		params.SampleParams.SampleSteps = int32(model.SampleSteps)
	}
	if sample, present, err := convert("sample method", model.SampleMethod, sdSampleMethodCount); err != nil {
		return err
	} else if present {
		params.SampleParams.SampleMethod = sample
	}
	if scheduler, present, err := convert("scheduler", model.Scheduler, sdSchedulerCount); err != nil {
		return err
	} else if present {
		params.SampleParams.Scheduler = scheduler
	}
	return nil
}

func boolByte(value bool) uint8 {
	if value {
		return 1
	}
	return 0
}
