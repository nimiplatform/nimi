package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestChatGPTPlanMetadataDoesNotProduceOutputOrCompletion(t *testing.T) {
	metadata := []byte(`{"type":"response.metadata","response_id":"resp_1","sequence_number":0,"metadata":{"openai_verification_recommendation":[],"output_tokens":9999}}`)
	s, _ := ChatGPTPlanTextBehaviorStreamAssembler(&runtimev1.TextGenerateScenarioSpec{})
	if deltas, err := s.Append(metadata); err != nil || len(deltas) != 0 {
		t.Fatal(deltas, err)
	}
	if _, err := s.Finish(); err == nil {
		t.Fatal("metadata completed an empty stream")
	}
	for _, event := range []string{
		`{"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}`,
		`{"type":"response.output_item.added","output_index":0,"item":{"id":"msg_1","type":"message"}}`,
		`{"type":"response.output_text.delta","output_index":0,"item_id":"msg_1","delta":"391"}`,
		string(metadata),
		`{"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"391"}]}}`,
		`{"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":7,"output_tokens":9}}}`,
		string(metadata),
	} {
		if _, err := s.Append([]byte(event)); err != nil {
			t.Fatal(err)
		}
	}
	result, err := s.Finish()
	if err != nil || len(result.Items) != 1 || result.Items[0].Text != "391" || result.Usage.GetInputTokens() != 7 || result.Usage.GetOutputTokens() != 9 {
		t.Fatal(result, err)
	}
	other := newResponsesStreamAssembler(openAIResponses, &runtimev1.TextGenerateScenarioSpec{})
	if _, err = other.Append(metadata); err == nil {
		t.Fatal("unreviewed route inherited SIWC metadata handling")
	}
}

func TestChatGPTPlanMetadataDoesNotSuppressFailureOrInvalidEvents(t *testing.T) {
	for _, tc := range []struct {
		event  string
		reason runtimev1.ReasonCode
	}{
		{`{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}`, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED},
		{`{"type":"error","error":{"code":"subscription_sharing_usage_limit_exceeded","param":null}}`, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED},
		{`{"type":"error","error":{"code":"chatpass_v2_scope_not_authorized"}}`, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED},
		{`{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}`, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		{`{"type":"response.unknown"}`, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{`{"type":"response.metadata",`, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
	} {
		s, _ := ChatGPTPlanTextBehaviorStreamAssembler(&runtimev1.TextGenerateScenarioSpec{})
		_, _ = s.Append([]byte(`{"type":"response.metadata","metadata":{},"response_id":"resp_1"}`))
		_, err := s.Append([]byte(tc.event))
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != tc.reason {
			t.Fatal(tc.event, err)
		}
	}
}
