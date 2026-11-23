package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// Verified chat-template identities and tokenizer protocol contracts for Tier 1
// local llama.cpp/text-generate/v3 Text Behavior adapters. Matching proves the
// effective chat template, architecture family, and tokenizer BOS/EOS +
// control/user-defined special tokens actually consumed by pinned llama.cpp
// b12648 without per-sample weight SHA-256 whitelists.
// @nimi-authority: rule.nimi.runtime.local-compute.r112
// @nimi-authority: rule.nimi.runtime.ai-provider.r120
const (
	Gemma4E2BTemplateIdentity = "sha256:33204f1acb5bd0002713e16a593847f24ceeafe711ed88bda2a352dc996a3373" // pragma: allowlist secret -- public template digest
	Gemma426BTemplateIdentity = "sha256:94899c0f917d93f6fe81c95744d1e8ddab2d21d39228d2e4aec1fb2a25bff413" // pragma: allowlist secret -- public template digest
	Gemma412BTemplateIdentity = "sha256:ae53464bf3be25802b3a5b37def7fd89667067d7577049b3b2d74c4d8de4c6d4" // pragma: allowlist secret -- public template digest
	Qwen35Q4TemplateIdentity  = "sha256:7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67" // pragma: allowlist secret -- public template digest
	Qwen38Q4TemplateIdentity  = "sha256:c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041" // pragma: allowlist secret -- public template digest
	LFM3Q4TemplateIdentity    = "sha256:f45005c50cd2a97329722bf3a2dee9f16c04cdf825a589b280fb7e99e6827818" // pragma: allowlist secret -- public template digest

	LlamaTokenizerProtocolGemma4     = "gemma4.v1"
	LlamaTokenizerProtocolQwen3Coder = "qwen3-coder.v1"
	LlamaTokenizerProtocolLFM3       = "lfm3.v1"
)

type llamaTokenizerProtocolSpec struct {
	requiredBOS      string
	requiredEOS      string
	requiredSpecials []string
}

var llamaTokenizerProtocolSpecs = map[string]llamaTokenizerProtocolSpec{
	LlamaTokenizerProtocolGemma4: {
		requiredBOS: "<bos>",
		requiredSpecials: []string{
			"<|\"|>",
			"<|channel>",
			"<channel|>",
			"<|tool_call>",
			"<tool_call|>",
			"<|turn>",
			"<turn|>",
		},
	},
	LlamaTokenizerProtocolQwen3Coder: {
		requiredEOS: "<|im_end|>",
		requiredSpecials: []string{
			"</think>",
			"</tool_call>",
			"<|im_end|>",
			"<|im_start|>",
			"<think>",
			"<tool_call>",
		},
	},
	LlamaTokenizerProtocolLFM3: {
		requiredBOS: "<|startoftext|>",
		requiredEOS: "<|im_end|>",
		requiredSpecials: []string{
			"</think>",
			"<|im_end|>",
			"<|im_start|>",
			"<|tool_call_end|>",
			"<|tool_call_start|>",
			"<|tool_list_end|>",
			"<|tool_list_start|>",
			"<think>",
		},
	},
}

// LlamaTokenizerProtocolKnown reports whether protocol names a verified Tier 1
// tokenizer protocol contract.
func LlamaTokenizerProtocolKnown(protocol string) bool {
	_, ok := llamaTokenizerProtocolSpecs[strings.TrimSpace(protocol)]
	return ok
}

// LlamaTokenizerProtocolSatisfied reports whether observed GGUF tokenizer facts
// supply every BOS/EOS and control/user-defined special token consumed by the
// named pinned llama.cpp b12648 chat/PEG parser protocol.
func LlamaTokenizerProtocolSatisfied(facts LlamaTokenizerFacts, protocol string) bool {
	spec, ok := llamaTokenizerProtocolSpecs[strings.TrimSpace(protocol)]
	if !ok {
		return false
	}
	if spec.requiredBOS != "" && facts.BOSToken != spec.requiredBOS {
		return false
	}
	if spec.requiredEOS != "" && facts.EOSToken != spec.requiredEOS {
		return false
	}
	if len(spec.requiredSpecials) == 0 {
		return true
	}
	present := make(map[string]struct{}, len(facts.SpecialTokens))
	for _, token := range facts.SpecialTokens {
		present[token] = struct{}{}
	}
	for _, required := range spec.requiredSpecials {
		if _, found := present[required]; !found {
			return false
		}
	}
	return true
}

