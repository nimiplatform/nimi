package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	integrationservice "github.com/nimiplatform/nimi/runtime/internal/services/integration"
)

type publicationTransport func(*http.Request) (*http.Response, error)

func (f publicationTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type publicationSecrets struct{}

func (publicationSecrets) ReadSecret(string) (string, bool, error) {
	return "fixture-secret", true, nil
}
func (publicationSecrets) WriteSecret(string, string) error { return nil }
func (publicationSecrets) DeleteSecret(string) error        { return nil }

// Tests actual App admission/renewal, Integration dispatch and terminal SQLite
// facts. Only the remote HTTP exchange is a deterministic transport fixture;
// this is NOT an external Feishu or Desktop product acceptance claim.
func TestIntegrationNativePhaseSurvivesConsumerRenewal(t *testing.T) {
	f := newLocalAppSessionFixture(t, []string{"integration.consume"})
	f, _, _ = bindRunAccessFixture(t, f)
	f.service.now = time.Now
	f.service.localAppSessionTTL = 2 * time.Second
	ctx, cancel := context.WithCancel(f.context)
	defer cancel()
	f.context = ctx
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	audit, err := auditlog.Open(backend, nil, 128, 128)
	if err != nil {
		t.Fatal(err)
	}
	account := accountservice.New(nil, accountservice.WithAuditStore(audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
	WithRuntimeAccountProjectionProvider(account)(f.service)
	if _, err = f.service.OpenLocalAppSessionProjection(ctx); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	releaseToken := func() { releaseOnce.Do(func() { close(release) }) }
	var businessRequests atomic.Int32
	transport := publicationTransport(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Path, "tenant_access_token") {
			close(entered)
			<-release
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"code":0,"tenant_access_token":"fixture-token","expire":7200}`))}, nil
		}
		businessRequests.Add(1)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"message_id":"fixture-message"}}`))}, nil
	})
	s, err := integrationservice.New(integrationservice.Options{Backend: backend, Audit: audit, Revalidator: f.service, Secrets: publicationSecrets{}, HTTPClient: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { releaseToken(); s.Close() }()
	authorized, err := f.service.AuthorizeLocalAppIngress(ctx, localappop.IngressIntegrationCallInvoke)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
	target := map[string]any{"account": before.AccountID, "subject": "fixture-feishu", "identity": "feishu:fixture-app", "public": &runtimev1.IntegrationTarget{TargetRef: "publication-feishu", IntegrationId: "feishu", DisplayName: "Fixture", Kind: "feishu", Available: true}, "config": &runtimev1.IntegrationConnectionConfig{Feishu: &runtimev1.IntegrationFeishuConfig{AppId: "fixture-app"}}}
	raw, err := json.Marshal(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = backend.DB().Exec(`INSERT INTO runtime_integration_target(account_id,target_ref,config_json) VALUES(?,?,?)`, before.AccountID, "publication-feishu", string(raw)); err != nil {
		t.Fatal(err)
	}
	if _, err = backend.DB().Exec(`INSERT INTO runtime_integration_permission(account_id,consumer_subject,target_ref,operations_json) VALUES(?,?,?,?)`, before.AccountID, before.RegisteredAppSubject, "publication-feishu", `["feishu.messages.send"]`); err != nil {
		t.Fatal(err)
	}
	started, err := s.InvokeIntegrationCall(authorized, &runtimev1.InvokeIntegrationCallRequest{TargetRef: "publication-feishu", Operation: "feishu.messages.send", InputJson: `{"conversation":{"kind":"user","id":"fixture-recipient"},"body":{"kind":"text","text":"fixture"}}`})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("token phase not reached")
	}
	time.Sleep(time.Until(before.ExpiresAt.Add(-time.Second)))
	if _, err = f.service.RenewLocalAppSessionProjection(ctx); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Until(before.ExpiresAt.Add(60 * time.Millisecond)))
	currentCtx, err := f.service.AuthorizeLocalAppIngress(ctx, localappop.IngressIntegrationCallGet)
	if err != nil {
		t.Fatal(err)
	}
	current, _ := accountservice.AuthorizedLocalAppDecisionFromContext(currentCtx)
	releaseToken()
	var observed *runtimev1.IntegrationCall
	for deadline := time.Now().Add(500 * time.Millisecond); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		response, err := s.GetIntegrationCall(currentCtx, &runtimev1.GetIntegrationCallRequest{CallId: started.Call.CallId})
		if err != nil {
			t.Fatal(err)
		}
		observed = response.Call
		if observed.Status != "accepted" {
			break
		}
	}
	t.Logf("same_session=%v current_live=%v old_expired=%v state=%s reason=%s business_requests=%d", before.SessionID == current.SessionID, time.Now().Before(current.ExpiresAt), !time.Now().Before(before.ExpiresAt), observed.Status, observed.ErrorCode, businessRequests.Load())
	// The real current owner admits the phase after normal renewal.
	if before.SessionID != current.SessionID || !time.Now().Before(current.ExpiresAt) || observed.Status != "completed" || observed.ErrorCode != "" || businessRequests.Load() != 1 {
		t.Fatalf("renewed consumer lost native phase: %v", observed)
	}
}

