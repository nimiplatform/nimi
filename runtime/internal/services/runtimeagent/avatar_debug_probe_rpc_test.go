package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAvatarDebugProbeRecordsRuntimeAuditReplayAndProjection(t *testing.T) {
	svc := testAvatarDebugService()
	resp, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testDelegatedControlContext(),
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
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
		Context:              testDelegatedControlContext(),
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
	})
	if err != nil {
		t.Fatalf("list avatar debug probe results: %v", err)
	}
	if len(listed.GetProbeResults()) != 1 || listed.GetProbeResults()[0].GetProbeId() != "probe-1" {
		t.Fatalf("unexpected listed probe results: %+v", listed.GetProbeResults())
	}

	replay, err := svc.GetAvatarDebugReplay(context.Background(), &runtimev1.GetAvatarDebugReplayRequest{
		Context:              testDelegatedControlContext(),
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
		ProbeId:              "probe-1",
	})
	if err != nil {
		t.Fatalf("get avatar debug replay: %v", err)
	}
	if replay.GetRequest().GetProbeId() != "probe-1" || replay.GetResult().GetProbeId() != "probe-1" || replay.GetReplayRef().GetProbeId() != "probe-1" {
		t.Fatalf("replay did not reconstruct from runtime audit lineage: %+v", replay)
	}
}

func TestAvatarDebugProbeFailsClosedWithoutAuditStore(t *testing.T) {
	svc := testAvatarDebugService()
	svc.auditStore = nil
	_, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testDelegatedControlContext(),
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected missing audit store to fail closed, got %v", err)
	}
}

func TestAvatarDebugProbeRejectsInvalidEnvelope(t *testing.T) {
	svc := testAvatarDebugService()
	_, err := svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testDelegatedControlContext(),
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_UNSPECIFIED,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid probe kind rejection, got %v", err)
	}
	_, err = svc.RequestAvatarDebugProbe(context.Background(), &runtimev1.RequestAvatarDebugProbeRequest{
		Context:              testDelegatedControlContext(),
		AgentId:              "agent-1",
		ConversationAnchorId: "anchor-1",
		ProbeKind:            runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		RequestedBy:          runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_UNSPECIFIED,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid requested_by rejection, got %v", err)
	}
}

func testAvatarDebugService() *Service {
	svc := testDelegatedControlSurfaceServiceWithoutAudit()
	svc.auditStore = auditlog.New(128, 128)
	return svc
}