// LlamaTokenizerFactsForProtocol returns canonical tokenizer facts satisfying
// protocol for deterministic test fixtures.
func LlamaTokenizerFactsForProtocol(protocol string) LlamaTokenizerFacts {
	spec, ok := llamaTokenizerProtocolSpecs[strings.TrimSpace(protocol)]
	if !ok {
		return LlamaTokenizerFacts{}
	}
	specials := append([]string(nil), spec.requiredSpecials...)
	sort.Strings(specials)
	return LlamaTokenizerFacts{
		BOSToken:      spec.requiredBOS,
		EOSToken:      spec.requiredEOS,
		SpecialTokens: specials,
	}
}

// KnownLlamaTemplateCohort pairs a verified effective chat-template digest with
// the exact llama.cpp architecture family(ies) and tokenizer protocol contract
// for which that Tier 1 behavior was verified.
type KnownLlamaTemplateCohort struct {
	TemplateIdentity  string
	Architectures     []string
	TokenizerProtocol string
}

// KnownStandardLlamaTemplateCohorts returns the complete Tier 1 cohort table
// for LlamaGenericGGUFRecipeID so Tier 1 and Tier 2 remain strictly mutually
// exclusive on (TemplateIdentity, Architecture, TokenizerFacts) and never
// produce AMBIGUOUS.
func KnownStandardLlamaTemplateCohorts() []KnownLlamaTemplateCohort {
	return []KnownLlamaTemplateCohort{
		{TemplateIdentity: Gemma4E2BTemplateIdentity, Architectures: []string{"gemma4"}, TokenizerProtocol: LlamaTokenizerProtocolGemma4},
		{TemplateIdentity: Gemma426BTemplateIdentity, Architectures: []string{"gemma4"}, TokenizerProtocol: LlamaTokenizerProtocolGemma4},
		{TemplateIdentity: Qwen35Q4TemplateIdentity, Architectures: []string{"qwen35", "qwen35moe"}, TokenizerProtocol: LlamaTokenizerProtocolQwen3Coder},
		{TemplateIdentity: Qwen38Q4TemplateIdentity, Architectures: []string{"qwen35", "qwen35moe"}, TokenizerProtocol: LlamaTokenizerProtocolQwen3Coder},
		{TemplateIdentity: LFM3Q4TemplateIdentity, Architectures: []string{"lfm3"}, TokenizerProtocol: LlamaTokenizerProtocolLFM3},
	}
}

// KnownLlamaTemplateCohortMatches reports whether (templateID, architecture,
// tokenizer) satisfies the exact Tier 1 cohort contract.
func KnownLlamaTemplateCohortMatches(cohort KnownLlamaTemplateCohort, templateID, architecture string, tokenizer LlamaTokenizerFacts) bool {
	if cohort.TemplateIdentity == "" || templateID != cohort.TemplateIdentity {
		return false
	}
	if len(cohort.Architectures) > 0 && !contains(cohort.Architectures, architecture) {
		return false
	}
	if cohort.TokenizerProtocol != "" && !LlamaTokenizerProtocolSatisfied(tokenizer, cohort.TokenizerProtocol) {
		return false
	}
	return true
}

// KnownLlamaTemplateCohortAllowed reports whether (recipeID, templateID,
// architecture, tokenizer) belongs to an exact verified Tier 1 Text Behavior
// cohort. Missing tokenizer evidence degrades cleanly to Tier 2.
func KnownLlamaTemplateCohortAllowed(recipeID, templateID, architecture string, tokenizer LlamaTokenizerFacts) bool {
	recipeID = strings.TrimSpace(recipeID)
	templateID = strings.TrimSpace(templateID)
	architecture = strings.TrimSpace(architecture)
	if templateID == "" || architecture == "" {
		return false
	}
	if recipeID == LlamaGemma412BRecipeID {
		return KnownLlamaTemplateCohortMatches(KnownLlamaTemplateCohort{
			TemplateIdentity:  Gemma412BTemplateIdentity,
			Architectures:     []string{"gemma4"},
			TokenizerProtocol: LlamaTokenizerProtocolGemma4,
		}, templateID, architecture, tokenizer)
	}
	if recipeID != LlamaGenericGGUFRecipeID {
		return false
	}
	for _, cohort := range KnownStandardLlamaTemplateCohorts() {
		if KnownLlamaTemplateCohortMatches(cohort, templateID, architecture, tokenizer) {
			return true
		}
	}
	return false
}

