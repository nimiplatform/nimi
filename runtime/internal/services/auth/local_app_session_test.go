package auth

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/status"
)

func TestLocalAppSessionRequestsRejectCallerAssertions(t *testing.T) {
	open := &runtimev1.OpenLocalAppSessionRequest{}
	open.ProtoReflect().SetUnknown([]byte{0x0a, 0x01, 'x'})
	if _, err := (&Service{}).OpenLocalAppSession(context.Background(), open); localAppSessionTestReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("open caller assertion error = %v", err)
	}
	renew := &runtimev1.RenewLocalAppSessionRequest{}
	renew.ProtoReflect().SetUnknown([]byte{0x0a, 0x01, 'x'})
	if _, err := (&Service{}).RenewLocalAppSession(context.Background(), renew); localAppSessionTestReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("renew caller assertion error = %v", err)
	}
}

func TestLocalAppSessionResultAndErrorArePostureOnly(t *testing.T) {
	response := localAppSessionResponse(LocalAppSessionProjection{})
	if response.ProtoReflect().Descriptor().Fields().Len() != 4 ||
		response.GetState() != runtimev1.LocalAppSessionState_LOCAL_APP_SESSION_STATE_READY ||
		response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || response.GetCurrentUser() != nil ||
		response.GetCurrentUserReasonCode() != runtimev1.ReasonCode_CURRENT_USER_DISPLAY_UNAVAILABLE {
		t.Fatalf("session response = %+v", response)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	assertNoLocalAppPrivateProjectionText(t, string(encoded))

	avatar := "https://cdn.example/avatar.png"
	ready := localAppSessionResponse(LocalAppSessionProjection{
		CurrentUser: &runtimev1.CurrentUserDisplayProjection{
			Handle: "halliday", DisplayName: "Halliday", AvatarUrl: &avatar,
		},
		CurrentUserReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	})
	if ready.GetCurrentUser().GetHandle() != "halliday" || ready.GetCurrentUser().GetDisplayName() != "Halliday" ||
		ready.GetCurrentUser().GetAvatarUrl() != avatar || ready.GetCurrentUserReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("Current User response = %+v", ready)
	}
	readyJSON, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	assertNoLocalAppPrivateProjectionText(t, string(readyJSON))

	_, projectedErr := (&Service{}).OpenLocalAppSession(context.Background(), &runtimev1.OpenLocalAppSessionRequest{})
	statusJSON, err := json.Marshal(status.Convert(projectedErr).Proto())
	if err != nil {
		t.Fatal(err)
	}
	assertNoLocalAppPrivateProjectionText(t, string(statusJSON))
}

func assertNoLocalAppPrivateProjectionText(t testing.TB, value string) {
	t.Helper()
	lower := strings.ToLower(value)
	for _, forbidden := range []string{
		"subject", "account", "snapshot", "generation", "credential", "session_proof", "peer_proof", "runtime_boot_epoch",
	} {
		if strings.Contains(lower, forbidden) {
			t.Fatalf("private field %q leaked in %s", forbidden, value)
		}
	}
}

func localAppSessionTestReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
