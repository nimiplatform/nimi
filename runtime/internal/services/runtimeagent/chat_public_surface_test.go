package runtimeagent

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"strconv"
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

type targetRefCapturePublicChatScenarioStreamer struct {
	request *runtimev1.StreamScenarioRequest
}

func (s *targetRefCapturePublicChatScenarioStreamer) StreamScenario(
	req *runtimev1.StreamScenarioRequest,
	_ grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent],
) error {
	s.request = req
	return nil
}

func TestAIBackedPublicChatTurnExecutorPassesDurableTargetRef(t *testing.T) {
	t.Parallel()
	streamer := &targetRefCapturePublicChatScenarioStreamer{}
	executor := NewAIBackedPublicChatTurnExecutor(streamer)
	targetRef := &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
					ProfileBindingId: "local-runtime:fixture-chat",
				},
			},
		},
	}
	err := executor.StreamChatTurn(context.Background(), &PublicChatTurnExecutionRequest{
		AppID:         "nimi.zhiyu",
		SubjectUserID: "user-1",
		Messages: []*runtimev1.ChatMessage{{
			Role:    "user",
			Content: "hello",
		}},
		Binding: publicChatExecutionBinding{
			ModelID:     "runtime-agent-live-e2e",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef:   targetRef,
		},
	}, nil)
	if err != nil {
		t.Fatalf("StreamChatTurn: %v", err)
	}
	got := streamer.request.GetHead().GetTargetRef().GetLocalRuntime().GetProfileBindingId()
	if got != "local-runtime:fixture-chat" {
		t.Fatalf("expected scenario head target_ref profile binding id, got %q", got)
	}
}

func publicChatTestLocalRuntimeTargetRef(ref string) *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: ref},
			},
		},
	}
}

func publicChatTestAudioSynthesizeBinding() *runtimev1.RuntimeAgentAIConfigIntent {
	return &runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityAudioSynthesize,
		ModelId:     "speech/qwen3tts",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:   publicChatTestLocalRuntimeTargetRef("local-runtime:speech/qwen3tts"),
	}
}

// TestPublicChatTurnRequestImageActionPromptFollowsAgentAIConfig proves the
// K-AGCORE-148 tri-state APML output contract: the image action affordance
// derives from committed config presence plus readiness, with distinct
// truthful copy for not_configured and unavailable.
func TestPublicChatTurnRequestImageActionPromptFollowsAgentAIConfig(t *testing.T) {
	t.Parallel()
	notConfigured := publicChatScenarioSystemPromptForImageConfig(t, nil)
	if strings.Contains(notConfigured, `include exactly one sibling <action kind="image">`) {
		t.Fatalf("image action routing rule must not be exposed without a committed image.generate binding, got %q", notConfigured)
	}
	if !strings.Contains(notConfigured, `Do not output <action kind="image">`) {
		t.Fatalf("not_configured prompt must explicitly prohibit image actions, got %q", notConfigured)
	}
	if !strings.Contains(notConfigured, "image generation is not configured") {
		t.Fatalf("not_configured prompt must state the not-configured truth, got %q", notConfigured)
	}

	available := publicChatScenarioSystemPromptForImageConfig(t, &runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
		ModelId:     "local/image",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	if !strings.Contains(available, `include exactly one sibling <action kind="image">`) {
		t.Fatalf("image action routing rule must be exposed when the committed image.generate binding is ready, got %q", available)
	}
	if strings.Contains(available, `Do not output <action kind="image">`) {
		t.Fatalf("image-capable prompt must not prohibit image actions, got %q", available)
	}

	// A committed cloud image binding without a connector is structurally
	// unusable: readiness reports UNAVAILABLE (connector_missing), which must
	// project the distinct configured-but-unavailable truth, never the
	// not-configured copy (K-AGCORE-148).
	unavailable := publicChatScenarioSystemPromptForImageConfig(t, &runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
		ModelId:     "openai/gpt-image-1",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
	})
	if strings.Contains(unavailable, `include exactly one sibling <action kind="image">`) {
		t.Fatalf("image action routing rule must not be exposed when the configured image route is unavailable, got %q", unavailable)
	}
	if !strings.Contains(unavailable, `Do not output <action kind="image">`) {
		t.Fatalf("unavailable prompt must explicitly prohibit image actions, got %q", unavailable)
	}
	if !strings.Contains(unavailable, "configured but currently unavailable") {
		t.Fatalf("unavailable prompt must state the configured-but-unavailable truth, got %q", unavailable)
	}
	if strings.Contains(unavailable, "image generation is not configured") {
		t.Fatalf("unavailable prompt must not collapse into the not-configured copy, got %q", unavailable)
	}
}