// llamaSupportedTextArchitectures lists generative LLM architectures registered
// in pinned llama.cpp b12648 (src/llama-arch.cpp LLM_ARCH_NAMES). Non-generative
// encoder, embedding, projector, audio/TTS, speculative-draft, OCR, and diffusion
// architectures (clip, *bert*, *embedding*, llama-embed, pangu-embedded, t5*,
// wavtokenizer-dec, qwen3tts, pockettts, moshi, zonos3, kokoro, tiny-voca,
// eagle3, dflash, gemma4-assistant, dream, llada*, rnd1, vllm-decision2,
// paddleocr, deepseek2-ocr) are intentionally excluded; generative-architecture
// embedding models (such as qwen3 with pooling_type > 0) are rejected separately
// via pooling_type checks.
var llamaSupportedTextArchitectures = []string{
	"afmoe",
	"apertus",
	"arcee",
	"arctic",
	"arwkv7",
	"baichuan",
	"bailingmoe",
	"bailingmoe2",
	"bailingmoe3",
	"beam",
	"bitnet",
	"bloom",
	"chameleon",
	"chatglm",
	"clef",
	"clover_moe",
	"codeshell",
	"cogvlm",
	"cohere2",
	"cohere2moe",
	"command-r",
	"dbrx",
	"deci",
	"deepseek",
	"deepseek2",
	"deepseek32",
	"deepseek4",
	"deepseek41",
	"domynedge",
	"dots1",
	"dots3note",
	"ernie4_5",
	"ernie4_5-moe",
	"exaone",
	"exaone-moe",
	"exaone4",
	"falcon",
	"falcon-h1",
	"flint",
	"gemma",
	"gemma2",
	"gemma3",
	"gemma3n",
	"gemma4",
	"glm-dsa",
	"glm4",
	"glm4moe",
	"glm5-next",
	"gpt-oss",
	"gpt2",
	"gptj",
	"gptneox",
	"granite",
	"granite_swa",
	"granitehybrid",
	"granitemoe",
	"graniteswitch",
	"grok",
	"grovemoe",
	"hrm_text",
	"hunyuan-dense",
	"hunyuan-moe",
	"hunyuan_vl",
	"hy_v3",
	"hy_v4",
	"inkling2",
	"inkling2_loop",
	"internlm2",
	"jais",
	"jais2",
	"jamba",
	"k2-horizon",
	"kimi-k3",
	"kimi-k31",
	"kimi-linear",
	"kolibri1",
	"laguna",
	"lfm2",
	"lfm2moe",
	"lfm3",
	"limite",
	"llama",
	"llama4",
	"maincoder",
	"maion-coder",
	"mamba",
	"mamba2",
	"maple",
	"mellum",
	"metis16",
	"mimo2",
	"minicpm",
	"minicpm3",
	"minimax-01",
	"minimax-m2",
	"minimax-m3",
	"mistral-large4",
	"mistral3",
	"mistral4",
	"mpt",
	"muse-glimmer",
	"muse-spark",
	"nanbeige",
	"nemotron",
	"nemotron_h",
	"nemotron_h_moe",
	"olmo",
	"olmo2",
	"olmoe",
	"openelm",
	"orion",
	"phi2",
	"phi3",
	"phimoe",
	"plamo",
	"plamo2",
	"plamo3",
	"plm",
	"qwen",
	"qwen2",
	"qwen2moe",
	"qwen2vl",
	"qwen3",
	"qwen35",
	"qwen35moe",
	"qwen3moe",
	"qwen3next",
	"qwen3vl",
	"qwen3vlmoe",
	"qwen4exp",
	"refact",
	"ricursive",
	"rwkv6",
	"rwkv6qwen2",
	"rwkv7",
	"seed_oss",
	"sensenova_u1",
	"smallthinker",
	"smollm3",
	"spark2_5",
	"stablelm",
	"starcoder",
	"starcoder2",
	"step35",
	"talkie",
	"xing4_0",
	"xverse",
	"zaya1",
}

func Qwen35ToolUseCapabilityProjection() *runtimev1.ToolUseCapabilityProjection {
	return &runtimev1.ToolUseCapabilityProjection{
		SupportedToolSpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
		SupportedToolChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO},
		SupportsSingleCall:       true, SupportsSync: true, SupportsToolOnlyResponse: true,
		SupportsToolResultRoundTrip: true,
	}
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

// llamaAdmittedVisionProjectorType reports whether projType belongs to the
// verified set of vision projector families admitted for both single-slot
// projection and main-model combination validation in LlamaGenericGGUFRecipeID.
func llamaAdmittedVisionProjectorType(projType string) bool {
	switch strings.TrimSpace(projType) {
	case "gemma4uv", "gemma4v", "gemma3", "inkling2v", "qwen3vl_merger", "qwen2vl_merger", "qwen2.5vl_merger":
		return true
	default:
		return false
	}
}

