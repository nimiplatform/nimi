package integration

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type providerPublicationBackend struct {
	Backend
	before func()
}

func (b *providerPublicationBackend) WithSerializedWriter(ctx context.Context, commit func(context.Context) error) error {
	if b.before != nil {
		before := b.before
		b.before = nil
		before()
	}
	return b.Backend.WithSerializedWriter(ctx, commit)
}

func providerPublicationFixture(t *testing.T, effect string) (*Service, *accountservice.Service, accountservice.LocalAppCallerDecision, string) {
	t.Helper()
	s := newIntegrationTestService(t, nil)
	account := accountservice.New(nil, accountservice.WithAuditStore(s.audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&generationTestCustody{material: accountservice.AccountMaterial{AccountID: "test-account", RealmEnvironmentID: "realm", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
	projection, generation, _, ok := account.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("Account unavailable")
	}
	p, d := testDecision("provider", 1), testDecision("consumer", 2)
	p.AccountID, p.RealmEnvironmentID, p.AccountGeneration = projection.AccountId, projection.RealmEnvironmentId, generation
	d.AccountID, d.RealmEnvironmentID, d.AccountGeneration = projection.AccountId, projection.RealmEnvironmentId, generation
	s.revalidator = generationTestRevalidator{Revalidator: s.revalidator, account: account}
	target := registerTestProvider(t, s, p, effect)
	grantTestTarget(t, s, d, target, "document.read")
	id := invokeTestCall(t, s, d, target, "document.read", `{}`)
	if len(pollTestProvider(t, s, p).GetCalls()) != 1 {
		t.Fatal("provider not dispatched")
	}
	return s, account, p, id
}

func logoutPublicationAccount(account *accountservice.Service) error {
	response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop", DeviceId: "device", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
	if err == nil && !response.GetAccepted() {
		return context.Canceled
	}
	return err
}

func TestProviderCompletionRejectsLogoutAfterPrevalidation(t *testing.T) {
	for _, effect := range []string{"read", "write"} {
		t.Run(effect, func(t *testing.T) {
			s, account, p, id := providerPublicationFixture(t, effect)
			s.backend = &providerPublicationBackend{Backend: s.backend, before: func() {
				if err := logoutPublicationAccount(account); err != nil {
					t.Fatal(err)
				}
			}}
			response, err := s.CompleteIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `{"private":"late"}`})
			if err != nil || response.GetAccepted() {
				t.Fatalf("stale result accepted: %v %v", response, err)
			}
			var state string
			if err := s.backend.DB().QueryRow(`SELECT status FROM runtime_integration_call WHERE call_id=?`, id).Scan(&state); err != nil {
				t.Fatal(err)
			}
			want := "canceled"
			if effect == "write" {
				want = "unconfirmed"
			}
			if state != want || s.calls[id].fact.ResultJson != "" {
				t.Fatalf("outcome=%s want=%s", state, want)
			}
		})
	}
}

func TestProviderCompletionCommitBeforeLogoutRetainsCompletedFact(t *testing.T) {
	s, account, p, id := providerPublicationFixture(t, "read")
	entered, release := make(chan struct{}), make(chan struct{})
	s.revalidator = generationTestRevalidator{Revalidator: s.revalidator, account: account, entered: entered, release: release}
	finished := make(chan bool, 1)
	go func() {
		r, err := s.CompleteIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `{"result":"committed"}`})
		finished <- err == nil && r.GetAccepted()
	}()
	<-entered
	loggedOut := make(chan error, 1)
	go func() { loggedOut <- logoutPublicationAccount(account) }()
	select {
	case err := <-loggedOut:
		t.Fatalf("logout crossed publication: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case accepted := <-finished:
		if !accepted {
			t.Fatal("commit failed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("publication deadlocked")
	}
	select {
	case err := <-loggedOut:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("logout deadlocked")
	}
	var state string
	if err := s.backend.DB().QueryRow(`SELECT status FROM runtime_integration_call WHERE call_id=?`, id).Scan(&state); err != nil || state != "completed" {
		t.Fatalf("fact lost: %s %v", state, err)
	}
}
