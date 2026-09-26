package app

import (
	"context"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type localAppRefreshCustody struct {
	mu       sync.Mutex
	material accountservice.AccountMaterial
}

func (c *localAppRefreshCustody) Load(context.Context, string) (accountservice.AccountMaterial, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.material, nil
}
func (c *localAppRefreshCustody) Store(_ context.Context, _ string, m accountservice.AccountMaterial) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.material = m
	return nil
}
func (c *localAppRefreshCustody) Clear(context.Context, string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.material = accountservice.AccountMaterial{}
	return nil
}

type localAppBlockingAccountRefresher struct {
	entered chan struct{}
	release chan struct{}
}

func (r localAppBlockingAccountRefresher) Refresh(ctx context.Context, current accountservice.AccountMaterial) (accountservice.AccountMaterial, error) {
	close(r.entered)
	select {
	case <-ctx.Done():
		return accountservice.AccountMaterial{}, ctx.Err()
	case <-r.release:
	}
	current.AccessToken = "rotated-access"
	current.RefreshToken = "rotated-refresh"
	current.AccessTokenExpires = time.Time{}
	return current, nil
}

func TestLocalAppRenewalDuringRealAccountRefreshPreservesScope(t *testing.T) {
	f, desktop, run := runAccessFixture(t)
	refresher := localAppBlockingAccountRefresher{entered: make(chan struct{}), release: make(chan struct{})}
	var release sync.Once
	defer release.Do(func() { close(refresher.release) })
	// A fixed owner clock keeps existing authorization unexpired while the
	// actual Account scheduler and refresh transaction wait on network work.
	account := accountservice.New(nil, accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", CurrentUserHandle: "user", DisplayName: "User", AccessToken: "initial-access", RefreshToken: "initial-refresh", AccessTokenExpires: f.now.Add(time.Second)}}), accountservice.WithRefresher(refresher))
	WithRuntimeAccountProjectionProvider(account)(f.service)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	originalHandle, ok := f.connection.Session()
	if !ok {
		t.Fatal("missing initial App session")
	}
	baseline, err := f.service.GetLocalDevelopmentRunAccess(desktop, run)
	if err != nil || !baseline.Available {
		t.Fatalf("baseline unavailable: %v %v", baseline, err)
	}
	authorized, err := f.service.AuthorizeLocalAppIngress(f.context, localappop.IngressStorageJSONRead)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-refresher.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("Account owner did not start scheduled refresh")
	}
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err != nil {
		t.Fatalf("same-identity pending refresh broke App renewal: %v", err)
	}
	currentHandle, ok := f.connection.Session()
	if !ok || currentHandle != originalHandle {
		t.Fatal("pending refresh replaced App session fence")
	}
	select {
	case <-authorized.Done():
		t.Fatal("pending refresh canceled admitted App scope")
	default:
	}
	current, err := f.service.GetLocalDevelopmentRunAccess(desktop, run)
	if err != nil || !current.Available || current.ExecutionScopeRef != baseline.ExecutionScopeRef || current.ReasonCode != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("pending refresh changed Host-visible scope: %v %v", current, err)
	}
	release.Do(func() { close(refresher.release) })
}
