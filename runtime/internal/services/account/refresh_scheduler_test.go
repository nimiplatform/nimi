package account

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptrace"
	"testing"
	"testing/synctest"
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
		name             string
		disposition      refreshFailureDisposition
		state            runtimev1.AccountSessionState
		reason           runtimev1.ReasonCode
		accountReason    runtimev1.AccountReasonCode
		retainsToken     bool
		clearsOnlineOnly bool
	}{
		{name: "not dispatched", disposition: refreshFailurePreDispatch, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, reason: runtimev1.ReasonCode_REALM_UNAVAILABLE, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED, retainsToken: true},
		{name: "token invalid", disposition: refreshFailureTokenInvalid, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED, reason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID},
		{name: "contract invalid", disposition: refreshFailureContractInvalid, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED, reason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID},
		{name: "outcome ambiguous", disposition: refreshFailureOutcomeAmbiguous, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, reason: runtimev1.ReasonCode_REALM_UNAVAILABLE, accountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS, clearsOnlineOnly: true},
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
			if test.clearsOnlineOnly {
				if !custody.has || custody.clearCalls != 0 || custody.storeCalls != 2 ||
					!custody.material.OnlineCredentialsCleared ||
					custody.material.AccessToken != "" || custody.material.RefreshToken != "" ||
					!custody.material.AccessTokenExpires.IsZero() || len(custody.material.RefreshTokenHashes) != 0 {
					t.Fatalf("ambiguous refresh custody = %+v", custody)
				}
				service.mu.RLock()
				timer := service.refreshTimer
				service.mu.RUnlock()
				if timer != nil {
					t.Fatal("ambiguous refresh left background refresh timer active")
				}
				return
			}
			if custody.has || custody.clearCalls != 1 || custody.storeCalls != 1 {
				t.Fatalf("unsafe refresh custody = %+v", custody)
			}
		})
	}
}

func TestDeferredRefreshPreservesLocalIdentityWhenAccessTokenPassesExpiry(t *testing.T) {
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
		result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		result.reasonCode != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
		result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
		t.Fatalf("offline deferred refresh result = (%+v, %v)", result, err)
	}
	if !custody.has || custody.material.RefreshToken != current.RefreshToken ||
		custody.material.RefreshTokenHashes[refreshHash(current.RefreshToken)] ||
		custody.clearCalls != 0 || custody.storeCalls != 2 {
		t.Fatalf("offline deferred refresh custody = %+v", custody)
	}
	service.mu.RLock()
	defer service.mu.RUnlock()
	if service.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		!service.authenticatedRuntimeIdentity || service.material.RefreshToken != current.RefreshToken ||
		service.projection == nil || service.refreshTimer == nil || service.refreshRetryAttempt != 1 {
		t.Fatalf("offline deferred service state=%v authenticated=%v material=%+v projection=%+v timer=%v retry=%d",
			service.state,
			service.authenticatedRuntimeIdentity,
			service.material,
			service.projection,
			service.refreshTimer,
			service.refreshRetryAttempt,
		)
	}
	if len(service.events) < 2 ||
		service.events[len(service.events)-2].GetEventType() != runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_DEFERRED ||
		service.events[len(service.events)-1].GetEventType() != runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS {
		t.Fatalf("offline deferred refresh events = %+v", service.events)
	}
}

func TestScheduledRetryRefreshesRejectedAccessTokenBeforeExpiry(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		current := testMaterial("acct-refresh", "access-rejected", "refresh-old")
		current.AccessTokenExpires = time.Now().Add(time.Hour)
		custody := &refreshRestartProofCustody{material: current, has: true}
		calls := 0
		service := New(nil,
			WithProductionActivation(),
			WithCustody(custody),
			WithCustodyPartition("refresh-rejected-before-expiry"),
			WithRefresher(funcAccountRefresher{fn: func(_ context.Context, material AccountMaterial) (AccountMaterial, error) {
				calls++
				if calls == 1 {
					return AccountMaterial{}, newRefreshFailure(refreshFailurePreDispatch, errors.New("offline"))
				}
				material.AccessToken = "access-rotated"
				material.RefreshToken = "refresh-rotated"
				return material, nil
			}}),
		)
		stopAccountRefreshTimer(t, service)
		_, generation, _, ok := service.BindAuthenticatedRuntimeGeneration(context.Background())
		if !ok {
			t.Fatal("expected a current Runtime identity")
		}
		result, err := service.refreshAccountSessionAfterUnauthorized(context.Background(), current.AccessToken, generation)
		if err != nil || result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
			t.Fatalf("refresh after unauthorized = (%+v, %v), want deferred refresh", result, err)
		}
		service.mu.RLock()
		deferredSequence := service.nextSequence
		service.mu.RUnlock()
		time.Sleep(2 * time.Second)
		synctest.Wait()
		service.mu.RLock()
		defer service.mu.RUnlock()
		if calls != 2 || service.material.AccessToken != "access-rotated" {
			t.Fatalf("scheduled retry did not rotate the rejected token, calls=%d", calls)
		}
		for _, event := range service.events {
			if event.GetSequence() > deferredSequence && event.GetEventType() == runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_COMPLETED {
				return
			}
		}
		t.Fatal("scheduled retry did not publish refresh completion")
	})
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
	t.Run("before access expiry", func(t *testing.T) {
		testDaemonRestartRefreshesStoredMaterial(t, 240*time.Millisecond)
	})
	t.Run("access expired while stopped", func(t *testing.T) {
		testDaemonRestartRefreshesStoredMaterial(t, -time.Hour)
	})
}

func testDaemonRestartRefreshesStoredMaterial(t *testing.T, expiresIn time.Duration) {
	t.Helper()
	current := testMaterial("acct-refresh", "access-old", "refresh-old")
	current.AccessTokenExpires = time.Now().UTC().Add(expiresIn)
	custody := &memoryCustody{material: current, has: true}
	refresher := &countingAccountRefresher{material: testMaterial("acct-refresh", "access-new", "refresh-new")}
	restarted := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("proactive-restart"),
		WithRefresher(refresher),
	)
	stopAccountRefreshTimer(t, restarted)
	deadline := time.Now().Add(3 * time.Second)
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
