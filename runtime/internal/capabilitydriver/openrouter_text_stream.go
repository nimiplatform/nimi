package capabilitydriver

import (
	"encoding/json"
	"reflect"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

type openRouterTextStream struct {
	profile        OpenRouterTextBehavior
	inner          *responsesBehaviorStream
	summary        bool
	seen           bool
	sealed         map[uint32]json.RawMessage
	reasoningBytes int
}

func (s *openRouterTextStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(data)) == "[DONE]" {
		return s.inner.Append(data)
	}
	var e struct {
		Type     string          `json:"type"`
		Index    uint32          `json:"output_index"`
		Item     json.RawMessage `json:"item"`
		Code     json.RawMessage `json:"code"`
		Error    json.RawMessage `json:"error"`
		Response *struct {
			Model  string            `json:"model"`
			Status string            `json:"status"`
			Output []json.RawMessage `json:"output"`
			Error  json.RawMessage   `json:"error"`
		} `json:"response"`
	}
	bad := func() ([]textbehavior.OrderedDelta, error) {
		return nil, s.profile.profile.outputError("native event, model or final output mismatch")
	}
	if json.Unmarshal(data, &e) != nil || s.inner.completed {
		return bad()
	}
	if e.Type == "error" || e.Type == "response.failed" {
		raw := e.Error
		if e.Response != nil {
			raw = e.Response.Error
		}
		var v struct {
			Code json.RawMessage `json:"code"`
		}
		_ = json.Unmarshal(raw, &v)
		if len(v.Code) == 0 {
			v.Code = e.Code
		}
		return nil, openRouterTextFailure(0, strings.Trim(string(v.Code), "\""))
	}
	if e.Response != nil && e.Response.Model != "" {
		if e.Response.Model != s.profile.policy.model {
			return bad()
		}
		s.seen = true
	}
	if (e.Type == "response.created" || e.Type == "response.completed") && (e.Response == nil || e.Response.Model == "") {
		return bad()
	}
	if !s.seen && e.Type != "response.in_progress" && e.Type != "response.queued" {
		return bad()
	}
	if e.Type == "response.output_item.done" {
		var item struct {
			Type   string `json:"type"`
			Role   string `json:"role"`
			Status string `json:"status"`
		}
		if json.Unmarshal(e.Item, &item) != nil || item.Status != "" && item.Status != "completed" || item.Type == "message" && item.Role != "assistant" {
			return bad()
		}
		if item.Type == "reasoning" {
			s.reasoningBytes += len(e.Item)
			if s.reasoningBytes > responsesItemTextLimit {
				return bad()
			}
		}
		if s.sealed == nil {
			s.sealed = map[uint32]json.RawMessage{}
		}
		if len(s.sealed) >= 1024 {
			return bad()
		}
		s.sealed[e.Index] = append(json.RawMessage(nil), e.Item...)
	}
	if e.Type == "response.completed" {
		if e.Response.Status == "incomplete" {
			return nil, deepseekIncomplete()
		}
		if e.Response.Status != "completed" || len(e.Response.Error) > 0 && string(e.Response.Error) != "null" || len(e.Response.Output) != len(s.sealed) {
			return bad()
		}
		for i, raw := range e.Response.Output {
			if !sameOpenRouterOutput(raw, s.sealed[uint32(i)]) {
				return bad()
			}
		}
	}
	// Plaintext is replayed only from a sealed native reasoning item. It is
	// never silently promoted into the separately typed summary channel.
	if e.Type == "response.reasoning.delta" || e.Type == "response.reasoning_text.delta" || e.Type == "response.reasoning_text.done" {
		return nil, nil
	}
	if !s.summary && strings.HasPrefix(e.Type, "response.reasoning_summary_") {
		return nil, nil
	}
	deltas, err := s.inner.Append(data)
	if err == nil && s.reasoningBytes+s.inner.bufferedBytes > responsesItemTextLimit {
		return bad()
	}
	return deltas, err
}

// Optional annotations and other unused message metadata may differ between
// done and completed. Compare the consumed content, and all native reasoning
// state that will be replayed, rather than requiring identical JSON decoration.
func sameOpenRouterOutput(left, right json.RawMessage) bool {
	var a, b responsesBehaviorItem
	if json.Unmarshal(left, &a) != nil || json.Unmarshal(right, &b) != nil || a.Type != b.Type {
		return false
	}
	var meta struct {
		Role   string `json:"role"`
		Status string `json:"status"`
	}
	if json.Unmarshal(left, &meta) != nil || meta.Status != "" && meta.Status != "completed" || a.Type == "message" && meta.Role != "assistant" {
		return false
	}
	if a.Type == "reasoning" {
		x, e := decodeOpenRouterReasoning(left)
		if e != nil {
			return false
		}
		y, e := decodeOpenRouterReasoning(right)
		if e != nil {
			return false
		}
		x.Status, y.Status = "completed", "completed"
		if len(x.Content) == 0 {
			x.Content = nil
		}
		if len(y.Content) == 0 {
			y.Content = nil
		}
		return reflect.DeepEqual(x, y)
	}
	return reflect.DeepEqual(a, b)
}
func (s *openRouterTextStream) Finish() (textbehavior.NormalizedResult, error) {
	return s.inner.Finish()
}
func openRouterTextFailure(_ int, code string) error {
	status, _ := strconv.Atoi(code)
	reason, g := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable
	switch {
	case status == 401 || status == 403:
		reason, g = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.FailedPrecondition
	case status == 402 || status == 429 || code == "rate_limit_exceeded" || code == "insufficient_quota":
		reason, g = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted
	case status == 400 || status == 413 || status == 422 || code == "invalid_prompt" || code == "context_length_exceeded":
		reason, g = runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument
	case code == "model_not_found" || status == 404:
		reason, g = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound
	case status == 408 || status == 504:
		reason, g = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, codes.DeadlineExceeded
	}
	return grpcerr.WithReasonCode(g, reason)
}
