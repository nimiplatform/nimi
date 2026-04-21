package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

type stubPublicChatTurnExecutor struct {
	stream func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error
}

func (s stubPublicChatTurnExecutor) StreamChatTurn(
	ctx context.Context,
	req *PublicChatTurnExecutionRequest,
	emit func(*runtimev1.StreamScenarioEvent) error,
) error {
	return s.stream(ctx, req, emit)
}

type stubChatTrackSidecarExecutor struct {
	result *ChatTrackSidecarResult
	err    error
}

func (s stubChatTrackSidecarExecutor) ExecuteChatTrackSidecar(context.Context, *ChatTrackSidecarExecutorRequest) (*ChatTrackSidecarResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.result == nil {
		return &ChatTrackSidecarResult{}, nil
	}
	return s.result, nil
}

type stubPublicChatBindingResolver struct {
	resolve func(context.Context, PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error)
}

func (s stubPublicChatBindingResolver) ResolvePublicChatBinding(
	ctx context.Context,
	req PublicChatBindingResolutionRequest,
) (PublicChatBindingResolution, error) {
	return s.resolve(ctx, req)
}

type publicChatEmitCapture struct {
	mu    sync.Mutex
	items []*runtimev1.SendAppMessageRequest
	held  []*runtimev1.SendAppMessageRequest
	ch    chan *runtimev1.SendAppMessageRequest
}

func newPublicChatEmitCapture() *publicChatEmitCapture {
	return &publicChatEmitCapture{
		ch: make(chan *runtimev1.SendAppMessageRequest, 32),
	}
}

func (c *publicChatEmitCapture) emit(_ context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
	c.mu.Lock()
	c.items = append(c.items, req)
	c.mu.Unlock()
	c.ch <- req
	return &runtimev1.SendAppMessageResponse{
		MessageId: "msg_" + req.GetMessageType(),
		Accepted:  true,
	}, nil
}

func (c *publicChatEmitCapture) waitForMessageType(t *testing.T, messageType string) *runtimev1.SendAppMessageRequest {
	t.Helper()
	timeout := time.NewTimer(3 * time.Second)
	defer timeout.Stop()
	for {
		c.mu.Lock()
		for index, item := range c.held {
			if item.GetMessageType() == messageType {
				c.held = append(c.held[:index], c.held[index+1:]...)
				c.mu.Unlock()
				return item
			}
		}
		c.mu.Unlock()
		select {
		case req := <-c.ch:
			if req.GetMessageType() == messageType {
				return req
			}
			c.mu.Lock()
			c.held = append(c.held, req)
			c.mu.Unlock()
		case <-timeout.C:
			c.mu.Lock()
			seen := make([]string, 0, len(c.items))
			for _, item := range c.items {
				seen = append(seen, item.GetMessageType())
			}
			c.mu.Unlock()
			t.Fatalf("timed out waiting for message type %s; seen=%v", messageType, seen)
		}
	}
}

func newRuntimeAgentServiceForPublicChatTest(t *testing.T) *Service {
	t.Helper()
	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFn := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	t.Cleanup(closeFn)
	return svc
}

func newRuntimeAgentServiceForPublicChatStatePath(t *testing.T, localStatePath string) *Service {
	t.Helper()
	svc, closeFn := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	t.Cleanup(closeFn)
	return svc
}

func newRuntimeAgentServiceForPublicChatStatePathWithClose(t *testing.T, localStatePath string) (*Service, func()) {
	t.Helper()
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	var svc *Service
	closeFn := func() {
		if svc != nil {
			svc.Close()
		}
		_ = memorySvc.Close()
	}
	memorySvc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	if _, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		AgentId:     "agent-alpha",
		DisplayName: "Alpha",
	}); err != nil {
		if status.Code(err) != codes.AlreadyExists {
			t.Fatalf("InitializeAgent: %v", err)
		}
	}
	svc.SetPublicChatBindingResolver(stubPublicChatBindingResolver{
		resolve: func(_ context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
			route := req.RouteHint
			if route == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
				modelID := strings.ToLower(strings.TrimSpace(req.ModelID))
				if strings.HasPrefix(modelID, "cloud/") || strings.HasPrefix(modelID, "openai/") {
					route = runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
				} else {
					route = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
				}
			}
			return PublicChatBindingResolution{
				ModelID:     strings.TrimSpace(req.ModelID),
				RoutePolicy: route,
				ConnectorID: strings.TrimSpace(req.ConnectorID),
			}, nil
		},
	})
	return svc, closeFn
}

func publicChatStructPayload(t *testing.T, payload map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(payload)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}

func publicChatPayloadMap(t *testing.T, req *runtimev1.SendAppMessageRequest) map[string]any {
	t.Helper()
	if req.GetPayload() == nil {
		return map[string]any{}
	}
	return req.GetPayload().AsMap()
}

