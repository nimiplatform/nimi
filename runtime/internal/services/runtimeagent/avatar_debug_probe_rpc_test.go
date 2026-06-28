package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestAvatarDebugProbeRecordsRuntimeAuditReplayAndProjection(t *testing.T) {
	svc := testAvatarDebugService()
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	resp, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
		ProbeId:              "probe-1",
		ReplayRequested:      true,
	})
	if err != nil {
		t.Fatalf("request avatar debug probe: %v", err)
	}
	if resp.GetRequest().GetProbeId() != "probe-1" {
		t.Fatalf("request probe id mismatch: %+v", resp.GetRequest())
	}
	if got := resp.GetResult().GetStatus(); got != runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_BLOCKED {
		t.Fatalf("wave-3 must fail closed before Avatar backend evidence, got %s", got)
	}
	if resp.GetResult().GetReasonCode() != avatarDebugSessionUnavailable {
		t.Fatalf("unexpected reason code: %s", resp.GetResult().GetReasonCode())
	}
	if resp.GetReplayRef().GetVisibility() != runtimev1.AvatarDebugReplayVisibility_AVATAR_DEBUG_REPLAY_VISIBILITY_DESKTOP_DEBUG_WORKBENCH {
		t.Fatalf("expected workbench replay visibility, got %s", resp.GetReplayRef().GetVisibility())
	}
	if len(svc.events) != 3 {
		t.Fatalf("expected request/result/replay projection events, got %d", len(svc.events))
	}
	for _, event := range svc.events {
		if event.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG {
			t.Fatalf("unexpected event type: %s", event.GetEventType())
		}
		if event.GetAvatarDebug() == nil {
			t.Fatalf("avatar debug projection missing typed detail: %+v", event)
		}
	}

	listed, err := svc.ListAvatarDebugProbeResults(context.Background(), &runtimev1.ListAvatarDebugProbeResultsRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("list avatar debug probe results: %v", err)
	}
	if len(listed.GetProbeResults()) != 1 || listed.GetProbeResults()[0].GetProbeId() != "probe-1" {
		t.Fatalf("unexpected listed probe results: %+v", listed.GetProbeResults())
	}

	replay, err := svc.GetAvatarDebugReplay(context.Background(), &runtimev1.GetAvatarDebugReplayRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeId:              "probe-1",
	})
	if err != nil {
		t.Fatalf("get avatar debug replay: %v", err)
	}
	if replay.GetRequest().GetProbeId() != "probe-1" || replay.GetResult().GetProbeId() != "probe-1" || replay.GetReplayRef().GetProbeId() != "probe-1" {
		t.Fatalf("replay did not reconstruct from runtime audit lineage: %+v", replay)
	}
	if len(replay.GetResult().GetEvidenceRefs()) == 0 || replay.GetResult().GetEvidenceRefs()[0] != avatarDebugAuthorizationRefPrefix+"probe-1" {
		t.Fatalf("replay result missing authorization evidence ref: %+v", replay.GetResult().GetEvidenceRefs())
	}
	if !containsString(replay.GetResult().GetEvidenceRefs(), avatarDebugProjectionRefPrefix+"probe-1") {
		t.Fatalf("replay result missing projection lineage evidence ref: %+v", replay.GetResult().GetEvidenceRefs())
	}
	auditEvents, err := svc.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain:   avatarDebugAuditDomain,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("list avatar debug audit events: %v", err)
	}
	if len(auditEvents.GetEvents()) != 3 {
		t.Fatalf("expected request/result/replay audit events, got %d", len(auditEvents.GetEvents()))
	}
	for _, event := range auditEvents.GetEvents() {
		fields := event.GetPayload().GetFields()
		if fields["access_decision_verdict"].GetStringValue() != avatarDebugAuthorizationVerdict {
			t.Fatalf("avatar debug audit event missing authorization verdict: %+v", event)
		}
		if fields["access_decision_ref"].GetStringValue() != avatarDebugAuthorizationRefPrefix+"probe-1" {
			t.Fatalf("avatar debug audit event missing authorization ref: %+v", event)
		}
		if event.GetOperation() == avatarDebugReplayLinkOperation {
			if fields["request_event_id"].GetStringValue() != avatarDebugRequestOperation+":probe-1" {
				t.Fatalf("avatar debug replay missing request event id: %+v", event)
			}
			if fields["result_event_id"].GetStringValue() != avatarDebugResultOperation+":probe-1" {
				t.Fatalf("avatar debug replay missing result event id: %+v", event)
			}
			if fields["authorization_verdict_id"].GetStringValue() != avatarDebugAuthorizationRefPrefix+"probe-1" {
				t.Fatalf("avatar debug replay missing authorization verdict id: %+v", event)
			}
			if fields["projection_lineage_id"].GetStringValue() != avatarDebugProjectionRefPrefix+"probe-1" {
				t.Fatalf("avatar debug replay missing projection lineage id: %+v", event)
			}
			if fields["replay_visibility"].GetStringValue() != runtimev1.AvatarDebugReplayVisibility_AVATAR_DEBUG_REPLAY_VISIBILITY_DESKTOP_DEBUG_WORKBENCH.String() {
				t.Fatalf("avatar debug replay missing replay visibility: %+v", event)
			}
		}
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func TestAvatarDebugProbeFailsClosedWithoutAuditStore(t *testing.T) {
	svc := testAvatarDebugService()
	svc.auditStore = nil
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	_, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected missing audit store to fail closed, got %v", err)
	}
}

