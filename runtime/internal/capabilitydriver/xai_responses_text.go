package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const XAIGrok47Model = "grok-4.7"
const xaiTextRequestBytes = 32 << 20

type XAIResponsesBehavior struct{ profile responsesProfile }

func NewXAIResponsesBehavior() XAIResponsesBehavior {
	return XAIResponsesBehavior{profile: responsesProfile{
		label: "xAI Grok 4.7 Responses", continuityKind: "xai.grok-4.7.responses.encrypted-reasoning",
		// Native max_output_tokens excludes reasoning and function-call tokens.
		// It cannot stand in for the canonical caller's exact hard limit.
		outputLimit: false, namedToolChoice: true, parallelToolCalls: true, reasoningControls: true,
		jsonObject: true, samplingControls: true, schemaMapper: mapXAISchema, strictToolSchemas: true, orderedSystemInput: true,
		failure: xaiResponsesFailure,
	}}
}
func (p XAIResponsesBehavior) ContinuityKind() string { return p.profile.continuityKind }

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// @nimi-authority: rule.nimi.runtime.ai-provider.internal-output-budget
func (p XAIResponsesBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, false)
}

func (p XAIResponsesBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, planning bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, p.profile.inputError("missing input")
	}
	if spec.Temperature != nil && spec.GetTemperature() > 1 || spec.TopP != nil && spec.GetTopP() > .95 || spec.GetReasoning().GetEffort() == runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM {
		return textbehavior.SerializedRequest{}, p.profile.unsupported("xAI silently clamps these sampling or reasoning values")
	}
	captured := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	if captured.Reasoning == nil {
		captured.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
	}
	if captured.Reasoning.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED {
		captured.Reasoning.Activation = runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED
	}
	if captured.Reasoning.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED && captured.Reasoning.Intensity == nil {
		captured.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
	}
	if captured.Reasoning.GetEffort() == runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
		captured.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
	}
	for _, message := range captured.GetInput() {
		for index, part := range message.GetParts() {
			if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				mime := part.GetArtifactRef().GetMimeType()
				if mime != "image/png" && mime != "image/jpeg" {
					return textbehavior.SerializedRequest{}, p.profile.unsupported("image format")
				}
				part = &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:" + mime + ";base64,"}}}
				message.Parts[index] = part
			}
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL {
				if part.GetImageUrl().GetDetail() != "" {
					return textbehavior.SerializedRequest{}, p.profile.unsupported("image detail control")
				}
				if err := validateXAITextImage(part.GetImageUrl().GetUrl(), !planning); err != nil {
					return textbehavior.SerializedRequest{}, err
				}
			}
		}
	}
	serialized, err := serializeResponsesRequest(&p.profile, captured)
	if err != nil {
		return serialized, err
	}
	var body map[string]any
	if err = json.Unmarshal(serialized.Payload, &body); err != nil {
		return serialized, err
	}
	if reasoning, ok := body["reasoning"].(map[string]any); ok && reasoning["summary"] != nil {
		reasoning["summary"] = "detailed"
	}
	serialized.Payload, err = json.Marshal(body)
	if len(serialized.Payload) > xaiTextRequestBytes {
		return textbehavior.SerializedRequest{}, p.profile.inputError("request envelope exceeds 32 MiB")
	}
	return serialized, err
}

func (p XAIResponsesBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(xaiTextRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}

func validateXAITextImage(location string, decode bool) error {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if !strings.HasPrefix(location, "data:") {
		u, err := url.Parse(location)
		if err != nil || len(location) > 8192 || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return invalid()
		}
		return nil
	}
	header, encoded, ok := strings.Cut(location, ",")
	mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !ok || !strings.HasSuffix(header, ";base64") || mime != "image/png" && mime != "image/jpeg" || len(encoded) > base64.StdEncoding.EncodedLen(20<<20) {
		return invalid()
	}
	if !decode {
		return nil
	}
	imageBytes, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(imageBytes) == 0 || len(imageBytes) > 20<<20 {
		return invalid()
	}
	geometry, format, err := image.DecodeConfig(bytes.NewReader(imageBytes))
	if err != nil || geometry.Width <= 0 || geometry.Height <= 0 || mime != "image/"+format {
		return invalid()
	}
	return nil
}
func (p XAIResponsesBehavior) Parse(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{}, p.profile.outputError("this exact route collects native SSE in both execution modes")
}
func (p XAIResponsesBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &xaiResponsesStream{StreamFragmentAssembler: newResponsesStreamAssembler(&p.profile, spec)}, nil
}

type xaiResponsesStream struct {
	textbehavior.StreamFragmentAssembler
	confirmed bool
}

