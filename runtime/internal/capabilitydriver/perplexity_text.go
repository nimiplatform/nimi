package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// PerplexityTextModels is the reviewed Agent API cohort, not a remote inventory.
func PerplexityTextModels() []string {
	return []string{
		"anthropic/claude-fable-5-1", "anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5",
		"openai/gpt-6.1-sol", "openai/gpt-6-astra", "openai/gpt-6-sol", "openai/gpt-6-luna",
		"google/gemini-4-argon", "google/gemini-3.8-flash", "xai/grok-4.7", "xai/grok-4.6",
		"perplexity/glm-5.3", "perplexity/glm-5.3-flash", "perplexity/deepseek-v4-pro-0813", "perplexity/kimi-k3", "perplexity/nemotron-3.5-super-120b-a12b",
	}
}

type PerplexityTextBehavior struct {
	model   string
	profile responsesProfile
}

func NewPerplexityTextBehavior(model string) (PerplexityTextBehavior, error) {
	for _, reviewed := range PerplexityTextModels() {
		if model == reviewed {
			return PerplexityTextBehavior{model: model, profile: responsesProfile{
				label: "Perplexity Agent API", outputLimit: true, namedToolChoice: true,
				strictToolSchemas: true, orderedSystemInput: true, schemaMapper: perplexitySchema, failure: OpenAIResponsesFailure,
			}}, nil
		}
	}
	return PerplexityTextBehavior{}, deepseekUnsupported()
}

func perplexitySchema(schema map[string]any) (map[string]any, error) {
	profile := responsesProfile{label: "Perplexity Agent API"}
	if err := validateResponsesStructuredSchema(&profile, schema, true); err != nil {
		return nil, err
	}
	return schema, nil
}

func (p PerplexityTextBehavior) ContinuityKind() string {
	return "perplexity.agent.function." + p.model
}

func (p PerplexityTextBehavior) Vision() bool {
	return !strings.HasPrefix(p.model, "perplexity/") || p.model == "perplexity/kimi-k3"
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// @nimi-authority: rule.nimi.runtime.ai-provider.r119
func (p PerplexityTextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, false)
}

