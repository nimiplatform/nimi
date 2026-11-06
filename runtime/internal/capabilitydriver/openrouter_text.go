package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"io"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

type openRouterTextPolicy struct {
	model, efforts      string
	maxOutput           int32
	off, vision, schema bool
}

func OpenRouterTextModels() []string {
	out := []string{}
	for _, p := range openRouterTextPolicies() {
		out = append(out, p.model)
	}
	return out
}

type OpenRouterTextBehavior struct {
	policy  openRouterTextPolicy
	profile responsesProfile
}

func NewOpenRouterTextBehavior(model string) (OpenRouterTextBehavior, error) {
	for _, policy := range openRouterTextPolicies() {
		if policy.model == model {
			p := OpenRouterTextBehavior{policy: policy}
			p.profile = responsesProfile{label: "OpenRouter Responses", continuityKind: "openrouter." + model + ".responses-replay", outputLimit: policy.maxOutput > 0, namedToolChoice: true, parallelToolCalls: true, reasoningControls: true, jsonObject: true, orderedSystemInput: strings.HasPrefix(model, "openai/"), failure: openRouterTextFailure}
			p.profile.nativeReasoningCarrier = p.carrier
			p.profile.nativeReasoningReplay = p.replay
			return p, nil
		}
	}
	return OpenRouterTextBehavior{}, openRouterUnsupported("unreviewed text model")
}
func openRouterUnsupported(s string) error {
	return (&responsesProfile{label: "OpenRouter"}).unsupported(s)
}
func (p OpenRouterTextBehavior) ContinuityKind() string    { return p.profile.continuityKind }
func (p OpenRouterTextBehavior) Vision() bool              { return p.policy.vision }
func (p OpenRouterTextBehavior) StrictSchema() bool        { return p.policy.schema }
func (p OpenRouterTextBehavior) CanDisableReasoning() bool { return p.policy.off }
func (p OpenRouterTextBehavior) Efforts() []string         { return strings.Fields(p.policy.efforts) }

func (p OpenRouterTextBehavior) reasoning(r *runtimev1.ReasoningConfig) (map[string]any, error) {
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
		return nil, nil
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED {
		if !p.policy.off || r.GetIntensity() != nil || r.GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
			return nil, openRouterUnsupported("reasoning off")
		}
		return map[string]any{"enabled": false, "effort": "none"}, nil
	}
	if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED && r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE {
		return nil, openRouterUnsupported("reasoning activation")
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE && !strings.HasPrefix(p.policy.model, "anthropic/") {
		return nil, openRouterUnsupported("adaptive reasoning")
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return nil, openRouterUnsupported("exact reasoning token budget")
	}
	wire := map[string]any{"enabled": true}
	if r.GetEffort() != runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
		effort := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"}[r.GetEffort()]
		if !contains(p.Efforts(), effort) {
			return nil, openRouterUnsupported("model-specific reasoning effort")
		}
		wire["effort"] = effort
	}
	if r.GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
		wire["summary"] = "auto"
	}
	return wire, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p OpenRouterTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(s, false)
}
func (p OpenRouterTextBehavior) serialize(s *runtimev1.TextGenerateScenarioSpec, planning bool) (textbehavior.SerializedRequest, error) {
	if s == nil {
		return textbehavior.SerializedRequest{}, openRouterUnsupported("missing input")
	}
	if textbehavior.RequiresOrderedSystemMessages(s) && !p.profile.orderedSystemInput {
		return textbehavior.SerializedRequest{}, openRouterUnsupported("gateway preservation of ordered system messages is unreviewed for this model")
	}
	if s.MaxTokens != nil && (p.policy.maxOutput == 0 || s.GetMaxTokens() > p.policy.maxOutput) {
		return textbehavior.SerializedRequest{}, openRouterUnsupported("exact output token limit")
	}
	if f := s.GetResponseFormat(); f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		if !p.policy.schema {
			return textbehavior.SerializedRequest{}, openRouterUnsupported("strict schema on this model")
		}
		if err := validateGroqStrictSchema(f.GetJsonSchema().AsMap()); err != nil {
			return textbehavior.SerializedRequest{}, openRouterUnsupported("strict JSON schema outside the reviewed closed basic subset")
		}
	}
	reasoning, err := p.reasoning(s.GetReasoning())
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	copy := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
	copy.Reasoning = nil
	for _, m := range copy.GetInput() {
		if m == nil {
			return textbehavior.SerializedRequest{}, openRouterUnsupported("nil message")
		}
		for i, part := range m.GetParts() {
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				continue
			}
			if !p.Vision() {
				return textbehavior.SerializedRequest{}, openRouterUnsupported("model input modality")
			}
			if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				mime := part.GetArtifactRef().GetMimeType()
				if mime != "image/png" && mime != "image/jpeg" {
					return textbehavior.SerializedRequest{}, openRouterUnsupported("owned PNG/JPEG input required")
				}
				part = &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:" + mime + ";base64,"}}}
				m.Parts[i] = part
			}
			if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL || part.GetImageUrl().GetDetail() != "" {
				return textbehavior.SerializedRequest{}, openRouterUnsupported("input part or image detail")
			}
			header, encoded, ok := strings.Cut(part.GetImageUrl().GetUrl(), ",")
			if !ok || header != "data:image/png;base64" && header != "data:image/jpeg;base64" || len(encoded) > 32<<20 {
				return textbehavior.SerializedRequest{}, openRouterUnsupported("owned PNG/JPEG bytes required")
			}
			if !planning {
				data, e := base64.StdEncoding.Strict().DecodeString(encoded)
				if e != nil || len(data) == 0 {
					return textbehavior.SerializedRequest{}, openRouterUnsupported("image encoding")
				}
				g, f, e := image.DecodeConfig(bytes.NewReader(data))
				if e != nil || g.Width <= 0 || g.Height <= 0 || header != "data:image/"+f+";base64" {
					return textbehavior.SerializedRequest{}, openRouterUnsupported("image encoding")
				}
			}
		}
	}
	wire, err := serializeResponsesRequest(&p.profile, copy)
	if err != nil {
		return wire, err
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	delete(body, "parallel_tool_calls")
	body["provider"] = map[string]any{"require_parameters": true, "allow_fallbacks": false}
	body["plugins"] = []any{}
	body["truncation"] = "disabled"
	if reasoning != nil {
		body["reasoning"] = reasoning
	}
	if strings.HasPrefix(p.policy.model, "openai/") {
		if reasoning == nil {
			reasoning = map[string]any{}
			body["reasoning"] = reasoning
		}
		reasoning["context"] = "all_turns"
	}
	wire.Payload, err = json.Marshal(body)
	if len(wire.Payload) > 32<<20 {
		return textbehavior.SerializedRequest{}, openRouterUnsupported("request envelope exceeds 32 MiB")
	}
	return wire, err
}
func (p OpenRouterTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(32<<20, int64(len(wire.Payload)))
	return prepared, budget, err
}

