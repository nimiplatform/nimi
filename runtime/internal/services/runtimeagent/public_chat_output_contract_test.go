package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

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

type blockingPublicChatScenarioStreamer struct {
	entered chan struct{}
}

func (b *blockingPublicChatScenarioStreamer) StreamScenario(
	_ *runtimev1.StreamScenarioRequest,
	_ grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent],
) error {
	close(b.entered)
	select {}
}

type failingPublicChatScenarioStreamer struct {
	err error
}

func (f *failingPublicChatScenarioStreamer) StreamScenario(
	_ *runtimev1.StreamScenarioRequest,
	_ grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent],
) error {
	return f.err
}

func TestPublicChatScenarioStreamServerDoesNotEmitAfterContextCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	stream := &publicChatScenarioStreamServer{
		ctx: ctx,
		send: func(*runtimev1.StreamScenarioEvent) error {
			called = true
			return nil
		},
	}

	err := stream.Send(&runtimev1.StreamScenarioEvent{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled context from late scenario event, got %v", err)
	}
	if called {
		t.Fatal("late scenario event reached public chat emitter after context cancellation")
	}
}

func TestAIBackedPublicChatTurnExecutorPropagatesScenarioErrorBeforeDeadline(t *testing.T) {
	t.Parallel()
	scenarioErr := errors.New("scenario transport failed")
	executor := NewAIBackedPublicChatTurnExecutor(&failingPublicChatScenarioStreamer{err: scenarioErr})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	err := executor.StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
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
	if !errors.Is(err, scenarioErr) {
		t.Fatalf("expected original scenario error, got %v", err)
	}
}

func TestAIBackedPublicChatTurnExecutorReturnsWhenScenarioIgnoresContext(t *testing.T) {
	t.Parallel()
	streamer := &blockingPublicChatScenarioStreamer{entered: make(chan struct{})}
	executor := NewAIBackedPublicChatTurnExecutor(streamer)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- executor.StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
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
	}()

	select {
	case <-streamer.entered:
	case <-time.After(time.Second):
		t.Fatal("expected public chat executor to call StreamScenario")
	}

	select {
	case err := <-errCh:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected context deadline when scenario ignores context, got %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("public chat executor did not return after context deadline")
	}
}

func TestAIBackedPublicChatTurnExecutorPreservesRuntimeComposedAPMLOutputContract(t *testing.T) {
	streamer := &capturePublicChatScenarioStreamer{}
	executor := NewAIBackedPublicChatTurnExecutor(streamer)
	composedPrompt := publicChatAPMLOutputContractPrompt(publicChatAvailableActions{ImageGenerate: publicChatImageActionAvailable})
	err := executor.StreamChatTurn(context.Background(), &PublicChatTurnExecutionRequest{
		AppID:         "desktop.app",
		SubjectUserID: "user-1",
		SystemPrompt:  composedPrompt,
		Messages: []*runtimev1.ChatMessage{{
			Role:    "user",
			Content: "hello",
		}},
		Binding: publicChatExecutionBinding{
			ModelID:     "local/default",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		AvailableActions: publicChatAvailableActions{ImageGenerate: publicChatImageActionAvailable},
	}, nil)
	if err != nil {
		t.Fatalf("StreamChatTurn: %v", err)
	}
	spec := streamer.request.GetSpec().GetTextGenerate()
	if spec == nil {
		t.Fatalf("expected text generate spec")
	}
	prompt := strings.TrimSpace(spec.GetSystemPrompt())
	if prompt != composedPrompt {
		t.Fatalf("provider adapter mutated the Runtime-composed output contract")
	}
	if !strings.Contains(prompt, `Output APML only`) || !strings.Contains(prompt, `<message id="message-0">`) {
		t.Fatalf("expected APML output contract in system prompt, got %q", prompt)
	}
	if !strings.Contains(prompt, `no Markdown, JSON, fences, <think>, or other prose`) || !strings.Contains(prompt, `at most one each`) {
		t.Fatalf("expected APML output contract to forbid non-APML wrappers and duplicate cues, got %q", prompt)
	}
	if !strings.Contains(prompt, `Begin exactly <message id="message-0">`) || !strings.Contains(prompt, `FINAL: reply ONLY as <message id="message-0">reply text</message>`) {
		t.Fatalf("expected APML contract to reinforce the first emitted token for compact local models, got %q", prompt)
	}
	if !strings.Contains(prompt, `<message id="message-0">reply text</message>`) || !strings.Contains(prompt, "Never self-close <message>") {
		t.Fatalf("expected a complete text-only APML example that forbids the observed self-closing message failure, got %q", prompt)
	}
	if !strings.Contains(prompt, "<emotion>angry|confused|embarrassed|excited|ext:apologetic|ext:grateful|ext:lonely|ext:proud|happy|neutral|sad|shy|surprised|worried</emotion>") {
		t.Fatalf("expected APML emotion choices to be projected from admitted runtime emotions, got %q", prompt)
	}
	if !strings.Contains(prompt, "Optional inside <message>") || !strings.Contains(prompt, `"focused" is activity, not emotion`) {
		t.Fatalf("expected APML contract to prevent activity/emotion category drift, got %q", prompt)
	}
	if !strings.Contains(prompt, "inside <message>") {
		t.Fatalf("expected APML cue placement to remain explicit, got %q", prompt)
	}
	if !strings.Contains(prompt, "ext:grateful") || !strings.Contains(prompt, "thinking") {
		t.Fatalf("expected APML activity choices to be projected from admitted runtime activities, got %q", prompt)
	}
	if !strings.Contains(prompt, "If the user asks to create, draw, generate, send, or show an image") {
		t.Fatalf("expected APML image intent routing rule in system prompt, got %q", prompt)
	}
	if !strings.Contains(prompt, "agent photo/avatar/selfie request") {
		t.Fatalf("expected APML agent portrait image rule in system prompt, got %q", prompt)
	}
}

func TestPublicChatAPMLOutputContractDisablesUnavailableImageAction(t *testing.T) {
	streamer := &capturePublicChatScenarioStreamer{}
	executor := NewAIBackedPublicChatTurnExecutor(streamer)
	composedPrompt := publicChatAPMLOutputContractPrompt(publicChatAvailableActions{ImageGenerate: publicChatImageActionNotConfigured})
	err := executor.StreamChatTurn(context.Background(), &PublicChatTurnExecutionRequest{
		AppID:         "desktop.app",
		SubjectUserID: "user-1",
		SystemPrompt:  composedPrompt,
		Messages: []*runtimev1.ChatMessage{{
			Role:    "user",
			Content: "generate a photo",
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
	if prompt != composedPrompt {
		t.Fatalf("provider adapter mutated the Runtime-composed unavailable-image contract")
	}
	if strings.Contains(prompt, `include exactly one sibling <action kind="image">`) {
		t.Fatalf("default APML contract must not expose image action routing, got %q", prompt)
	}
	if !strings.Contains(prompt, `Do not output <action kind="image">`) {
		t.Fatalf("default APML contract must explicitly prohibit image action output, got %q", prompt)
	}
	if got := len([]byte(prompt)); got > 1800 {
		t.Fatalf("default APML contract exceeds the mandatory context budget: bytes=%d", got)
	}
}
