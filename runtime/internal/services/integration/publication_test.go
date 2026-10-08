package integration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// This seeds an already admitted invocation at the actual final-publication
// boundary. It tests commit ordering, not external-platform acceptance.
func publicationCall(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision) *invocation {
	t.Helper()
	target := saveTelegramTestTarget(t, s)
	op := operation(target, "telegram.updates.read")
	grantTestTarget(t, s, d, target.Public.TargetRef, op.Name)
	ctx, cancel := context.WithCancel(testContext(d, localappop.OperationIntegrationCallInvoke))
	now := timestamppb.Now()
	c := &invocation{decision: d, ctx: ctx, cancel: cancel, target: target, op: op,
		fact: &runtimev1.IntegrationCall{CallId: "ic_publication_" + d.RegisteredAppSubject, TargetRef: target.Public.TargetRef, Operation: op.Name, Status: "accepted", CreatedAt: now, UpdatedAt: now}, done: make(chan struct{})}
	s.mu.Lock()
	s.calls[c.fact.CallId] = c
	s.mu.Unlock()
	if err := s.saveFact(ctx, d, c.fact, nil); err != nil {
		t.Fatal(err)
	}
	return c
}

type generationTestCustody struct {
	material accountservice.AccountMaterial
}

func (c *generationTestCustody) Load(context.Context, string) (accountservice.AccountMaterial, error) {
	return c.material, nil
}
func (c *generationTestCustody) Store(_ context.Context, _ string, m accountservice.AccountMaterial) error {
	c.material = m
	return nil
}
func (c *generationTestCustody) Clear(context.Context, string) error {
	c.material = accountservice.AccountMaterial{}
	return nil
}

type generationTestRevalidator struct {
	Revalidator
	account          *accountservice.Service
	entered, release chan struct{}
}

func (r generationTestRevalidator) CommitLocalAppIngress(ctx context.Context, i localappop.Ingress, commit func(context.Context) error) error {
	authorized, err := r.AuthorizeLocalAppIngress(ctx, i)
	if err != nil {
		return err
	}
	d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
	accepted, err := r.account.CommitAuthenticatedRuntimeGeneration(ctx, d.AccountID, d.RealmEnvironmentID, d.AccountGeneration, func() error {
		if r.entered != nil {
			close(r.entered)
			<-r.release
		}
		return commit(authorized)
	})
	if !accepted && err == nil {
		return context.Canceled
	}
	return err
}

