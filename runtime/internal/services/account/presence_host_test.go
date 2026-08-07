package account

import (
	"context"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type fakeHostPresenceProvider struct {
	outcome hostPresenceOutcome
	method  runtimev1.PresenceVerificationMethod
	err     error
	seen    hostPresenceRequest
	calls   int
}

func (f *fakeHostPresenceProvider) RequestHostPresence(_ context.Context, request hostPresenceRequest) (hostPresenceResult, error) {
	f.calls++
	f.seen = request
	if f.err != nil {
		return hostPresenceResult{Outcome: hostPresenceUnavailable, Method: f.method}, f.err
	}
	return hostPresenceResult{Outcome: f.outcome, Method: f.method}, nil
}

func TestHostPresenceVerifierReturnsVerifiedOSCredential(t *testing.T) {
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	provider := &fakeHostPresenceProvider{outcome: hostPresenceVerified}
	verifier := hostPresenceVerifier{providers: []hostPresenceProvider{provider}}

	result, err := verifier.RequestPresenceVerification(context.Background(), PresenceVerificationRequest{
		Account: PresenceVerificationAccountContext{
			AccountID:   "acct-1",
			DisplayName: "Alice",
		},
		Purpose:      "shijing.profile.reveal",
		RequestedTTL: 90 * time.Second,
		Now:          now,
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if result.State != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED {
		t.Fatalf("state = %v, want verified", result.State)
	}
	if result.Method != runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL {
		t.Fatalf("method = %v, want OS credential", result.Method)
	}
	if !result.VerifiedUntil.Equal(now.Add(90 * time.Second)) {
		t.Fatalf("verified until = %s, want %s", result.VerifiedUntil, now.Add(90*time.Second))
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.calls)
	}
	if provider.seen.AccountID != "acct-1" || provider.seen.Purpose != "shijing.profile.reveal" {
		t.Fatalf("provider request = %+v", provider.seen)
	}
}

func TestHostPresenceVerifierReturnsRejectedWhenProviderRejects(t *testing.T) {
	verifier := hostPresenceVerifier{
		providers: []hostPresenceProvider{&fakeHostPresenceProvider{outcome: hostPresenceRejected}},
	}

	result, err := verifier.RequestPresenceVerification(context.Background(), PresenceVerificationRequest{
		Account:      PresenceVerificationAccountContext{AccountID: "acct-1"},
		Purpose:      "shijing.profile.reveal",
		RequestedTTL: time.Minute,
		Now:          time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if result.State != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED {
		t.Fatalf("state = %v, want rejected", result.State)
	}
	if result.Method != runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL {
		t.Fatalf("method = %v, want OS credential", result.Method)
	}
}

func TestHostPresenceVerifierFailsClosedWhenProviderUnavailable(t *testing.T) {
	verifier := hostPresenceVerifier{
		providers: []hostPresenceProvider{&fakeHostPresenceProvider{outcome: hostPresenceUnavailable}},
	}

	_, err := verifier.RequestPresenceVerification(context.Background(), PresenceVerificationRequest{
		Account:      PresenceVerificationAccountContext{AccountID: "acct-1"},
		Purpose:      "shijing.profile.reveal",
		RequestedTTL: time.Minute,
		Now:          time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC),
	})
	if !errors.Is(err, ErrPresenceVerificationUnavailable) {
		t.Fatalf("error = %v, want ErrPresenceVerificationUnavailable", err)
	}
}

func TestHostPresenceVerifierFallsBackToRealmReauthWhenLocalUnavailable(t *testing.T) {
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	local := &fakeHostPresenceProvider{outcome: hostPresenceUnavailable}
	realm := &fakeHostPresenceProvider{
		outcome: hostPresenceVerified,
		method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH,
	}
	verifier := hostPresenceVerifier{providers: []hostPresenceProvider{local, realm}}

	result, err := verifier.RequestPresenceVerification(context.Background(), PresenceVerificationRequest{
		Account:      PresenceVerificationAccountContext{AccountID: "acct-1", DisplayName: "Alice"},
		Purpose:      "shijing.profile.reveal",
		RequestedTTL: time.Minute,
		Now:          now,
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if result.State != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED {
		t.Fatalf("state = %v, want verified", result.State)
	}
	if result.Method != runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH {
		t.Fatalf("method = %v, want Nimi reauth", result.Method)
	}
	if local.calls != 1 || realm.calls != 1 {
		t.Fatalf("provider calls local=%d realm=%d, want 1/1", local.calls, realm.calls)
	}
}

func TestHostPresenceVerifierCarriesRequestScopedBrowserLauncher(t *testing.T) {
	provider := &fakeHostPresenceProvider{outcome: hostPresenceVerified}
	verifier := hostPresenceVerifier{providers: []hostPresenceProvider{provider}}
	launchedURL := ""
	ctx := WithPresenceBrowserLauncher(context.Background(), func(_ context.Context, rawURL string) error {
		launchedURL = rawURL
		return nil
	})

	_, err := verifier.RequestPresenceVerification(ctx, PresenceVerificationRequest{
		Account:      PresenceVerificationAccountContext{AccountID: "acct-1"},
		Purpose:      "account.profile.update",
		RequestedTTL: time.Minute,
		Now:          time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if provider.seen.BrowserLauncher == nil {
		t.Fatal("provider did not receive the request-scoped browser launcher")
	}
	if err := provider.seen.BrowserLauncher(context.Background(), "https://realm.example/authorize"); err != nil {
		t.Fatalf("BrowserLauncher: %v", err)
	}
	if launchedURL != "https://realm.example/authorize" {
		t.Fatalf("launched URL = %q", launchedURL)
	}
}

func TestHostPresenceVerifierDoesNotFallBackWhenLocalRejects(t *testing.T) {
	local := &fakeHostPresenceProvider{outcome: hostPresenceRejected}
	realm := &fakeHostPresenceProvider{
		outcome: hostPresenceVerified,
		method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH,
	}
	verifier := hostPresenceVerifier{providers: []hostPresenceProvider{local, realm}}

	result, err := verifier.RequestPresenceVerification(context.Background(), PresenceVerificationRequest{
		Account:      PresenceVerificationAccountContext{AccountID: "acct-1"},
		Purpose:      "shijing.profile.reveal",
		RequestedTTL: time.Minute,
		Now:          time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if result.State != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED {
		t.Fatalf("state = %v, want rejected", result.State)
	}
	if realm.calls != 0 {
		t.Fatalf("realm fallback calls = %d, want 0 after local rejection", realm.calls)
	}
}
