package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// Protocol fixtures exercise actual QQ/Feishu configure, recorded persistence,
// setup projection and deletion. They are not live-platform acceptance.
func nativeIdentityFixture(t *testing.T, adapter string) (*Service, *runtimev1.PutIntegrationConnectionRequest) {
	t.Helper()
	config := &runtimev1.IntegrationConnectionConfig{QqOfficial: &runtimev1.IntegrationQQOfficialConfig{AppId: "123456"}}
	if adapter == "feishu" {
		config = &runtimev1.IntegrationConnectionConfig{Feishu: &runtimev1.IntegrationFeishuConfig{AppId: "cli_native_identity", SetupMode: "manual"}}
	}
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		switch {
		case adapter == "qq-official" && req.URL.String() == qqTokenURL:
			var body map[string]string
			if json.NewDecoder(req.Body).Decode(&body) != nil || body["appId"] != config.QqOfficial.AppId || body["clientSecret"] == "" {
				return nil, fmt.Errorf("invalid QQ credential request")
			}
			return jsonResponse(map[string]any{"access_token": "fixture-token", "expires_in": "7200"}), nil
		case adapter == "qq-official" && req.URL.String() == qqAPIBase+"/gateway":
			return jsonResponse(map[string]any{"url": "wss://gateway.qq.com"}), nil
		case adapter == "feishu" && strings.HasSuffix(req.URL.Path, "/tenant_access_token/internal"):
			return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "fixture-token", "expire": 7200}), nil
		case adapter == "feishu" && req.URL.Path == "/open-apis/bot/v3/info":
			return jsonResponse(map[string]any{"code": 0, "bot": map[string]string{"open_id": "ou_verified_identity", "app_name": "Verified native bot"}}), nil
		default:
			return nil, fmt.Errorf("unexpected native identity request")
		}
	}))
	return s, &runtimev1.PutIntegrationConnectionRequest{Adapter: adapter, DisplayName: "PRIVATE_EXISTING_DISPLAY", Config: config, Secret: "PRIVATE_EXISTING_SECRET"}
}

func nativeIdentityHome(t *testing.T, account string, op localappop.Operation) context.Context {
	t.Helper()
	ctx := desktopIntegrationContext(t, op)
	d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	d.AccountID = account
	return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d)
}

func requireNativeIdentityCounts(t *testing.T, s *Service, targets, credentials int) {
	t.Helper()
	var count int
	if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_target`).Scan(&count); err != nil || count != targets {
		t.Fatalf("target count=%d want=%d: %v", count, targets, err)
	}
	secrets := s.secrets.(*testSecrets)
	secrets.mu.Lock()
	defer secrets.mu.Unlock()
	if len(secrets.values) != credentials {
		t.Fatalf("credential count=%d want=%d", len(secrets.values), credentials)
	}
}

func TestNativeIdentitySameAndCrossAccountSetupKeepsSafeConflict(t *testing.T) {
	for _, adapter := range []string{"qq-official", "feishu"} {
		t.Run(adapter, func(t *testing.T) {
			s, req := nativeIdentityFixture(t, adapter)
			owner := "PRIVATE_OWNER_ACCOUNT"
			created, err := s.PutIntegrationConnection(nativeIdentityHome(t, owner, localappop.OperationIntegrationConnectionPut), req)
			if err != nil {
				t.Fatal(err)
			}
			for _, account := range []string{owner, "different-account"} {
				ctx := nativeIdentityHome(t, account, localappop.OperationIntegrationConnectionSetupStart)
				started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: adapter, DisplayName: "Different local display", Config: proto.Clone(req.Config).(*runtimev1.IntegrationConnectionConfig)})
				if err != nil {
					t.Fatal(err)
				}
				_, err = s.SubmitIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, Secret: "different-credential-same-bot"})
				if err != nil {
					t.Fatal(err)
				}
				waitSetupStatus(t, s, ctx, started.Setup.SetupId, "failed")
				view, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
				if err != nil || view.Setup.ErrorCode != "INTEGRATION_IDENTITY_ALREADY_CONNECTED" || view.Setup.TargetRef != "" || view.Setup.AccountLabel != "" {
					t.Fatal("lost or unsafe native conflict", view, err)
				}
				encoded, _ := json.Marshal(view.Setup)
				for _, private := range []string{owner, req.DisplayName, req.Secret, created.Connection.TargetRef} {
					if strings.Contains(string(encoded), private) {
						t.Fatal("duplicate revealed existing owner")
					}
				}
				requireNativeIdentityCounts(t, s, 1, 1)
			}
			foreign := proto.Clone(req).(*runtimev1.PutIntegrationConnectionRequest)
			foreign.TargetRef = created.Connection.TargetRef
			if _, err := s.PutIntegrationConnection(nativeIdentityHome(t, "different-account", localappop.OperationIntegrationConnectionPut), foreign); status.Code(err) != codes.NotFound {
				t.Fatal("foreign refresh found owner", err)
			}
			var grants int
			if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_permission`).Scan(&grants); err != nil || grants != 0 {
				t.Fatal("duplicate created permissions", grants, err)
			}
		})
	}
}

