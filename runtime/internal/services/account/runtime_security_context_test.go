package account

import (
	"context"
	"math"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAuthenticatedRuntimeSecurityContextGenerationLifecycle(t *testing.T) {
	svc := newHarnessService(t, nil)
	if projection, generation, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || generation != 0 {
		t.Fatalf("initial security context = (%+v, %d, %v), want unauthenticated generation zero", projection, generation, ok)
	}

	completeLogin(t, svc)
	projection, loginGeneration, invalidated, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok || projection.GetAccountId() != "acct-1" || projection.GetRealmEnvironmentId() != "realm-local" || loginGeneration == 0 || invalidated == nil {
		t.Fatalf("login security context = (%+v, %d, %v)", projection, loginGeneration, ok)
	}

	svc.refresher = staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}
	refresh, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || !refresh.accepted {
		t.Fatalf("same-identity refresh = (%+v, %v)", refresh, err)
	}
	projection, refreshGeneration, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok || projection.GetAccountId() != "acct-1" || refreshGeneration != loginGeneration {
		t.Fatalf("same-identity refresh security context = (%+v, %d, %v), want generation %d", projection, refreshGeneration, ok, loginGeneration)
	}
	select {
	case <-invalidated:
		t.Fatal("same-identity refresh invalidated the bound account generation")
	default:
	}

	unauthorized, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: firstPartyCaller()})
	if err != nil || unauthorized.GetAccepted() {
		t.Fatalf("unauthorized logout = (%+v, %v)", unauthorized, err)
	}
	if _, generation, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); !ok || generation != loginGeneration {
		t.Fatalf("unauthorized logout changed security generation: generation=%d ok=%v", generation, ok)
	}

	logout, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !logout.GetAccepted() {
		t.Fatalf("logout = (%+v, %v)", logout, err)
	}
	if projection, generation, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || generation <= loginGeneration {
		t.Fatalf("logged-out security context = (%+v, %d, %v), want advanced unavailable generation", projection, generation, ok)
	}
	select {
	case <-invalidated:
	default:
		t.Fatal("logout did not synchronously invalidate the bound account generation")
	}
	logoutGeneration := svc.accountGeneration

	svc.exchanger = staticExchanger{material: testMaterial("acct-1", "access-3", "refresh-3")}
	completeLogin(t, svc)
	_, nextLoginGeneration, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok || nextLoginGeneration <= logoutGeneration {
		t.Fatalf("next login generation = %d, want greater than logout generation %d", nextLoginGeneration, logoutGeneration)
	}
}

func TestAuthenticatedRuntimeSecurityContextCustodyRestore(t *testing.T) {
	material := testMaterial("acct-restored", "access-restored", "refresh-restored")
	material.RealmEnvironmentID = "realm-restored"
	restored := newProductionHarnessService(t, &memoryCustody{material: material, has: true})
	projection, generation, ok := restored.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok || generation == 0 || projection.GetAccountId() != "acct-restored" || projection.GetRealmEnvironmentId() != "realm-restored" {
		t.Fatalf("restored security context = (%+v, %d, %v)", projection, generation, ok)
	}

	unavailable := newProductionHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	if projection, generation, ok := unavailable.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || generation != 0 {
		t.Fatalf("unavailable custody security context = (%+v, %d, %v)", projection, generation, ok)
	}
}