func (p PerplexityTextBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, planning bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, p.profile.inputError("missing request")
	}
	if strings.HasPrefix(p.model, "anthropic/") && spec.MaxTokens == nil {
		return textbehavior.SerializedRequest{}, p.profile.unsupported("Anthropic targets require an explicit output token limit")
	}
	if p.model == "perplexity/nemotron-3.5-super-120b-a12b" && spec.GetMaxTokens() > 131072 {
		return textbehavior.SerializedRequest{}, p.profile.unsupported("Nemotron output token limit")
	}
	reasoning, err := p.reasoning(spec.GetReasoning())
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	cloned := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	cloned.Reasoning = nil
	replay := map[string]perplexityFunctionReplay{}
	for _, message := range cloned.Input {
		if message == nil {
			return textbehavior.SerializedRequest{}, p.profile.inputError("nil message")
		}
		for i, part := range message.GetParts() {
			if planning && p.Vision() && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				mime := part.GetArtifactRef().GetMimeType()
				if mime != "image/png" && mime != "image/jpeg" {
					return textbehavior.SerializedRequest{}, p.profile.unsupported("reviewed PNG/JPEG image input required")
				}
				part = &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:" + mime + ";base64,"}}}
				message.Parts[i] = part
			}
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL && p.Vision() {
				u := part.GetImageUrl()
				header, encoded, ok := strings.Cut(u.GetUrl(), ",")
				if !ok || u.GetDetail() != "" || header != "data:image/png;base64" && header != "data:image/jpeg;base64" || len(encoded) > base64.StdEncoding.EncodedLen(50_000_000) {
					return textbehavior.SerializedRequest{}, p.profile.unsupported("owned PNG/JPEG input without detail required")
				}
				if !planning {
					data, err := base64.StdEncoding.Strict().DecodeString(encoded)
					if err != nil || len(data) == 0 {
						return textbehavior.SerializedRequest{}, p.profile.inputError("image bytes")
					}
					g, format, err := image.DecodeConfig(bytes.NewReader(data))
					if err != nil || g.Width <= 0 || g.Height <= 0 || header != "data:image/"+format+";base64" {
						return textbehavior.SerializedRequest{}, p.profile.inputError("image encoding")
					}
				}
			} else if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				return textbehavior.SerializedRequest{}, p.profile.unsupported("input modality")
			}
		}
		var pending *perplexityFunctionReplay
		items := make([]*runtimev1.TextTurnItem, 0, len(message.GetTurnItems()))
		for _, item := range message.GetTurnItems() {
			if carrier := item.GetOutput().GetReasoningContinuity(); carrier != nil {
				if pending != nil || !textbehavior.ValidContinuity(carrier) || carrier.Kind != p.ContinuityKind() || carrier.Version != 1 {
					return textbehavior.SerializedRequest{}, perplexityContinuityError()
				}
				var native perplexityFunctionReplay
				d := json.NewDecoder(bytes.NewReader(carrier.Payload))
				d.DisallowUnknownFields()
				if d.Decode(&native) != nil || d.Decode(new(any)) != io.EOF || !native.valid() {
					return textbehavior.SerializedRequest{}, perplexityContinuityError()
				}
				pending = &native
				continue
			}
			if call := item.GetOutput().GetToolCall(); call != nil {
				if pending != nil {
					if pending.CallID != call.Id || pending.Name != call.Name || pending.Arguments != call.ArgumentsJson {
						return textbehavior.SerializedRequest{}, perplexityContinuityError()
					}
					if _, exists := replay[call.Id]; exists {
						return textbehavior.SerializedRequest{}, perplexityContinuityError()
					}
					replay[call.Id] = *pending
					pending = nil
				} else if strings.HasPrefix(p.model, "google/") {
					return textbehavior.SerializedRequest{}, perplexityContinuityError()
				}
			} else if pending != nil {
				return textbehavior.SerializedRequest{}, perplexityContinuityError()
			}
			items = append(items, item)
		}
		if pending != nil {
			return textbehavior.SerializedRequest{}, perplexityContinuityError()
		}
		message.TurnItems = items
	}
	wire, err := serializeResponsesRequest(&p.profile, cloned)
	if err != nil {
		return wire, err
	}
	var body map[string]any
	if err := json.Unmarshal(wire.Payload, &body); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	// store=false hides retrieval only. Perplexity still persists state; this
	// adapter never sends previous_response_id, background, effort or fallback.
	delete(body, "include")
	delete(body, "parallel_tool_calls")
	body["max_steps"] = 1
	if reasoning != nil {
		body["reasoning"] = reasoning
	}
	if len(spec.Tools) == 0 {
		body["tools"] = []any{}
		body["tool_choice"] = "none"
	}
	for _, raw := range body["input"].([]any) {
		item := raw.(map[string]any)
		if item["type"] == "function_call" {
			call := replay[item["call_id"].(string)]
			if call.ThoughtSignature != "" {
				item["thought_signature"] = call.ThoughtSignature
			}
		} else if item["role"] != nil {
			item["type"] = "message"
		}
	}
	if text, ok := body["text"].(map[string]any); ok {
		format := text["format"].(map[string]any)
		name := format["name"].(string)
		if len(name) > 64 || name == "" || strings.IndexFunc(name, func(r rune) bool { return !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9') }) >= 0 {
			return textbehavior.SerializedRequest{}, p.profile.unsupported("schema name must contain 1-64 ASCII letters or digits")
		}
		delete(format, "type")
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": format}
		delete(body, "text")
	}
	wire.Payload, err = json.Marshal(body)
	if len(wire.Payload) > 32<<20 {
		return textbehavior.SerializedRequest{}, p.profile.inputError("request envelope exceeds 32 MiB")
	}
	return wire, err
}

func (p PerplexityTextBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(32<<20, int64(len(wire.Payload)))
	return prepared, budget, err
}

func (p PerplexityTextBehavior) reasoning(r *runtimev1.ReasoningConfig) (map[string]any, error) {
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return nil, p.profile.unsupported("reasoning summaries are not published by this API")
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil {
		return nil, nil
	}
	if p.model != "perplexity/kimi-k3" || r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
		return nil, p.profile.unsupported("only the reviewed Kimi K3 effort mapping is admitted; omit reasoning to preserve other model defaults")
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return nil, p.profile.unsupported("exact reasoning budget")
	}
	if r.GetEffort() == runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
		return nil, nil
	}
	efforts := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"}
	if effort, ok := efforts[r.GetEffort()]; ok {
		return map[string]any{"effort": effort}, nil
	}
	return nil, p.profile.unsupported("reasoning effort")
}

func (p PerplexityTextBehavior) Parse(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{}, p.profile.outputError("Agent API uses SSE delivery")
}
func (p PerplexityTextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &perplexityTextStream{behavior: p, inner: newResponsesStreamAssembler(&p.profile, spec), calls: map[string]perplexityFunctionReplay{}, indices: map[uint32]uint32{}}, nil
}

type perplexityFunctionReplay struct {
	Type             string `json:"type"`
	CallID           string `json:"call_id"`
	Name             string `json:"name"`
	Arguments        string `json:"arguments"`
	ThoughtSignature string `json:"thought_signature,omitempty"`
}

func (r perplexityFunctionReplay) valid() bool {
	if r.Type != "function_call" || r.CallID == "" || r.Name == "" || !json.Valid([]byte(r.Arguments)) {
		return false
	}
	if r.ThoughtSignature != "" {
		_, err := base64.StdEncoding.Strict().DecodeString(r.ThoughtSignature)
		return err == nil
	}
	return false
}
func perplexityContinuityError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID)
}
