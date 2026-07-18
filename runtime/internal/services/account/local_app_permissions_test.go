package account

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocalAppPublicPermissionStatusKeepsReservedCatalogUnavailable(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	response, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	projection := response.GetProjection()
	if projection.GetPermissionId() != "agents.interact" || projection.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE || projection.GetCanRequest() || projection.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("unexpected reserved posture: %+v", projection)
	}
}

func TestLocalAppPublicPermissionRejectsInternalIDsAndAuthorityFields(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	status, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "runtime_agent.conversation.open"})
	if err != nil || status.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("internal operation id must fail closed: response=%+v err=%v", status, err)
	}
	request, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: " leading whitespace"})
	if err != nil || request.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID || request.GetProjection().GetCanRequest() {
		t.Fatalf("non-canonical reason must fail closed: response=%+v err=%v", request, err)
	}
}