func requirePublicChatStreamSequence(t *testing.T, req *runtimev1.SendAppMessageRequest, want float64) {
	t.Helper()
	payload := publicChatPayloadMap(t, req)
	if got := payload["stream_sequence"]; got != want {
		t.Fatalf("unexpected stream_sequence for %s: got=%v want=%v payload=%v", req.GetMessageType(), got, want, payload)
	}
}

func waitForPublicChatAgentIdle(t *testing.T, svc *Service, agentID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{AgentId: agentID})
		if err == nil && resp.GetState().GetExecutionState() == runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for agent %s to return to idle", agentID)
}

func publicChatStructuredEnvelopeJSON(messageID string, text string) string {
	return fmt.Sprintf(`{"schemaId":"%s","message":{"messageId":"%s","text":"%s"},"actions":[]}`,
		publicChatStructuredSchemaID,
		messageID,
		text,
	)
}

func publicChatStructuredEnvelopeWithFollowUpJSON(messageID string, text string, actionID string, prompt string, delayMs int) string {
	return fmt.Sprintf(`{"schemaId":"%s","message":{"messageId":"%s","text":"%s"},"actions":[{"actionId":"%s","actionIndex":0,"actionCount":1,"modality":"follow-up-turn","operation":"assistant.turn.schedule","promptPayload":{"kind":"follow-up-turn","promptText":"%s","delayMs":%d},"sourceMessageId":"%s","deliveryCoupling":"after-message"}]}`,
		publicChatStructuredSchemaID,
		messageID,
		text,
		actionID,
		prompt,
		delayMs,
		messageID,
	)
}

func TestPublicChatTurnRequestStreamsAndAppliesPostTurnEffects(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeJSON("message-1", "hello from runtime")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-public-chat",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-public-chat",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-public-chat",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
						Usage: &runtimev1.UsageStats{
							InputTokens:  11,
							OutputTokens: 7,
							ComputeMs:    13,
						},
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	started := capture.waitForMessageType(t, publicChatTurnStartedType)
	delta := capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	structured := capture.waitForMessageType(t, publicChatTurnStructuredType)
	postTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	completed := capture.waitForMessageType(t, publicChatTurnCompletedType)
	requirePublicChatStreamSequence(t, accepted, 1)
	requirePublicChatStreamSequence(t, started, 2)
	requirePublicChatStreamSequence(t, delta, 3)
	requirePublicChatStreamSequence(t, structured, 4)
	requirePublicChatStreamSequence(t, postTurn, 5)
	requirePublicChatStreamSequence(t, completed, 6)

	acceptedPayload := publicChatPayloadMap(t, accepted)
	sessionID := acceptedPayload["session_id"].(string)
	turnID := acceptedPayload["turn_id"].(string)
	if sessionID == "" || turnID == "" {
		t.Fatalf("expected accepted payload to include session_id and turn_id, got=%v", acceptedPayload)
	}
	if got := acceptedPayload["session_status"]; got != "turn_active" {
		t.Fatalf("expected accepted session_status turn_active, got=%v", acceptedPayload)
	}
	if got := acceptedPayload["transcript_message_count"]; got != float64(1) {
		t.Fatalf("expected accepted transcript count 1, got=%v", acceptedPayload)
	}
	executionBinding := acceptedPayload["execution_binding"].(map[string]any)
	if got := executionBinding["route"]; got != "local" {
		t.Fatalf("expected accepted route local, got=%v", executionBinding)
	}
	if got := executionBinding["model_id"]; got != "local/default" {
		t.Fatalf("expected accepted model_id local/default, got=%v", executionBinding)
	}
	if got := publicChatPayloadMap(t, started)["model_resolved"]; got != "qwen3-chat" {
		t.Fatalf("unexpected started model_resolved: %v", got)
	}
	if got := publicChatPayloadMap(t, delta)["text"]; got != publicChatStructuredEnvelopeJSON("message-1", "hello from runtime") {
		t.Fatalf("unexpected delta text: %v", got)
	}
	structuredPayload := publicChatPayloadMap(t, structured)["structured"].(map[string]any)
	messagePayload := structuredPayload["message"].(map[string]any)
	if got := messagePayload["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected structured message text: %v", got)
	}
	postTurnPayload := publicChatPayloadMap(t, postTurn)
	assistantMemory := postTurnPayload["assistant_memory"].(map[string]any)
	if assistantMemory["status"] != "applied" {
		t.Fatalf("expected assistant memory applied, got=%v", assistantMemory)
	}
	if got := publicChatPayloadMap(t, completed)["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected completed text: %v", got)
	}

	stateResp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{AgentId: "agent-alpha"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected agent to return to idle, got=%s", stateResp.GetState().GetExecutionState())
	}

	memoryResp, err := svc.QueryAgentMemory(context.Background(), &runtimev1.QueryAgentMemoryRequest{
		AgentId:          "agent-alpha",
		Query:            "",
		Limit:            10,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(memoryResp.GetMemories()) == 0 {
		t.Fatal("expected runtime public chat to write dyadic assistant memory")
	}
	if got := memoryResp.GetMemories()[0].GetRecord().GetPayload().(*runtimev1.MemoryRecord_Observational).Observational.GetObservation(); got != "hello from runtime" {
		t.Fatalf("unexpected dyadic memory observation: %q", got)
	}
}

func TestPublicChatTurnInterruptCancelsActiveTurn(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-interrupt",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			<-ctx.Done()
			return ctx.Err()
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id": "agent-alpha",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	started := capture.waitForMessageType(t, publicChatTurnStartedType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	sessionID := acceptedPayload["session_id"].(string)
	turnID := acceptedPayload["turn_id"].(string)

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"session_id": sessionID,
			"turn_id":    turnID,
			"reason":     "user_cancelled",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(interrupt): %v", err)
	}

	ack := capture.waitForMessageType(t, publicChatTurnInterruptAckType)
	interrupted := capture.waitForMessageType(t, publicChatTurnInterruptedType)
	requirePublicChatStreamSequence(t, accepted, 1)
	requirePublicChatStreamSequence(t, started, 2)
	requirePublicChatStreamSequence(t, ack, 3)
	requirePublicChatStreamSequence(t, interrupted, 4)
	if got := publicChatPayloadMap(t, ack)["accepted"]; got != true {
		t.Fatalf("expected interrupt ack accepted=true, got=%v", got)
	}
	if got := publicChatPayloadMap(t, interrupted)["reason"]; got != "user_cancelled" {
		t.Fatalf("unexpected interrupt reason: %v", got)
	}

	stateResp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{AgentId: "agent-alpha"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected agent to return to idle after interrupt, got=%s", stateResp.GetState().GetExecutionState())
	}
}

