package app

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestJobWorkAuthoritySurvivesSessionLossAndFencesRealWithdrawal(t *testing.T) {
	for _, withdrawal := range []string{"account", "registration"} {
		t.Run(withdrawal, func(t *testing.T) {
			f := newLocalAppSessionFixture(t, []string{"runtime.consume"})
			account := accountservice.New(nil, accountservice.WithAuditStore(auditlog.New(128, 128)), accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: f.now.Add(time.Hour)}}))
			WithRuntimeAccountProjectionProvider(account)(f.service)
			if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
				t.Fatal(err)
			}
			admitted, err := f.service.AuthorizeLocalAppIngress(f.context, localappop.IngressScenarioJobSubmit)
			if err != nil {
				t.Fatal(err)
			}
			decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(admitted)
			if !ok {
				t.Fatal("missing actual ingress decision")
			}
			permission, err := NewJobWorkAuthorizer(account, f.kernel).AdmitJobWork(admitted, decision)
			if err != nil {
				t.Fatal(err)
			}
			defer permission.Release()
			f.connection.Revoke()
			select {
			case <-decision.SessionInvalidated:
			default:
				t.Fatal("technical session did not close")
			}
			select {
			case <-permission.Invalidated:
				t.Fatal("technical session closed Job work")
			default:
			}
			committed := false
			if err := permission.WithCurrent(context.Background(), func() error { committed = true; return nil }); err != nil || !committed {
				t.Fatalf("admitted work lost current owner after detach: %v", err)
			}
			if withdrawal == "account" {
				response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop-1", DeviceId: "device-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
				if err != nil || !response.GetAccepted() {
					t.Fatalf("logout: %v", err)
				}
			} else if err := f.kernel.Registrations().Tombstone(context.Background(), f.registration.RegistrationHandle); err != nil {
				t.Fatal(err)
			}
			committed = false
			if err := permission.WithCurrent(context.Background(), func() error { committed = true; return nil }); err == nil || committed {
				t.Fatal("withdrawn owner published")
			}
			select {
			case <-permission.Invalidated:
			case <-time.After(time.Second):
				t.Fatal("withdrawal failed to signal admitted work")
			}
		})
	}
}
