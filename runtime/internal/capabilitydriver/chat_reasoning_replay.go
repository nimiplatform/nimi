package capabilitydriver

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// A carrier preserves one native string verbatim; this wrapper does not encrypt
// or authenticate it. The exact adapter binds the native field and model-specific
// kind, including whether the provider supplied plaintext or encrypted state.
func nativeReasoningReplay(kind, reasoning string) (*runtimev1.ReasoningContinuityCarrier, error) {
	// A JSON string preserves the distinction between an explicitly empty native
	// reasoning string and an absent field; even an empty native value is replayed.
	payload, err := json.Marshal(reasoning)
	carrier := &runtimev1.ReasoningContinuityCarrier{Kind: kind, Version: 1, Payload: payload}
	if err != nil || !textbehavior.ValidContinuity(carrier) || !utf8.ValidString(reasoning) {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID, grpcerr.ReasonOptions{Message: "Native reasoning replay is malformed or exceeds the 64 KiB carrier limit"})
	}
	return carrier, nil
}

func readNativeReasoningReplay(carrier *runtimev1.ReasoningContinuityCarrier, kind string) (string, error) {
	if kind == "" || !textbehavior.ValidContinuity(carrier) || carrier.GetKind() != kind || carrier.GetVersion() != 1 || !utf8.Valid(carrier.GetPayload()) {
		return "", nativeReasoningReplayInvalid()
	}
	var reasoning *string
	if json.Unmarshal(carrier.GetPayload(), &reasoning) != nil || reasoning == nil {
		return "", nativeReasoningReplayInvalid()
	}
	return *reasoning, nil
}

func nativeReasoningReplayInvalid() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID)
}

// The reviewed GLM and DeepSeek protocols share this Chat Completions envelope.
// Their exact request controls and model identities remain adapter-owned.
func parseReasoningChatResponse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec, kind string) (textbehavior.NormalizedResult, error) {
	return parseReasoningChatResponseWithPolicy(payload, spec, kind, true)
}

func parseReasoningChatResponseWithPolicy(payload []byte, spec *runtimev1.TextGenerateScenarioSpec, kind string, requireToolReasoning bool) (textbehavior.NormalizedResult, error) {
	if !utf8.Valid(payload) {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil || len(value.Choices) != 1 || value.Choices[0].Message == nil {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	message := value.Choices[0].Message
	var carrier *runtimev1.ReasoningContinuityCarrier
	if message.ReasoningContent != nil {
		carrier, err = nativeReasoningReplay(kind, *message.ReasoningContent)
		if err != nil {
			return textbehavior.NormalizedResult{}, err
		}
	}
	message.ReasoningContent = nil
	clean, err := json.Marshal(value)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	var result textbehavior.NormalizedResult
	if len(spec.GetTools()) > 0 {
		result, err = parseDeepseekToolResponse(clean, spec)
	} else {
		result, err = parseChatTextResponse(clean, spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
	}
	if err != nil {
		return result, err
	}
	if requireToolReasoning && result.FinishReason == runtimev1.FinishReason_FINISH_REASON_TOOL_CALL && carrier == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID, grpcerr.ReasonOptions{Message: "The provider omitted reasoning_content from a thinking tool-call response"})
	}
	if carrier != nil {
		result.Items = append([]textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: carrier}}, result.Items...)
	}
	return result, nil
}

type reasoningChatStream struct {
	inner            textbehavior.StreamFragmentAssembler
	kind             string
	reasoning        strings.Builder
	reasoningPresent bool
	sealed           bool
	carrier          *runtimev1.ReasoningContinuityCarrier
	optional         bool
}

func newReasoningChatStream(spec *runtimev1.TextGenerateScenarioSpec, kind string) textbehavior.StreamFragmentAssembler {
	var inner textbehavior.StreamFragmentAssembler
	if len(spec.GetTools()) > 0 {
		inner = newDeepseekToolStream(spec)
	} else {
		inner = &deepseekJSONStream{plainText: spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	}
	return &reasoningChatStream{inner: inner, kind: kind}
}

func (s *reasoningChatStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if !utf8.Valid(payload) {
		return nil, deepseekJSONOutputError()
	}
	if strings.TrimSpace(string(payload)) == "[DONE]" {
		return s.inner.Append(payload)
	}
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil {
		return nil, err
	}
	var first []textbehavior.OrderedDelta
	if len(value.Choices) == 1 {
		choice := value.Choices[0]
		if delta := choice.Delta; delta != nil {
			if delta.ReasoningContent != nil {
				if s.sealed && *delta.ReasoningContent != "" {
					return nil, deepseekJSONOutputError()
				}
				s.reasoningPresent = true
				if s.reasoning.Len()+len(*delta.ReasoningContent) > textbehavior.MaxReasoningContinuityPayloadBytes {
					return nil, nativeReasoningReplayInvalid()
				}
				s.reasoning.WriteString(*delta.ReasoningContent)
			}
			delta.ReasoningContent = nil
			calls, callErr := deepseekCalls(delta.ToolCalls)
			if callErr != nil {
				return nil, callErr
			}
			if delta.Content != nil && *delta.Content != "" || len(calls) > 0 || choice.FinishReason != nil {
				first, err = s.sealReasoning()
				if err != nil {
					return nil, err
				}
			}
		} else if choice.FinishReason != nil {
			first, err = s.sealReasoning()
			if err != nil {
				return nil, err
			}
		}
		if !s.optional && choice.FinishReason != nil && *choice.FinishReason == "tool_calls" && s.carrier == nil {
			return nil, nativeReasoningReplayInvalid()
		}
	}
	clean, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	deltas, err := s.inner.Append(clean)
	if err != nil {
		return nil, err
	}
	if s.carrier != nil {
		for i := range deltas {
			deltas[i].ItemIndex++
		}
	}
	return append(first, deltas...), nil
}

func (s *reasoningChatStream) sealReasoning() ([]textbehavior.OrderedDelta, error) {
	if s.sealed {
		return nil, nil
	}
	s.sealed = true
	if !s.reasoningPresent {
		return nil, nil
	}
	carrier, err := nativeReasoningReplay(s.kind, s.reasoning.String())
	if err != nil {
		return nil, err
	}
	s.carrier = carrier
	s.reasoning.Reset()
	return []textbehavior.OrderedDelta{{ItemIndex: 0, Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: proto.Clone(carrier).(*runtimev1.ReasoningContinuityCarrier), ItemCompleted: true}}, nil
}

func (s *reasoningChatStream) Finish() (textbehavior.NormalizedResult, error) {
	result, err := s.inner.Finish()
	if err != nil {
		return result, err
	}
	if s.carrier != nil {
		result.Items = append([]textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: proto.Clone(s.carrier).(*runtimev1.ReasoningContinuityCarrier)}}, result.Items...)
	}
	return result, nil
}
