package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const (
	Qwen35Q4ContentID        = "sha256:00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4" // pragma: allowlist secret -- public model digest
	Qwen35Q4EntrySHA256      = "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4"        // pragma: allowlist secret -- public model digest
	Qwen35Q4TemplateIdentity = "sha256:7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67" // pragma: allowlist secret -- public template digest
)

func qwen35Q4BehaviorAssetMatches(fact TextBehaviorBindingFacts) bool {
	return fact.RequirementID == MainGGUFRequirementID && fact.VerifiedContentID == Qwen35Q4ContentID &&
		fact.EntrySHA256 == Qwen35Q4EntrySHA256 && fact.TemplateIdentity == Qwen35Q4TemplateIdentity
}

func Qwen35ToolUseCapabilityProjection() *runtimev1.ToolUseCapabilityProjection {
	return &runtimev1.ToolUseCapabilityProjection{
		SupportedToolSpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
		SupportedToolChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO},
		SupportsSingleCall:       true, SupportsSync: true, SupportsToolOnlyResponse: true,
		SupportsToolResultRoundTrip: true,
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r005
// @nimi-authority: rule.nimi.runtime.local-compute.r031
// The qwen35 4B Model Contract validates the bounded main GGUF header. Optional
// behavior stays unavailable without an exact verified-content/template adapter.
func qwen35BaseTextModelContract(summary ggufmeta.Summary) bool {
	if summary.Magic != "GGUF" || summary.Version != 3 || ggufmeta.LLMDetectedArchitecture(summary) != "qwen35" {
		return false
	}
	if kind, ok := summary.StringValue("general.type"); !ok || kind != "model" {
		return false
	}
	if tokenizer, ok := summary.StringValue("tokenizer.ggml.pre"); !ok || tokenizer != "qwen35" {
		return false
	}
	for key, want := range map[string]uint64{
		"qwen35.block_count":             32,
		"qwen35.embedding_length":        2560,
		"qwen35.full_attention_interval": 4,
		"qwen35.ssm.state_size":          128,
		"qwen35.ssm.inner_size":          4096,
	} {
		if actual, ok := summary.Uint64Value(key); !ok || actual != want {
			return false
		}
	}
	if contextLength, ok := ggufmeta.LLMContextLength(summary); !ok || contextLength == 0 {
		return false
	}
	template, ok := summary.StringValue("tokenizer.chat_template")
	if !ok || !strings.Contains(template, "<|im_start|>") || !strings.Contains(template, "<|im_end|>") || !strings.Contains(template, "<think>") {
		return false
	}
	available := make(map[string]struct{}, len(summary.TensorNames))
	for _, name := range summary.TensorNames {
		available[name] = struct{}{}
	}
	for _, required := range []string{
		"token_embd.weight", "output_norm.weight", "blk.0.attn_qkv.weight",
		"blk.0.ssm_a", "blk.31.attn_q.weight", "blk.31.ffn_down.weight",
	} {
		if _, ok := available[required]; !ok {
			return false
		}
	}
	return true
}
