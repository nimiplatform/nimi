package capabilitydriver

import (
	"slices"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.minimax-h3-local-image
func stableDiffusionMiniMaxH3SafetensorsFamily(contract string, probe []byte) (string, bool) {
	tensors, ok := safetensorsTensorFacts(probe)
	if !ok {
		return "", false
	}
	if contract == "minimax-h3-image-vae" {
		if slices.Equal(tensors["decoder.x_embedder.weight"].Shape, []int64{1024, 24}) &&
			slices.Equal(tensors["decoder.proj_out.weight"].Shape, []int64{768, 1024}) &&
			slices.Equal(tensors["encoder.conv_out.weight"].Shape, []int64{48, 1024, 3, 3, 3}) {
			return "minimax-h3-image-vae", true
		}
		return "", false
	}
	for name, shape := range map[string][]int64{
		"condition_proj.weight":          {5376, 5120},
		"video_patch_proj.weight":        {5376, 96},
		"blocks.0.attn.qkv_proj.weight":  {21504, 5376},
		"blocks.49.attn.qkv_proj.weight": {21504, 5376},
		"final_layer.video_out.weight":   {576, 5376},
	} {
		if !slices.Equal(tensors[name].Shape, shape) {
			return "", false
		}
	}
	if _, hasAudio := tensors["audio_patch_proj.weight"]; hasAudio {
		return "", false
	}
	switch tensors["blocks.0.attn.qkv_proj.weight"].DType {
	case "BF16", "F16":
	case "I8":
		if !slices.Equal(tensors["blocks.0.attn.qkv_proj.weight_scale"].Shape, []int64{21504, 1}) ||
			!slices.Equal(tensors["blocks.0.attn.qkv_proj.comfy_quant"].Shape, []int64{72}) {
			return "", false
		}
	default:
		return "", false
	}
	return StableDiffusionMiniMaxH3ImageRecipeID, true
}

func stableDiffusionMiniMaxH3EncoderValid(summary ggufmeta.Summary) bool {
	// The combined checkpoint uses native tensor names and has no architecture
	// metadata. The last language layer and DeepStack projections identify it.
	for name, shape := range map[string][]uint64{
		"model.embed_tokens.weight":                        {5120, 151936},
		"model.layers.0.self_attn.q_proj.weight":           {5120, 8192},
		"model.layers.49.mlp.up_proj.weight":               {5120, 25600},
		"visual.deepstack_merger_list.0.linear_fc2.weight": {4608, 5120},
		"visual.deepstack_merger_list.1.linear_fc2.weight": {4608, 5120},
		"visual.deepstack_merger_list.2.linear_fc2.weight": {4608, 5120},
	} {
		if !slices.Equal(summary.TensorShapes[name], shape) {
			return false
		}
	}
	for _, name := range summary.TensorNames {
		if strings.HasPrefix(name, "model.layers.50.") || name == "model.norm.weight" {
			return false
		}
	}
	return true
}