type openRouterReasoning struct {
	Type      string                 `json:"type"`
	ID        string                 `json:"id"`
	Status    string                 `json:"status,omitempty"`
	Encrypted *string                `json:"encrypted_content,omitempty"`
	Format    *string                `json:"format,omitempty"`
	Signature *string                `json:"signature,omitempty"`
	Summary   []responsesSummaryPart `json:"summary"`
	Content   []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content,omitempty"`
}

func decodeOpenRouterReasoning(raw []byte) (openRouterReasoning, error) {
	var v openRouterReasoning
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) > textbehavior.MaxReasoningContinuityPayloadBytes || !utf8.Valid(raw) || d.Decode(&v) != nil || d.Decode(new(any)) != io.EOF || v.Type != "reasoning" || v.ID == "" || v.Summary == nil || v.Status != "" && v.Status != "completed" {
		return v, nativeReasoningReplayInvalid()
	}
	if v.Encrypted != nil && strings.Contains(*v.Encrypted, "[REDACTED]") {
		return v, nativeReasoningReplayInvalid()
	}
	if v.Format != nil && !contains(strings.Fields("unknown openai-responses-v1 azure-openai-responses-v1 bedrock-openai-responses-v1 bedrock-xai-responses-v1 xai-responses-v1 meta-responses-v1 openrouter-stealth-v1 anthropic-claude-v1 google-gemini-v1"), *v.Format) {
		return v, nativeReasoningReplayInvalid()
	}
	for _, s := range v.Summary {
		if s.Type != "summary_text" {
			return v, nativeReasoningReplayInvalid()
		}
	}
	for _, c := range v.Content {
		if c.Type != "reasoning_text" {
			return v, nativeReasoningReplayInvalid()
		}
	}
	return v, nil
}
func (p OpenRouterTextBehavior) carrier(raw json.RawMessage) (*runtimev1.ReasoningContinuityCarrier, error) {
	if _, err := decodeOpenRouterReasoning(raw); err != nil {
		return nil, err
	}
	return &runtimev1.ReasoningContinuityCarrier{Kind: p.ContinuityKind(), Version: 1, Payload: bytes.Clone(raw)}, nil
}
func (p OpenRouterTextBehavior) replay(c *runtimev1.ReasoningContinuityCarrier, summaries []string) (json.RawMessage, error) {
	v, err := decodeOpenRouterReasoning(c.Payload)
	if err != nil {
		return nil, err
	}
	if len(summaries) > 0 {
		if len(summaries) != len(v.Summary) {
			return nil, nativeReasoningReplayInvalid()
		}
		for i, s := range summaries {
			if v.Summary[i].Text != s {
				return nil, nativeReasoningReplayInvalid()
			}
		}
	}
	return bytes.Clone(c.Payload), nil
}
func (p OpenRouterTextBehavior) Parse(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{}, p.profile.outputError("Responses requires SSE delivery")
}
func (p OpenRouterTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &openRouterTextStream{profile: p, inner: newResponsesStreamAssembler(&p.profile, s), summary: s.GetReasoning().GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}, nil
}
