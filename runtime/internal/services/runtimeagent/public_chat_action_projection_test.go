package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/types/known/structpb"
)

type stubPublicChatActionExecutor struct {
	result  PublicChatActionExecutionResult
	err     error
	calls   int
	request PublicChatActionExecutionRequest
}

func (s *stubPublicChatActionExecutor) ExecuteImageAction(_ context.Context, req PublicChatActionExecutionRequest) (PublicChatActionExecutionResult, error) {
	s.calls++
	s.request = req
	if s.err != nil {
		return PublicChatActionExecutionResult{}, s.err
	}
	return s.result, nil
}

func publicChatImageActionAPML(messageID string, text string, actionID string, prompt string) string {
	return strings.Join([]string{
		fmt.Sprintf(`<message id="%s">%s</message>`, messageID, text),
		fmt.Sprintf(`<action id="%s" kind="image">`, actionID),
		fmt.Sprintf(`<prompt-payload kind="image"><prompt-text>%s</prompt-text></prompt-payload>`, prompt),
		`</action>`,
	}, "")
}

func emitPublicChatImageActionStream(traceID string, rawAPML string) func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
	return func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		if err := emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
			TraceId:   traceID,
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
			TraceId:   traceID,
			Payload: &runtimev1.StreamScenarioEvent_Delta{
				Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Text{
						Text: &runtimev1.TextStreamDelta{Text: rawAPML},
					},
				},
			},
		}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
			TraceId:   traceID,
			Payload: &runtimev1.StreamScenarioEvent_Completed{
				Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				},
			},
		})
	}
}

func publicChatImageActionTurnPayload(t *testing.T, anchorID string, includeImageBinding bool) *structpb.Struct {
	t.Helper()
	bindings := map[string]any{
		"text.generate": map[string]any{
			"route":    "local",
			"model_id": "local/default",
		},
	}
	if includeImageBinding {
		bindings["image.generate"] = map[string]any{
			"route":    "local",
			"model_id": "local/image",
		}
	}
	return publicChatStructPayload(t, map[string]any{
		"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
		"owner_user_id":          "user-1",
		"realm_agent_id":         "agent-alpha",
		"conversation_anchor_id": anchorID,
		"request_id":             "image-action-turn",
		"messages": []any{
			map[string]any{"role": "user", "content": "draw a studio portrait"},
		},
		"execution_bindings": bindings,
		"execution_params": map[string]any{
			"image.generate": map[string]any{
				"size":      "512x512",
				"steps":     15,
				"timeoutMs": 1000,
			},
		},
	})
}

func submitPublicChatImageActionTurn(t *testing.T, svc *Service, anchorID string, includeImageBinding bool) {
	t.Helper()
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload:       publicChatImageActionTurnPayload(t, anchorID, includeImageBinding),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(image action request): %v", err)
	}
}

func TestPublicChatImageActionExecutesAndEmitsArtifactLifecycle(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I will create that image.", "action-image-1", "studio portrait of the agent")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-success", rawAPML),
	})
	if err := svc.runtimeArtifacts.Put("artifact-image-1", runtimeartifact.ArtifactRecord{
		Bytes:     []byte("image-bytes"),
		MimeType:  "image/png",
		SizeBytes: int64(len("image-bytes")),
	}); err != nil {
		t.Fatalf("store artifact: %v", err)
	}
	actionExecutor := &stubPublicChatActionExecutor{
		result: PublicChatActionExecutionResult{
			ActionID:            "action-image-1",
			ProjectionMessageID: "agent-turn:image:1",
			ArtifactID:          "artifact-image-1",
			MimeType:            "image/png",
			JobID:               "job-image-1",
			ModelResolved:       "local/image",
		},
	}
	svc.SetPublicChatActionExecutor(actionExecutor)

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	planned := capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	started := capture.waitForMessageType(t, publicChatTurnActionStartedType)
	artifactReady := capture.waitForMessageType(t, publicChatTurnArtifactReadyType)
	completedAction := capture.waitForMessageType(t, publicChatTurnActionCompletedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	if actionExecutor.calls != 1 {
		t.Fatalf("expected one image action execution, got %d", actionExecutor.calls)
	}
	if got := actionExecutor.request.Action.PromptPayload.PromptText; got != "studio portrait of the agent" {
		t.Fatalf("expected APML prompt to drive image action, got %q", got)
	}
	for _, req := range []*runtimev1.SendAppMessageRequest{planned, started, artifactReady, completedAction} {
		detail := publicChatTurnDetail(t, req)
		if got := detail["action_id"]; got != "action-image-1" {
			t.Fatalf("expected action_id action-image-1 for %s, got=%v", req.GetMessageType(), detail)
		}
	}
	artifactDetail := publicChatTurnDetail(t, artifactReady)
	if got := artifactDetail["artifact_id"]; got != "artifact-image-1" {
		t.Fatalf("expected artifact_ready artifact id, got=%v", artifactDetail)
	}
	if got := artifactDetail["mime_type"]; got != "image/png" {
		t.Fatalf("expected artifact_ready mime image/png, got=%v", artifactDetail)
	}
}

