package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type capturePublicChatScenarioStreamer struct {
	request *runtimev1.StreamScenarioRequest
}

func (c *capturePublicChatScenarioStreamer) StreamScenario(
	req *runtimev1.StreamScenarioRequest,
	_ grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent],
) error {
	c.request = proto.Clone(req).(*runtimev1.StreamScenarioRequest)
	return nil
}

func TestAIBackedPublicChatTurnExecutorAddsAPMLOutputContract(t *testing.T) {
	streamer := &capturePublicChatScenarioStreamer{}
	executor := NewAIBackedPublicChatTurnExecutor(streamer)
	err := executor.StreamChatTurn(context.Background(), &PublicChatTurnExecutionRequest{
		AppID:         "desktop.app",
		SubjectUserID: "user-1",
		SystemPrompt:  "You are Alpha.",
		Messages: []*runtimev1.ChatMessage{{
			Role:    "user",
			Content: "hello",
		}},
		Binding: publicChatExecutionBinding{
			ModelID:     "local/default",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
	}, nil)
	if err != nil {
		t.Fatalf("StreamChatTurn: %v", err)
	}
	spec := streamer.request.GetSpec().GetTextGenerate()
	if spec == nil {
		t.Fatalf("expected text generate spec")
	}
	prompt := strings.TrimSpace(spec.GetSystemPrompt())
	if !strings.Contains(prompt, "You are Alpha.") {
		t.Fatalf("expected base prompt to be preserved, got %q", prompt)
	}
	if !strings.Contains(prompt, "Return APML only") || !strings.Contains(prompt, `<message id="message-0">`) {
		t.Fatalf("expected APML output contract in system prompt, got %q", prompt)
	}
	if !strings.Contains(prompt, "<emotion>calm|concerned|focus|joy|neutral|playful|surprised</emotion>") {
		t.Fatalf("expected APML emotion choices to be projected from admitted runtime emotions, got %q", prompt)
	}
	if !strings.Contains(prompt, "ext:grateful") || !strings.Contains(prompt, "thinking") {
		t.Fatalf("expected APML activity choices to be projected from admitted runtime activities, got %q", prompt)
	}
	if strings.Index(prompt, "You are Alpha.") > strings.Index(prompt, "Return APML only") {
		t.Fatalf("expected APML contract to follow base prompt for recency, got %q", prompt)
	}
}
