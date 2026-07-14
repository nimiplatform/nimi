package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPublicChatTurnRequestInjectsRuntimePreTurnMemoryContext(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	_, err := svc.WriteAgentMemory(context.Background(), &runtimev1.WriteAgentMemoryRequest{
		Context: testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId: testRuntimeAgentLocalRef("agent-alpha"),
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{
							AgentId: testRuntimeAgentLocalRef("agent-alpha"),
							UserId:  "user-1",
						},
					},
				},
				SourceEventId: "pre-turn-memory-seed",
				Extensions:    completePromotionEvidenceWithSourceProfile(t, svc, "canonical_agent_chat"),
				Record: &runtimev1.MemoryRecordInput{
					Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{
							Observation: "User prefers concise cartography answers",
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(seed): %v", err)
	}

	requests := make(chan *PublicChatTurnExecutionRequest, 1)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			requests <- req
			envelope := publicChatStructuredEnvelopeAPML("message-memory-context", "map answer")
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-memory-context",
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
				TraceId:   "trace-memory-context",
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
				TraceId:   "trace-memory-context",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	err = svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     "agent-alpha",
			"conversation_anchor_id": anchorID,
			"request_id":             "desktop-turn-memory-context",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages": []any{
				map[string]any{"role": "user", "content": "Can you help with cartography?"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	var captured *PublicChatTurnExecutionRequest
	select {
	case captured = <-requests:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for captured public chat execution request")
	}
	if captured.MaxTokens != int32(publicChatContextDefaultOutputTokens) {
		t.Fatalf("provider default max_tokens=%d want manifest reserve=%d", captured.MaxTokens, publicChatContextDefaultOutputTokens)
	}
	memoryLaneObserved := false
	for _, message := range captured.Messages {
		if strings.Contains(message.GetContent(), "User prefers concise cartography answers") {
			if message.GetRole() != "system" || !strings.Contains(message.GetContent(), "lane=canonical_memory") {
				t.Fatalf("canonical memory must remain a typed Runtime system lane: %#v", message)
			}
			memoryLaneObserved = true
		}
	}
	if !memoryLaneObserved {
		t.Fatalf("expected canonical memory canary in provider-visible typed context: %#v", captured.Messages)
	}
	capture.waitForMessageType(t, publicChatTurnCompletedType)
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-pre-turn-memory")
	snapshotRaw := fmt.Sprint(snapshot.AsMap())
	for _, forbidden := range []string{"Runtime recalled memory context:", "User prefers concise cartography answers"} {
		if strings.Contains(snapshotRaw, forbidden) {
			t.Fatalf("public session snapshot must not expose raw pre-turn memory prompt context %q: %v", forbidden, snapshotRaw)
		}
	}
}

func TestPublicChatTurnRequestFailsClosedWhenPreTurnMemoryReadFails(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	executorCalled := make(chan struct{}, 1)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, _ func(*runtimev1.StreamScenarioEvent) error) error {
			executorCalled <- struct{}{}
			return nil
		},
	})

	req := publicChatTurnRequestPayload{
		LocalAgentRef:        testRuntimeAgentLocalRef("agent-alpha"),
		OwnerUserID:          "user-1",
		RuntimeSourceRef:     "agent-alpha",
		ConversationAnchorID: anchorID,
		RequestID:            "desktop-turn-memory-read-fails",
		ThreadID:             publicChatTestAnchorThreadID(t, svc, anchorID),
		Messages: []publicChatMessagePayload{
			{Role: "user", Content: "hello"},
		},
	}
	runtime := publicChatRuntime{svc: svc}
	session, turn, turnCtx, err := runtime.reserveTurn(context.Background(), "desktop.app", "user-1", req)
	if err != nil {
		t.Fatalf("reserveTurn: %v", err)
	}
	// Intentionally call runTurn without handleTurnRequest's state mutation.
	// The runtime memory read policy must fail closed when no canonical
	// dyadic subject has been admitted, and the model executor must not run.
	runtime.runTurn(turnCtx, session, turn, req)
	failed := capture.waitForMessageType(t, publicChatTurnFailedType)
	failedDetail := publicChatTurnDetail(t, failed)
	if got := strings.TrimSpace(fmt.Sprint(failedDetail["reason_code"])); got == "" {
		t.Fatalf("expected pre-turn memory read failure to carry reason_code, got=%v", failedDetail)
	}
	select {
	case <-executorCalled:
		t.Fatal("pre-turn memory read failure must fail before StreamChatTurn")
	default:
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-pre-turn-memory-failed")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["status"]; got != publicChatTurnStatusFailed {
		t.Fatalf("expected failed last_turn after pre-turn memory read failure, got=%v", lastTurn)
	}
}

func TestPublicChatPreTurnMemoryRequiresSubjectContext(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	_, err := (publicChatRuntime{svc: svc}).loadPublicChatPreTurnMemoryInputs(context.Background(), publicChatAnchorState{
		AgentID:          testRuntimeAgentLocalRef("agent-alpha"),
		LocalAgentRef:    testRuntimeAgentLocalRef("agent-alpha"),
		OwnerUserID:      "user-1",
		RuntimeSourceRef: "agent-alpha",
		CallerAppID:      "desktop.app",
	}, publicChatTurnRequestPayload{
		Messages: []publicChatMessagePayload{
			{Role: "user", Content: "hello"},
		},
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected subjectless pre-turn memory assembly to fail closed, got %v", err)
	}
}