func TestPublicChatImageActionFailsClosedWithoutImageBinding(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I need an image route.", "action-image-1", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-no-binding", rawAPML),
	})
	actionExecutor := &stubPublicChatActionExecutor{}
	svc.SetPublicChatActionExecutor(actionExecutor)

	submitPublicChatImageActionTurn(t, svc, anchorID, false)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	actionFailed := capture.waitForMessageType(t, publicChatTurnActionFailedType)
	turnFailed := capture.waitForMessageType(t, publicChatTurnFailedType)

	if actionExecutor.calls != 0 {
		t.Fatalf("image action executor must not run without image.generate binding")
	}
	for _, req := range []*runtimev1.SendAppMessageRequest{actionFailed, turnFailed} {
		detail := publicChatTurnDetail(t, req)
		if !strings.Contains(fmt.Sprint(detail["message"]), "execution_bindings.image.generate") {
			t.Fatalf("expected missing image binding failure, got=%v", detail)
		}
	}
}

func TestPublicChatImageActionFailsClosedWhenExecutorFails(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I will create that image.", "action-image-1", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-job-failed", rawAPML),
	})
	svc.SetPublicChatActionExecutor(&stubPublicChatActionExecutor{err: fmt.Errorf("image job failed")})

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	actionFailed := capture.waitForMessageType(t, publicChatTurnActionFailedType)
	turnFailed := capture.waitForMessageType(t, publicChatTurnFailedType)

	if !strings.Contains(fmt.Sprint(publicChatTurnDetail(t, actionFailed)["message"]), "image job failed") {
		t.Fatalf("expected action_failed to preserve executor error, got=%v", publicChatTurnDetail(t, actionFailed))
	}
	if !strings.Contains(fmt.Sprint(publicChatTurnDetail(t, turnFailed)["message"]), "image job failed") {
		t.Fatalf("expected turn failed to preserve executor error, got=%v", publicChatTurnDetail(t, turnFailed))
	}
}

func TestPublicChatImageActionFailsClosedWhenArtifactMissing(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I will create that image.", "action-image-1", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-artifact-missing", rawAPML),
	})
	svc.SetPublicChatActionExecutor(&stubPublicChatActionExecutor{
		result: PublicChatActionExecutionResult{
			ActionID:            "action-image-1",
			ProjectionMessageID: "agent-turn:image:1",
			ArtifactID:          "missing-image-artifact",
			MimeType:            "image/png",
			JobID:               "job-image-1",
		},
	})

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	actionFailed := capture.waitForMessageType(t, publicChatTurnActionFailedType)
	turnFailed := capture.waitForMessageType(t, publicChatTurnFailedType)

	if !strings.Contains(fmt.Sprint(publicChatTurnDetail(t, actionFailed)["message"]), "was not stored") {
		t.Fatalf("expected artifact storage failure, got=%v", publicChatTurnDetail(t, actionFailed))
	}
	if !strings.Contains(fmt.Sprint(publicChatTurnDetail(t, turnFailed)["message"]), "was not stored") {
		t.Fatalf("expected turn failed to preserve artifact storage failure, got=%v", publicChatTurnDetail(t, turnFailed))
	}
}