func TestNativeIdentityConcurrentActualConfigurationAdmitsOneOwner(t *testing.T) {
	for _, adapter := range []string{"qq-official", "feishu"} {
		for _, cross := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/cross=%t", adapter, cross), func(t *testing.T) {
				s, req := nativeIdentityFixture(t, adapter)
				start := make(chan struct{})
				results := make(chan error, 2)
				var wg sync.WaitGroup
				for i := 0; i < 2; i++ {
					account := "one-account"
					if cross {
						account = fmt.Sprintf("account-%d", i)
					}
					ctx := nativeIdentityHome(t, account, localappop.OperationIntegrationConnectionPut)
					candidate := proto.Clone(req).(*runtimev1.PutIntegrationConnectionRequest)
					candidate.Secret = fmt.Sprintf("credential-%d", i)
					wg.Add(1)
					go func() { defer wg.Done(); <-start; _, err := s.PutIntegrationConnection(ctx, candidate); results <- err }()
				}
				close(start)
				wg.Wait()
				close(results)
				accepted, conflicts := 0, 0
				for err := range results {
					if err == nil {
						accepted++
					} else if status.Code(err) == codes.AlreadyExists && publicSetupError(err) == "INTEGRATION_IDENTITY_ALREADY_CONNECTED" {
						conflicts++
					} else {
						t.Fatal(err)
					}
				}
				if accepted != 1 || conflicts != 1 {
					t.Fatal("multiple native owners", accepted, conflicts)
				}
				requireNativeIdentityCounts(t, s, 1, 1)
			})
		}
	}
}

func TestNativeIdentityRemoveReservesThroughDrainThenReleases(t *testing.T) {
	for _, adapter := range []string{"qq-official", "feishu"} {
		t.Run(adapter, func(t *testing.T) {
			s, req := nativeIdentityFixture(t, adapter)
			ctx := nativeIdentityHome(t, "source-owner", localappop.OperationIntegrationConnectionPut)
			created, err := s.PutIntegrationConnection(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			id := created.Connection.TargetRef
			stored, err := s.loadTarget(context.Background(), "source-owner", id)
			if err != nil {
				t.Fatal(err)
			}
			consumer := testDecision("native-owner-consumer", 1)
			consumer.AccountID = "source-owner"
			grantTestTarget(t, s, consumer, id, adapter+".updates.read")
			run, cancel := context.WithCancel(s.ctx)
			done := make(chan struct{})
			s.mu.Lock()
			s.nativeReceivers[id] = &nativeReceiver{ctx: run, cancel: cancel, done: done, generation: stored.CredentialGeneration, feed: newNativeFeed()}
			s.mu.Unlock()
			t.Cleanup(func() {
				cancel()
				if !closed(done) {
					close(done)
				}
			})
			// A timed-out drain must not release a durable identity.
			short, stop := context.WithTimeout(setupTestContext(ctx, localappop.OperationIntegrationConnectionRemove), 30*time.Millisecond)
			_, err = s.RemoveIntegrationConnection(short, &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: id})
			stop()
			if err == nil {
				t.Fatal("unfinished receiver removed")
			}
			requireNativeIdentityCounts(t, s, 1, 1)
			other := nativeIdentityHome(t, "next-owner", localappop.OperationIntegrationConnectionPut)
			if _, err := s.PutIntegrationConnection(other, req); status.Code(err) != codes.AlreadyExists {
				t.Fatal("identity released during failed drain", err)
			}
			removed := make(chan error, 1)
			go func() {
				_, err := s.RemoveIntegrationConnection(setupTestContext(ctx, localappop.OperationIntegrationConnectionRemove), &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: id})
				removed <- err
			}()
			if _, err := s.PutIntegrationConnection(other, req); status.Code(err) != codes.AlreadyExists {
				t.Fatal("identity released before drain", err)
			}
			close(done)
			if err := <-removed; err != nil {
				t.Fatal(err)
			}
			requireNativeIdentityCounts(t, s, 0, 0)
			if s.permitted(context.Background(), "source-owner", consumer.RegisteredAppSubject, id, adapter+".updates.read") {
				t.Fatal("removed permission survived")
			}
			newConnection, err := s.PutIntegrationConnection(other, req)
			if err != nil || newConnection.Connection.TargetRef == id {
				t.Fatal("same source did not release", newConnection, err)
			}
			requireNativeIdentityCounts(t, s, 1, 1)
			var grants int
			if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_permission`).Scan(&grants); err != nil || grants != 0 {
				t.Fatal("new owner inherited permission", grants, err)
			}
		})
	}
}

func TestNativeIdentityFailedRemovalCommitRetainsOwnership(t *testing.T) {
	for _, adapter := range []string{"qq-official", "feishu"} {
		t.Run(adapter, func(t *testing.T) {
			s, req := nativeIdentityFixture(t, adapter)
			ctx := nativeIdentityHome(t, "source-owner", localappop.OperationIntegrationConnectionPut)
			created, err := s.PutIntegrationConnection(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			remove := &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: created.Connection.TargetRef}
			unblock := blockIntegrationAudit(t, s)
			_, err = s.RemoveIntegrationConnection(setupTestContext(ctx, localappop.OperationIntegrationConnectionRemove), remove)
			unblock()
			if err == nil {
				t.Fatal("unrecorded removal committed")
			}
			requireNativeIdentityCounts(t, s, 1, 1)
			other := nativeIdentityHome(t, "next-owner", localappop.OperationIntegrationConnectionPut)
			if _, err := s.PutIntegrationConnection(other, req); status.Code(err) != codes.AlreadyExists {
				t.Fatal("failed removal released identity", err)
			}
			if _, err := s.RemoveIntegrationConnection(setupTestContext(ctx, localappop.OperationIntegrationConnectionRemove), remove); err != nil {
				t.Fatal(err)
			}
			if _, err := s.PutIntegrationConnection(other, req); err != nil {
				t.Fatal("committed removal retained identity", err)
			}
		})
	}
}
