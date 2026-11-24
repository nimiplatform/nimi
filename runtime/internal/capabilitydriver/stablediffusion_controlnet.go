package capabilitydriver

import "slices"

// @nimi-authority: rule.nimi.runtime.ai-provider.sdxl-controlnet-union
func sdxlControlNetTensorContract(contract string, probe []byte) bool {
	tensors, ok := safetensorsTensorFacts(probe)
	if !ok {
		return false
	}
	return matchesSDXLTensors(contract, tensors)
}

func matchesSDXLTensors(contract string, tensors map[string]safetensorsTensorFact) bool {
	var expected map[string][]int64
	switch contract {
	case "sdxl-base-checkpoint":
		expected = map[string][]int64{
			"model.diffusion_model.input_blocks.0.0.weight":                                    {320, 4, 3, 3},
			"conditioner.embedders.0.transformer.text_model.embeddings.token_embedding.weight": {49408, 768},
			"conditioner.embedders.1.model.token_embedding.weight":                             {49408, 1280},
			"first_stage_model.decoder.conv_in.weight":                                         {512, 4, 3, 3},
		}
	case "sdxl-controlnet-union-promax":
		expected = map[string][]int64{
			"task_embedding": {8, 320},
			"controlnet_cond_embedding.conv_in.weight": {16, 3, 3, 3},
			"controlnet_down_blocks.0.weight":          {320, 320, 1, 1},
		}
	default:
		return false
	}
	return matchTensorShapes(tensors, expected)
}

func validSDXLControlType(value string) bool {
	return slices.Contains([]string{"openpose", "depth", "scribble", "canny", "normal", "segment", "tile", "repaint"}, value)
}