func TestPublicChatSessionSnapshotReportsLiveAndTerminalState(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	release := make(chan struct{})
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeJSON("message-snapshot", "snapshot complete")
			splitAt := len(envelope) / 2
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope[:splitAt]},
						},
					},
				},
			}); err != nil {
				return err
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-release:
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope[splitAt:]},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-session-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-session-snapshot",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	sessionID := publicChatPayloadMap(t, accepted)["session_id"].(string)

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"session_id": sessionID,
			"request_id": "snapshot-live-1",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot-live): %v", err)
	}

	liveSnapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	livePayload := publicChatPayloadMap(t, liveSnapshot)
	if got := livePayload["request_id"]; got != "snapshot-live-1" {
		t.Fatalf("expected live snapshot request_id, got=%v", livePayload)
	}
	if got := livePayload["session_status"]; got != "turn_active" {
		t.Fatalf("expected live session_status turn_active, got=%v", livePayload)
	}
	activeTurn := livePayload["active_turn"].(map[string]any)
	if got := activeTurn["status"]; got != publicChatTurnStatusStreaming {
		t.Fatalf("expected active turn status streaming, got=%v", activeTurn)
	}
	if got := activeTurn["trace_id"]; got != "trace-session-snapshot" {
		t.Fatalf("expected active turn trace_id, got=%v", activeTurn)
	}
	if got := activeTurn["stream_sequence"]; got != float64(3) {
		t.Fatalf("expected active turn stream_sequence 3, got=%v", activeTurn)
	}
	if got := activeTurn["output_observed"]; got != true {
		t.Fatalf("expected active turn output_observed=true, got=%v", activeTurn)
	}

	close(release)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"session_id": sessionID,
			"request_id": "snapshot-live-2",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot-terminal): %v", err)
	}

	terminalSnapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	terminalPayload := publicChatPayloadMap(t, terminalSnapshot)
	if got := terminalPayload["request_id"]; got != "snapshot-live-2" {
		t.Fatalf("expected terminal snapshot request_id, got=%v", terminalPayload)
	}
	if got := terminalPayload["session_status"]; got != "idle" {
		t.Fatalf("expected terminal session_status idle, got=%v", terminalPayload)
	}
	if _, ok := terminalPayload["active_turn"]; ok {
		t.Fatalf("expected no active_turn after completion, got=%v", terminalPayload)
	}
	lastTurn := terminalPayload["last_turn"].(map[string]any)
	if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("expected last turn completed, got=%v", lastTurn)
	}
	if got := lastTurn["message_id"]; got != "message-snapshot" {
		t.Fatalf("expected last turn message_id, got=%v", lastTurn)
	}
	if got := lastTurn["text"]; got != "snapshot complete" {
		t.Fatalf("expected last turn text, got=%v", lastTurn)
	}
	structured := lastTurn["structured"].(map[string]any)
	if got := structured["schema_id"]; got != publicChatStructuredSchemaID {
		t.Fatalf("expected structured schema id, got=%v", structured)
	}
	assistantMemory := lastTurn["assistant_memory"].(map[string]any)
	if got := assistantMemory["status"]; got != "applied" {
		t.Fatalf("expected assistant memory applied in last turn snapshot, got=%v", assistantMemory)
	}
	followUp := lastTurn["follow_up"].(map[string]any)
	if got := followUp["status"]; got != "skipped" {
		t.Fatalf("expected last turn follow_up skipped, got=%v", followUp)
	}
	if got := terminalPayload["transcript_message_count"]; got != float64(2) {
		t.Fatalf("expected transcript count 2, got=%v", terminalPayload)
	}
}

