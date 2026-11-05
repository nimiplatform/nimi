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

// @nimi-authority: rule.nimi.runtime.ai-provider.flux3-local-image
func stableDiffusionGGUFTensorContractValid(contract string, summary ggufmeta.Summary) bool {
	switch contract {
	case "flux3-klein":
		// This GGUF has no general.architecture metadata. The distilled flow-map
		// tensors and exact encoder/latent dimensions establish the model contract.
		for name, shape := range map[string][]uint64{
			"emb_in.image.weight": {128, 3072}, "emb_in.image_cond.weight": {128, 3072}, "txt_in.weight": {20480, 3072},
			"ref_time_in.in_layer.weight": {256, 3072}, "content_mode_blocks.image.4.q_proj.weight": {3072, 3072},
			"content_mode_blocks.image_cond.4.q_proj.weight": {3072, 3072}, "txt_mode_blocks.4.q_proj.weight": {3072, 3072},
			"single_blocks.0.mlp_in.weight": {3072, 18432}, "single_blocks.27.mlp_out.weight": {9216, 3072}, "final_layer.image.linear.weight": {3072, 128},
		} {
			if !slices.Equal(summary.TensorShapes[name], shape) {
				return false
			}
		}
		for _, prefix := range []string{"content_mode_blocks.image.5.", "content_mode_blocks.image_cond.5.", "txt_mode_blocks.5.", "single_blocks.28."} {
			for _, name := range summary.TensorNames {
				if strings.HasPrefix(name, prefix) {
					return false
				}
			}
		}
		return true
	case "qwen3-vl-4b-encoder":
		if ggufmeta.LLMDetectedArchitecture(summary) != "qwen3vl" {
			return false
		}
		for name, shape := range map[string][]uint64{"token_embd.weight": {2560, 151936}, "output_norm.weight": {2560}, "blk.0.attn_q.weight": {2560, 4096}, "blk.35.attn_output.weight": {4096, 2560}, "blk.35.ffn_up.weight": {2560, 9728}} {
			if !slices.Equal(summary.TensorShapes[name], shape) {
				return false
			}
		}

		for key, want := range map[string]uint64{"qwen3vl.embedding_length": 2560, "qwen3vl.block_count": 36, "qwen3vl.feed_forward_length": 9728, "qwen3vl.attention.head_count": 32, "qwen3vl.attention.head_count_kv": 8} {
			found := false
			for _, entry := range summary.Entries {
				if entry.Key == key {
					if found || !entry.HasUint64Value || entry.Uint64Value != want {
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
