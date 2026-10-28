package app

import (
	"bytes"
	"context"
	"path/filepath"
	"runtime/pprof"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	integrationservice "github.com/nimiplatform/nimi/runtime/internal/services/integration"
)

// Real App admission/renewal and Integration lifecycle. Native
// peer identity is the repository fixture; no remote provider or business write.
func TestIntegrationProviderCompletionAfterSessionRenewal(t *testing.T) {
	for _, effect := range []string{"read", "write"} {
		t.Run(effect, func(t *testing.T) { testProviderCompletionAfterSessionRenewal(t, effect) })
	}
}

func testProviderCompletionAfterSessionRenewal(t *testing.T, effect string) {
	f := newLocalAppSessionFixture(t, []string{"integration.consume", "integration.provide"})
	f, _, _ = bindRunAccessFixture(t, f)
	var cancel context.CancelFunc
	f.context, cancel = context.WithCancel(f.context)
	defer cancel()
	f.service.now = time.Now
	f.service.localAppSessionTTL = 2 * time.Second
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	audit, err := auditlog.Open(backend, nil, 128, 128)
	if err != nil {
		t.Fatal(err)
	}
	account := accountservice.New(nil, accountservice.WithAuditStore(audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "audit-access", RefreshToken: "audit-refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
	WithRuntimeAccountProjectionProvider(account)(f.service)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	s, err := integrationservice.New(integrationservice.Options{Backend: backend, Audit: audit, Revalidator: f.service})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	authorize := func(i localappop.Ingress) context.Context {
		c, e := f.service.AuthorizeLocalAppIngress(f.context, i)
		if e != nil {
			t.Fatal(e)
		}
		return c
	}
	regCtx := authorize(localappop.IngressIntegrationProviderRegister)
	before, _ := accountservice.AuthorizedLocalAppDecisionFromContext(regCtx)
	registered, err := s.RegisterIntegrationProvider(regCtx, &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "life-audit", DisplayName: "Audit provider", Operations: []*runtimev1.IntegrationOperation{{Name: "document.read", Description: "Read audit fixture", InputSchemaJson: `{"type":"object"}`, OutputSchemaJson: `{"type":"object"}`, Effect: effect, RetryPolicy: "none"}}})
	if err != nil {
		t.Fatal(err)
	}
	// Local fixture grant only; calls and final publication use the real owners.
	_, err = backend.DB().Exec(`INSERT INTO runtime_integration_permission(account_id,consumer_subject,target_ref,operations_json) VALUES(?,?,?,?)`, before.AccountID, before.RegisteredAppSubject, registered.Target.TargetRef, `["document.read"]`)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Until(before.ExpiresAt.Add(-time.Second)))
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Until(before.ExpiresAt.Add(80 * time.Millisecond)))
	currentCtx := authorize(localappop.IngressIntegrationCallInvoke)
	current, _ := accountservice.AuthorizedLocalAppDecisionFromContext(currentCtx)
	if current.SessionID != before.SessionID || !time.Now().Before(current.ExpiresAt) {
		t.Fatal("renewal did not preserve a current session")
	}
	started, err := s.InvokeIntegrationCall(currentCtx, &runtimev1.InvokeIntegrationCallRequest{TargetRef: registered.Target.TargetRef, Operation: "document.read", InputJson: `{}`})
	if err != nil {
		t.Fatal(err)
	}
	polled, err := s.PollIntegrationProvider(authorize(localappop.IngressIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{})
	if err != nil || len(polled.GetCalls()) != 1 {
		t.Fatalf("dispatch: %v %v", polled, err)
	}
	completed, err := s.CompleteIntegrationProvider(authorize(localappop.IngressIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: started.Call.CallId, ResultJson: `{"fixture":"available"}`})
	if err != nil {
		t.Fatal(err)
	}
	observed, err := s.GetIntegrationCall(authorize(localappop.IngressIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: started.Call.CallId})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("old_expired=%v current_live=%v same_session=%v provider_delivered=%d accepted=%v terminal=%s reason=%s", !time.Now().Before(before.ExpiresAt), time.Now().Before(current.ExpiresAt), before.SessionID == current.SessionID, len(polled.Calls), completed.Accepted, observed.Call.Status, observed.Call.ErrorCode)
	if !completed.Accepted || observed.Call.Status != "completed" || observed.Call.ResultJson != `{"fixture":"available"}` {
		t.Fatalf("renewed provider lost completion: %v %v", completed, observed)
	}
}

func TestIntegrationProviderTickerReleasesAdmissionWatchers(t *testing.T) {
	f := newLocalAppSessionFixture(t, []string{"integration.provide"})
	f, _, _ = bindRunAccessFixture(t, f)
	var cancel context.CancelFunc
	f.context, cancel = context.WithCancel(f.context)
	defer cancel()
	f.service.now = time.Now
	f.service.localAppSessionTTL = time.Minute
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	audit, err := auditlog.Open(backend, nil, 128, 128)
	if err != nil {
		t.Fatal(err)
	}
	s, err := integrationservice.New(integrationservice.Options{Backend: backend, Audit: audit, Revalidator: f.service})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	regCtx, err := f.service.AuthorizeLocalAppIngress(f.context, localappop.IngressIntegrationProviderRegister)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.RegisterIntegrationProvider(regCtx, &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "life-watchers", DisplayName: "Audit", Operations: []*runtimev1.IntegrationOperation{{Name: "read", Description: "Audit", InputSchemaJson: `{"type":"object"}`, OutputSchemaJson: `{"type":"object"}`, Effect: "read", RetryPolicy: "none"}}})
	if err != nil {
		t.Fatal(err)
	}
	watchers := func() int {
		var b bytes.Buffer
		if err := pprof.Lookup("goroutine").WriteTo(&b, 2); err != nil {
			t.Fatal(err)
		}
		return strings.Count(b.String(), "bindLocalAppSessionInvalidation.func1()")
	}
	time.Sleep(50 * time.Millisecond)
	before := watchers()
	time.Sleep(3100 * time.Millisecond)
	after := watchers()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	released := watchers()
	t.Logf("watchers_before=%d after_three_provider_ticks=%d after_close=%d", before, after, released)
	if after > before+1 || released > before {
		t.Fatalf("short checks retained admission watchers: before=%d after=%d released=%d", before, after, released)
	}
}