func TestPublicChatTurnRequestAllowsRouteOmissionWhenRuntimeResolvesBinding(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if req.Binding.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
				t.Fatalf("expected runtime-resolved local route, got=%v", req.Binding.RoutePolicy)
			}
			if req.Binding.ModelID != "local/default" {
				t.Fatalf("expected runtime-resolved model to preserve requested id, got=%q", req.Binding.ModelID)
			}
			envelope := publicChatStructuredEnvelopeJSON("message-route-omission", "runtime resolved route")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-route-omission",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-route-omission",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-route-omission",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-route-omission",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	started := capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	acceptedPayload := publicChatPayloadMap(t, accepted)
	if got := acceptedPayload["stream_sequence"]; got != float64(1) {
		t.Fatalf("expected accepted stream sequence 1, got=%v", acceptedPayload)
	}
	executionBinding := acceptedPayload["execution_binding"].(map[string]any)
	if got := executionBinding["route"]; got != "local" {
		t.Fatalf("expected runtime-resolved accepted route local, got=%v", executionBinding)
	}
	if got := executionBinding["model_id"]; got != "local/default" {
		t.Fatalf("expected runtime-resolved accepted model_id local/default, got=%v", executionBinding)
	}
	startedPayload := publicChatPayloadMap(t, started)
	if got := startedPayload["route_decision"]; got != "local" {
		t.Fatalf("expected started route_decision local, got=%v", startedPayload)
	}
}

func TestPublicChatTurnInvalidStructuredOutputFailsClosed(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-invalid-structured",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-invalid-structured",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: `{"schemaId":"bad","message":{"messageId":"m1","text":"hello"},"actions":[]}`},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-invalid-structured",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id": "agent-alpha",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	started := capture.waitForMessageType(t, publicChatTurnStartedType)
	delta := capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	requirePublicChatStreamSequence(t, accepted, 1)
	requirePublicChatStreamSequence(t, started, 2)
	requirePublicChatStreamSequence(t, delta, 3)
	requirePublicChatStreamSequence(t, failed, 4)
	if got := publicChatPayloadMap(t, failed)["reason_code"]; got != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("expected AI_OUTPUT_INVALID, got=%v", got)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatFollowUpRunsInsideRuntime(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	var mu sync.Mutex
	callCount := 0
	executor := stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}

			var envelope string
			switch currentCall {
			case 1:
				envelope = publicChatStructuredEnvelopeWithFollowUpJSON("message-1", "hello from runtime", "action-follow-up-1", "continue naturally", 20)
			case 2:
				if got := strings.TrimSpace(req.SystemPrompt); !strings.Contains(got, "FollowUpInstruction:") || !strings.Contains(got, "continue naturally") {
					t.Fatalf("expected follow-up system prompt to include internal continuation cue, got=%q", got)
				}
				if len(req.Messages) < 2 || req.Messages[len(req.Messages)-1].GetContent() != "hello from runtime" {
					t.Fatalf("expected follow-up request to include prior assistant text, got=%v", req.Messages)
				}
				envelope = publicChatStructuredEnvelopeJSON("message-2", "runtime follow up complete")
			default:
				t.Fatalf("unexpected follow-up executor call %d", currentCall)
			}

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}

			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	}
	svc.SetPublicChatTurnExecutor(executor)

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-follow-up",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	firstAccepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	firstCompleted := capture.waitForMessageType(t, publicChatTurnCompletedType)
	secondAccepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	secondPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	secondCompleted := capture.waitForMessageType(t, publicChatTurnCompletedType)

	firstFollowUp := publicChatPayloadMap(t, firstPostTurn)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected first turn follow-up scheduled, got=%v", firstFollowUp)
	}
	if got := publicChatPayloadMap(t, firstAccepted)["turn_origin"]; got != publicChatTurnOriginUser {
		t.Fatalf("expected initial turn origin=user, got=%v", got)
	}
	firstAcceptedPayload := publicChatPayloadMap(t, firstAccepted)
	firstBinding := firstAcceptedPayload["execution_binding"].(map[string]any)
	if got := firstBinding["route"]; got != "local" {
		t.Fatalf("expected first accepted route local, got=%v", firstBinding)
	}
	secondAcceptedPayload := publicChatPayloadMap(t, secondAccepted)
	if got := secondAcceptedPayload["turn_origin"]; got != publicChatTurnOriginFollowUp {
		t.Fatalf("expected follow-up turn origin=follow_up, got=%v", secondAcceptedPayload)
	}
	if got := secondAcceptedPayload["follow_up_depth"]; got != float64(1) {
		t.Fatalf("expected follow-up depth 1, got=%v", secondAcceptedPayload)
	}
	if got := secondAcceptedPayload["chain_id"]; got == "" {
		t.Fatalf("expected follow-up accepted event to include chain_id, got=%v", secondAcceptedPayload)
	}
	secondBinding := secondAcceptedPayload["execution_binding"].(map[string]any)
	if got := secondBinding["route"]; got != "local" {
		t.Fatalf("expected follow-up accepted route local, got=%v", secondBinding)
	}
	if got := secondAcceptedPayload["transcript_message_count"]; got != float64(2) {
		t.Fatalf("expected follow-up accepted transcript count 2, got=%v", secondAcceptedPayload)
	}
	secondFollowUp := publicChatPayloadMap(t, secondPostTurn)["follow_up"].(map[string]any)
	if got := secondFollowUp["status"]; got != "skipped" {
		t.Fatalf("expected second turn follow-up skipped, got=%v", secondFollowUp)
	}
	if got := publicChatPayloadMap(t, firstCompleted)["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected first completed text: %v", got)
	}
	if got := publicChatPayloadMap(t, secondCompleted)["text"]; got != "runtime follow up complete" {
		t.Fatalf("unexpected second completed text: %v", got)
	}

	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected runtime executor to run two turns including follow-up, got=%d", callCount)
	}
}

