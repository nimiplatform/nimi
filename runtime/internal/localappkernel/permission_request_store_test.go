package localappkernel

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestPermissionGrantStoreCreatesAndRefreshesSelectorFreePendingRequest(t *testing.T) {
	ctx := context.Background()
	now := testNow
	kernel := openTestKernel(t, Options{Now: func() time.Time { return now }})
	defer func() { _ = kernel.Close() }()
	principal, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: "com.example.pending",
		DevelopmentAuthorizationID: "dev-auth:pending", CanonicalProjectFileID: "file-id:pending",
	})
	if err != nil {
		t.Fatal(err)
	}
	input := CreatePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one",
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact", RequestID: "request-pending-1",
		DisplayAppID: principal.AppID, Reason: "Open a conversation with my selected Agent",
	}
	created, err := kernel.PermissionGrants().CreatePendingRequest(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 || created.Reason != input.Reason || created.DisplayAppID != principal.AppID || created.RequestedAt != now {
		t.Fatalf("created request = %+v", created)
	}
	if _, err := kernel.PermissionGrants().CreatePendingRequest(ctx, input); err == nil {
		t.Fatal("duplicate pending request was created")
	}
	now = now.Add(time.Second)
	refreshed, err := kernel.PermissionGrants().RefreshPendingRequest(ctx, RefreshPermissionRequestInput{
		LocalOSUserAnchor: input.LocalOSUserAnchor, AccountID: input.AccountID, LocalAppPrincipalID: input.LocalAppPrincipalID,
		PermissionID: input.PermissionID, RequestID: input.RequestID, DisplayAppID: input.DisplayAppID, Reason: "Continue the selected Agent conversation",
		ExpectedRevision: created.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Revision != 2 || refreshed.RequestedAt != now || refreshed.CreatedAt != created.CreatedAt || refreshed.Reason == created.Reason {
		t.Fatalf("refreshed request = %+v", refreshed)
	}
	if _, err := kernel.PermissionGrants().RefreshPendingRequest(ctx, RefreshPermissionRequestInput{
		LocalOSUserAnchor: input.LocalOSUserAnchor, AccountID: input.AccountID, LocalAppPrincipalID: input.LocalAppPrincipalID,
		PermissionID: input.PermissionID, RequestID: input.RequestID, DisplayAppID: input.DisplayAppID, Reason: input.Reason, ExpectedRevision: 1,
	}); !errors.Is(err, ErrPermissionRevisionConflict) {
		t.Fatalf("stale refresh error = %v", err)
	}
	var historyCount int
	if err := kernel.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM local_app_permission_request_history
		WHERE local_os_user_anchor = ? AND account_id = ? AND local_app_principal_id = ? AND permission_id = ?`,
		input.LocalOSUserAnchor, input.AccountID, input.LocalAppPrincipalID, input.PermissionID).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if historyCount != 2 {
		t.Fatalf("request history count = %d, want 2", historyCount)
	}
}

func TestPermissionGrantStoreConsumesPendingRequestWithCAS(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, Options{})
	defer func() { _ = kernel.Close() }()
	principal, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: "com.example.decision",
		DevelopmentAuthorizationID: "dev-auth:decision", CanonicalProjectFileID: "file-id:decision",
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := kernel.PermissionGrants().CreatePendingRequest(ctx, CreatePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", RequestID: "request-decision-1", DisplayAppID: principal.AppID, Reason: "Open a conversation",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := kernel.PermissionGrants().DecidePendingRequest(ctx, DecidePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", ExpectedRevision: created.Revision + 1, State: PermissionGrantStateGranted, OwnerSelectorDigest: "selector-one",
	}); !errors.Is(err, ErrPermissionRevisionConflict) {
		t.Fatalf("stale decision error = %v", err)
	}
	decision, err := kernel.PermissionGrants().DecidePendingRequest(ctx, DecidePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", ExpectedRevision: created.Revision, State: PermissionGrantStateGranted, OwnerSelectorDigest: "selector-one",
	})
	if err != nil {
		t.Fatal(err)
	}
	if decision.State != PermissionGrantStateGranted || decision.Revision != 2 || decision.OwnerSelectorDigest != "selector-one" {
		t.Fatalf("decision = %+v", decision)
	}
	if _, err := kernel.PermissionGrants().GetPendingRequest(ctx, kernel.LocalOSUserAnchor(), "account-one", principal.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("consumed pending request = %v", err)
	}
	grant, err := kernel.PermissionGrants().Get(ctx, PermissionGrantKey{LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one",
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact", OwnerSelectorDigest: "selector-one"})
	if err != nil || grant.State != PermissionGrantStateGranted || grant.Revision != 2 {
		t.Fatalf("granted decision = (%+v, %v)", grant, err)
	}
	if _, err := kernel.PermissionGrants().DecidePendingRequest(ctx, DecidePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", ExpectedRevision: created.Revision, State: PermissionGrantStateGranted, OwnerSelectorDigest: "selector-one",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("already-decided error = %v", err)
	}
}

func TestPermissionGrantStoreListsOnlyExactOwnerPartition(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, Options{})
	defer func() { _ = kernel.Close() }()
	principal, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: "com.example.partitioned",
		DevelopmentAuthorizationID: "dev-auth:partitioned", CanonicalProjectFileID: "file-id:partitioned",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, accountID := range []string{"account-one", "account-other"} {
		if _, err := kernel.PermissionGrants().CreatePendingRequest(ctx, CreatePermissionRequestInput{
			LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: accountID, LocalAppPrincipalID: principal.LocalAppPrincipalID,
			PermissionID: "agents.interact", RequestID: "request-" + accountID, DisplayAppID: principal.AppID, Reason: "Open a conversation",
		}); err != nil {
			t.Fatal(err)
		}
	}
	requests, err := kernel.PermissionGrants().ListPermissionRequests(ctx, kernel.LocalOSUserAnchor(), "account-one")
	if err != nil || len(requests) != 1 || requests[0].AccountID != "account-one" {
		t.Fatalf("partitioned requests = (%+v, %v)", requests, err)
	}
	if _, err := kernel.PermissionGrants().ListPermissionRequests(ctx, "other-os-user-anchor", "account-one"); !errors.Is(err, ErrPartitionMismatch) {
		t.Fatalf("cross OS-user list error = %v", err)
	}
}

func TestPermissionGrantStoreRejectsUnboundedPendingRequestReason(t *testing.T) {
	kernel := openTestKernel(t, Options{})
	defer func() { _ = kernel.Close() }()
	_, err := kernel.PermissionGrants().CreatePendingRequest(context.Background(), CreatePermissionRequestInput{
		LocalOSUserAnchor: kernel.LocalOSUserAnchor(), AccountID: "account-one", LocalAppPrincipalID: "lap_v1_missing",
		PermissionID: "agents.interact", RequestID: "request-invalid-reason", DisplayAppID: "com.example.pending", Reason: strings.Repeat("x", MaxPermissionRequestReasonBytes+1),
	})
	if !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("unbounded reason error = %v", err)
	}
}