func TestAvatarDebugProbeRejectsInvalidEnvelope(t *testing.T) {
	svc := testAvatarDebugService()
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	_, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_UNSPECIFIED,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid probe kind rejection, got %v", err)
	}
	_, err = svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_UNSPECIFIED,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid requested_by rejection, got %v", err)
	}
}

func TestAvatarDebugProbeRejectsBodyIdentityWithoutScopedBinding(t *testing.T) {
	svc := testAvatarDebugService()
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	ctx := testAvatarDebugContext(anchorID)
	ctx.ScopedBinding = nil

	_, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              ctx,
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
		ProbeId:              "probe-forged-body",
		ReplayRequested:      true,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected missing scoped binding to fail closed, got %v", err)
	}
	auditEvents, listErr := svc.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain:   avatarDebugAuditDomain,
		PageSize: 10,
	})
	if listErr != nil {
		t.Fatalf("list avatar debug audit events: %v", listErr)
	}
	if len(auditEvents.GetEvents()) != 0 {
		t.Fatalf("unauthorized avatar debug request must not write PASS audit events: %+v", auditEvents.GetEvents())
	}
	if len(svc.events) != 0 {
		t.Fatalf("unauthorized avatar debug request must not project replay events: %+v", svc.events)
	}
}

func TestSubmitAvatarDebugProbeResultSupersedesRuntimeBlockedResult(t *testing.T) {
	svc := testAvatarDebugService()
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	if _, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
		ProbeId:              "probe-submit-1",
		ReplayRequested:      true,
	}); err != nil {
		t.Fatalf("seed avatar debug probe: %v", err)
	}
	submittedAt := time.Now().UTC().Add(time.Second)
	resp, err := svc.SubmitAvatarDebugProbeResult(context.Background(), &runtimev1.SubmitAvatarDebugProbeResultRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		Result: &runtimev1.AvatarDebugProbeResultEnvelope{
			ProbeId:              "probe-submit-1",
			AgentId:              agentID,
			ConversationAnchorId: anchorID,
			ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
			Status:               runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED,
			ObservedAt:           timestamppb.New(submittedAt),
			EvidenceRefs:         []string{"avatar.debug.session/probe-submit-1", "avatar.debug.session/probe-submit-1"},
			ResultId:             "avatar-debug-result-submit-1",
		},
	})
	if err != nil {
		t.Fatalf("submit avatar debug probe result: %v", err)
	}
	if got := resp.GetResult().GetStatus(); got != runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED {
		t.Fatalf("unexpected submitted status: %s", got)
	}
	if refs := resp.GetResult().GetEvidenceRefs(); len(refs) != 1 || refs[0] != "avatar.debug.session/probe-submit-1" {
		t.Fatalf("submitted evidence refs were not normalized: %+v", refs)
	}

	listed, err := svc.ListAvatarDebugProbeResults(context.Background(), &runtimev1.ListAvatarDebugProbeResultsRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("list avatar debug probe results: %v", err)
	}
	if len(listed.GetProbeResults()) != 1 {
		t.Fatalf("expected latest result per probe, got %+v", listed.GetProbeResults())
	}
	if got := listed.GetProbeResults()[0].GetStatus(); got != runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED {
		t.Fatalf("snapshot/list must prefer Avatar-submitted result, got %s", got)
	}

	replay, err := svc.GetAvatarDebugReplay(context.Background(), &runtimev1.GetAvatarDebugReplayRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeId:              "probe-submit-1",
	})
	if err != nil {
		t.Fatalf("get avatar debug replay: %v", err)
	}
	if got := replay.GetResult().GetStatus(); got != runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED {
		t.Fatalf("replay must use latest submitted result, got %s", got)
	}
	if len(svc.events) != 4 {
		t.Fatalf("expected original request/result/replay plus submitted result event, got %d", len(svc.events))
	}
}