func TestPublicChatTurnFailureProjectsRuntimeActionHintAndBindingContext(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
			return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    "local model unavailable during runtime public chat preflight",
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-preflight-failure",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	requirePublicChatStreamSequence(t, accepted, 1)
	requirePublicChatStreamSequence(t, failed, 2)
	failedPayload := publicChatPayloadMap(t, failed)
	if got := failedPayload["reason_code"]; got != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got=%v", failedPayload)
	}
	if got := failedPayload["action_hint"]; got != "inspect_local_runtime_model_health" {
		t.Fatalf("expected action_hint on failed payload, got=%v", failedPayload)
	}
	if got := failedPayload["message"]; got != "local model unavailable during runtime public chat preflight" {
		t.Fatalf("expected runtime preflight message on failed payload, got=%v", failedPayload)
	}
	if got := failedPayload["model_resolved"]; got != "local/default" {
		t.Fatalf("expected resolved model on failed payload, got=%v", failedPayload)
	}
	if got := failedPayload["route_decision"]; got != "local" {
		t.Fatalf("expected route_decision local on failed payload, got=%v", failedPayload)
	}

	sessionID := publicChatPayloadMap(t, accepted)["session_id"].(string)
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"session_id": sessionID,
			"request_id": "snapshot-preflight-failure",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot): %v", err)
	}
	snapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	snapshotPayload := publicChatPayloadMap(t, snapshot)
	lastTurn := snapshotPayload["last_turn"].(map[string]any)
	if got := lastTurn["status"]; got != publicChatTurnStatusFailed {
		t.Fatalf("expected failed last_turn, got=%v", lastTurn)
	}
	if got := lastTurn["reason_code"]; got != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected failed reason_code in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["action_hint"]; got != "inspect_local_runtime_model_health" {
		t.Fatalf("expected action_hint in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["message"]; got != "local model unavailable during runtime public chat preflight" {
		t.Fatalf("expected message in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["model_resolved"]; got != "local/default" {
		t.Fatalf("expected model_resolved in snapshot, got=%v", lastTurn)
	}
	if got := lastTurn["route_decision"]; got != "local" {
		t.Fatalf("expected route_decision in snapshot, got=%v", lastTurn)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatFollowUpCancelsOnNewUserTurn(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	var mu sync.Mutex
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-cancel-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}

			envelope := publicChatStructuredEnvelopeJSON(fmt.Sprintf("message-%d", currentCall), fmt.Sprintf("turn-%d", currentCall))
			if currentCall == 1 {
				envelope = publicChatStructuredEnvelopeWithFollowUpJSON("message-1", "turn-1", "action-follow-up-1", "come back later", 150)
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-cancel-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-cancel-follow-up-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	firstErr := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-cancel-follow-up",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if firstErr != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", firstErr)
	}

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstFollowUp := publicChatPayloadMap(t, firstPostTurn)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected follow-up scheduled, got=%v", firstFollowUp)
	}

	secondErr := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-cancel-follow-up",
			"messages": []any{
				map[string]any{"role": "user", "content": "new user reply"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if secondErr != nil {
		t.Fatalf("ConsumePublicChatAppMessage(second): %v", secondErr)
	}

	canceled := capture.waitForMessageType(t, publicChatFollowUpCanceledType)
	secondAccepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	canceledPayload := publicChatPayloadMap(t, canceled)
	if got := canceledPayload["reason"]; got != "user_message" {
		t.Fatalf("expected follow-up canceled by user_message, got=%v", canceledPayload)
	}
	if got := publicChatPayloadMap(t, secondAccepted)["turn_origin"]; got != publicChatTurnOriginUser {
		t.Fatalf("expected second accepted turn to be user-originated, got=%v", got)
	}

	time.Sleep(250 * time.Millisecond)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected pending follow-up to be canceled before execution, got callCount=%d", callCount)
	}
}

func TestPublicChatFollowUpRecoversAfterRestart(t *testing.T) {
	t.Parallel()

	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	firstCapture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(firstCapture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	var mu sync.Mutex
	callCount := 0
	executor := stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-recovery-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}

			var envelope string
			switch currentCall {
			case 1:
				envelope = publicChatStructuredEnvelopeWithFollowUpJSON("message-1", "persist me", "action-recover", "resume after restart", 200)
			case 2:
				if got := strings.TrimSpace(req.SystemPrompt); !strings.Contains(got, "resume after restart") {
					t.Fatalf("expected recovered follow-up system prompt, got=%q", got)
				}
				if len(req.Messages) < 2 || req.Messages[len(req.Messages)-1].GetContent() != "persist me" {
					t.Fatalf("expected recovered follow-up transcript to include persisted assistant text, got=%v", req.Messages)
				}
				envelope = publicChatStructuredEnvelopeJSON("message-2", "recovered follow up")
			default:
				t.Fatalf("unexpected recovered call count=%d", currentCall)
			}

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-recovery-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-recovery-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	}
	svc.SetPublicChatTurnExecutor(executor)

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-recovery",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}

	_ = firstCapture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStartedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStructuredType)
	postTurn := firstCapture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnCompletedType)
	firstFollowUp := publicChatPayloadMap(t, postTurn)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected persisted follow-up scheduled, got=%v", firstFollowUp)
	}

	closeFirst()

	recoveredSvc, closeRecovered := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeRecovered()
	recoveredCapture := newPublicChatEmitCapture()
	recoveredSvc.SetPublicChatAppEmitter(recoveredCapture.emit)
	recoveredSvc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	recoveredSvc.SetPublicChatTurnExecutor(executor)

	recoveredAccepted := recoveredCapture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = recoveredCapture.waitForMessageType(t, publicChatTurnStartedType)
	_ = recoveredCapture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = recoveredCapture.waitForMessageType(t, publicChatTurnStructuredType)
	recoveredPostTurn := recoveredCapture.waitForMessageType(t, publicChatTurnPostTurnType)
	recoveredCompleted := recoveredCapture.waitForMessageType(t, publicChatTurnCompletedType)

	recoveredAcceptedPayload := publicChatPayloadMap(t, recoveredAccepted)
	if got := recoveredAcceptedPayload["turn_origin"]; got != publicChatTurnOriginFollowUp {
		t.Fatalf("expected recovered accepted turn to be follow_up, got=%v", recoveredAcceptedPayload)
	}
	if got := recoveredAcceptedPayload["follow_up_depth"]; got != float64(1) {
		t.Fatalf("expected recovered follow-up depth 1, got=%v", recoveredAcceptedPayload)
	}
	recoveredFollowUp := publicChatPayloadMap(t, recoveredPostTurn)["follow_up"].(map[string]any)
	if got := recoveredFollowUp["status"]; got != "skipped" {
		t.Fatalf("expected recovered follow-up chain to stop, got=%v", recoveredFollowUp)
	}
	if got := publicChatPayloadMap(t, recoveredCompleted)["text"]; got != "recovered follow up" {
		t.Fatalf("unexpected recovered follow-up text: %v", got)
	}

	waitForPublicChatAgentIdle(t, recoveredSvc, "agent-alpha")

	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected executor to run original turn plus recovered follow-up, got=%d", callCount)
	}
}

