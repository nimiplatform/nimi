package runtimeagent

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAuthorizedLocalAppPrincipalInterruptsSharedAccountConversation(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	baseDecision := accountservice.LocalAppCallerDecision{
		AppID:               "nimi.zhiyu",
		AccountID:           "user-1",
		LocalAppPrincipalID: "principal-a",
		LocalAppRecordID:    "record-a",
		LocalAgentID:        localAgentRef,
	}
	openDecision := baseDecision
	openDecision.Operation = accountservice.LocalAppOperationOpenConversation
	opened, err := svc.OpenConversationAnchor(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenConversationAnchorRequest{AgentId: localAgentRef},
	)
	if err != nil {
		t.Fatalf("OpenConversationAnchor(local app): %v", err)
	}
	anchorID := opened.GetSnapshot().GetAnchor().GetConversationAnchorId()
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(ctx context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-local-app-interrupt",
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "qwen3-chat", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				}},
			}); err != nil {
				return err
			}
			<-ctx.Done()
			return ctx.Err()
		},
	})
	turnDecision := baseDecision
	turnDecision.Operation = accountservice.LocalAppOperationSendConversationTurn
	if err := svc.ConsumePublicChatAppMessage(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), turnDecision),
		&runtimev1.AppMessageEvent{
			MessageId: "local-app-interrupt-turn", ToAppId: publicChatRuntimeAppID,
			FromAppId: baseDecision.AppID, SubjectUserId: baseDecision.AccountID,
			MessageType: publicChatTurnRequestType,
			Payload: publicChatStructPayload(t, map[string]any{
				"local_agent_ref": localAgentRef, "conversation_anchor_id": anchorID,
				"request_id": "local-app-interrupt-turn",
				"messages":   []any{map[string]any{"role": "user", "content": "please wait"}},
			}),
		},
	); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(local request): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)

	interruptEvent := &runtimev1.AppMessageEvent{
		ToAppId: publicChatRuntimeAppID, FromAppId: baseDecision.AppID,
		SubjectUserId: baseDecision.AccountID, MessageType: publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID, "reason": "user_cancel",
		}),
	}
	foreignDecision := baseDecision
	foreignDecision.Operation = accountservice.LocalAppOperationInterruptConversation
	foreignDecision.AccountID = "foreign-account"
	foreignDecision.LocalAppPrincipalID = "foreign-principal"
	foreignDecision.LocalAppRecordID = "foreign-record"
	err = svc.ConsumePublicChatAppMessage(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), foreignDecision),
		interruptEvent,
	)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign-account interrupt status = %s err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED {
		t.Fatalf("foreign-account interrupt reason = %s ok=%v err=%v", reason, ok, err)
	}

	interruptDecision := baseDecision
	interruptDecision.Operation = accountservice.LocalAppOperationInterruptConversation
	interruptDecision.LocalAppPrincipalID = "principal-b"
	interruptDecision.LocalAppRecordID = "record-b"
	if err := svc.ConsumePublicChatAppMessage(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), interruptDecision),
		interruptEvent,
	); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(second principal interrupt): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnInterruptAckType)
	_ = capture.waitForMessageType(t, publicChatTurnInterruptedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	err = svc.ConsumePublicChatAppMessage(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), interruptDecision),
		interruptEvent,
	)
	if status.Code(err) != codes.NotFound {
		t.Fatalf("inactive-turn interrupt status = %s err=%v", status.Code(err), err)
	}
}