func TestSubmitAvatarDebugProbeResultRejectsInvalidEnvelope(t *testing.T) {
	svc := testAvatarDebugService()
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	_, err := svc.SubmitAvatarDebugProbeResult(context.Background(), &runtimev1.SubmitAvatarDebugProbeResultRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		Result: &runtimev1.AvatarDebugProbeResultEnvelope{
			ProbeId:              "probe-invalid",
			AgentId:              agentID,
			ConversationAnchorId: anchorID,
			ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
			Status:               runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED,
			ResultId:             "avatar-debug-result-invalid",
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected missing evidence refs to fail closed, got %v", err)
	}
	auditEvents, listErr := svc.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain:   avatarDebugAuditDomain,
		PageSize: 10,
	})
	if listErr != nil {
		t.Fatalf("list avatar debug audit events: %v", listErr)
	}
	if len(auditEvents.GetEvents()) != 0 || len(svc.events) != 0 {
		t.Fatalf("invalid submitted result must not write audit or projection events")
	}
}

func TestSubmitAvatarDebugProbeResultRejectsNonAvatarSubmittableProbeKinds(t *testing.T) {
	for _, probeKind := range []runtimev1.AvatarDebugProbeKind{
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_PACKAGE_VALIDATION,
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_LAUNCH_READINESS,
	} {
		svc := testAvatarDebugService()
		agentID := avatarDebugTestAgentID()
		anchorID := avatarDebugTestAnchorID()
		_, err := svc.SubmitAvatarDebugProbeResult(context.Background(), &runtimev1.SubmitAvatarDebugProbeResultRequest{
			Context:              testAvatarDebugContext(anchorID),
			AgentId:              agentID,
			ConversationAnchorId: anchorID,
			Result: &runtimev1.AvatarDebugProbeResultEnvelope{
				ProbeId:              "probe-non-avatar-submittable",
				AgentId:              agentID,
				ConversationAnchorId: anchorID,
				ProbeKind:            probeKind,
				Status:               runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED,
				ObservedAt:           timestamppb.Now(),
				EvidenceRefs:         []string{"avatar.debug.session/probe-non-avatar-submittable"},
				ResultId:             "avatar-debug-result-non-avatar-submittable",
			},
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected %s submit rejection, got %v", probeKind, err)
		}
		auditEvents, listErr := svc.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{
			Domain:   avatarDebugAuditDomain,
			PageSize: 10,
		})
		if listErr != nil {
			t.Fatalf("list avatar debug audit events: %v", listErr)
		}
		if len(auditEvents.GetEvents()) != 0 || len(svc.events) != 0 {
			t.Fatalf("non-avatar-submittable %s result must not write audit or projection events", probeKind)
		}
	}
}