func TestPublicChatFollowUpCancelsOnSessionReuseWithoutThreadReplay(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	var mu sync.Mutex
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-session-reuse-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}

			var envelope string
			switch currentCall {
			case 1:
				envelope = publicChatStructuredEnvelopeWithFollowUpJSON("message-1", "hello from runtime", "action-follow-up-1", "continue naturally", 200)
			default:
				envelope = publicChatStructuredEnvelopeJSON("message-2", "new user reply handled")
			}

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-session-reuse-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}

			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-session-reuse-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-session-reuse-cancel",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}

	firstAccepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstFollowUp := publicChatPayloadMap(t, firstPostTurn)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected follow-up scheduled, got=%v", firstFollowUp)
	}
	sessionID := publicChatPayloadMap(t, firstAccepted)["session_id"].(string)

	secondErr := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":   "agent-alpha",
			"session_id": sessionID,
			"messages": []any{
				map[string]any{"role": "user", "content": "new user reply"},
			},
		}),
	})
	if secondErr != nil {
		t.Fatalf("ConsumePublicChatAppMessage(second): %v", secondErr)
	}

	canceled := capture.waitForMessageType(t, publicChatFollowUpCanceledType)
	secondAccepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	canceledPayload := publicChatPayloadMap(t, canceled)
	if got := canceledPayload["reason"]; got != "user_message" {
		t.Fatalf("expected follow-up canceled by user_message, got=%v", canceledPayload)
	}
	if got := publicChatPayloadMap(t, secondAccepted)["turn_origin"]; got != publicChatTurnOriginUser {
		t.Fatalf("expected second accepted turn to be user-originated, got=%v", got)
	}

	time.Sleep(250 * time.Millisecond)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected pending follow-up to be canceled before execution, got callCount=%d", callCount)
	}
}