func publicChatScenarioSystemPromptForImageConfig(t *testing.T, imageBinding *runtimev1.RuntimeAgentAIConfigIntent) string {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	streamer := &capturePublicChatScenarioStreamer{}
	svc.SetPublicChatTurnExecutor(NewAIBackedPublicChatTurnExecutor(streamer))
	if imageBinding != nil {
		upsertPublicChatTestAgentAIConfig(t, svc, imageBinding)
	}

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "desktop-turn-image-prompt",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages": []any{
				map[string]any{"role": "user", "content": "Can you generate a photo?"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(image prompt request): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnFailedType)
	if streamer.request == nil || streamer.request.GetSpec().GetTextGenerate() == nil {
		t.Fatalf("expected captured text generate stream request")
	}
	var composed strings.Builder
	for _, message := range streamer.request.GetSpec().GetTextGenerate().GetInput() {
		if message.GetRole() == "system" {
			for _, line := range strings.Split(message.GetContent(), "\n") {
				encoded, found := strings.CutPrefix(line, "content_json_string=")
				if !found {
					continue
				}
				decoded, err := strconv.Unquote(encoded)
				if err != nil {
					t.Fatalf("decode typed context item: %v", err)
				}
				composed.WriteString(decoded)
				composed.WriteByte('\n')
			}
		}
	}
	return composed.String()
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
	timeout := time.NewTimer(10 * time.Second)
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
func (c *publicChatEmitCapture) messageTypes() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.items))
	for _, item := range c.items {
		out = append(out, item.GetMessageType())
	}
	return out
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
	setRuntimeAgentManagedEmbeddingProfileForTest(memorySvc, &runtimev1.MemoryEmbeddingProfile{
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
	svc.SetRuntimeAccountProjectionProvider(bundledAvatarTestProjectionProvider{accountID: "user-1"})
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-alpha"),
	}); err != nil {
		if status.Code(err) != codes.AlreadyExists {
			t.Fatalf("RealmSourceMaterialization: %v", err)
		}
	}
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	verified, err := verifySourceMaterializationPacketV3(
		bytes.NewReader(vector.Packet),
		bytes.NewReader(vector.CurrentJWKS),
		sourceMaterializationExpectationFromVectorV3(t, vector),
	)
	if err != nil {
		t.Fatalf("verify public chat Packet v3 fixture: %v", err)
	}
	svc.publicChatSourceSnapshotResolve = func(_ context.Context, localAgentRef string) (localAgentSourceSnapshotV2, bool, error) {
		if strings.TrimSpace(localAgentRef) == "" {
			return localAgentSourceSnapshotV2{}, false, nil
		}
		snapshot, err := finalizeLocalAgentSourceSnapshotV2(verified, localAgentRef)
		return snapshot, err == nil, err
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
			resolvedTargetRef := clonePublicChatTargetRef(req.TargetRef)
			if resolvedTargetRef == nil {
				if route == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
					resolvedTargetRef = &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
						Version:              "v2",
						ConnectorId:          firstNonEmpty(strings.TrimSpace(req.ConnectorID), "public-chat-test-connector"),
						RemoteModelCatalogId: "public-chat-test-catalog-v1",
						ProviderModelId:      strings.TrimSpace(req.ModelID),
						Provider:             "public-chat-test-provider",
					}}}
				} else {
					resolvedTargetRef = publicChatTestLocalRuntimeTargetRef("local-runtime:public-chat-test")
				}
			}
			return PublicChatBindingResolution{
				BindingAlias:        strings.TrimSpace(req.BindingAlias),
				ModelID:             strings.TrimSpace(req.ModelID),
				RoutePolicy:         route,
				ConnectorID:         strings.TrimSpace(req.ConnectorID),
				TargetRef:           resolvedTargetRef,
				ContextWindowTokens: 32768,
				CatalogRevision:     "public-chat-test-catalog-v1",
				ModelRevision:       "public-chat-test-model-v1",
				ProviderID:          "public-chat-test-provider",
				RouteDigest:         sha256HexBytes([]byte("public-chat-test-route:" + strings.TrimSpace(req.ModelID))),
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
	ctx := testLocalAgentContext(subjectUserID, agentID)
	ctx.AppId = callerAppID
	resp, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       ctx,
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

func publicChatTestAnchorThreadID(t *testing.T, svc *Service, anchorID string) string {
	t.Helper()
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[strings.TrimSpace(anchorID)]
	var threadID string
	if anchor != nil {
		threadID = strings.TrimSpace(anchor.ThreadID)
	}
	svc.chatSurfaceMu.Unlock()
	if threadID == "" {
		t.Fatalf("conversation anchor %q has no Runtime-owned thread id", anchorID)
	}
	return threadID
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

// publicChatSessionSnapshotDetail extracts the unary public chat session
// snapshot map. Runtime carrier execution truth lives only inside this map.
func publicChatSessionSnapshotDetail(t *testing.T, snapshot *structpb.Struct) map[string]any {
	t.Helper()
	if snapshot == nil {
		t.Fatalf("expected public chat session snapshot")
	}
	return snapshot.AsMap()
}

// publicChatActiveTurnSnapshot returns session snapshot active_turn.
func publicChatActiveTurnSnapshot(t *testing.T, snapshot *structpb.Struct) map[string]any {
	t.Helper()
	snap := publicChatSessionSnapshotDetail(t, snapshot)
	active, ok := snap["active_turn"].(map[string]any)
	if !ok {
		t.Fatalf("expected snapshot.active_turn map, got snap=%v", snap)
	}
	return active
}

// publicChatLastTurnSnapshot returns session snapshot last_turn.
func publicChatLastTurnSnapshot(t *testing.T, snapshot *structpb.Struct) map[string]any {
	t.Helper()
	snap := publicChatSessionSnapshotDetail(t, snapshot)
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
) *structpb.Struct {
	t.Helper()
	_ = capture
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	if anchor == nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatalf("anchor not found for snapshot: %s", anchorID)
	}
	callerAppID := anchor.CallerAppID
	subjectUserID := anchor.SubjectUserID
	ownerUserID := anchor.OwnerUserID
	runtimeSourceRef := anchor.RuntimeSourceRef
	localAgentRef := anchor.LocalAgentRef
	svc.chatSurfaceMu.Unlock()
	resp, err := svc.GetPublicChatSessionSnapshot(authenticatedRuntimeAgentTestContext(context.Background(), subjectUserID), &runtimev1.GetPublicChatSessionSnapshotRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:            callerAppID,
			SubjectUserId:    subjectUserID,
			OwnerUserId:      ownerUserID,
			RuntimeSourceRef: runtimeSourceRef,
			LocalAgentRef:    localAgentRef,
		},
		AgentId:              localAgentRef,
		ConversationAnchorId: anchorID,
		RequestId:            requestID,
	})
	if err != nil {
		t.Fatalf("GetPublicChatSessionSnapshot(%s): %v", requestID, err)
	}
	return resp.GetSnapshot()
}