func TestAuthenticatedRuntimeSecurityContextRefreshIdentityRules(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	_, initialGeneration, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("login did not establish Runtime security context")
	}

	changedRealm := testMaterial("acct-1", "access-2", "refresh-2")
	changedRealm.RealmEnvironmentID = "realm-next"
	svc.refresher = staticRefresher{material: changedRealm}
	refresh, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || !refresh.accepted {
		t.Fatalf("realm-changing refresh = (%+v, %v)", refresh, err)
	}
	projection, changedGeneration, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok || projection.GetRealmEnvironmentId() != "realm-next" || changedGeneration <= initialGeneration {
		t.Fatalf("realm-changing refresh security context = (%+v, %d, %v), previous generation %d", projection, changedGeneration, ok, initialGeneration)
	}

	svc.mu.Lock()
	svc.material.AccessTokenExpires = time.Now().UTC().Add(-time.Second)
	svc.mu.Unlock()
	if projection, expiredGeneration, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || expiredGeneration <= changedGeneration {
		t.Fatalf("expired security context = (%+v, %d, %v), previous generation %d", projection, expiredGeneration, ok, changedGeneration)
	}
	expiredGeneration := svc.accountGeneration

	next := testMaterial("acct-1", "access-3", "refresh-3")
	next.RealmEnvironmentID = "realm-next"
	svc.refresher = staticRefresher{material: next}
	refresh, err = svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || !refresh.accepted {
		t.Fatalf("expired-account refresh = (%+v, %v)", refresh, err)
	}
	_, refreshedGeneration, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok || refreshedGeneration <= expiredGeneration {
		t.Fatalf("post-expiry refresh generation = %d, want greater than %d", refreshedGeneration, expiredGeneration)
	}
}

func TestAuthenticatedRuntimeSecurityContextMissingRealmRefreshInvalidatesGeneration(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	_, before, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("login did not establish Runtime security context")
	}

	missingRealm := testMaterial("acct-1", "access-2", "refresh-2")
	missingRealm.RealmEnvironmentID = ""
	svc.refresher = staticRefresher{material: missingRealm}
	refresh, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || refresh.accepted {
		t.Fatalf("missing-Realm refresh = (%+v, %v)", refresh, err)
	}
	if projection, after, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || after <= before {
		t.Fatalf("missing-Realm security context = (%+v, %d, %v), previous generation %d", projection, after, ok, before)
	}
}

func TestAuthenticatedRuntimeSecurityContextRefreshCannotRestoreAfterConcurrentLogout(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	_, before, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("login did not establish Runtime security context")
	}

	started := make(chan struct{})
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	svc.refresher = blockingRuntimeSecurityContextRefresher{
		material: testMaterial("acct-1", "access-2", "refresh-2"),
		started:  started,
		release:  release,
	}

	type refreshResult struct {
		response *refreshAccountSessionResult
		err      error
	}
	refreshDone := make(chan refreshResult, 1)
	go func() {
		response, err := svc.refreshAccountSessionInternal(context.Background(), true)
		refreshDone <- refreshResult{response: response, err: err}
	}()
	<-started

	type logoutResult struct {
		response *runtimev1.LogoutResponse
		err      error
	}
	logoutDone := make(chan logoutResult, 1)
	go func() {
		response, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
		logoutDone <- logoutResult{response: response, err: err}
	}()
	select {
	case result := <-logoutDone:
		t.Fatalf("logout completed before in-flight refresh committed: (%+v, %v)", result.response, result.err)
	case <-time.After(50 * time.Millisecond):
	}

	close(release)
	refreshed := <-refreshDone
	if refreshed.err != nil || !refreshed.response.accepted {
		t.Fatalf("serialized refresh = (%+v, %v)", refreshed.response, refreshed.err)
	}
	loggedOut := <-logoutDone
	if loggedOut.err != nil || !loggedOut.response.GetAccepted() {
		t.Fatalf("serialized logout = (%+v, %v)", loggedOut.response, loggedOut.err)
	}
	if projection, after, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || after <= before {
		t.Fatalf("post-logout security context = (%+v, %d, %v), previous generation %d", projection, after, ok, before)
	}
}

type blockingRuntimeSecurityContextRefresher struct {
	material AccountMaterial
	started  chan<- struct{}
	release  <-chan struct{}
}

func (refresher blockingRuntimeSecurityContextRefresher) Refresh(ctx context.Context, _ AccountMaterial) (AccountMaterial, error) {
	close(refresher.started)
	select {
	case <-refresher.release:
		return refresher.material, nil
	case <-ctx.Done():
		return AccountMaterial{}, ctx.Err()
	}
}

