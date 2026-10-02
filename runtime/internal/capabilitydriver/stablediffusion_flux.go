package capabilitydriver

import (
	"slices"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r064
// These contracts describe the architecture accepted by the pinned sd.cpp
// loader. Names, catalog recommendations and filenames are not model identity.
func stableDiffusionCLIPLRequirement() *runtimev1.LocalCapabilityRequirement {
	return stableDiffusionRequirement(StableDiffusionCLIPLRequirementID,
		runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		"auxiliary", 0, "CLIP-L text encoder", map[string]any{
			"asset_kind": "auxiliary", "artifact_role": "text_encoder",
			"compatible_families": []any{"clip-l"}, "format": "safetensors", "tensor_contract": "clip-l-768",
		})
}

func stableDiffusionCLIPLRequirementValid(requirement *runtimev1.LocalCapabilityRequirement) bool {
	return stableDiffusionRequirementShape(requirement, StableDiffusionCLIPLRequirementID, "auxiliary", 0) &&
		requirement.GetPresence() == runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED &&
		proto.Equal(requirement.GetCompatibilityConstraints(), stableDiffusionCLIPLRequirement().GetCompatibilityConstraints())
}

func stableDiffusionSafetensorsContractFamily(contract string, probe []byte) (string, bool) {
	if contract != "clip-l-768" {
		return stableDiffusionVAETensorContractFamily(contract, probe)
	}
	tensors, ok := safetensorsTensorFacts(probe)
	if !ok {
		return "", false
	}
	for name, shape := range map[string][]int64{
		"text_model.embeddings.token_embedding.weight":         {49408, 768},
		"text_model.embeddings.position_embedding.weight":      {77, 768},
		"text_model.encoder.layers.0.self_attn.q_proj.weight":  {768, 768},
		"text_model.encoder.layers.11.self_attn.q_proj.weight": {768, 768},
		"text_model.final_layer_norm.weight":                   {768},
	} {
		fact, exists := tensors[name]
		if !exists || !slices.Equal(fact.Shape, shape) || (fact.DType != "F16" && fact.DType != "F32" && fact.DType != "BF16") {
			return "", false
		}
	}
	if _, exists := tensors["text_model.encoder.layers.12.self_attn.q_proj.weight"]; exists {
		return "", false
	}
	return "clip-l", true
}

func stableDiffusionGGUFTensorContractValid(contract string, summary ggufmeta.Summary) bool {
	switch contract {
	case "flux1-schnell":
		if ggufmeta.LLMDetectedArchitecture(summary) != "flux" {
			return false
		}
		for _, name := range summary.TensorNames {
			if strings.HasPrefix(name, "guidance_in.") {
				return false
			}
		}
		for name, shape := range map[string][]uint64{
			"img_in.weight": {64, 3072}, "txt_in.weight": {4096, 3072},
			"vector_in.in_layer.weight":             {768, 3072},
			"double_blocks.18.img_attn.proj.weight": {3072, 3072},
			"single_blocks.37.linear1.weight":       {3072, 21504},
			"final_layer.linear.weight":             {3072, 64},
		} {
			if !slices.Equal(summary.TensorShapes[name], shape) {
				return false
			}
		}
		return true
	case "t5-v1_1-xxl-encoder":
		if ggufmeta.LLMDetectedArchitecture(summary) != "t5encoder" {
			return false
		}
		for name, shape := range map[string][]uint64{
			"token_embd.weight": {4096, 32128}, "enc.blk.0.attn_q.weight": {4096, 4096},
			"enc.blk.23.ffn_up.weight": {4096, 10240}, "enc.output_norm.weight": {4096},
		} {
			if !slices.Equal(summary.TensorShapes[name], shape) {
				return false
			}
		}
		for key, expected := range map[string]uint64{
			"t5encoder.embedding_length": 4096, "t5encoder.feed_forward_length": 10240,
			"t5encoder.block_count": 24, "t5encoder.attention.head_count": 64,
		} {
			found := false
			for _, entry := range summary.Entries {
				if entry.Key == key {
					if found || !entry.HasUint64Value || entry.Uint64Value != expected {
						return false
					}
					found = true
				}
			}
			if !found {
				return false
			}
		}
		return true
	default:
		return false
	}
}