// llamaProjectorCompatibleWithMain validates structural compatibility between a
// bound main LLM GGUF and a bound clip mmproj GGUF without coupling them by
// per-sample weight SHA-256. Only verified vision projector families with
// positive matching interface widths (accounting for n_deepstack_layers in
// b12648 llama_hparams::n_embd_inp and mtmd_model::n_mmproj_embd) are admitted;
// unproven projector families fail closed so Loadouts never project unverified
// input.image as CONFIGURED.
func llamaProjectorCompatibleWithMain(mainFacts, projFacts llamaGGUFProbe, unified bool) bool {
	if projFacts.Architecture != "clip" {
		return false
	}
	mainArch := strings.TrimSpace(mainFacts.Architecture)
	projType := strings.TrimSpace(projFacts.ProjectorType)
	audioType := strings.TrimSpace(projFacts.AudioProjectorType)
	if mainFacts.EmbeddingLength == 0 || projFacts.VisionProjectionDim == 0 {
		return false
	}
	mainInputWidth := mainFacts.EmbeddingLength
	if mainFacts.DeepstackLayers > 0 {
		if mainFacts.DeepstackLayers > math.MaxUint64/mainFacts.EmbeddingLength-1 {
			return false
		}
		mainInputWidth = mainFacts.EmbeddingLength * (1 + mainFacts.DeepstackLayers)
	}
	if unified {
		if mainArch != "gemma4" || projType != "gemma4uv" || audioType != "gemma4ua" {
			return false
		}
		if projFacts.AudioProjectionDim == 0 {
			return false
		}
		return projFacts.VisionProjectionDim == mainFacts.EmbeddingLength &&
			projFacts.AudioProjectionDim == mainFacts.EmbeddingLength
	}
	if audioType == "gemma4ua" || projType == "gemma4uv" {
		return mainArch == "gemma4" && projFacts.VisionProjectionDim == mainFacts.EmbeddingLength
	}
	switch projType {
	case "inkling2v":
		return (mainArch == "inkling2_loop" || mainArch == "inkling2") &&
			projFacts.VisionProjectionDim == mainFacts.EmbeddingLength
	case "gemma4v":
		return mainArch == "gemma4" && projFacts.VisionProjectionDim == mainFacts.EmbeddingLength
	case "gemma3":
		return (mainArch == "gemma3" || mainArch == "gemma3n") &&
			projFacts.VisionProjectionDim == mainFacts.EmbeddingLength
	case "qwen3vl_merger":
		if !contains([]string{"qwen35", "qwen35moe", "qwen3", "qwen3moe", "qwen3vl", "qwen3vlmoe"}, mainArch) {
			return false
		}
		if projFacts.ProjectorMergerWidth == 0 {
			return false
		}
		if projFacts.ProjectorDeepstackLayers > math.MaxUint64/projFacts.ProjectorMergerWidth-1 {
			return false
		}
		projOutputWidth := projFacts.ProjectorMergerWidth * (1 + projFacts.ProjectorDeepstackLayers)
		return projOutputWidth == mainInputWidth
	case "qwen2vl_merger", "qwen2.5vl_merger":
		return contains([]string{"qwen2", "qwen2vl", "qwen2moe"}, mainArch) &&
			projFacts.VisionProjectionDim == mainFacts.EmbeddingLength
	default:
		return false
	}
}

// LlamaStructuredOutputRequestSerializer serializes Tier 2 unknown-template
// Structured Output requests (json_object / json_schema) for pinned llama.cpp
// without injecting template-specific chat_template_kwargs. Tool Use, Reasoning,
// explicit DISABLED reasoning, and ordered system messages are rejected closed.
// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// @nimi-authority: rule.nimi.runtime.ai-provider.r120
// @nimi-authority: rule.nimi.runtime.ai-provider.r123
func LlamaStructuredOutputRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, fmt.Errorf("llama structured output request is missing")
	}
	if len(spec.GetTools()) > 0 || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED ||
		strings.TrimSpace(spec.GetToolChoiceName()) != "" || textbehavior.RequiresOrderedSystemMessages(spec) {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if reasoning := spec.GetReasoning(); reasoning != nil &&
		reasoning.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	format := spec.GetResponseFormat()
	if format == nil || (format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT &&
		format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA) {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	messages, err := gemma4BehaviorMessages(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"model": "nimi-selected-local", "messages": messages, "stream": stream}
	if stream {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	gemma4ApplySampling(body, spec)
	if err := gemma4ApplyResponseFormat(body, spec); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, fmt.Errorf("encode llama structured output request: %w", err)
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, nil
}
