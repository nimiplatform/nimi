package integration

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Already-admitted call with a real saved fact, target and standing permission.
// Execute directly to deliberately exclude the asynchronous watcher from proof.
func admittedNativePhaseCall(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision, target target, op *runtimev1.IntegrationOperation) *invocation {
	t.Helper()
	grantTestTarget(t, s, d, target.Public.TargetRef, op.Name)
	ctx, cancel := context.WithCancel(testContext(d, localappop.OperationIntegrationCallInvoke))
	now := timestamppb.Now()
	c := &invocation{decision: d, ctx: ctx, cancel: cancel, target: target, op: op, fact: &runtimev1.IntegrationCall{CallId: "ic_phase", TargetRef: target.Public.TargetRef, Operation: op.Name, Status: "accepted", CreatedAt: now, UpdatedAt: now}, done: make(chan struct{})}
	c.ctx = context.WithValue(c.ctx, invocationContextKey{}, c)
	s.calls[c.fact.CallId] = c
	if err := s.saveFact(ctx, d, c.fact, nil); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestNativeLaterPhaseRejectsActualLogoutBeforeWatcherCancellation(t *testing.T) {
	testNativeLaterPhaseInvalidation(t, false)
}

func TestNativeLaterPhaseRejectsTechnicalDeadlineBeforeWatcherCancellation(t *testing.T) {
	testNativeLaterPhaseInvalidation(t, true)
}

func testNativeLaterPhaseInvalidation(t *testing.T, technicalExpiry bool) {
	for _, phase := range []string{"feishu-token", "feishu-upload", "weixin-upload-url", "weixin-cdn"} {
		t.Run(phase, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var requests atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				requests.Add(1)
				blocked := (phase == "feishu-token" && strings.Contains(req.URL.Path, "tenant_access_token")) || (phase == "feishu-upload" && strings.HasSuffix(req.URL.Path, "/files")) || (phase == "weixin-upload-url" && strings.HasSuffix(req.URL.Path, "getuploadurl")) || (phase == "weixin-cdn" && strings.HasSuffix(req.URL.Path, "/upload"))
				if blocked {
					close(entered)
					<-release
				}
				if strings.Contains(req.URL.Path, "tenant_access_token") {
					return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "private-token", "expire": 7200}), nil
				}
				if strings.HasSuffix(req.URL.Path, "/files") {
					return jsonResponse(map[string]any{"code": 0, "data": map[string]string{"file_key": "real-upload"}}), nil
				}
				if strings.HasSuffix(req.URL.Path, "getuploadurl") {
					return jsonResponse(map[string]any{"ret": 0, "upload_param": "private-upload"}), nil
				}
				if strings.HasSuffix(req.URL.Path, "/upload") {
					response := jsonResponse(map[string]string{})
					response.Header.Set("x-encrypted-param", "confirmed-upload")
					return response, nil
				}
				t.Error("later message dispatched after actual logout", req.URL.Path)
				return jsonResponse(map[string]any{"code": 0, "ret": 0, "data": map[string]string{"message_id": "unexpected"}}), nil
			}))
			adapter := "feishu"
			if strings.HasPrefix(phase, "weixin") {
				adapter = "weixin"
			}
			plain := []byte("owned media before logout")
			target := seedNativeMediaSource(t, s, adapter, plain)
			account := accountservice.New(nil, accountservice.WithAuditStore(s.audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&generationTestCustody{material: accountservice.AccountMaterial{AccountID: "test-account", RealmEnvironmentID: "realm", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
			projection, generation, _, ok := account.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("Account authentication missing")
			}
			d := testDecision("consumer", 1)
			d.AccountID, d.RealmEnvironmentID, d.AccountGeneration = projection.AccountId, projection.RealmEnvironmentId, generation
			s.revalidator = generationTestRevalidator{Revalidator: s.revalidator, account: account}
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			s.assets = &publicationAssets{store: store}
			owned, err := store.Write(context.Background(), appstorage.ManagedOwner{AccountID: d.AccountID, RegisteredAppSubject: d.RegisteredAppSubject}, "outbound/file", "application/octet-stream", false, io.NopCloser(bytes.NewReader(plain)))
			if err != nil {
				t.Fatal(err)
			}
			input := schemaJSON(map[string]any{"conversation": nativeConversation{Kind: map[string]string{"feishu": "user", "weixin": "private"}[adapter], ID: "specified"}, "contextRef": "opaque-reply", "body": map[string]any{"kind": "file", "fileName": "owned.txt", "asset": outboundAsset{RelativePath: owned.RelativePath, SHA256: owned.SHA256, MediaType: owned.MediaType, SizeBytes: owned.SizeBytes}}})
			secret, _, err := s.secrets.ReadSecret("integration:" + target.Public.TargetRef)
			if err != nil {
				t.Fatal(err)
			}
			if technicalExpiry {
				d.ExpiresAt = time.Now().Add(time.Second)
			}
			call := admittedNativePhaseCall(t, s, d, target, nativeOperations(adapter)[0])
			done := make(chan error, 1)
			go func() { _, _, err := s.execute(call.ctx, target, call.op, input, secret); done <- err }()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("prior response did not stop")
			}
			if technicalExpiry {
				time.Sleep(time.Until(d.ExpiresAt) + 10*time.Millisecond)
			} else {
				response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop", DeviceId: "device", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
				if err != nil || !response.GetAccepted() {
					t.Fatal("actual logout", response, err)
				}
			}
			if call.ctx.Err() != nil || closed(d.SessionInvalidated) {
				t.Fatal("test depends on asynchronous cancellation")
			}
			before := requests.Load()
			close(release)
			select {
			case err := <-done:
				if publicAdapterError(err) != "INTEGRATION_SCOPE_ENDED" || requests.Load() != before {
					t.Fatal("phase admission escaped logout", err, requests.Load(), before)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("late phase did not settle")
			}
		})
	}
}
