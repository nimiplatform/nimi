package integration

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// These bounded protocol fixtures drive real setup, adapter validation and
// recorded SQLite commits. They do not prove a real WeChat account login.
func weixinNameTransport(t *testing.T, botID *atomic.Value) http.RoundTripper {
	t.Helper()
	return testRoundTripper(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/ilink/bot/get_bot_qrcode":
			return jsonResponse(map[string]string{"qrcode": "private-fixture", "qrcode_img_content": "https://liteapp.weixin.qq.com/fixture"}), nil
		case "/ilink/bot/get_qrcode_status":
			return jsonResponse(map[string]string{"status": "confirmed", "bot_token": "fixture-token", "ilink_bot_id": botID.Load().(string), "baseurl": weixinAPIBase, "ilink_user_id": "different-scanning-user", "nickname": "not-a-declared-profile"}), nil
		default:
			t.Error("unexpected profile or platform request", req.URL.Path)
			return nil, fmt.Errorf("unexpected Weixin request")
		}
	})
}

func weixinNameRequest(target, name string) *runtimev1.StartIntegrationConnectionSetupRequest {
	return &runtimev1.StartIntegrationConnectionSetupRequest{TargetRef: target, Adapter: "weixin", DisplayName: name, Config: &runtimev1.IntegrationConnectionConfig{Weixin: &runtimev1.IntegrationWeixinConfig{}}}
}

func completedWeixinNameSetup(t *testing.T, s *Service, ctx context.Context, targetRef, name, want string) *runtimev1.IntegrationConnectionSetup {
	t.Helper()
	started, err := s.StartIntegrationConnectionSetup(ctx, weixinNameRequest(targetRef, name))
	if err != nil {
		t.Fatal(err)
	}
	waitSetupStatus(t, s, ctx, started.Setup.SetupId, want)
	if !activeSetupStatus(want) {
		s.workers.Wait()
	}
	response, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
	if err != nil {
		t.Fatal(err)
	}
	return response.Setup
}

