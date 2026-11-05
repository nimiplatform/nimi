package capabilitydriver

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const LFM3Q4ContentID = "sha256:3793e1e6e2266919d6e015287221b41100175a98eddaba92e111aed3b05c93c4"        // pragma: allowlist secret -- public model digest
const LFM3Q4TemplateIdentity = "sha256:f45005c50cd2a97329722bf3a2dee9f16c04cdf825a589b280fb7e99e6827818" // pragma: allowlist secret -- public template digest

func lfm3Q4ContentMatches(contentID, digest string) bool {
	return contentID == LFM3Q4ContentID && digest == strings.TrimPrefix(LFM3Q4ContentID, "sha256:")
}

func lfm3Q4BehaviorAssetMatches(fact TextBehaviorBindingFacts) bool {
	return fact.RequirementID == MainGGUFRequirementID && lfm3Q4ContentMatches(fact.VerifiedContentID, fact.EntrySHA256) && fact.TemplateIdentity == LFM3Q4TemplateIdentity
}

// @nimi-authority: rule.nimi.runtime.local-compute.r031
// LFM3 is a separate hybrid convolution/attention contract. Structural facts
// do not admit NVFP4: the exact content gate also applies to base text, because
// the pinned engine loads that distinct quantization but computes it wrongly.
func lfm3BaseTextModelContract(summary ggufmeta.Summary) bool {
	if summary.Magic != "GGUF" || summary.Version != 3 || summary.TensorCount != 287 || ggufmeta.LLMDetectedArchitecture(summary) != "lfm3" {
		return false
	}
	for key, want := range map[string]uint64{
		"lfm3.block_count": 24, "lfm3.embedding_length": 2048, "lfm3.feed_forward_length": 7680,
		"lfm3.attention.head_count": 16, "lfm3.attention.key_length": 128, "lfm3.attention.value_length": 128,
		"lfm3.attention.sliding_window": 256, "lfm3.shortconv.l_cache": 7, "lfm3.context_length": 262144,
	} {
		if actual, ok := summary.Uint64Value(key); !ok || actual != want {
			return false
		}
	}
	if pre, ok := summary.StringValue("tokenizer.ggml.pre"); !ok || pre != "lfm2" {
		return false
	}
	if identity, ok := ggufmeta.LLMChatTemplateIdentity(summary); !ok || identity != LFM3Q4TemplateIdentity {
		return false
	}
	for name, want := range map[string][]uint64{
		"token_embd.weight": {2048, 128000}, "output_norm.weight": {2048},
		"blk.0.shortconv.conv.weight": {7, 2048}, "blk.23.shortconv.in_proj.weight": {2048, 6144},
		"blk.2.attn_k.weight": {2048, 512}, "blk.2.attn_q.weight": {2048, 2048}, "blk.4.attn_gate.weight": {2048, 16},
	} {
		actual := summary.TensorShapes[name]
		if len(actual) != len(want) {
			return false
		}
		for i, value := range want {
			if actual[i] != value {
				return false
			}
		}
	}
	return true
}
