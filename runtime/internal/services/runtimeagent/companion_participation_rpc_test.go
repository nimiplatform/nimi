package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCompanionParticipationRequestRunsPublicChatTurnAndProjectsCommit(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if len(req.Messages) != 1 || strings.TrimSpace(req.Messages[0].GetContent()) != "hello avatar" {
				t.Fatalf("expected companion request to route one user message through runtime public chat, got=%v", req.Messages)
			}
			if req.Binding.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || strings.TrimSpace(req.Binding.ModelID) != "local/default" {
				t.Fatalf("expected companion request to use runtime-resolved public chat binding, got=%+v", req.Binding)
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-companion",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "local/default",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-companion",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: publicChatStructuredEnvelopeAPML("message-companion-1", "runtime committed")},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-companion",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	resp, err := svc.RequestCompanionParticipation(companionParticipationWriteTestContext(), &runtimev1.RequestCompanionParticipationRequest{
		Context:              companionParticipationAgentContext("desktop.app"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		SurfaceKind:          runtimev1.CompanionParticipationSurfaceKind_COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_COMPANION,
		TriggerSource:        runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_USER_EXPLICIT,
		ProfileRef:           "avatar.profile/default",
		RequestId:            "companion-turn-1",
		Text:                 "hello avatar",
	})
	if err != nil {
		t.Fatalf("RequestCompanionParticipation: %v", err)
	}
	if resp.GetProjection().GetStatus() != runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_ADMISSION_PENDING &&
		resp.GetProjection().GetStatus() != runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_RUNNING {
		t.Fatalf("expected active projection after request, got=%v", resp.GetProjection())
	}
	if resp.GetProjection().GetAuditRef() == "" || resp.GetProjection().GetProjectionId() == "" || resp.GetProjection().GetTurnId() == "" {
		t.Fatalf("projection missing required refs: %v", resp.GetProjection())
	}
	if strings.Contains(resp.GetProjection().String(), "hello avatar") {
		t.Fatalf("projection must not expose raw user text: %v", resp.GetProjection())
	}

	capture.waitForMessageType(t, publicChatTurnCompletedType)
	projectionResp, err := svc.GetCompanionParticipationProjection(companionParticipationReadTestContext(), &runtimev1.GetCompanionParticipationProjectionRequest{
		Context:              companionParticipationAgentContext("desktop.app"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		SurfaceKind:          runtimev1.CompanionParticipationSurfaceKind_COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_COMPANION,
		TriggerSource:        runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_USER_EXPLICIT,
		ProfileRef:           "avatar.profile/default",
	})
	if err != nil {
		t.Fatalf("GetCompanionParticipationProjection: %v", err)
	}
	projection := projectionResp.GetProjection()
	if projection.GetStatus() != runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_COMMITTED_BY_OWNER {
		t.Fatalf("expected committed_by_owner projection, got=%v", projection)
	}
	if projection.GetCandidateRef() == "" || projection.GetCommitRef() == "" || projection.GetAuditRef() == "" {
		t.Fatalf("committed projection missing typed refs: %v", projection)
	}
	if strings.Contains(projection.String(), "runtime committed") || strings.Contains(projection.String(), "hello avatar") {
		t.Fatalf("projection must not expose raw model or user text: %v", projection)
	}

	replayResp, err := svc.OpenCompanionParticipationReplay(companionParticipationReadTestContext(), &runtimev1.OpenCompanionParticipationReplayRequest{
		Context:              companionParticipationAgentContext("desktop.app"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		SurfaceKind:          runtimev1.CompanionParticipationSurfaceKind_COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_COMPANION,
		TriggerSource:        runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_USER_EXPLICIT,
		ProjectionId:         projection.GetProjectionId(),
	})
	if err != nil {
		t.Fatalf("OpenCompanionParticipationReplay: %v", err)
	}
	if replayResp.GetReplayRef() == "" || replayResp.GetProjection().GetProjectionId() != projection.GetProjectionId() {
		t.Fatalf("expected replay ref for projection, got=%v", replayResp)
	}
}

func TestCompanionParticipationRequestProjectsBlockedInsteadOfSyntheticCandidate(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")

	resp, err := svc.RequestCompanionParticipation(companionParticipationWriteTestContext(), &runtimev1.RequestCompanionParticipationRequest{
		Context:              companionParticipationAgentContext("desktop.app"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		SurfaceKind:          runtimev1.CompanionParticipationSurfaceKind_COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_COMPANION,
		TriggerSource:        runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_USER_EXPLICIT,
		ProfileRef:           "avatar.profile/default",
		RequestId:            "missing-input",
	})
	if err != nil {
		t.Fatalf("RequestCompanionParticipation missing text should project blocked, not error: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetStatus() != runtimev1.CompanionParticipationStatus_COMPANION_PARTICIPATION_STATUS_BLOCKED {
		t.Fatalf("expected blocked projection, got=%v", projection)
	}
	if projection.GetCandidateRef() != "" || projection.GetCommitRef() != "" {
		t.Fatalf("blocked projection must not fabricate candidate or commit refs: %v", projection)
	}
	if projection.GetRefusalReason() != "companion_participation_text_required" {
		t.Fatalf("expected typed refusal reason, got=%v", projection)
	}
}

func TestCompanionParticipationRejectsUnknownSurfaceKind(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")

	_, err := svc.GetCompanionParticipationProjection(companionParticipationReadTestContext(), &runtimev1.GetCompanionParticipationProjectionRequest{
		Context:              companionParticipationAgentContext("desktop.app"),
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		TriggerSource:        runtimev1.CompanionParticipationTriggerSource_COMPANION_PARTICIPATION_TRIGGER_SOURCE_USER_EXPLICIT,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected unknown surface kind to fail closed with InvalidArgument, got %v", err)
	}
}

func companionParticipationReadTestContext() context.Context {
	return envelope.WithValidatedProtectedCapability(context.Background(), "desktop.app", runtimeAgentCompanionParticipationReadScope)
}

func companionParticipationWriteTestContext() context.Context {
	return envelope.WithValidatedProtectedCapability(context.Background(), "desktop.app", runtimeAgentCompanionParticipationWriteScope)
}

func companionParticipationAgentContext(appID string) *runtimev1.AgentRequestContext {
	ctx := testRuntimeAgentIdentityContext("agent-alpha")
	ctx.AppId = appID
	return ctx
}
