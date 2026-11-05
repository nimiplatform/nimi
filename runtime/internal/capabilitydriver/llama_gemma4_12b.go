package capabilitydriver

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const (
	Gemma412BQ4ContentID        = "sha256:93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b" // pragma: allowlist secret -- public model digest
	Gemma412BProjectorContentID = "sha256:cb018338a7538a9814d994bfe54644c71eb7ed54e31eae2f721e45fd3c260da7" // pragma: allowlist secret -- public projector digest
	Gemma412BTemplateIdentity   = "sha256:ae53464bf3be25802b3a5b37def7fd89667067d7577049b3b2d74c4d8de4c6d4" // pragma: allowlist secret -- public template digest
)

func gemma412BBehaviorAssetMatches(fact TextBehaviorBindingFacts) bool {
	return fact.RequirementID == MainGGUFRequirementID && fact.VerifiedContentID == Gemma412BQ4ContentID &&
		fact.EntrySHA256 == strings.TrimPrefix(Gemma412BQ4ContentID, "sha256:") && fact.TemplateIdentity == Gemma412BTemplateIdentity
}

func gemma412BExactBindingMatches(input ModelAssetBindingInput, template string) bool {
	want := Gemma412BQ4ContentID
	if input.Requirement.GetRequirementId() == CompanionMMProjRequirementID {
		want = Gemma412BProjectorContentID
	} else if template != Gemma412BTemplateIdentity {
		return false
	}
	return input.Binding.GetVerifiedContentId() == want && input.Binding.GetEntrySha256() == strings.TrimPrefix(want, "sha256:")
}

// @nimi-authority: rule.nimi.runtime.local-compute.gemma4-unified-inputs
// Unified 12B has no per-layer embeddings or separate transformer encoders.
// Its exact content/template and projector are independent of E2B and 26B.
func gemma412BModelContract(summary ggufmeta.Summary, projector bool) bool {
	if summary.Magic != "GGUF" || summary.Version != 3 {
		return false
	}
	metadata := map[string]uint64{
		"gemma4.block_count": 48, "gemma4.context_length": 262144, "gemma4.embedding_length": 3840,
		"gemma4.feed_forward_length": 15360, "gemma4.attention.head_count": 16,
		"gemma4.attention.key_length": 512, "gemma4.attention.value_length": 512,
		"gemma4.attention.sliding_window": 1024, "gemma4.embedding_length_per_layer_input": 0,
	}
	shapes := map[string][]uint64{
		"token_embd.weight": {3840, 262144}, "output_norm.weight": {3840},
		"blk.0.attn_q.weight": {3840, 4096}, "blk.0.attn_k.weight": {3840, 2048},
		"blk.47.attn_q.weight": {3840, 8192}, "blk.47.attn_k.weight": {3840, 512},
		"blk.47.ffn_down.weight": {15360, 3840},
	}
	if projector {
		if summary.TensorCount != 11 || ggufmeta.LLMDetectedArchitecture(summary) != "clip" {
			return false
		}
		for key, want := range map[string]string{"clip.vision.projector_type": "gemma4uv", "clip.audio.projector_type": "gemma4ua"} {
			if actual, ok := summary.StringValue(key); !ok || actual != want {
				return false
			}
		}
		metadata = map[string]uint64{"clip.vision.projection_dim": 3840, "clip.vision.block_count": 0, "clip.audio.projection_dim": 3840, "clip.audio.embedding_length": 640, "clip.audio.num_mel_bins": 128}
		shapes = map[string][]uint64{"mm.a.input_projection.weight": {640, 3840}, "mm.input_projection.weight": {3840, 3840}, "v.patch_embd.weight": {6912, 3840}, "v.position_embd.weight": {3840, 1120, 2}}
	} else {
		if summary.TensorCount != 667 || ggufmeta.LLMDetectedArchitecture(summary) != "gemma4" {
			return false
		}
		if identity, ok := ggufmeta.LLMChatTemplateIdentity(summary); !ok || identity != Gemma412BTemplateIdentity {
			return false
		}
	}
	for key, want := range metadata {
		if actual, ok := summary.Uint64Value(key); !ok || actual != want {
			return false
		}
	}
	for name, want := range shapes {
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

func gemma412BFeatures(features []string) ([]string, runtimev1.LocalCapabilityReason) {
	set := map[string]struct{}{}
	for _, feature := range features {
		if feature != "input.image" && feature != "input.audio" && feature != "input.video" {
			return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
		}
		set[feature] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for feature := range set {
		result = append(result, feature)
	}
	sort.Strings(result)
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