func TestWeixinNamelessVerifiedSetupPersistsIdentityDisplayAndRefresh(t *testing.T) {
	for _, test := range []struct{ name, botID, explicitName, wantName string }{
		{"derived", "verified-bot@im.bot", "", "WeChat iLink · verified-bot@im.bot"},
		{"existing-remark", "verified-bot@im.bot", "Saved local remark", "Saved local remark"},
		{"bounded-full-identity", strings.Repeat("a", 256), "", strings.Repeat("a", 256)},
	} {
		t.Run(test.name, func(t *testing.T) {
			var botID atomic.Value
			botID.Store(test.botID)
			s := newIntegrationTestService(t, weixinNameTransport(t, &botID))
			ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
			first := completedWeixinNameSetup(t, s, ctx, "", test.explicitName, "completed")
			stored, err := s.loadTarget(context.Background(), "test-account", first.TargetRef)
			if err != nil || stored.Public.DisplayName != test.wantName || stored.Public.AccountLabel != test.botID || stored.Identity != "weixin:"+test.botID || stored.CredentialGeneration != 1 {
				t.Fatal("verified identity display was not persisted", err)
			}
			var grants int
			if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_permission`).Scan(&grants); err != nil || grants != 0 {
				t.Fatal("setup manufactured permissions", grants, err)
			}
			consumer := testDecision("consumer", 1)
			s.registrations = integrationTestRegistrations{{Subject: consumer.RegisteredAppSubject, AppID: consumer.AppID, DisplayName: "Consumer", SourceKind: "development"}}
			grantTestTarget(t, s, consumer, first.TargetRef, "weixin.messages.reply")
			refreshed := completedWeixinNameSetup(t, s, ctx, first.TargetRef, "", "completed")
			current, err := s.loadTarget(context.Background(), "test-account", refreshed.TargetRef)
			if err != nil || refreshed.TargetRef != first.TargetRef || current.Public.DisplayName != test.wantName || current.CredentialGeneration != 2 || !s.permitted(context.Background(), "test-account", "consumer", first.TargetRef, "weixin.messages.reply") {
				t.Fatal("nameless refresh changed target, display or grants", err)
			}
			home, err := s.GetIntegrationManagement(setupTestContext(ctx, localappop.OperationIntegrationManagementGet), &runtimev1.GetIntegrationManagementRequest{})
			if err != nil || len(home.Targets) != 1 || home.Targets[0].DisplayName != test.wantName {
				t.Fatal("Home did not receive persisted display", err)
			}
			lab, err := s.ListIntegrationConnections(testContext(consumer, localappop.OperationIntegrationConnectionList), &runtimev1.ListIntegrationConnectionsRequest{})
			if err != nil || len(lab.Connections) != 1 || lab.Connections[0].DisplayName != test.wantName || len(lab.Connections[0].PermittedOperations) != 1 {
				t.Fatal("consumer did not receive stored display/permission", err)
			}
			before, err := s.captureCredential(current)
			if err != nil {
				t.Fatal(err)
			}
			botID.Store("different-verified-bot")
			pending := completedWeixinNameSetup(t, s, ctx, first.TargetRef, "", "awaiting-new-target")
			if pending.ErrorCode != "" || pending.TargetRef != first.TargetRef {
				t.Fatal("changed-identity setup lost its confirmation or original target")
			}
			if _, err := s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: pending.SetupId}); err != nil {
				t.Fatal(err)
			}
			unchanged, err := s.loadTarget(context.Background(), "test-account", first.TargetRef)
			after, credentialErr := s.captureCredential(unchanged)
			if err != nil || credentialErr != nil || before != after || unchanged.CredentialGeneration != 2 || unchanged.Public.DisplayName != test.wantName {
				t.Fatal("failed refresh changed persisted account", err, credentialErr)
			}
			foreign, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
			foreign.AccountID = "other-account"
			if _, err := s.StartIntegrationConnectionSetup(accountservice.ContextWithAuthorizedLocalAppDecision(ctx, foreign), weixinNameRequest(first.TargetRef, "")); status.Code(err) != codes.NotFound {
				t.Fatal("foreign account refreshed an existing target", err)
			}
		})
	}
}

func TestSetupIdentityConflictProjectionDoesNotExposeArbitraryStatus(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want string
	}{
		{"owner-identity-conflict", failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED"), "INTEGRATION_NEW_TARGET_REQUIRED"},
		{"owner-duplicate-native-source", failure(codes.AlreadyExists, "INTEGRATION_IDENTITY_ALREADY_CONNECTED"), "INTEGRATION_IDENTITY_ALREADY_CONNECTED"},
		{"duplicate-grpc-mimic", status.Error(codes.AlreadyExists, "INTEGRATION_IDENTITY_ALREADY_CONNECTED"), "INTEGRATION_EXECUTOR_FAILED"},
		{"duplicate-provider-mimic", errors.New("INTEGRATION_IDENTITY_ALREADY_CONNECTED PRIVATE_PROVIDER_BODY"), "INTEGRATION_EXECUTOR_FAILED"},
		{"duplicate-wrong-owner-reason", failure(codes.Unavailable, "INTEGRATION_IDENTITY_ALREADY_CONNECTED"), "INTEGRATION_EXECUTOR_FAILED"},
		{"plain-grpc-mimic", status.Error(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED"), "INTEGRATION_EXECUTOR_FAILED"},
		{"private-grpc-body", status.Error(codes.Unavailable, "PRIVATE_TOKEN_SENTINEL"), "INTEGRATION_EXECUTOR_FAILED"},
		{"unlisted-owner-body", failure(codes.FailedPrecondition, "PRIVATE_TOKEN_SENTINEL"), "INTEGRATION_EXECUTOR_FAILED"},
		{"adapter-qr-failure", adapterError("INTEGRATION_WEIXIN_QR_INVALID"), "INTEGRATION_WEIXIN_QR_INVALID"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := publicSetupError(test.err); got != test.want {
				t.Fatal("unsafe or lost setup reason", got)
			}
		})
	}
}

func TestWeixinNamelessSetupDoesNotPersistFailedOrStoppedConfirmation(t *testing.T) {
	for _, stop := range []string{"invalid-identity", "cancel", "expiry"} {
		t.Run(stop, func(t *testing.T) {
			var botID atomic.Value
			botID.Store("verified-bot")
			if stop == "invalid-identity" {
				botID.Store("")
			}
			s := newIntegrationTestService(t, weixinNameTransport(t, &botID))
			ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
			if stop == "invalid-identity" {
				completedWeixinNameSetup(t, s, ctx, "", "", "failed")
			} else {
				entered, release := make(chan struct{}), make(chan struct{})
				adapter := s.adapters["weixin"]
				configure := adapter.configure
				adapter.configure = func(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
					prepared, err := configure(ctx, account, id, req, secret)
					if err == nil && prepared.Public.DisplayName == "" {
						t.Error("verified candidate has no identity display")
					}
					close(entered)
					<-release
					return prepared, err
				}
				s.adapters["weixin"] = adapter
				if stop == "expiry" {
					d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
					d.ExpiresAt = time.Now().Add(2 * time.Second)
					ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d)
				}
				func() {
					defer close(release)
					started, err := s.StartIntegrationConnectionSetup(ctx, weixinNameRequest("", ""))
					if err != nil {
						t.Fatal(err)
					}
					select {
					case <-entered:
					case <-time.After(3 * time.Second):
						t.Fatal("real Weixin candidate did not arrive")
					}
					if stop == "cancel" {
						if _, err := s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId}); err != nil {
							t.Fatal(err)
						}
					} else {
						time.Sleep(time.Until(started.Setup.ExpiresAt.AsTime()) + 20*time.Millisecond)
					}
				}()
				s.workers.Wait()
			}
			var targets, grants int
			if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_target`).Scan(&targets); err != nil || targets != 0 {
				t.Fatal("failed/stopped setup persisted a target", targets, err)
			}
			if err := s.backend.DB().QueryRow(`SELECT count(*) FROM runtime_integration_permission`).Scan(&grants); err != nil || grants != 0 {
				t.Fatal("failed/stopped setup persisted a grant", grants, err)
			}
			secrets := s.secrets.(*testSecrets)
			secrets.mu.Lock()
			defer secrets.mu.Unlock()
			if len(secrets.values) != 0 {
				t.Fatal("failed/stopped setup persisted credentials")
			}
		})
	}
}

func TestWeixinAbsentNameDoesNotPermitUnverifiedPutOrOtherNamelessAdapters(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionPut)
	request := &runtimev1.PutIntegrationConnectionRequest{Adapter: "weixin", Config: &runtimev1.IntegrationConnectionConfig{Weixin: &runtimev1.IntegrationWeixinConfig{}}}
	if _, err := s.PutIntegrationConnection(ctx, request); status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "INTEGRATION_WEIXIN_SETUP_REQUIRED") {
		t.Fatal("nameless put bypassed real identity confirmation", err)
	}
	for _, adapter := range []string{"mcp", "telegram", "feishu", "qq-official", "onebot-v11"} {
		if _, err := s.StartIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupStart), &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: adapter}); status.Code(err) != codes.InvalidArgument {
			t.Fatal("other adapter lost required name", adapter, err)
		}
	}
}