type publicationAccountCommitter struct {
	*accountservice.Service
	before func()
}

func (a *publicationAccountCommitter) CommitAuthenticatedRuntimeGeneration(ctx context.Context, accountID, realm string, generation uint64, commit func() error) (bool, error) {
	if a.before != nil {
		before := a.before
		a.before = nil
		before()
	}
	return a.Service.CommitAuthenticatedRuntimeGeneration(ctx, accountID, realm, generation, commit)
}

// Both App sessions share one real App service, registration kernel, Account
// owner and Integration service. Only native peer identity is a fixture.
func TestIntegrationProviderCompletionFencesProviderRemoval(t *testing.T) {
	for _, effect := range []string{"read", "write"} {
		for _, order := range []string{"withdraw-first", "commit-first"} {
			t.Run(effect+"/"+order, func(t *testing.T) { testIntegrationProviderRemovalOrder(t, effect, order) })
		}
	}
}
func testIntegrationProviderRemovalOrder(t *testing.T, effect, order string) {
	f := newLocalAppSessionFixture(t, []string{"integration.consume", "integration.provide"})
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	dbpath, err := localappkernel.CanonicalRegistrationDatabasePath(dir)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), dbpath, identity, localappkernel.Options{HostInstallID: "publication-host", DataRoot: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer kernel.Close()
	f.kernel = kernel
	f.service.localAppKernel = kernel
	input := f.registrationInput
	input.ExistingRegistrationHandle = ""
	f.registration, err = kernel.Registrations().RegisterDevelopment(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	f.registrationHandle, _ = localDevelopmentRegistrationIdentifier(f.registration.RegistrationHandle)
	f.registrationInput = input
	f.registrationInput.ExistingRegistrationHandle = f.registration.RegistrationHandle
	ticket := f.store.launches[f.connection.LaunchID()]
	ticket.RegistrationHandle = f.registrationHandle
	f.store.launches[ticket.LaunchID] = ticket
	f, _, _ = bindRunAccessFixture(t, f)
	consumerInput := input
	consumerInput.AppID = "nimi.test.publication.consumer"
	consumerInput.SourceRef = "publication-consumer"
	consumerInput.RawDeclaration = []string{"integration.consume", "integration.provide"}
	consumerReg, err := kernel.Registrations().RegisterDevelopment(context.Background(), consumerInput)
	if err != nil {
		t.Fatal(err)
	}
	consumerHandle, _ := localDevelopmentRegistrationIdentifier(consumerReg.RegistrationHandle)
	process := f.process
	process.PID++
	process.CreationMarker = "publication-consumer"
	launchID := localAppSessionTestIdentifier(0x51)
	conn, err := protectedlocal.EstablishLocalAppConnection(context.Background(), localAppSessionTestVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{LaunchID: launchID, Process: process, RuntimeBootEpoch: localAppSessionTestIdentifier(0x43), ProcessLiveness: &localAppSessionTestLiveness{revoked: make(chan struct{})}, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Revoke()
	consumerCtx, consumerCancel := context.WithCancel(protectedlocal.ContextWithLocalAppConnection(context.Background(), conn))
	defer consumerCancel()
	consumerTicket := ticket
	consumerTicket.LaunchID = launchID
	consumerTicket.RegistrationHandle = consumerHandle
	consumerTicket.Process = process
	f.store.launches[launchID] = consumerTicket
	consumerFixture := f
	consumerFixture.connection = conn
	consumerFixture.context = consumerCtx
	consumerFixture.registrationHandle = consumerHandle
	consumerFixture.registration = consumerReg
	consumerFixture, _, _ = bindRunAccessFixture(t, consumerFixture)
	ctx, cancel := context.WithCancel(f.context)
	defer cancel()
	f.context = ctx
	f.service.now = time.Now
	f.service.localAppSessionTTL = time.Minute
	realBackend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer realBackend.Close()
	backend := realBackend
	audit, err := auditlog.Open(backend, nil, 128, 128)
	if err != nil {
		t.Fatal(err)
	}
	account := accountservice.New(nil, accountservice.WithAuditStore(audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
	commitAccount := &publicationAccountCommitter{Service: account}
	WithRuntimeAccountProjectionProvider(commitAccount)(f.service)
	for _, scope := range []context.Context{ctx, consumerCtx} {
		if _, err = f.service.OpenLocalAppSessionProjection(scope); err != nil {
			t.Fatal(err)
		}
	}
	authorize := func(scope context.Context, i localappop.Ingress) context.Context {
		current, err := f.service.AuthorizeLocalAppIngress(scope, i)
		if err != nil {
			t.Fatal(err)
		}
		return current
	}
	s, err := integrationservice.New(integrationservice.Options{Backend: backend, Audit: audit, Revalidator: f.service})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// Reciprocal roles exercise the fixed pair owner without any new lock ordering registry.
	paired := make(chan error, 2)
	for _, scopes := range [][2]context.Context{{ctx, consumerCtx}, {consumerCtx, ctx}} {
		go func(a, b context.Context) {
			paired <- f.service.CommitLocalAppProviderCompletion(a, b, func(context.Context, context.Context) error { return nil })
		}(scopes[0], scopes[1])
	}
	for range 2 {
		select {
		case err := <-paired:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("reciprocal scope commits deadlocked")
		}
	}
	providerCtx := authorize(ctx, localappop.IngressIntegrationProviderRegister)
	providerDecision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(providerCtx)
	registered, err := s.RegisterIntegrationProvider(providerCtx, &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "publication-provider", DisplayName: "Publication", Operations: []*runtimev1.IntegrationOperation{{Name: "operation", InputSchemaJson: `{"type":"object"}`, OutputSchemaJson: `{"type":"object"}`, Effect: effect, RetryPolicy: "none"}}})
	if err != nil {
		t.Fatal(err)
	}
	invocationCtx := authorize(consumerCtx, localappop.IngressIntegrationCallInvoke)
	consumerDecision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(invocationCtx)
	if _, err = backend.DB().Exec(`INSERT INTO runtime_integration_permission(account_id,consumer_subject,target_ref,operations_json) VALUES(?,?,?,?)`, consumerDecision.AccountID, consumerDecision.RegisteredAppSubject, registered.Target.TargetRef, `["operation"]`); err != nil {
		t.Fatal(err)
	}
	started, err := s.InvokeIntegrationCall(invocationCtx, &runtimev1.InvokeIntegrationCallRequest{TargetRef: registered.Target.TargetRef, Operation: "operation", InputJson: `{}`})
	if err != nil {
		t.Fatal(err)
	}
	polled, err := s.PollIntegrationProvider(authorize(ctx, localappop.IngressIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{})
	if err != nil || len(polled.GetCalls()) != 1 {
		t.Fatal("dispatch", polled, err)
	}
	completeCtx := authorize(ctx, localappop.IngressIntegrationProviderComplete)
	if order == "withdraw-first" {
		commitAccount.before = func() {
			if err := kernel.Registrations().Tombstone(context.Background(), f.registration.RegistrationHandle); err != nil {
				t.Fatal(err)
			}
			select {
			case <-providerDecision.SessionInvalidated:
				t.Fatal("requires pre-notification window")
			default:
			}
		}
	}
	completed, err := s.CompleteIntegrationProvider(completeCtx, &runtimev1.CompleteIntegrationProviderRequest{CallId: started.Call.CallId, ResultJson: `{"value":"handler-result"}`})
	if err != nil {
		t.Fatal(err)
	}
	if order == "commit-first" {
		if err := kernel.Registrations().Tombstone(context.Background(), f.registration.RegistrationHandle); err != nil {
			t.Fatal(err)
		}
	}
	observed, err := s.GetIntegrationCall(authorize(consumerCtx, localappop.IngressIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: started.Call.CallId})
	if err != nil {
		t.Fatal(err)
	}
	registration, err := kernel.Registrations().GetByHandle(context.Background(), f.registration.RegistrationHandle)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("provider_registration=%s consumer_distinct=%v accepted=%v state=%s body=%s", registration.State, providerDecision.RegisteredAppSubject != consumerDecision.RegisteredAppSubject, completed.Accepted, observed.Call.Status, observed.Call.ResultJson)
	if registration.State != localappkernel.RegistrationStateTombstoned {
		t.Fatal("provider removal did not commit")
	}
	if order == "commit-first" {
		if !completed.Accepted || observed.Call.Status != "completed" || observed.Call.ResultJson == "" {
			t.Fatal("committed fact lost", completed, observed)
		}
	} else {
		want := "canceled"
		if effect == "write" {
			want = "unconfirmed"
		}
		if completed.Accepted || observed.Call.Status != want || observed.Call.ResultJson != "" {
			t.Fatal("withdrawn provider published a new result", completed, observed)
		}
	}
}
