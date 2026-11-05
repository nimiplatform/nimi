package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

func stepfunHiddenReasoning(payload []byte, hasCalls *bool) ([]byte, error) {
	if !utf8.Valid(payload) {
		return nil, deepseekJSONOutputError()
	}
	var body map[string]any
	d := json.NewDecoder(bytes.NewReader(payload))
	d.UseNumber()
	if d.Decode(&body) != nil || d.Decode(new(any)) != io.EOF || body == nil {
		return nil, deepseekJSONOutputError()
	}
	choices, ok := body["choices"].([]any)
	if !ok || len(choices) > 1 {
		return nil, deepseekJSONOutputError()
	}
	for _, raw := range choices {
		choice, ok := raw.(map[string]any)
		if !ok {
			return nil, deepseekJSONOutputError()
		}
		for _, key := range []string{"message", "delta"} {
			if message, ok := choice[key].(map[string]any); ok {
				if calls, ok := message["tool_calls"].([]any); ok && len(calls) > 0 {
					*hasCalls = true
				}
				if reasoning := message["reasoning"]; reasoning != nil {
					if _, ok := reasoning.(string); !ok {
						return nil, deepseekJSONOutputError()
					}
				}
				delete(message, "reasoning")
				// The request captures general format. A conflicting nonempty field
				// is not a second source of answer or invented continuity.
				if reasoning := message["reasoning_content"]; reasoning != nil && reasoning != "" {
					return nil, deepseekJSONOutputError()
				}
			}
		}
		// StepFun's documented tool result uses native stop with tool_calls.
		// Complete arguments are still validated by the inner tool assembler.
		if choice["finish_reason"] == "stop" && *hasCalls {
			choice["finish_reason"] = "tool_calls"
		}
	}
	return json.Marshal(body)
}

type stepfunTextStream struct {
	textbehavior.StreamFragmentAssembler
	hasCalls bool
}

func (s *stepfunTextStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(payload)) == "[DONE]" {
		return s.StreamFragmentAssembler.Append(payload)
	}
	clean, err := stepfunHiddenReasoning(payload, &s.hasCalls)
	if err != nil {
		return nil, err
	}
	return s.StreamFragmentAssembler.Append(clean)
}
