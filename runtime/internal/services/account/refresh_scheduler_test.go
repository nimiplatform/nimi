package account

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptrace"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func stopAccountRefreshTimer(t *testing.T, service *Service) {
	t.Helper()
	t.Cleanup(func() {
		service.mu.Lock()
		if service.refreshTimer != nil {
			service.refreshTimer.Stop()
			service.refreshTimer = nil
		}
		service.mu.Unlock()
	})
}

func TestRefreshFailureDispositionControlsCustodyAndAccountState(t *testing.T) {
	tests := []struct {
		name          string
		disposition   refreshFailureDisposition
		state         runtimev1.AccountSessionState
		reason        runtimev1.ReasonCode
		accountReason runtimev1.AccountReasonCode
		retainsToken  bool
	}{
		{name: "not dispatched", disposition: refreshFailurePreDispatch, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING, reason: runtimev1.ReasonCode_REALM_UNAVAILABLE, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED, retainsToken: true},
		{name: "token invalid", disposition: refreshFailureTokenInvalid, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED, reason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID},
		{name: "contract invalid", disposition: refreshFailureContractInvalid, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED, reason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID},
		{name: "outcome ambiguous", disposition: refreshFailureOutcomeAmbiguous, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED, reason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			current := testMaterial("acct-refresh", "access-old", "refresh-old")
			custody := &refreshRestartProofCustody{material: current, has: true}
			service := New(nil,
				WithProductionActivation(),
				WithCustody(custody),
				WithCustodyPartition("refresh-disposition-"+test.name),
				WithRefresher(staticRefresher{err: newRefreshFailure(test.disposition, errors.New(test.name))}),
			)
			stopAccountRefreshTimer(t, service)
			result, err := service.refreshAccountSessionInternal(context.Background(), true)
			if err != nil || result.accepted || result.state != test.state || result.reasonCode != test.reason || result.accountReasonCode != test.accountReason {
				t.Fatalf("refresh result = (%+v, %v)", result, err)
			}
			if test.retainsToken {
				if !custody.has || custody.material.RefreshToken != current.RefreshToken ||
					custody.material.RefreshTokenHashes[refreshHash(current.RefreshToken)] || custody.clearCalls != 0 || custody.storeCalls != 2 {
					t.Fatalf("safe pre-dispatch custody = %+v", custody)
				}
				return
			}
			if custody.has || custody.clearCalls != 1 || custody.storeCalls != 1 {
				t.Fatalf("unsafe refresh custody = %+v", custody)
			}
		})
	}
}

func TestDeferredRefreshTransitionsToExpiredWhenAccessTokenPassesExpiry(t *testing.T) {
	clockNow := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	current := testMaterial("acct-refresh", "access-old", "refresh-old")
	current.AccessTokenExpires = clockNow.Add(time.Minute)
	custody := &refreshRestartProofCustody{material: current, has: true}
	service := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("refresh-expired-before-retry"),
		WithRefresher(staticRefresher{err: newRefreshFailure(refreshFailurePreDispatch, errors.New("offline"))}),
		WithClock(func() time.Time { return clockNow }),
	)
	stopAccountRefreshTimer(t, service)
	clockNow = clockNow.Add(2 * time.Minute)

	result, err := service.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || result.accepted ||
		result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED ||
		result.reasonCode != runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED ||
		result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE {
		t.Fatalf("expired refresh result = (%+v, %v)", result, err)
	}
	if !custody.has || custody.material.RefreshToken != current.RefreshToken ||
		custody.material.RefreshTokenHashes[refreshHash(current.RefreshToken)] ||
		custody.clearCalls != 0 || custody.storeCalls != 2 {
		t.Fatalf("expired refresh custody = %+v", custody)
	}
	service.mu.RLock()
	defer service.mu.RUnlock()
	if service.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED ||
		service.authenticatedRuntimeIdentity || service.material.RefreshToken != current.RefreshToken ||
		service.projection == nil || service.refreshTimer != nil || service.refreshRetryAttempt != 0 {
		t.Fatalf("expired service state=%v authenticated=%v material=%+v projection=%+v timer=%v retry=%d",
			service.state,
			service.authenticatedRuntimeIdentity,
			service.material,
			service.projection,
			service.refreshTimer,
			service.refreshRetryAttempt,
		)
	}
	if len(service.events) < 2 ||
		service.events[len(service.events)-2].GetEventType() != runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED ||
		service.events[len(service.events)-1].GetEventType() != runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS {
		t.Fatalf("expired refresh events = %+v", service.events)
	}
}

func TestRealmTokenRefresherDistinguishesNotSentFromUncertainDispatch(t *testing.T) {
	tests := []struct {
		name        string
		writeSignal bool
		want        refreshFailureDisposition
	}{
		{name: "not sent", want: refreshFailurePreDispatch},
		{name: "possibly sent", writeSignal: true, want: refreshFailureOutcomeAmbiguous},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := &http.Client{Transport: accountRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if test.writeSignal {
					if trace := httptrace.ContextClientTrace(request.Context()); trace != nil && trace.WroteRequest != nil {
						trace.WroteRequest(httptrace.WroteRequestInfo{})
					}
				}
				return nil, errors.New("transport stopped")
			})}
			refresher := newRealmTokenRefresher(resolveProductionConfig(ProductionConfig{
				RealmBaseURL: "https://realm.test",
				TokenURL:     "https://realm.test/api/auth/refresh",
				HTTPClient:   client,
			}))
			_, err := refresher.Refresh(context.Background(), testMaterial("acct-refresh", "access-old", "refresh-old"))
			if got := refreshFailureDispositionOf(err); got != test.want {
				t.Fatalf("refresh disposition = %v, want %v (error=%v)", got, test.want, err)
			}
		})
	}
}

func TestDaemonRestartRebuildsProactiveRefreshTimer(t *testing.T) {
	current := testMaterial("acct-refresh", "access-old", "refresh-old")
	current.AccessTokenExpires = time.Now().UTC().Add(240 * time.Millisecond)
	custody := &memoryCustody{material: current, has: true}
	refresher := &countingAccountRefresher{material: testMaterial("acct-refresh", "access-new", "refresh-new")}
	restarted := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("proactive-restart"),
		WithRefresher(refresher),
	)
	stopAccountRefreshTimer(t, restarted)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		restarted.mu.RLock()
		complete := restarted.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
			restarted.material.AccessToken == "access-new"
		restarted.mu.RUnlock()
		if complete {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if refresher.calls.Load() != 1 {
		t.Fatalf("proactive refresh calls = %d, want 1", refresher.calls.Load())
	}
	restarted.mu.RLock()
	state := restarted.state
	accessToken := restarted.material.AccessToken
	restarted.mu.RUnlock()
	if state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || accessToken != "access-new" {
		t.Fatalf("proactive refresh state=%v token=%q", state, accessToken)
	}
}