func TestPublicChatFollowUpCanceledProjectsRuntimeActionHint(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	acceptedCount := 0
	svc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		if req.GetMessageType() == publicChatTurnAcceptedType {
			acceptedCount++
			if acceptedCount == 2 {
				return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
					ActionHint: "inspect_local_runtime_model_health",
					Message:    "local model unavailable before follow-up turn dispatch",
				})
			}
		}
		return capture.emit(ctx, req)
	})
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	var mu sync.Mutex
	callCount := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			mu.Lock()
			callCount++
			currentCall := callCount
			mu.Unlock()

			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   fmt.Sprintf("trace-follow-up-cancel-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}

			envelope := publicChatStructuredEnvelopeWithFollowUpJSON("message-1", "turn-1", "action-follow-up-1", "come back later", 20)
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   fmt.Sprintf("trace-follow-up-cancel-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}

			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   fmt.Sprintf("trace-follow-up-cancel-%d", currentCall),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-follow-up-cancel-action-hint",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	sessionID := publicChatPayloadMap(t, accepted)["session_id"]
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstFollowUp := publicChatPayloadMap(t, firstPostTurn)["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected follow-up scheduled, got=%v", firstFollowUp)
	}

	canceled := capture.waitForMessageType(t, publicChatFollowUpCanceledType)
	canceledPayload := publicChatPayloadMap(t, canceled)
	if got := canceledPayload["reason"]; got != "runtime_unavailable" {
		t.Fatalf("expected runtime_unavailable cancel reason, got=%v", canceledPayload)
	}
	if got := canceledPayload["reason_code"]; got != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE cancel reason_code, got=%v", canceledPayload)
	}
	if got := canceledPayload["action_hint"]; got != "inspect_local_runtime_model_health" {
		t.Fatalf("expected action_hint on follow-up cancel, got=%v", canceledPayload)
	}
	if got := canceledPayload["message"]; got != "local model unavailable before follow-up turn dispatch" {
		t.Fatalf("expected follow-up cancel message, got=%v", canceledPayload)
	}

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"session_id": sessionID,
			"request_id": "snapshot-follow-up-launch-failed",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot): %v", err)
	}
	snapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	lastTurn := publicChatPayloadMap(t, snapshot)["last_turn"].(map[string]any)
	lastTurnFollowUp := lastTurn["follow_up"].(map[string]any)
	if got := lastTurnFollowUp["status"]; got != "canceled" {
		t.Fatalf("expected snapshot follow_up canceled, got=%v", lastTurnFollowUp)
	}
	if got := lastTurnFollowUp["action_hint"]; got != "inspect_local_runtime_model_health" {
		t.Fatalf("expected snapshot follow_up action_hint, got=%v", lastTurnFollowUp)
	}
	if got := lastTurnFollowUp["reason_code"]; got != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected snapshot follow_up reason_code, got=%v", lastTurnFollowUp)
	}
	if got := lastTurnFollowUp["message"]; got != "local model unavailable before follow-up turn dispatch" {
		t.Fatalf("expected snapshot follow_up message, got=%v", lastTurnFollowUp)
	}

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if callCount != 1 {
		t.Fatalf("expected follow-up launch to fail before executor call, got callCount=%d", callCount)
	}
}