func (s *xaiResponsesStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	var event struct {
		Type     string `json:"type"`
		Response *struct {
			Model string `json:"model"`
		} `json:"response"`
	}
	if json.Unmarshal(payload, &event) != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if event.Response != nil && event.Response.Model != "" {
		if event.Response.Model != XAIGrok47Model {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		s.confirmed = true
	}
	if (event.Type == "response.created" || event.Type == "response.completed") && (event.Response == nil || event.Response.Model == "") {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !s.confirmed && event.Type != "error" && event.Type != "response.failed" && event.Type != "response.in_progress" && event.Type != "response.queued" {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	// This plaintext stream is not the native summary channel. Never promote it
	// to reasoning summary, answer text or a purported encrypted carrier.
	if event.Type == "response.reasoning_text.delta" || event.Type == "response.reasoning_text.done" {
		return nil, nil
	}
	return s.StreamFragmentAssembler.Append(payload)
}
func xaiResponsesFailure(_ int, code string) error {
	reason, grpcCode := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable
	switch code {
	case "rate_limit_exceeded", "insufficient_quota":
		reason, grpcCode = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted
	case "model_not_found":
		reason, grpcCode = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound
	case "invalid_prompt", "context_length_exceeded":
		reason, grpcCode = runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument
	case "content_policy_violation":
		reason, grpcCode = runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED, codes.PermissionDenied
	}
	return grpcerr.WithReasonCodeOptions(grpcCode, reason, grpcerr.ReasonOptions{Message: "xAI Responses request failed"})
}

// mapXAISchema keeps standard object openness explicit and rejects native
// best-effort or differently interpreted constraints before paid inference.
func mapXAISchema(root map[string]any) (map[string]any, error) {
	unsupported := func() (map[string]any, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	active := map[string]bool{}
	var visit func(map[string]any, int) (map[string]any, error)
	visit = func(node map[string]any, depth int) (map[string]any, error) {
		if depth > 32 {
			return unsupported()
		}
		out := make(map[string]any, len(node)+1)
		for key, value := range node {
			switch key {
			case "$schema", "title", "description", "$comment", "default", "type", "enum", "const", "required", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum":
				out[key] = value
			case "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties":
				limit := float64(2048)
				if strings.HasSuffix(key, "Items") {
					limit = 256
				}
				if strings.HasSuffix(key, "Properties") {
					limit = 64
				}
				n, ok := value.(float64)
				if !ok || n > limit {
					return unsupported()
				}
				out[key] = value
			case "format":
				switch value {
				case "date", "time", "date-time", "email", "uuid", "ipv4", "ipv6", "uri":
					out[key] = value
				default:
					return unsupported()
				}
			case "pattern":
				// Native patterns implicitly match the whole string, with different dot
				// and escape semantics. Do not advertise standard pattern enforcement.
				return unsupported()
			case "additionalProperties":
				if _, ok := value.(bool); !ok {
					return unsupported()
				}
				out[key] = value
			case "properties", "$defs", "definitions":
				children, ok := value.(map[string]any)
				if !ok {
					return unsupported()
				}
				mapped := map[string]any{}
				for name, child := range children {
					schema, ok := child.(map[string]any)
					if !ok {
						return unsupported()
					}
					v, err := visit(schema, depth+1)
					if err != nil {
						return nil, err
					}
					mapped[name] = v
				}
				out[key] = mapped
			case "items":
				child, ok := value.(map[string]any)
				if !ok {
					return unsupported()
				}
				mapped, err := visit(child, depth+1)
				if err != nil {
					return nil, err
				}
				out[key] = mapped
			case "anyOf", "allOf", "prefixItems":
				children, ok := value.([]any)
				if !ok || len(children) == 0 || key == "allOf" && len(children) != 1 {
					return unsupported()
				}
				mapped := make([]any, 0, len(children))
				for _, child := range children {
					schema, ok := child.(map[string]any)
					if !ok {
						return unsupported()
					}
					v, err := visit(schema, depth+1)
					if err != nil {
						return nil, err
					}
					mapped = append(mapped, v)
				}
				out[key] = mapped
			case "$ref":
				ref, ok := value.(string)
				if !ok || !strings.HasPrefix(ref, "#/") || active[ref] {
					return unsupported()
				}
				var found any = root
				for _, part := range strings.Split(ref[2:], "/") {
					object, ok := found.(map[string]any)
					if !ok {
						return unsupported()
					}
					found = object[strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")]
				}
				target, ok := found.(map[string]any)
				if !ok {
					return unsupported()
				}
				active[ref] = true
				_, err := visit(target, depth+1)
				delete(active, ref)
				if err != nil {
					return nil, err
				}
				out[key] = ref
			default:
				return unsupported()
			}
		}
		object := node["type"] == "object" || node["properties"] != nil
		if types, ok := node["type"].([]any); ok {
			for _, kind := range types {
				object = object || kind == "object"
			}
		}
		if object && node["additionalProperties"] == nil {
			out["additionalProperties"] = true
		}
		return out, nil
	}
	return visit(root, 0)
}