func TestAuthorizedLocalAppTurnHydratesIdentityAndFreezesAliasTarget(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	decision := accountservice.LocalAppCallerDecision{
		AppID:               "nimi.zhiyu",
		AccountID:           "user-1",
		LocalAppPrincipalID: "principal-a",
		LocalAppRecordID:    "record-a",
		LocalAgentID:        localAgentRef,
	}
	openDecision := decision
	openDecision.Operation = accountservice.LocalAppOperationOpenConversation
	opened, err := svc.OpenConversationAnchor(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenConversationAnchorRequest{AgentId: localAgentRef},
	)
	if err != nil {
		t.Fatalf("OpenConversationAnchor(local app): %v", err)
	}
	anchorID := opened.GetSnapshot().GetAnchor().GetConversationAnchorId()
	if anchorID == "" {
		t.Fatal("local-app conversation anchor id is empty")
	}

	resolvedTarget := &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
		Version: "v2",
		Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: "local-runtime:local-asset-live"},
	}}}
	var bindingReleaseCount atomic.Int32
	svc.SetPublicChatBindingResolver(stubPublicChatBindingResolver{
		resolve: func(_ context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
			return PublicChatBindingResolution{
				BindingAlias:        req.BindingAlias,
				ModelID:             "local/runtime-agent-live-e2e",
				RoutePolicy:         runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				TargetRef:           clonePublicChatTargetRef(resolvedTarget),
				ContextWindowTokens: 32768,
				CatalogRevision:     "local-app-turn-catalog-v1",
				ModelRevision:       "local-app-turn-model-v1",
				ProviderID:          "local",
				RouteDigest:         sha256HexBytes([]byte("local-app-turn-route-v1")),
				Release:             func() { bindingReleaseCount.Add(1) },
			}, nil
		},
	})
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	executed := make(chan PublicChatTurnExecutionRequest, 1)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			executed <- *req
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-local-app-turn",
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "local/runtime-agent-live-e2e",
					RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				}},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-local-app-turn",
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{
						Text: publicChatStructuredEnvelopeAPML("message-local-app-turn", "你好，我在。"),
					}},
				}},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-local-app-turn",
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				}},
			})
		},
	})

	turnDecision := decision
	turnDecision.Operation = accountservice.LocalAppOperationSendConversationTurn
	err = svc.ConsumePublicChatAppMessage(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), turnDecision),
		&runtimev1.AppMessageEvent{
			MessageId:     "app-message-local-turn-1",
			ToAppId:       publicChatRuntimeAppID,
			FromAppId:     decision.AppID,
			SubjectUserId: decision.AccountID,
			MessageType:   publicChatTurnRequestType,
			Payload: publicChatStructPayload(t, map[string]any{
				"local_agent_ref":        localAgentRef,
				"conversation_anchor_id": anchorID,
				"request_id":             "zhiyu-local-turn-1",
				"messages": []any{
					map[string]any{"role": "user", "content": "你好"},
				},
			}),
		},
	)
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(local app): %v", err)
	}

	var execution PublicChatTurnExecutionRequest
	select {
	case execution = <-executed:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for the hydrated local-app turn to execute; emitted=%v", capture.messageTypes())
	}
	if execution.SubjectUserID != decision.AccountID {
		t.Fatalf("execution subject = %q", execution.SubjectUserID)
	}
	if execution.Binding.BindingAlias != "local/default" {
		t.Fatalf("execution binding alias = %q", execution.Binding.BindingAlias)
	}
	if got := execution.Binding.TargetRef.GetLocalRuntime().GetProfileBindingId(); got != "local-runtime:local-asset-live" {
		t.Fatalf("execution durable target = %q", got)
	}
	if got := bindingReleaseCount.Load(); got != 0 {
		t.Fatalf("binding lease released before turn execution completed: count=%d", got)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	deadline := time.Now().Add(2 * time.Second)
	for bindingReleaseCount.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := bindingReleaseCount.Load(); got != 1 {
		t.Fatalf("binding lease release count=%d, want 1", got)
	}

	snapshotDecision := decision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetPublicChatSessionSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetPublicChatSessionSnapshotRequest{
			AgentId:              localAgentRef,
			ConversationAnchorId: anchorID,
			RequestId:            "zhiyu-local-snapshot-1",
		},
	)
	if err != nil {
		t.Fatalf("GetPublicChatSessionSnapshot(local app): %v", err)
	}
	detail := snapshot.GetSnapshot().AsMap()
	if detail["config_revision"] != float64(1) {
		t.Fatalf("snapshot config revision = %v", detail["config_revision"])
	}
	bindings, ok := detail["execution_bindings"].(map[string]any)
	if !ok {
		t.Fatalf("snapshot execution bindings = %#v", detail["execution_bindings"])
	}
	textBinding, ok := bindings[runtimeAgentAIConfigCapabilityTextGenerate].(map[string]any)
	if !ok {
		t.Fatalf("snapshot text.generate binding = %#v", bindings[runtimeAgentAIConfigCapabilityTextGenerate])
	}
	if textBinding["binding_alias"] != "local/default" {
		t.Fatalf("snapshot binding alias = %v", textBinding["binding_alias"])
	}
	targetRef, ok := textBinding["target_ref"].(map[string]any)
	if !ok {
		t.Fatalf("snapshot target ref = %#v", textBinding["target_ref"])
	}
	localTarget, ok := targetRef["localRuntime"].(map[string]any)
	if !ok || localTarget["profileBindingId"] != "local-runtime:local-asset-live" {
		t.Fatalf("snapshot local durable target = %#v", targetRef)
	}
}