func TestPublicChatSessionSnapshotPersistsLastTurnAcrossRestart(t *testing.T) {
	t.Parallel()

	localStatePath := t.TempDir() + "/local-state.json"
	svc, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	firstCapture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(firstCapture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeJSON("message-restart-snapshot", "persisted terminal text")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-restart-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-restart-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-restart-snapshot",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":  "agent-alpha",
			"thread_id": "thread-restart-snapshot",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}

	accepted := firstCapture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStartedType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = firstCapture.waitForMessageType(t, publicChatTurnCompletedType)
	sessionID := publicChatPayloadMap(t, accepted)["session_id"].(string)

	closeFirst()

	recoveredSvc, closeRecovered := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeRecovered()
	recoveredCapture := newPublicChatEmitCapture()
	recoveredSvc.SetPublicChatAppEmitter(recoveredCapture.emit)

	err = recoveredSvc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"session_id": sessionID,
			"request_id": "restart-snapshot-1",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot after restart): %v", err)
	}

	snapshot := recoveredCapture.waitForMessageType(t, publicChatSessionSnapshotType)
	payload := publicChatPayloadMap(t, snapshot)
	if got := payload["request_id"]; got != "restart-snapshot-1" {
		t.Fatalf("expected request_id echo, got=%v", payload)
	}
	if got := payload["session_status"]; got != "idle" {
		t.Fatalf("expected idle session after restart, got=%v", payload)
	}
	lastTurn := payload["last_turn"].(map[string]any)
	if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("expected persisted last turn completed, got=%v", lastTurn)
	}
	if got := lastTurn["message_id"]; got != "message-restart-snapshot" {
		t.Fatalf("expected persisted message id, got=%v", lastTurn)
	}
	if got := lastTurn["text"]; got != "persisted terminal text" {
		t.Fatalf("expected persisted terminal text, got=%v", lastTurn)
	}
	if structured, ok := lastTurn["structured"].(map[string]any); !ok || structured["schema_id"] != publicChatStructuredSchemaID {
		t.Fatalf("expected persisted structured payload, got=%v", lastTurn)
	}
	if assistantMemory, ok := lastTurn["assistant_memory"].(map[string]any); !ok || assistantMemory["status"] != "applied" {
		t.Fatalf("expected persisted assistant memory outcome, got=%v", lastTurn)
	}
}

func TestPublicChatTurnRejectsConcurrentTurnForSameAgent(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	release := make(chan struct{})
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeJSON("message-concurrent", "done")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-concurrent",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-release:
				if err := emit(&runtimev1.StreamScenarioEvent{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
					TraceId:   "trace-concurrent",
					Payload: &runtimev1.StreamScenarioEvent_Delta{
						Delta: &runtimev1.ScenarioStreamDelta{
							Delta: &runtimev1.ScenarioStreamDelta_Text{
								Text: &runtimev1.TextStreamDelta{Text: envelope},
							},
						},
					},
				}); err != nil {
					return err
				}
				return emit(&runtimev1.StreamScenarioEvent{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
					TraceId:   "trace-concurrent",
					Payload: &runtimev1.StreamScenarioEvent_Completed{
						Completed: &runtimev1.ScenarioStreamCompleted{
							FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
						},
					},
				})
			}
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id": "agent-alpha",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(first): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id": "agent-alpha",
			"messages": []any{
				map[string]any{"role": "user", "content": "second turn"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected concurrent turn rejection, got err=%v code=%v", err, status.Code(err))
	}

	close(release)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}

func TestPublicChatSessionRejectsThreadIdentityDrift(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeJSON("message-session", "hello")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-session",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-session",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-session",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":   "agent-alpha",
			"session_id": "session-fixed",
			"thread_id":  "thread-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(initial session): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":   "agent-alpha",
			"session_id": "session-fixed",
			"thread_id":  "thread-2",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello again"},
			},
		}),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected thread identity drift rejection, got err=%v code=%v", err, status.Code(err))
	}
}

func TestPublicChatSessionRejectsExecutionBindingDrift(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeJSON("message-binding", "hello")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-binding",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-binding",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: envelope},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-binding",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":   "agent-alpha",
			"session_id": "session-binding-fixed",
			"thread_id":  "thread-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
			"execution_binding": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(initial session): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":   "agent-alpha",
			"session_id": "session-binding-fixed",
			"thread_id":  "thread-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello again"},
			},
			"execution_binding": map[string]any{
				"route":    "cloud",
				"model_id": "cloud/gpt-5.4-mini",
			},
		}),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected execution binding drift rejection, got err=%v code=%v", err, status.Code(err))
	}
}
