package capabilitydriver

import (
	"slices"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.hyperflow-h3-local-video
func (driver StableDiffusionVideoDriver) parseConfig(value *structpb.Struct) (stableDiffusionVideoPortableConfig, runtimev1.LocalCapabilityReason) {
	config, reason := parseStableDiffusionVideoPortableConfig(value)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !driver.hyperFlow {
		return config, reason
	}
	if config.recipe.cfgScale != 1 || config.recipe.flowShift != 12 ||
		(config.recipe.sampleMethod != "" && config.recipe.sampleMethod != "euler") || config.recipe.scheduler != "" {
		return stableDiffusionVideoPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	config.recipe.sampleMethod = "euler"
	return config, reason
}

func hyperFlowH3TransformerProbeValid(probe []byte) bool {
	tensors, ok := safetensorsTensorFacts(probe)
	if !ok {
		return false
	}
	for name, shape := range map[string][]int64{
		"hyperflow_gate": {1}, "hyperflow_sigmas": {7},
		"video_patch_proj.weight": {5376, 96}, "audio_patch_proj.weight": {5376, 32},
		"condition_proj.weight": {5376, 5120}, "final_layer.video_out.weight": {96, 5376},
	} {
		if !slices.Equal(tensors[name].Shape, shape) {
			return false
		}
	}
	return true
}

func solH3VAEProbeValid(probe []byte) bool {
	tensors, ok := safetensorsTensorFacts(probe)
	return ok && slices.Equal(tensors["decoder.x_embedder.weight"].Shape, []int64{2048, 24}) &&
		slices.Equal(tensors["decoder.proj_out.weight"].Shape, []int64{3072, 2048}) &&
		slices.Equal(tensors["encoder.conv_out.weight"].Shape, []int64{48, 1024, 3, 3, 3})
}