// The actual Integration terminal transaction and Account logout audit share
// one runtimepersistence backend. This tests their common commit mechanism;
// the real App technical-session seam has its separate owner test.
func TestExternalReadSharedWriterOrdersAccountLogoutAndTerminalCommit(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	account := accountservice.New(nil, accountservice.WithAuditStore(s.audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&generationTestCustody{material: accountservice.AccountMaterial{AccountID: "test-account", RealmEnvironmentID: "realm", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
	projection, generation, invalidated, ok := account.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("actual Account not authenticated")
	}
	d := testDecision("consumer", 1)
	d.AccountID, d.RealmEnvironmentID, d.AccountGeneration, d.SessionInvalidated = projection.AccountId, projection.RealmEnvironmentId, generation, invalidated
	c := publicationCall(t, s, d)
	entered, release := make(chan struct{}), make(chan struct{})
	s.revalidator = generationTestRevalidator{Revalidator: s.revalidator, account: account, entered: entered, release: release}
	finished, loggedOut := make(chan bool, 1), make(chan error, 1)
	go func() { finished <- s.finishExternal(c, "completed", `{"private":"result"}`, "") }()
	<-entered
	go func() {
		response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop", DeviceId: "device", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
		if err == nil && !response.GetAccepted() {
			err = context.Canceled
		}
		loggedOut <- err
	}()
	select {
	case <-loggedOut:
		t.Fatal("logout overtook actual publication fence")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case accepted := <-finished:
		if !accepted {
			t.Fatal("terminal SQL commit failed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Integration terminal SQL deadlocked with Account audit")
	}
	select {
	case err := <-loggedOut:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Account audit did not drain")
	}
	var state string
	if err := s.backend.DB().QueryRow(`SELECT status FROM runtime_integration_call WHERE call_id=?`, c.fact.CallId).Scan(&state); err != nil || state != "completed" {
		t.Fatal("actual terminal fact not committed", state, err)
	}
	if c.fact.Status != "completed" || c.fact.ResultJson == "" {
		t.Fatal("preceding read publication was rewritten", c.fact)
	}
}

func TestPublishedMediaRecordFailureRetainsOwnedAssetUncertainty(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	a := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
	close(a.release)
	s.assets = a
	c := publicationCall(t, s, testDecision("consumer", 1))
	c.op = testOperation("read")
	grantTestTarget(t, s, c.decision, c.target.Public.TargetRef, c.op.Name)
	failing := &integrationFailingBackend{Backend: s.backend}
	s.backend = failing
	failing.fail.Store(true)
	body := []byte("actually published attachment")
	sum := sha256.Sum256(body)
	result, err := s.adoptInboundMedia(c, "received/uncertain.bin", appstorage.VerifiedAssetInput{MediaType: "application/octet-stream", SizeBytes: int64(len(body)), SHA256: "sha256:" + hex.EncodeToString(sum[:]), Body: io.NopCloser(bytes.NewReader(body))}, "transport-and-local-digest")
	if err == nil || c.fact.Status != "unconfirmed" || c.fact.ResultJson != result || result == "" {
		t.Fatal("published effect lost", c.fact, result, err)
	}
	if s.finish(c, "canceled", "", "INTEGRATION_SCOPE_ENDED") {
		t.Fatal("record failure was rewritten as asset-free cancellation")
	}
	owner := appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}
	asset, err := store.Open(context.Background(), owner, "received/uncertain.bin")
	if err != nil {
		t.Fatal("actual published asset disappeared", err)
	}
	_ = asset.Body.Close()
	observed, err := s.GetIntegrationCall(testContext(c.decision, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: c.fact.CallId})
	if err != nil || observed.GetCall().GetStatus() != "unconfirmed" || observed.GetCall().GetResultJson() != result {
		t.Fatal("owned asset attribution unavailable", observed, err)
	}
}

func TestFinalPublicationRejectsActualLogoutWhileTechnicalWatcherLags(t *testing.T) {
	for _, path := range []string{"read", "media", "setup"} {
		t.Run(path, func(t *testing.T) {
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if strings.HasSuffix(req.URL.Path, "/getMe") {
					return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"id": 77, "username": "setup_bot"}}), nil
				}
				return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"url": ""}}), nil
			}))
			account := accountservice.New(nil, accountservice.WithAuditStore(s.audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&generationTestCustody{material: accountservice.AccountMaterial{AccountID: "test-account", RealmEnvironmentID: "realm", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
			projection, generation, _, ok := account.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("actual Account not authenticated")
			}
			// Deliberately leave the technical-session signal live. The actual
			// Account owner must reject publication without waiting for its watcher.
			d := testDecision("consumer", 1)
			d.AccountID, d.RealmEnvironmentID, d.AccountGeneration = projection.AccountId, projection.RealmEnvironmentId, generation
			releaseFence := make(chan struct{})
			close(releaseFence)
			s.revalidator = generationTestRevalidator{Revalidator: s.revalidator, account: account, entered: make(chan struct{}), release: releaseFence}
			logout := func() {
				response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop", DeviceId: "device", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
				if err != nil || !response.GetAccepted() {
					t.Fatal("actual logout", response, err)
				}
			}
			if path == "read" {
				call := publicationCall(t, s, d)
				logout()
				s.finishExternal(call, "completed", `{"private":"late"}`, "")
				if call.fact.Status != "canceled" || call.fact.ResultJson != "" {
					t.Fatal("late external read", call.fact)
				}
				return
			}
			if path == "media" {
				call := publicationCall(t, s, d)
				call.op = testOperation("read")
				grantTestTarget(t, s, d, call.target.Public.TargetRef, call.op.Name)
				store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
				if err != nil {
					t.Fatal(err)
				}
				assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
				s.assets = assets
				body := []byte("prepared before Account logout")
				sum := sha256.Sum256(body)
				done := make(chan error, 1)
				go func() {
					_, err := s.adoptInboundMedia(call, "received/late.bin", appstorage.VerifiedAssetInput{MediaType: "application/octet-stream", SizeBytes: int64(len(body)), SHA256: "sha256:" + hex.EncodeToString(sum[:]), Body: io.NopCloser(bytes.NewReader(body))}, "transport-and-local-digest")
					done <- err
				}()
				<-assets.prepared
				logout()
				close(assets.release)
				if err := <-done; err == nil {
					t.Fatal("late asset published")
				}
				page, err := store.List(context.Background(), appstorage.ManagedOwner{AccountID: d.AccountID, RegisteredAppSubject: d.RegisteredAppSubject}, "", "", 100)
				if err != nil || len(page.Assets) != 0 {
					t.Fatal("late candidate became listable", page, err)
				}
				return
			}
			prepared, release := make(chan struct{}), make(chan struct{})
			adapter := s.adapters["telegram"]
			configure := adapter.configure
			adapter.configure = func(ctx context.Context, accountID, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
				target, err := configure(ctx, accountID, id, req, secret)
				close(prepared)
				<-release
				return target, err
			}
			s.adapters["telegram"] = adapter
			managementContext := func(op localappop.Operation) context.Context {
				ctx := desktopIntegrationContext(t, op)
				owner, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
				owner.RealmEnvironmentID, owner.AccountGeneration = d.RealmEnvironmentID, d.AccountGeneration
				return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, owner)
			}
			started, err := s.StartIntegrationConnectionSetup(managementContext(localappop.OperationIntegrationConnectionSetupStart), setupRequest())
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.SubmitIntegrationConnectionSetup(managementContext(localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, Secret: "write-only"})
			if err != nil {
				t.Fatal(err)
			}
			<-prepared
			logout()
			close(release)
			done := make(chan struct{})
			go func() { s.workers.Wait(); close(done) }()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("setup did not end")
			}
			var count int
			if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_target`).Scan(&count); err != nil || count != 0 {
				t.Fatal("late setup connection", count, err)
			}
			secrets := s.secrets.(*testSecrets)
			secrets.mu.Lock()
			defer secrets.mu.Unlock()
			if len(secrets.values) != 0 {
				t.Fatal("late setup installed credentials")
			}
		})
	}
}

func stopPublication(t *testing.T, s *Service, c *invocation, stop string, invalidated chan struct{}) {
	t.Helper()
	switch stop {
	case "revoke":
		_, err := s.SetIntegrationPermission(desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet), &runtimev1.SetIntegrationPermissionRequest{
			ConsumerRef: ref("icons_", c.decision.AccountID, c.decision.RegisteredAppSubject), TargetRef: c.target.Public.TargetRef})
		if err != nil {
			t.Fatal(err)
		}
	case "cancel":
		_, err := s.CancelIntegrationCall(testContext(c.decision, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: c.fact.CallId})
		if err != nil {
			t.Fatal(err)
		}
	case "invalidate":
		close(invalidated)
	}
}

func TestExternalReadFinalPublicationOrdersStops(t *testing.T) {
	for _, stop := range []string{"revoke", "cancel", "invalidate"} {
		for _, completionFirst := range []bool{false, true} {
			t.Run(stop+map[bool]string{false: "/stop-first", true: "/completion-first"}[completionFirst], func(t *testing.T) {
				s := newIntegrationTestService(t, nil)
				invalidated := make(chan struct{})
				d := testDecision("consumer", 1)
				d.SessionInvalidated = invalidated
				c := publicationCall(t, s, d)
				// Represents the actual adapter result already returned before
				// finishExternal acquires its final publication guard.
				result := `{"cursor":"opaque","updates":[{"text":"private-body","mediaRef":"private-media"}]}`
				if completionFirst {
					s.finishExternal(c, "completed", result, "")
				}
				stopPublication(t, s, c, stop, invalidated)
				if !completionFirst {
					s.finishExternal(c, "completed", result, "")
				}
				s.mu.Lock()
				fact := cloneCall(c.fact, true)
				s.mu.Unlock()
				if completionFirst {
					if fact.Status != "completed" || fact.ResultJson != result {
						t.Fatalf("completed fact lost: %v", fact)
					}
				} else if fact.Status != "canceled" || fact.ResultJson != "" {
					t.Fatalf("late read escaped: %v", fact)
				}
				if stop != "invalidate" {
					read, err := s.GetIntegrationCall(testContext(d, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: fact.CallId})
					if err != nil || read.GetCall().GetResultJson() != fact.ResultJson {
						t.Fatalf("call.get leaked/replaced result: %v %v", read, err)
					}
				}
			})
		}
	}
}

type publicationAssets struct {
	store    *appstorage.AssetStore
	prepared chan struct{}
	release  chan struct{}
	once     sync.Once
}

func (a *publicationAssets) OpenOwnedIntegrationAsset(ctx context.Context, owner appstorage.ManagedOwner, path string) (*appstorage.AssetSource, error) {
	return a.store.Open(ctx, owner, path)
}

func (a *publicationAssets) AdoptOwnedIntegrationMedia(ctx context.Context, owner appstorage.ManagedOwner, path string, input appstorage.VerifiedAssetInput, guard appstorage.AssetCommitGuard) (appstorage.AssetRecord, error) {
	return a.store.AdoptGuarded(ctx, owner, path, input, func(candidate appstorage.AssetRecord, publish func() error) error {
		a.once.Do(func() { close(a.prepared) })
		<-a.release
		return guard(candidate, publish)
	})
}

func TestMediaCandidateFinalCommitOrdersStops(t *testing.T) {
	for _, stop := range []string{"revoke", "cancel", "invalidate"} {
		for _, publicationFirst := range []bool{false, true} {
			t.Run(stop+map[bool]string{false: "/stop-first", true: "/publication-first"}[publicationFirst], func(t *testing.T) {
				s := newIntegrationTestService(t, nil)
				store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
				if err != nil {
					t.Fatal(err)
				}
				a := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
				s.assets = a
				invalidated := make(chan struct{})
				d := testDecision("consumer", 1)
				d.SessionInvalidated = invalidated
				c := publicationCall(t, s, d)
				c.op = testOperation("read")
				grantTestTarget(t, s, d, c.target.Public.TargetRef, c.op.Name)
				body := []byte("verified native message attachment")
				sum := sha256.Sum256(body)
				input := appstorage.VerifiedAssetInput{MediaType: "application/octet-stream", SizeBytes: int64(len(body)), SHA256: "sha256:" + hex.EncodeToString(sum[:]), Body: io.NopCloser(bytes.NewReader(body))}
				done := make(chan error, 1)
				go func() {
					_, err := s.adoptInboundMedia(c, "received/item.bin", input, "transport-and-local-digest")
					done <- err
				}()
				<-a.prepared // EOF, candidate sync and metadata are complete.
				if publicationFirst {
					close(a.release)
					if err := <-done; err != nil {
						t.Fatal(err)
					}
				}
				stopPublication(t, s, c, stop, invalidated)
				if !publicationFirst {
					close(a.release)
					if err := <-done; err == nil {
						t.Fatal("stopped candidate committed")
					}
				}
				owner := appstorage.ManagedOwner{AccountID: d.AccountID, RegisteredAppSubject: d.RegisteredAppSubject}
				page, err := store.List(context.Background(), owner, "", "", 100)
				if err != nil {
					t.Fatal(err)
				}
				if publicationFirst {
					if len(page.Assets) != 1 || c.fact.Status != "completed" || c.fact.ResultJson == "" {
						t.Fatalf("legal publication lost: %v %v", page, c.fact)
					}
				} else {
					if len(page.Assets) != 0 {
						t.Fatalf("stopped candidate is listable: %v", page)
					}
					if _, err := store.Open(context.Background(), owner, "received/item.bin"); err == nil {
						t.Fatal("stopped candidate is readable")
					}
					bytes, objects, err := store.Usage(context.Background(), owner)
					if err != nil || bytes != 0 || objects != 0 {
						t.Fatalf("unpublished quota charged: %d %d %v", bytes, objects, err)
					}
				}
			})
		}
	}
}