func TestAuthenticatedRuntimeSecurityContextClearingTransitionsAdvance(t *testing.T) {
	tests := []struct {
		name       string
		newService func(*testing.T) (*Service, *memoryCustody)
		transition func(*testing.T, *Service, *memoryCustody)
	}{
		{
			name: "reauth required",
			transition: func(t *testing.T, svc *Service, _ *memoryCustody) {
				svc.refresher = staticRefresher{err: ErrLoginExchangeFailure}
				refresh, err := svc.refreshAccountSessionInternal(context.Background(), true)
				if err != nil || refresh.accepted {
					t.Fatalf("failed refresh = (%+v, %v)", refresh, err)
				}
			},
		},
		{
			name: "custody unavailable",
			newService: func(t *testing.T) (*Service, *memoryCustody) {
				custody := &memoryCustody{}
				return newHarnessService(t, custody), custody
			},
			transition: func(t *testing.T, svc *Service, custody *memoryCustody) {
				custody.err = ErrCustodyUnavailable
				svc.refresher = staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}
				refresh, err := svc.refreshAccountSessionInternal(context.Background(), true)
				if err != nil || refresh.accepted {
					t.Fatalf("custody-failed refresh = (%+v, %v)", refresh, err)
				}
			},
		},
		{
			name: "refresh token reuse",
			transition: func(t *testing.T, svc *Service, _ *memoryCustody) {
				svc.mu.Lock()
				svc.material.RefreshTokenHashes = map[string]bool{refreshHash("reused-refresh"): true}
				svc.mu.Unlock()
				if reason, ok := svc.ObserveRefreshToken(context.Background(), "reused-refresh"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED {
					t.Fatalf("reuse observation = (%v, %v)", reason, ok)
				}
			},
		},
		{
			name: "account switch",
			transition: func(t *testing.T, svc *Service, _ *memoryCustody) {
				switchAccount, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
				if err != nil || !switchAccount.GetAccepted() {
					t.Fatalf("SwitchAccount = (%+v, %v)", switchAccount, err)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var svc *Service
			var custody *memoryCustody
			if test.newService != nil {
				svc, custody = test.newService(t)
			} else {
				custody = &memoryCustody{}
				svc = newHarnessService(t, custody)
			}
			completeLogin(t, svc)
			_, before, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background())
			if !ok {
				t.Fatal("login did not establish Runtime security context")
			}
			test.transition(t, svc, custody)
			if projection, after, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || after <= before {
				t.Fatalf("cleared security context = (%+v, %d, %v), previous generation %d", projection, after, ok, before)
			}
		})
	}
}

func TestAuthenticatedRuntimeSecurityContextGenerationOverflowFailsClosed(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	svc.mu.Lock()
	svc.accountGeneration = math.MaxUint64
	svc.mu.Unlock()

	logout, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !logout.GetAccepted() {
		t.Fatalf("logout at maximum generation = (%+v, %v)", logout, err)
	}
	if projection, generation, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || generation != math.MaxUint64 {
		t.Fatalf("post-overflow logout context = (%+v, %d, %v)", projection, generation, ok)
	}

	svc.exchanger = staticExchanger{material: testMaterial("acct-2", "access-2", "refresh-2")}
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !begin.GetAccepted() {
		t.Fatalf("BeginLogin after maximum generation = (%+v, %v)", begin, err)
	}
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil {
		t.Fatalf("CompleteLogin after maximum generation: %v", err)
	}
	if complete.GetAccepted() {
		t.Fatalf("generation overflow must reject new authenticated identity: %+v", complete)
	}
	if projection, generation, ok := svc.AuthenticatedRuntimeSecurityContext(context.Background()); ok || projection != nil || generation != math.MaxUint64 {
		t.Fatalf("overflow wrapped or exposed identity: (%+v, %d, %v)", projection, generation, ok)
	}
}
