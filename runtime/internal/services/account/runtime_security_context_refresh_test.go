package account

import (
	"context"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type securityContextPendingRefresher struct {
	next    AccountMaterial
	err     error
	entered chan struct{}
	release chan struct{}
}

func (r securityContextPendingRefresher) Refresh(ctx context.Context, _ AccountMaterial) (AccountMaterial, error) {
	close(r.entered)
	select {
	case <-r.release:
		return r.next, r.err
	case <-ctx.Done():
		return AccountMaterial{}, ctx.Err()
	}
}

func TestAuthenticatedRuntimeSecurityContextPreservesUnexpiredIdentityDuringRefresh(t *testing.T) {
	for _, expiry := range []bool{false, true} {
		t.Run(map[bool]string{false: "same-identity", true: "expires-while-refresh-pending"}[expiry], func(t *testing.T) {
			svc := newHarnessService(t, nil)
			stopAccountRefreshTimer(t, svc)
			completeLogin(t, svc)
			_, before, invalidated, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("missing authenticated baseline")
			}
			refresher := securityContextPendingRefresher{next: testMaterial("acct-1", "access-next", "refresh-next"), entered: make(chan struct{}), release: make(chan struct{})}
			svc.refresher = refresher
			done := make(chan *refreshAccountSessionResult, 1)
			go func() { result, _ := svc.refreshAccountSessionInternal(context.Background(), true); done <- result }()
			<-refresher.entered
			if expiry {
				svc.mu.Lock()
				svc.material.AccessTokenExpires = time.Now().Add(-time.Second)
				svc.mu.Unlock()
			}
			projection, generation, fence, active := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !expiry {
				if !active || projection.GetAccountId() != "acct-1" || generation != before || fence != invalidated {
					t.Errorf("in-flight refresh changed live identity: active=%v generation=%d previous=%d", active, generation, before)
				}
				select {
				case <-invalidated:
					t.Error("in-flight refresh closed live account fence")
				default:
				}
			} else {
				if active || projection != nil || generation <= before {
					t.Errorf("expired material remained usable: active=%v generation=%d previous=%d", active, generation, before)
				}
				select {
				case <-invalidated:
				default:
					t.Error("expiry during refresh did not close old account fence")
				}
			}
			close(refresher.release)
			result := <-done
			if result == nil || !result.accepted {
				t.Fatalf("refresh failed unexpectedly: %v", result)
			}
			_, after, afterFence, active := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !active {
				t.Fatal("refresh result was not installed")
			}
			if !expiry && (after != before || afterFence != invalidated) {
				t.Fatal("same-identity completed refresh replaced the account fence")
			}
			if expiry && (after <= before || afterFence == invalidated) {
				t.Fatal("refresh revived an already expired account fence")
			}
		})
	}
}

func TestAuthenticatedRuntimeSecurityContextPendingFailureKeepsInvalidation(t *testing.T) {
	svc := newHarnessService(t, nil)
	stopAccountRefreshTimer(t, svc)
	completeLogin(t, svc)
	_, before, invalidated, _ := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	refresher := securityContextPendingRefresher{err: ErrLoginExchangeFailure, entered: make(chan struct{}), release: make(chan struct{})}
	svc.refresher = refresher
	done := make(chan *refreshAccountSessionResult, 1)
	go func() { result, _ := svc.refreshAccountSessionInternal(context.Background(), true); done <- result }()
	<-refresher.entered
	if _, generation, _, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || generation != before {
		t.Error("pending unexpired identity was lost before refresh outcome")
	}
	close(refresher.release)
	if result := <-done; result == nil || result.accepted {
		t.Fatalf("invalid refresh succeeded: %v", result)
	}
	if projection, generation, _, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background()); ok || projection != nil || generation <= before {
		t.Fatal("failed refresh retained prior identity")
	}
	select {
	case <-invalidated:
	default:
		t.Fatal("failed refresh left old fence open")
	}
}

func TestAuthenticatedRuntimeSecurityContextDeferredRefreshNeedsLiveCustody(t *testing.T) {
	material := testMaterial("acct-1", "access-current", "refresh-current")
	svc := newProductionHarnessService(t, &memoryCustody{material: material, has: true})
	stopAccountRefreshTimer(t, svc)
	_, before, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("missing live custody baseline")
	}
	svc.refresher = staticRefresher{err: newRefreshFailure(refreshFailurePreDispatch, errors.New("network not reached"))}
	result, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING {
		t.Fatalf("refresh was not deferred: %v %v", result, err)
	}
	if _, generation, current, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || generation != before || current != fence {
		t.Fatal("safe pre-dispatch deferral invalidated unexpired identity")
	}
	material.AccessTokenExpires = time.Now().Add(-time.Second)
	cold := newProductionHarnessService(t, &memoryCustody{material: material, has: true})
	stopAccountRefreshTimer(t, cold)
	if projection, generation, _, ok := cold.BindAuthenticatedRuntimeGeneration(context.Background()); ok || projection != nil || generation != 0 {
		t.Fatal("cold expired custody gained authentication from REFRESH_PENDING")
	}
}

func TestAuthenticatedRuntimeSecurityContextRefreshCompletionCutsUnobservedExpiry(t *testing.T) {
	svc := newHarnessService(t, nil)
	stopAccountRefreshTimer(t, svc)
	completeLogin(t, svc)
	_, before, fence, _ := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	refresher := securityContextPendingRefresher{next: testMaterial("acct-1", "access-next", "refresh-next"), entered: make(chan struct{}), release: make(chan struct{})}
	svc.refresher = refresher
	done := make(chan *refreshAccountSessionResult, 1)
	go func() { result, _ := svc.refreshAccountSessionInternal(context.Background(), true); done <- result }()
	<-refresher.entered
	svc.mu.Lock()
	svc.material.AccessTokenExpires = time.Now().Add(-time.Second)
	svc.mu.Unlock()
	// No identity read, App operation, or observer runs during the expired gap.
	close(refresher.release)
	if result := <-done; result == nil || !result.accepted {
		t.Fatalf("refresh did not install replacement: %v", result)
	}
	if _, after, _, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || after <= before {
		t.Fatal("unobserved expiry reused the old account generation")
	}
	select {
	case <-fence:
	default:
		t.Fatal("unobserved expiry left the old execution fence open")
	}
}
