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

func TestAuthenticatedRuntimeSecurityContextPreservesTrustedLocalIdentityDuringRefresh(t *testing.T) {
	for _, accessExpired := range []bool{false, true} {
		t.Run(map[bool]string{false: "same-identity", true: "access-expires-while-refresh-pending"}[accessExpired], func(t *testing.T) {
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
			if accessExpired {
				svc.mu.Lock()
				svc.material.AccessTokenExpires = time.Now().Add(-time.Second)
				svc.mu.Unlock()
			}
			projection, generation, fence, active := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !active || projection.GetAccountId() != "acct-1" || generation != before || fence != invalidated {
				t.Errorf("in-flight refresh changed live local identity: active=%v generation=%d previous=%d", active, generation, before)
			}
			select {
			case <-invalidated:
				t.Error("in-flight refresh closed live local account fence")
			default:
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
			if after != before || afterFence != invalidated {
				t.Fatal("same-identity completed refresh replaced the local account fence")
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

func TestAuthenticatedRuntimeSecurityContextDeferredRefreshPreservesTrustedCustody(t *testing.T) {
	material := testMaterial("acct-1", "access-current", "refresh-current")
	svc := newProductionHarnessService(t, &memoryCustody{material: material, has: true})
	stopAccountRefreshTimer(t, svc)
	_, before, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("missing live custody baseline")
	}
	svc.refresher = staticRefresher{err: newRefreshFailure(refreshFailurePreDispatch, errors.New("network not reached"))}
	result, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
		t.Fatalf("refresh was not safely deferred: %v %v", result, err)
	}
	if _, generation, current, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || generation != before || current != fence {
		t.Fatal("safe pre-dispatch deferral invalidated trusted local identity")
	}
	material.AccessTokenExpires = time.Now().Add(-time.Second)
	cold := newProductionHarnessService(t, &memoryCustody{material: material, has: true})
	stopAccountRefreshTimer(t, cold)
	if projection, generation, _, ok := cold.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || projection.GetAccountId() != "acct-1" || generation == 0 {
		t.Fatalf("cold restart with trusted custody and expired access token lost local identity: proj=%+v gen=%d ok=%v", projection, generation, ok)
	}
	marked := material
	marked.RefreshTokenHashes = map[string]bool{refreshHash(marked.RefreshToken): true}
	markedCustody := &memoryCustody{material: marked, has: true}
	crashed := newProductionHarnessService(t, markedCustody)
	stopAccountRefreshTimer(t, crashed)
	if projection, generation, _, ok := crashed.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || projection.GetAccountId() != "acct-1" || generation == 0 {
		t.Fatalf("cold custody with unrevoked in-flight refresh crash fence lost trusted local identity: proj=%+v gen=%d ok=%v", projection, generation, ok)
	}
	if !markedCustody.material.OnlineCredentialsCleared || markedCustody.material.AccessToken != "" || markedCustody.material.RefreshToken != "" || len(markedCustody.material.RefreshTokenHashes) != 0 {
		t.Fatalf("cold custody with in-flight crash fence retained potentially rotated online tokens: %+v", markedCustody.material)
	}
	if _, _, _, ok, err := crashed.realmUnaryCredential(context.Background()); err != nil || ok {
		t.Fatalf("cold custody with cleared online tokens admitted online credential: ok=%v err=%v", ok, err)
	}
}

func TestAuthenticatedRuntimeSecurityContextRefreshCompletionPreservesSameIdentityAndCutsInvalidatedIdentity(t *testing.T) {
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
	close(refresher.release)
	if result := <-done; result == nil || !result.accepted {
		t.Fatalf("refresh did not install replacement: %v", result)
	}
	if _, after, afterFence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || after != before || afterFence != fence {
		t.Fatal("same-identity refresh after access-token expiry disrupted local account generation")
	}
	select {
	case <-fence:
		t.Fatal("same-identity refresh closed local execution fence")
	default:
	}

	svc.mu.Lock()
	svc.invalidateAuthenticatedRuntimeIdentityLocked()
	svc.mu.Unlock()
	select {
	case <-fence:
	default:
		t.Fatal("explicit invalidation left old execution fence open")
	}
	svc.refresher = staticRefresher{material: testMaterial("acct-1", "access-rebound", "refresh-rebound")}
	if result, err := svc.refreshAccountSessionInternal(context.Background(), true); err != nil || result == nil || !result.accepted {
		t.Fatalf("refresh after explicit invalidation failed: %v %v", result, err)
	}
	if _, afterInvalidation, nextFence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background()); !ok || afterInvalidation <= before || nextFence == fence {
		t.Fatal("explicit invalidation reused the old account generation or fence")
	}
}