func TestGetAvatarDebugSnapshotAggregatesRuntimeAuditProjection(t *testing.T) {
	svc := testAvatarDebugService()
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	if _, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
		ProbeId:              "probe-snapshot-1",
		ReplayRequested:      true,
	}); err != nil {
		t.Fatalf("seed avatar debug probe: %v", err)
	}

	snapshot, err := svc.GetAvatarDebugSnapshot(context.Background(), &runtimev1.GetAvatarDebugSnapshotRequest{
		Context:              testAvatarDebugContext(anchorID),
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("get avatar debug snapshot: %v", err)
	}
	if snapshot.GetAgentId() != agentID || snapshot.GetConversationAnchorId() != anchorID {
		t.Fatalf("snapshot identity mismatch: %+v", snapshot)
	}
	if len(snapshot.GetProbeResults()) != 1 || snapshot.GetProbeResults()[0].GetProbeId() != "probe-snapshot-1" {
		t.Fatalf("snapshot did not aggregate the recorded probe result: %+v", snapshot.GetProbeResults())
	}
	if len(snapshot.GetReplayRefs()) != 1 {
		t.Fatalf("snapshot did not aggregate the replay ref: %+v", snapshot.GetReplayRefs())
	}
	if snapshot.GetObservedAt() == nil {
		t.Fatalf("snapshot must carry observed_at")
	}
}

func TestGetAvatarDebugSnapshotRequiresConversationAnchor(t *testing.T) {
	svc := testAvatarDebugService()
	_, err := svc.GetAvatarDebugSnapshot(context.Background(), &runtimev1.GetAvatarDebugSnapshotRequest{
		Context: testAvatarDebugContext(""),
		AgentId: avatarDebugTestAgentID(),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected missing conversation_anchor_id rejection, got %v", err)
	}
}

func testAvatarDebugService() *Service {
	agentID := avatarDebugTestAgentID()
	anchorID := avatarDebugTestAnchorID()
	svc := &Service{
		agents: map[string]*agentEntry{
			agentID: {
				Agent: &runtimev1.AgentRecord{
					AgentId:          agentID,
					OwnerUserId:      "user-1",
					RuntimeSourceRef: "agent-1",
					LocalAgentRef:    agentID,
					LifecycleStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
				},
				State: &runtimev1.AgentStateProjection{ActiveUserId: "user-1"},
			},
		},
		events:        []*runtimev1.AgentEvent{},
		subscribers:   map[uint64]*subscriber{},
		chatAnchors:   map[string]*publicChatAnchorState{},
		chatTurns:     map[string]*publicChatTurnState{},
		chatFollowUps: map[string]*publicChatFollowUpState{},
	}
	svc.chatAnchors[anchorID] = &publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              agentID,
		OwnerUserID:          "user-1",
		RuntimeSourceRef:     "agent-1",
		LocalAgentRef:        agentID,
		CallerAppID:          "nimi.desktop",
		SubjectUserID:        "user-1",
		Status:               runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE,
	}
	svc.auditStore = auditlog.New(128, 128)
	svc.SetScopedBindingValidator(stubScopedBindingValidator{
		validate: func(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
			if bindingID != "binding-avatar-debug" || actual.GetRuntimeAppId() != "nimi.desktop" || actual.GetAgentId() != agentID || actual.GetConversationAnchorId() != anchorID {
				return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND, false
			}
			if requiredScope != avatarDebugReadScope && requiredScope != avatarDebugWriteScope {
				return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
			}
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED, true
		},
	})
	return svc
}

func avatarDebugTestAgentID() string {
	return testOpaqueLocalAgentRef("user-1", "agent-1")
}

func avatarDebugTestAnchorID() string {
	return "anchor-1"
}

func testAvatarDebugContext(anchorID string) *runtimev1.AgentRequestContext {
	agentID := avatarDebugTestAgentID()
	return &runtimev1.AgentRequestContext{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-1",
		OwnerUserId:      "user-1",
		RuntimeSourceRef: "agent-1",
		LocalAgentRef:    agentID,
		ScopedBinding: &runtimev1.ScopedRuntimeBindingAttachment{
			BindingId:            "binding-avatar-debug",
			RuntimeAppId:         "nimi.desktop",
			AgentId:              agentID,
			ConversationAnchorId: anchorID,
		},
	}
}
