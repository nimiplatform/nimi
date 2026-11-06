package capabilitydriver

import (
	"encoding/json"
	"reflect"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// Agent API shares Responses text events, but carries function continuity on
// the call itself and has no encrypted reasoning output item. Keep those facts
// in this exact adapter rather than weakening the other Responses routes.
type perplexityTextStream struct {
	behavior                PerplexityTextBehavior
	inner                   *responsesBehaviorStream
	calls                   map[string]perplexityFunctionReplay
	indices                 map[uint32]uint32
	next                    uint32
	sequence                int64
	seenSequence, confirmed bool
	completedItems          []json.RawMessage
	continuityBytes         int
}

func (s *perplexityTextStream) carrier(callID string) (*runtimev1.ReasoningContinuityCarrier, error) {
	native, exists := s.calls[callID]
	if !exists {
		return nil, nil
	}
	payload, err := json.Marshal(native)
	c := &runtimev1.ReasoningContinuityCarrier{Kind: s.behavior.ContinuityKind(), Version: 1, Payload: payload}
	if err != nil || !textbehavior.ValidContinuity(c) {
		return nil, s.behavior.profile.outputError("function signature size")
	}
	return c, nil
}

func (s *perplexityTextStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if string(payload) == "[DONE]" {
		return s.inner.Append(payload)
	}
	var event struct {
		Type     string          `json:"type"`
		Sequence *int64          `json:"sequence_number"`
		Index    uint32          `json:"output_index"`
		Item     json.RawMessage `json:"item"`
		Response *struct {
			Model  string            `json:"model"`
			Status string            `json:"status"`
			Output []json.RawMessage `json:"output"`
			Error  json.RawMessage   `json:"error"`
		} `json:"response"`
	}
	bad := func(detail string) ([]textbehavior.OrderedDelta, error) {
		return nil, s.behavior.profile.outputError(detail)
	}
	if json.Unmarshal(payload, &event) != nil || s.inner.completed {
		return bad("stream envelope")
	}
	if event.Sequence == nil || *event.Sequence < 0 || s.seenSequence && *event.Sequence <= s.sequence {
		return bad("stream event sequence")
	}
	s.sequence, s.seenSequence = *event.Sequence, true
	if event.Response != nil && event.Response.Model != "" {
		if event.Response.Model != s.behavior.model {
			return bad("selected model changed")
		}
		s.confirmed = true
	}
	if event.Type == "response.created" || event.Type == "response.completed" {
		if event.Response == nil || event.Response.Model == "" {
			return bad("missing model claim")
		}
	}
	if !s.confirmed && event.Type != "error" && event.Type != "response.failed" {
		return bad("output before selected model confirmation")
	}
	switch event.Type {
	case "response.reasoning.started", "response.reasoning.stopped":
		// Native thought is neither an answer nor an authorized summary.
		return nil, nil
	case "response.output_item.added", "response.output_item.done":
		var item struct {
			perplexityFunctionReplay
			Status string `json:"status"`
			Role   string `json:"role"`
		}
		if json.Unmarshal(event.Item, &item) != nil || item.Type != "message" && item.Type != "function_call" {
			return bad("unrequested provider tool or reasoning output")
		}
		if item.Type == "message" && item.Role != "assistant" {
			return bad("message role")
		}
		if event.Type == "response.output_item.done" {
			if item.Status != "completed" {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
			}
			if item.Type == "function_call" {
				if item.ThoughtSignature != "" {
					if !item.perplexityFunctionReplay.valid() {
						return bad("native function signature")
					}
					if _, exists := s.calls[item.CallID]; exists {
						return bad("duplicate function signature")
					}
					s.calls[item.CallID] = item.perplexityFunctionReplay
					carrier, err := s.carrier(item.CallID)
					if err != nil {
						return nil, err
					}
					s.continuityBytes += len(carrier.Payload)
					if s.continuityBytes > responsesItemTextLimit {
						return bad("aggregate function continuity size")
					}
				} else if strings.HasPrefix(s.behavior.model, "google/") {
					return bad("missing thinking model function signature")
				}
			}
			// Preserve provider output order; done events may seal later items first.
			for len(s.completedItems) <= int(event.Index) {
				if len(s.completedItems) > 1024 {
					return bad("output item count")
				}
				s.completedItems = append(s.completedItems, nil)
			}
			s.completedItems[event.Index] = append(json.RawMessage(nil), event.Item...)
		}
	case "response.completed":
		if event.Response.Status == "incomplete" {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
		}
		if event.Response.Status != "completed" || len(event.Response.Error) > 0 && string(event.Response.Error) != "null" || len(event.Response.Output) != len(s.completedItems) {
			return bad("terminal response")
		}
		for i, raw := range event.Response.Output {
			var a, b any
			if json.Unmarshal(raw, &a) != nil || json.Unmarshal(s.completedItems[i], &b) != nil || !reflect.DeepEqual(a, b) {
				return bad("terminal output disagrees with sealed items")
			}
		}
	}
	deltas, err := s.inner.Append(payload)
	if err != nil {
		return nil, err
	}
	if s.inner.bufferedBytes+s.continuityBytes > responsesItemTextLimit {
		return bad("aggregate output size")
	}
	out := make([]textbehavior.OrderedDelta, 0, len(deltas)+1)
	for _, delta := range deltas {
		index, exists := s.indices[delta.ItemIndex]
		if !exists {
			if delta.ToolCall != nil {
				carrier, err := s.carrier(delta.ToolCall.Id)
				if err != nil {
					return nil, err
				}
				if carrier != nil {
					out = append(out, textbehavior.OrderedDelta{ItemIndex: s.next, Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: carrier, ItemCompleted: true})
					s.next++
				}
			}
			index = s.next
			s.next++
			s.indices[delta.ItemIndex] = index
		}
		delta.ItemIndex = index
		out = append(out, delta)
	}
	return out, nil
}

func (s *perplexityTextStream) Finish() (textbehavior.NormalizedResult, error) {
	result, err := s.inner.Finish()
	if err != nil {
		return result, err
	}
	items := make([]textbehavior.OrderedItem, 0, len(result.Items)+len(s.calls))
	for _, item := range result.Items {
		if item.ToolCall != nil {
			carrier, err := s.carrier(item.ToolCall.Id)
			if err != nil {
				return textbehavior.NormalizedResult{}, err
			}
			if carrier != nil {
				items = append(items, textbehavior.OrderedItem{Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: carrier})
			}
		}
		items = append(items, item)
	}
	result.Items = items
	return result, nil
}
