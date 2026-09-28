package capabilitydriver

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r005
// @nimi-authority: rule.nimi.runtime.local-compute.r031
// The first qwen35 cohort is a 4B base-text Model Contract. It validates the
// bounded main GGUF header and keeps tools, reasoning presentation, structured
// output, and vision outside this recipe until their exact behavior is accepted.
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
