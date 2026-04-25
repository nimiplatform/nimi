package runtimeagent

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"strings"
	"sync"
	"testing"
	"time"
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

// openPublicChatTestAnchor opens a ConversationAnchor for the given caller
// and returns its id. Per K-AGCORE-034 `runtime.agent.turn.request` requires
// an existing anchor; there is no implicit anchor creation on the ingress
// path, so tests must open one explicitly before issuing any turn request.
func openPublicChatTestAnchor(t *testing.T, svc *Service, agentID string, callerAppID string, subjectUserID string) string {
	t.Helper()
	resp, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       &runtimev1.AgentRequestContext{AppId: callerAppID, SubjectUserId: subjectUserID},
		AgentId:       agentID,
		SubjectUserId: subjectUserID,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor: %v", err)
	}
	anchorID := resp.GetSnapshot().GetAnchor().GetConversationAnchorId()
	if anchorID == "" {
		t.Fatalf("OpenConversationAnchor returned empty anchor id")
	}
	return anchorID
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

// publicChatTurnDetail extracts the runtime.agent.turn.*.detail payload per
// yaml turn_envelope (envelope at top, event-specific fields under
// `detail`). Fails if the event has no detail object.
func publicChatTurnDetail(t *testing.T, req *runtimev1.SendAppMessageRequest) map[string]any {
	t.Helper()
	payload := publicChatPayloadMap(t, req)
	detail, ok := payload["detail"].(map[string]any)
	if !ok {
		t.Fatalf("expected detail object on %s, got payload=%v", req.GetMessageType(), payload)
	}
	return detail
}

// publicChatSessionSnapshotDetail extracts the inner
// session.snapshot.detail.snapshot map per yaml session_events.
// Runtime carrier execution truth lives only inside this map.
func publicChatSessionSnapshotDetail(t *testing.T, req *runtimev1.SendAppMessageRequest) map[string]any {
	t.Helper()
	payload := publicChatPayloadMap(t, req)
	detail, ok := payload["detail"].(map[string]any)
	if !ok {
		t.Fatalf("expected session.snapshot detail object, got payload=%v", payload)
	}
	snapshot, ok := detail["snapshot"].(map[string]any)
	if !ok {
		t.Fatalf("expected session.snapshot detail.snapshot object, got detail=%v", detail)
	}
	return snapshot
}

// publicChatActiveTurnSnapshot returns session.snapshot.detail.snapshot.active_turn.
func publicChatActiveTurnSnapshot(t *testing.T, req *runtimev1.SendAppMessageRequest) map[string]any {
	t.Helper()
	snap := publicChatSessionSnapshotDetail(t, req)
	active, ok := snap["active_turn"].(map[string]any)
	if !ok {
		t.Fatalf("expected snapshot.active_turn map, got snap=%v", snap)
	}
	return active
}

