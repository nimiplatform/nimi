package integration

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestIntegrationRevokesStoredPermissionAfterConsumerLosesEligibility(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, one, two := testDecision("provider", 1), testDecision("one", 2), testDecision("two", 3)
	target := registerTestProvider(t, s, provider, "read")
	s.registrations = integrationTestRegistrations{{Subject: one.RegisteredAppSubject, AppID: one.AppID, DisplayName: "One"}, {Subject: two.RegisteredAppSubject, AppID: two.AppID, DisplayName: "Two"}}
	manage := desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet)
	for _, consumer := range []accountservice.LocalAppCallerDecision{one, two} {
		if _, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", consumer.AccountID, consumer.RegisteredAppSubject), TargetRef: target, Operations: []string{"document.read"}}); err != nil {
			t.Fatal(err)
		}
	}
	s.registrations = integrationTestRegistrations{{Subject: two.RegisteredAppSubject, AppID: two.AppID, DisplayName: "Two"}}
	summary, err := s.GetIntegrationManagement(desktopIntegrationContext(t, localappop.OperationIntegrationManagementGet), &runtimev1.GetIntegrationManagementRequest{})
	if err != nil || len(summary.GetConsumers()) != 1 || len(summary.GetPermissions()) != 2 {
		t.Fatalf("stored permission disappeared with eligibility: %v %v", summary, err)
	}
	if _, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", one.AccountID, one.RegisteredAppSubject), TargetRef: target, Operations: []string{"document.read"}}); status.Code(err) != codes.NotFound {
		t.Fatalf("ineligible consumer received a new grant: %v", err)
	}
	revoked, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", one.AccountID, one.RegisteredAppSubject), TargetRef: target})
	if err != nil || len(revoked.GetPermission().GetOperations()) != 0 {
		t.Fatalf("ineligible consumer could not be revoked: %v %v", revoked, err)
	}
	if s.permitted(context.Background(), one.AccountID, one.RegisteredAppSubject, target, "document.read") {
		t.Fatal("revoked permission still permits calls")
	}
	id := invokeTestCall(t, s, two, target, "document.read", `{}`)
	polled := pollTestProvider(t, s, provider)
	if len(polled.Calls) != 1 || polled.Calls[0].CallId != id {
		t.Fatalf("other consumer lost provider access: %v", polled)
	}
	completed, err := s.CompleteIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `{"kept":true}`})
	if err != nil || !completed.GetAccepted() {
		t.Fatalf("unrelated consumer result failed: %v %v", completed, err)
	}
	if call := waitTestCall(t, s, two, id); call.Status != "completed" {
		t.Fatalf("other consumer was canceled: %v", call)
	}
}

func TestIntegrationRevocationUsesOnlyExistingCurrentAccountPermission(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	own := testDecision("unavailable-app", 1)
	foreign := own
	foreign.AccountID = "another-account"
	const missingTarget = "missing-provider-target"
	grantTestTarget(t, s, own, missingTarget, "document.read")
	grantTestTarget(t, s, foreign, missingTarget, "document.read")
	// There is no target and no registration owner available. Only revocation
	// of a matching persisted permission is allowed through this path.
	s.registrations = nil
	manage := desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet)
	foreignDecision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(manage)
	if !ok {
		t.Fatal("missing management test decision")
	}
	foreignDecision.AccountID = foreign.AccountID
	foreignContext := accountservice.ContextWithAuthorizedLocalAppDecision(manage, foreignDecision)
	req := &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", own.AccountID, own.RegisteredAppSubject), TargetRef: missingTarget}
	if _, err := s.SetIntegrationPermission(foreignContext, req); status.Code(err) != codes.NotFound {
		t.Fatalf("foreign account changed permission: %v", err)
	}
	if !s.permitted(context.Background(), own.AccountID, own.RegisteredAppSubject, missingTarget, "document.read") {
		t.Fatal("foreign account revoked own permission")
	}
	if _, err := s.SetIntegrationPermission(manage, req); err != nil {
		t.Fatalf("missing target blocked existing revocation: %v", err)
	}
	if s.permitted(context.Background(), own.AccountID, own.RegisteredAppSubject, missingTarget, "document.read") || !s.permitted(context.Background(), foreign.AccountID, foreign.RegisteredAppSubject, missingTarget, "document.read") {
		t.Fatal("revocation crossed account boundaries")
	}
	unknown := &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", own.AccountID, "not-stored"), TargetRef: missingTarget}
	if _, err := s.SetIntegrationPermission(manage, unknown); status.Code(err) != codes.NotFound {
		t.Fatalf("revocation created a missing mapping: %v", err)
	}
	var rows int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_integration_permission WHERE account_id=?`, own.AccountID).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("revocation created permission rows: count=%d err=%v", rows, err)
	}
}
