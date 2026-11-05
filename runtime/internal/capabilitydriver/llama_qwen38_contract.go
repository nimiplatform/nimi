package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const Qwen38Q4ContentID = "sha256:c600de0300ae8a0eb3a6c0b8b5561b8b96f16bd2c863c2a66c42de29d391a747"            // pragma: allowlist secret -- public model digest
const Qwen38Q4TemplateIdentity = "sha256:c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041"     // pragma: allowlist secret -- public template digest
const Qwen38BF16ProjectorContentID = "sha256:de2a49866988ea272c43dc2a43ee2662c25725a717ca5b9059ea420a97f53fe8" // pragma: allowlist secret -- public model digest

func qwen38Q4BehaviorAssetMatches(fact TextBehaviorBindingFacts) bool {
	return fact.RequirementID == MainGGUFRequirementID && fact.VerifiedContentID == Qwen38Q4ContentID &&
		fact.EntrySHA256 == strings.TrimPrefix(Qwen38Q4ContentID, "sha256:") && fact.TemplateIdentity == Qwen38Q4TemplateIdentity
}

func qwen38VisionPair(main, projector *runtimev1.ModelAssetExactBinding) bool {
	return main != nil && projector != nil && main.GetVerifiedContentId() == Qwen38Q4ContentID && main.GetEntrySha256() == strings.TrimPrefix(Qwen38Q4ContentID, "sha256:") &&
		projector.GetVerifiedContentId() == Qwen38BF16ProjectorContentID && projector.GetEntrySha256() == strings.TrimPrefix(Qwen38BF16ProjectorContentID, "sha256:")
}

func qwen38ProjectorCombinationContract(requirements []*runtimev1.LocalCapabilityRequirement) bool {
	for _, r := range requirements {
		if r.GetCompatibilityConstraints().GetFields()["qwen38_27b_projector_contract"].GetStringValue() == "v1" {
			return true
		}
	}
	return false
}

// @nimi-authority: rule.nimi.runtime.local-compute.r031
func qwen38ProjectorModelContract(summary ggufmeta.Summary) bool {
	if summary.Magic != "GGUF" || summary.Version != 3 || summary.TensorCount != 334 {
		return false
	}
	for key, want := range map[string]string{"general.architecture": "clip", "general.type": "mmproj", "clip.projector_type": "qwen3vl_merger"} {
		if actual, ok := summary.StringValue(key); !ok || actual != want {
			return false
		}
	}
	for key, want := range map[string]uint64{"clip.vision.projection_dim": 5120, "clip.vision.embedding_length": 1152, "clip.vision.image_size": 768, "clip.vision.patch_size": 16, "clip.vision.block_count": 27, "clip.vision.spatial_merge_size": 2} {
		if actual, ok := summary.Uint64Value(key); !ok || actual != want {
			return false
		}
	}
	qkv, projection := summary.TensorShapes["v.blk.0.attn_qkv.weight"], summary.TensorShapes["mm.2.weight"]
	return len(qkv) == 2 && qkv[0] == 1152 && qkv[1] == 3456 && len(projection) == 2 && projection[0] == 4608 && projection[1] == 5120
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r005
// @nimi-authority: rule.nimi.runtime.local-compute.r031
// Qwen3.8's 27B contract is independent from Qwen3.5 4B even though both use
// the qwen35 engine architecture. Optional behaviors require separate exact
// content/template registration; these bounded model facts admit base text.
func qwen38BaseTextModelContract(summary ggufmeta.Summary) bool {
	if summary.Magic != "GGUF" || summary.Version != 3 || ggufmeta.LLMDetectedArchitecture(summary) != "qwen35" {
		return false
	}
	for key, want := range map[string]string{"general.type": "model", "tokenizer.ggml.pre": "qwen35"} {
		if actual, ok := summary.StringValue(key); !ok || actual != want {
			return false
		}
	}
	for key, want := range map[string]uint64{
		"qwen35.block_count": 64, "qwen35.embedding_length": 5120, "qwen35.feed_forward_length": 17408,
		"qwen35.attention.head_count": 24, "qwen35.attention.head_count_kv": 4,
		"qwen35.attention.key_length": 256, "qwen35.attention.value_length": 256,
		"qwen35.full_attention_interval": 4, "qwen35.ssm.state_size": 128, "qwen35.ssm.inner_size": 6144,
	} {
		if actual, ok := summary.Uint64Value(key); !ok || actual != want {
			return false
		}
	}
	if capacity, ok := ggufmeta.LLMContextLength(summary); !ok || capacity == 0 {
		return false
	}
	template, ok := summary.StringValue("tokenizer.chat_template")
	if !ok || !strings.Contains(template, "<|im_start|>") || !strings.Contains(template, "<|im_end|>") || !strings.Contains(template, "<think>") {
		return false
	}
	for name, want := range map[string][]uint64{
		"token_embd.weight": {5120, 248320}, "output_norm.weight": {5120},
		"blk.0.attn_qkv.weight": {5120, 10240}, "blk.0.ssm_a": {48},
		"blk.63.attn_q.weight": {5120, 12288}, "blk.63.ffn_down.weight": {17408, 5120},
	} {
		actual := summary.TensorShapes[name]
		if len(actual) != len(want) {
			return false
		}
		for i, dimension := range want {
			if actual[i] != dimension {
				return false
			}
		}
	}
	return true
}