// publicChatLastTurnSnapshot returns session.snapshot.detail.snapshot.last_turn.
func publicChatLastTurnSnapshot(t *testing.T, req *runtimev1.SendAppMessageRequest) map[string]any {
	t.Helper()
	snap := publicChatSessionSnapshotDetail(t, req)
	last, ok := snap["last_turn"].(map[string]any)
	if !ok {
		t.Fatalf("expected snapshot.last_turn map, got snap=%v", snap)
	}
	return last
}
func publicChatPostTurnHookIntent(t *testing.T, req *runtimev1.SendAppMessageRequest) map[string]any {
	t.Helper()
	detail := publicChatTurnDetail(t, req)
	hookIntent, ok := detail["hook_intent"].(map[string]any)
	if !ok {
		t.Fatalf("expected post_turn.detail.hook_intent object, got detail=%v", detail)
	}
	return hookIntent
}
func requirePublicChatPostTurnHookIntent(t *testing.T, req *runtimev1.SendAppMessageRequest, expectedIntentID string, expectedAdmissionState string, expectedDelayMs int) {
	t.Helper()
	hookIntent := publicChatPostTurnHookIntent(t, req)
	if got := hookIntent["intent_id"]; got != expectedIntentID {
		t.Fatalf("expected hook_intent.intent_id=%s, got=%v", expectedIntentID, hookIntent)
	}
	if got := hookIntent["trigger_family"]; got != "time" {
		t.Fatalf("expected hook_intent.trigger_family=time, got=%v", hookIntent)
	}
	triggerDetail, ok := hookIntent["trigger_detail"].(map[string]any)
	if !ok {
		t.Fatalf("expected hook_intent.trigger_detail object, got=%v", hookIntent)
	}
	timeDetail, ok := triggerDetail["time"].(map[string]any)
	if !ok {
		t.Fatalf("expected hook_intent.trigger_detail.time object, got=%v", triggerDetail)
	}
	if got := timeDetail["delay_ms"]; got != float64(expectedDelayMs) {
		t.Fatalf("expected hook_intent.trigger_detail.time.delay_ms=%d, got=%v", expectedDelayMs, hookIntent)
	}
	if got := hookIntent["effect"]; got != "follow-up-turn" {
		t.Fatalf("expected hook_intent.effect=follow-up-turn, got=%v", hookIntent)
	}
	if got := hookIntent["admission_state"]; got != expectedAdmissionState {
		t.Fatalf("expected hook_intent.admission_state=%s, got=%v", expectedAdmissionState, hookIntent)
	}
	for _, banned := range []string{"follow_up_id", "scheduled_for", "status", "reason_code", "action_hint", "message", "trace_id"} {
		if _, present := hookIntent[banned]; present {
			t.Fatalf("hook_intent indication must not leak execution truth %q, got=%v", banned, hookIntent)
		}
	}
}
func requestPublicChatSessionSnapshot(
	t *testing.T,
	svc *Service,
	capture *publicChatEmitCapture,
	anchorID string,
	requestID string,
) *runtimev1.SendAppMessageRequest {
	t.Helper()
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"request_id":             requestID,
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot %s): %v", requestID, err)
	}
	return capture.waitForMessageType(t, publicChatSessionSnapshotType)
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
func publicChatStructuredEnvelopeAPML(messageID string, text string) string {
	return fmt.Sprintf(`<message id="%s">%s</message>`,
		messageID,
		text,
	)
}
func publicChatStructuredEnvelopeWithFollowUpAPML(messageID string, text string, actionID string, prompt string, delayMs int) string {
	return fmt.Sprintf(`<message id="%s">%s</message><time-hook id="%s"><delay-ms>%d</delay-ms><effect kind="follow-up-turn"><prompt-text>%s</prompt-text></effect></time-hook>`,
		messageID,
		text,
		actionID,
		delayMs,
		prompt,
	)
}
func TestPublicChatTurnRequestStreamsAndAppliesPostTurnEffects(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-1", "hello from runtime")
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"request_id":             "desktop-turn-request-1",
			"thread_id":              "thread-1",
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
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	postTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	completed := capture.waitForMessageType(t, publicChatTurnCompletedType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	gotAnchorID := acceptedPayload["conversation_anchor_id"].(string)
	turnID := acceptedPayload["turn_id"].(string)
	if gotAnchorID != anchorID || turnID == "" {
		t.Fatalf("expected accepted envelope to carry conversation_anchor_id and turn_id, got=%v", acceptedPayload)
	}
	if _, ok := acceptedPayload["stream_id"].(string); !ok {
		t.Fatalf("expected accepted envelope stream_id, got=%v", acceptedPayload)
	}
	acceptedDetail := publicChatTurnDetail(t, accepted)
	if got := acceptedDetail["request_id"]; got != "desktop-turn-request-1" {
		t.Fatalf("expected accepted.detail.request_id to echo request payload correlation id, got=%v", acceptedDetail)
	}
	// session/transcript/execution truth must NOT live on turn events per yaml.
	for _, banned := range []string{"session_status", "transcript_message_count", "execution_binding", "model_resolved", "trace_id", "stream_sequence", "thread_id", "turn_origin"} {
		if _, present := acceptedPayload[banned]; present {
			t.Fatalf("runtime.agent.turn.accepted envelope must not carry %q per yaml; got=%v", banned, acceptedPayload)
		}
	}
	startedDetail := publicChatTurnDetail(t, started)
	if got := startedDetail["track"]; got != "chat" {
		t.Fatalf("expected started.detail.track=chat, got=%v", startedDetail)
	}
	if _, banned := publicChatPayloadMap(t, started)["model_resolved"]; banned {
		t.Fatalf("runtime.agent.turn.started must not carry model_resolved per yaml")
	}
	deltaDetail := publicChatTurnDetail(t, delta)
	if got := deltaDetail["text"]; got != publicChatStructuredEnvelopeAPML("message-1", "hello from runtime") {
		t.Fatalf("unexpected delta.detail.text: %v", got)
	}
	structuredDetail := publicChatTurnDetail(t, structured)
	if got := structuredDetail["kind"]; got != publicChatStructuredSchemaID {
		t.Fatalf("expected structured.detail.kind=schema id, got=%v", structuredDetail)
	}
	structuredPayload := structuredDetail["payload"].(map[string]any)
	messagePayload := structuredPayload["message"].(map[string]any)
	if got := messagePayload["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected structured message text: %v", got)
	}
	// runtime.agent.turn.message_committed: yaml requires `message_id`
	// envelope extra plus `{message_id, text}` detail.
	committedPayload := publicChatPayloadMap(t, committed)
	if got := committedPayload["message_id"]; got != "message-1" {
		t.Fatalf("expected message_committed envelope message_id=message-1, got=%v", committedPayload)
	}
	committedDetail := publicChatTurnDetail(t, committed)
	if got := committedDetail["message_id"]; got != "message-1" {
		t.Fatalf("expected message_committed.detail.message_id=message-1, got=%v", committedDetail)
	}
	if got := committedDetail["text"]; got != "hello from runtime" {
		t.Fatalf("expected message_committed.detail.text=hello from runtime, got=%v", committedDetail)
	}
	// post_turn.detail is indication-only; runtime execution truth
	// (assistant_memory etc.) must not appear here.
	postTurnDetail := publicChatTurnDetail(t, postTurn)
	for _, banned := range []string{"assistant_memory", "chat_sidecar", "follow_up", "trace_id"} {
		if _, present := postTurnDetail[banned]; present {
			t.Fatalf("runtime.agent.turn.post_turn.detail must be indication-only; saw %q in %v", banned, postTurnDetail)
		}
	}
	// completed.detail is `terminal_reason?` only.
	completedDetail := publicChatTurnDetail(t, completed)
	if got := completedDetail["terminal_reason"]; got != "stop" {
		t.Fatalf("expected completed.detail.terminal_reason=stop, got=%v", completedDetail)
	}
	for _, banned := range []string{"text", "message_id", "usage", "model_resolved", "trace_id"} {
		if _, present := completedDetail[banned]; present {
			t.Fatalf("runtime.agent.turn.completed.detail must be terminal_reason-only; saw %q in %v", banned, completedDetail)
		}
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
func TestPublicChatTurnRequestDetachesExecutionFromIngressContext(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			select {
			case <-time.After(25 * time.Millisecond):
			case <-ctx.Done():
				return ctx.Err()
			}
			envelope := publicChatStructuredEnvelopeAPML("message-detached", "detached execution survived ingress cancellation")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-detached-public-chat",
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
				TraceId:   "trace-detached-public-chat",
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
				TraceId:   "trace-detached-public-chat",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})
	parent, cancel := context.WithCancel(context.Background())
	err := svc.ConsumePublicChatAppMessage(parent, &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-detached-context",
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
	cancel()
	capture.waitForMessageType(t, publicChatTurnAcceptedType)
	capture.waitForMessageType(t, publicChatTurnStartedType)
	capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	capture.waitForMessageType(t, publicChatTurnCompletedType)
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-detached-context")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("expected completed last_turn after ingress context cancellation, got=%v", lastTurn)
	}
	if got := lastTurn["text"]; got != "detached execution survived ingress cancellation" {
		t.Fatalf("unexpected completed text after ingress context cancellation, got=%v", lastTurn)
	}
}
func TestPublicChatTurnInterruptCancelsActiveTurn(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
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
	turnID := acceptedPayload["turn_id"].(string)
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"turn_id":                turnID,
			"reason":                 "user_cancelled",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(interrupt): %v", err)
	}
	ack := capture.waitForMessageType(t, publicChatTurnInterruptAckType)
	interrupted := capture.waitForMessageType(t, publicChatTurnInterruptedType)
	_ = started
	ackDetail := publicChatTurnDetail(t, ack)
	if got := ackDetail["interrupted_turn_id"]; got != turnID {
		t.Fatalf("expected interrupt_ack.detail.interrupted_turn_id=%q, got=%v", turnID, ackDetail)
	}
	interruptedDetail := publicChatTurnDetail(t, interrupted)
	if got := interruptedDetail["reason"]; got != "user_cancelled" {
		t.Fatalf("unexpected interrupted.detail.reason: %v", got)
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
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	release := make(chan struct{})
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			envelope := publicChatStructuredEnvelopeAPML("message-snapshot", "snapshot complete")
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-session-snapshot",
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
	if got := publicChatPayloadMap(t, accepted)["conversation_anchor_id"].(string); got != anchorID {
		t.Fatalf("expected accepted conversation_anchor_id=%s, got=%s", anchorID, got)
	}
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"request_id":             "snapshot-live-1",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot-live): %v", err)
	}
	liveSnapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	liveSnap := publicChatSessionSnapshotDetail(t, liveSnapshot)
	if got := liveSnap["request_id"]; got != "snapshot-live-1" {
		t.Fatalf("expected snapshot.detail.snapshot.request_id, got=%v", liveSnap)
	}
	if got := liveSnap["session_status"]; got != "turn_active" {
		t.Fatalf("expected live session_status turn_active, got=%v", liveSnap)
	}
	activeTurn := liveSnap["active_turn"].(map[string]any)
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
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"request_id":             "snapshot-live-2",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot-terminal): %v", err)
	}
	terminalSnapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	terminalSnap := publicChatSessionSnapshotDetail(t, terminalSnapshot)
	if got := terminalSnap["request_id"]; got != "snapshot-live-2" {
		t.Fatalf("expected terminal snapshot request_id, got=%v", terminalSnap)
	}
	if got := terminalSnap["session_status"]; got != "idle" {
		t.Fatalf("expected terminal session_status idle, got=%v", terminalSnap)
	}
	if _, ok := terminalSnap["active_turn"]; ok {
		t.Fatalf("expected no active_turn after completion, got=%v", terminalSnap)
	}
	lastTurn := terminalSnap["last_turn"].(map[string]any)
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
	if got := terminalSnap["transcript_message_count"]; got != float64(2) {
		t.Fatalf("expected transcript count 2, got=%v", terminalSnap)
	}
	transcript, ok := terminalSnap["transcript"].([]any)
	if !ok || len(transcript) != 2 {
		t.Fatalf("expected transcript payload with 2 messages, got=%v", terminalSnap["transcript"])
	}
	firstMessage, ok := transcript[0].(map[string]any)
	if !ok || firstMessage["role"] != "user" || firstMessage["content"] != "hello" {
		t.Fatalf("expected first transcript message to preserve user hello, got=%v", transcript[0])
	}
	secondMessage, ok := transcript[1].(map[string]any)
	if !ok || secondMessage["role"] != "assistant" || secondMessage["content"] != "snapshot complete" {
		t.Fatalf("expected second transcript message to preserve assistant completion, got=%v", transcript[1])
	}
}
func TestPublicChatTurnRequestAllowsRouteOmissionWhenRuntimeResolvesBinding(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if req.AppID != "desktop.app" {
				t.Fatalf("expected public chat execution request to preserve caller app id, got=%q", req.AppID)
			}
			if req.Binding.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
				t.Fatalf("expected runtime-resolved local route, got=%v", req.Binding.RoutePolicy)
			}
			if req.Binding.ModelID != "local/default" {
				t.Fatalf("expected runtime-resolved model to preserve requested id, got=%q", req.Binding.ModelID)
			}
			envelope := publicChatStructuredEnvelopeAPML("message-route-omission", "runtime resolved route")
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-route-omission",
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
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	if _, ok := acceptedPayload["turn_id"].(string); !ok {
		t.Fatalf("expected accepted envelope turn_id, got=%v", acceptedPayload)
	}
	// Snapshot is the only admitted carrier for execution-binding truth.
	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatSessionSnapshotRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"request_id":             "snapshot-route-omission",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(snapshot): %v", err)
	}
	snapshot := capture.waitForMessageType(t, publicChatSessionSnapshotType)
	snapMap := publicChatSessionSnapshotDetail(t, snapshot)
	executionBinding := snapMap["execution_binding"].(map[string]any)
	if got := executionBinding["route"]; got != "local" {
		t.Fatalf("expected runtime-resolved snapshot route local, got=%v", executionBinding)
	}
	if got := executionBinding["model_id"]; got != "local/default" {
		t.Fatalf("expected runtime-resolved snapshot model_id local/default, got=%v", executionBinding)
	}
	lastTurn := snapMap["last_turn"].(map[string]any)
	if got := lastTurn["route_decision"]; got != "local" {
		t.Fatalf("expected last_turn route_decision local, got=%v", lastTurn)
	}
}
func TestPublicChatTurnInvalidStructuredOutputFailsClosed(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
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
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	failedDetail := publicChatTurnDetail(t, failed)
	if got := failedDetail["reason_code"]; got != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("expected AI_OUTPUT_INVALID failed.detail.reason_code, got=%v", failedDetail)
	}
	if got := strings.TrimSpace(fmt.Sprint(failedDetail["message"])); got == "" {
		t.Fatalf("expected failed.detail.message to carry structured parse detail, got=%v", failedDetail)
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-invalid-structured")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["status"]; got != publicChatTurnStatusFailed {
		t.Fatalf("expected failed last_turn after structured parse error, got=%v", lastTurn)
	}
	if got := lastTurn["reason_code"]; got != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("expected snapshot last_turn.reason_code=AI_OUTPUT_INVALID, got=%v", lastTurn)
	}
	if got := strings.TrimSpace(fmt.Sprint(lastTurn["message"])); got == "" {
		t.Fatalf("expected snapshot last_turn.message to preserve parse detail, got=%v", lastTurn)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
}
func TestPublicChatFollowUpRunsInsideRuntime(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
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
				envelope = publicChatStructuredEnvelopeWithFollowUpAPML("message-1", "hello from runtime", "action-follow-up-1", "continue naturally", 20)
			case 2:
				if got := strings.TrimSpace(req.SystemPrompt); !strings.Contains(got, "FollowUpInstruction:") || !strings.Contains(got, "continue naturally") {
					t.Fatalf("expected follow-up system prompt to include internal continuation cue, got=%q", got)
				}
				if len(req.Messages) < 2 || req.Messages[len(req.Messages)-1].GetContent() != "hello from runtime" {
					t.Fatalf("expected follow-up request to include prior assistant text, got=%v", req.Messages)
				}
				envelope = publicChatStructuredEnvelopeAPML("message-2", "runtime follow up complete")
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
			"agent_id":               "agent-alpha",
			"conversation_anchor_id": anchorID,
			"thread_id":              "thread-follow-up",
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
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	firstPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	firstCompleted := capture.waitForMessageType(t, publicChatTurnCompletedType)
	firstSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-follow-up-first")
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	secondPostTurn := capture.waitForMessageType(t, publicChatTurnPostTurnType)
	secondCompleted := capture.waitForMessageType(t, publicChatTurnCompletedType)
	secondSnapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-follow-up-second")
	firstPostTurnDetail := publicChatTurnDetail(t, firstPostTurn)
	if _, present := firstPostTurnDetail["follow_up"]; present {
		t.Fatalf("post_turn detail must not carry follow_up execution truth, got=%v", firstPostTurnDetail)
	}
	requirePublicChatPostTurnHookIntent(t, firstPostTurn, "action-follow-up-1", "pending", 20)
	firstLastTurn := publicChatLastTurnSnapshot(t, firstSnapshot)
	firstFollowUp := firstLastTurn["follow_up"].(map[string]any)
	if got := firstFollowUp["status"]; got != "scheduled" {
		t.Fatalf("expected first snapshot last_turn.follow_up scheduled, got=%v", firstFollowUp)
	}
	if got := firstLastTurn["turn_origin"]; got != publicChatTurnOriginUser {
		t.Fatalf("expected first snapshot last_turn.turn_origin=user, got=%v", firstLastTurn)
	}
	firstBinding := publicChatSessionSnapshotDetail(t, firstSnapshot)["execution_binding"].(map[string]any)
	if got := firstBinding["route"]; got != "local" {
		t.Fatalf("expected first snapshot execution_binding.route local, got=%v", firstBinding)
	}
	secondLastTurn := publicChatLastTurnSnapshot(t, secondSnapshot)
	if got := secondLastTurn["turn_origin"]; got != publicChatTurnOriginFollowUp {
		t.Fatalf("expected second snapshot last_turn.turn_origin=follow_up, got=%v", secondLastTurn)
	}
	if got := secondLastTurn["follow_up_depth"]; got != float64(1) {
		t.Fatalf("expected second snapshot last_turn.follow_up_depth=1, got=%v", secondLastTurn)
	}
	if got := secondLastTurn["chain_id"]; got == "" {
		t.Fatalf("expected second snapshot last_turn.chain_id, got=%v", secondLastTurn)
	}
	secondBinding := publicChatSessionSnapshotDetail(t, secondSnapshot)["execution_binding"].(map[string]any)
	if got := secondBinding["route"]; got != "local" {
		t.Fatalf("expected second snapshot execution_binding.route local, got=%v", secondBinding)
	}
	if got := publicChatSessionSnapshotDetail(t, secondSnapshot)["transcript_message_count"]; got != float64(3) {
		t.Fatalf("expected second snapshot transcript_message_count=3, got=%v", publicChatSessionSnapshotDetail(t, secondSnapshot))
	}
	secondPostTurnDetail := publicChatTurnDetail(t, secondPostTurn)
	if _, present := secondPostTurnDetail["follow_up"]; present {
		t.Fatalf("post_turn detail must not carry follow_up execution truth, got=%v", secondPostTurnDetail)
	}
	if _, present := secondPostTurnDetail["hook_intent"]; present {
		t.Fatalf("post_turn detail must omit hook_intent when no follow-up proposal exists, got=%v", secondPostTurnDetail)
	}
	secondFollowUp := secondLastTurn["follow_up"].(map[string]any)
	if got := secondFollowUp["status"]; got != "skipped" {
		t.Fatalf("expected second snapshot last_turn.follow_up skipped, got=%v", secondFollowUp)
	}
	if got := firstLastTurn["text"]; got != "hello from runtime" {
		t.Fatalf("unexpected first snapshot last_turn.text: %v", firstLastTurn)
	}
	if got := secondLastTurn["text"]; got != "runtime follow up complete" {
		t.Fatalf("unexpected second snapshot last_turn.text: %v", secondLastTurn)
	}
	if detail := publicChatTurnDetail(t, firstCompleted); len(detail) != 1 || detail["terminal_reason"] != "stop" {
		t.Fatalf("completed detail must be terminal_reason-only, got=%v", detail)
	}
	if detail := publicChatTurnDetail(t, secondCompleted); len(detail) != 1 || detail["terminal_reason"] != "stop" {
		t.Fatalf("completed detail must be terminal_reason-only, got=%v", detail)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected runtime executor to run two turns including follow-up, got=%d", callCount)
	}
}
