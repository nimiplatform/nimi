package integration

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

// These protocol fixtures exercise actual configure and Start/Submit/Get,
// SQLite and custody owners. They are not live account or credential evidence.
func TestNativeSetupFailedRefreshPreservesConnectionAndSuccessfulRefreshKeepsPermission(t *testing.T) {
	for _, adapter := range []string{"qq-official", "feishu"} {
		t.Run(adapter, func(t *testing.T) {
			s, original := nativeIdentityFixture(t, adapter)
			putCtx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionPut)
			created, err := s.PutIntegrationConnection(putCtx, original)
			if err != nil {
				t.Fatal(err)
			}
			id := created.Connection.TargetRef
			consumer := testDecision("setup-error-consumer", 49)
			operation := created.Connection.Operations[0].Name
			grantTestTarget(t, s, consumer, id, operation)
			var before, permissions string
			if err := s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE target_ref=?`, id).Scan(&before); err != nil {
				t.Fatal(err)
			}
			if err := s.backend.DB().QueryRow(`SELECT operations_json FROM runtime_integration_permission WHERE target_ref=?`, id).Scan(&permissions); err != nil {
				t.Fatal(err)
			}
			base := s.http.Transport
			var phase atomic.Value
			phase.Store("success")
			s.http.Transport = testRoundTripper(func(request *http.Request) (*http.Response, error) {
				if phase.Load().(string) == "auth-rejected" {
					if adapter == "qq-official" && request.URL.String() == qqTokenURL {
						response := jsonResponse(map[string]any{"errcode": 401, "errmsg": "PRIVATE_PROVIDER_SENTINEL"})
						response.StatusCode = http.StatusUnauthorized
						return response, nil
					}
					if adapter == "feishu" && strings.HasSuffix(request.URL.Path, "/tenant_access_token/internal") {
						return jsonResponse(map[string]any{"code": 9999999, "msg": "PRIVATE_PROVIDER_SENTINEL"}), nil
					}
				}
				if phase.Load().(string) == "gateway-rejected" && request.URL.String() == qqAPIBase+"/gateway" {
					return jsonResponse(map[string]string{"url": "ws://private-provider.invalid/gateway"}), nil
				}
				if phase.Load().(string) == "gateway-invalid-response" && request.URL.String() == qqAPIBase+"/gateway" {
					return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{`))}, nil
				}
				return base.RoundTrip(request)
			})
			refresh := func(candidate string, want string) *runtimev1.IntegrationConnectionSetup {
				t.Helper()
				ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
				started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{
					TargetRef: id, Adapter: adapter, DisplayName: "Original connection", Config: original.Config,
				})
				if err != nil {
					t.Fatal(err)
				}
				if _, err := s.SubmitIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, Secret: candidate}); err != nil {
					t.Fatal(err)
				}
				waitSetupStatus(t, s, ctx, started.Setup.SetupId, want)
				s.workers.Wait()
				view, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
				if err != nil {
					t.Fatal(err)
				}
				return view.Setup
			}
			assertUnchanged := func() {
				t.Helper()
				var after, afterPermissions string
				if err := s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE target_ref=?`, id).Scan(&after); err != nil {
					t.Fatal(err)
				}
				if err := s.backend.DB().QueryRow(`SELECT operations_json FROM runtime_integration_permission WHERE target_ref=?`, id).Scan(&afterPermissions); err != nil {
					t.Fatal(err)
				}
				secret, found, err := s.secrets.ReadSecret("integration:" + id)
				if err != nil || !found || secret != original.Secret || before != after || permissions != afterPermissions {
					t.Fatal("failed setup changed connection, credential or permission")
				}
				requireNativeIdentityCounts(t, s, 1, 1)
			}
			phase.Store("auth-rejected")
			failed := refresh("fixture-candidate-credential", "failed")
			want := "INTEGRATION_QQ_AUTH_REJECTED"
			if adapter == "feishu" {
				want = "INTEGRATION_FEISHU_PROVIDER_REJECTED"
			}
			if failed.ErrorCode != want || failed.TargetRef != id || failed.AccountLabel != "" {
				t.Fatal("lost or unsafe terminal setup facts", failed.Status, failed.ErrorCode)
			}
			assertUnchanged()
			if adapter == "qq-official" {
				phase.Store("gateway-rejected")
				if view := refresh("fixture-candidate-credential", "failed"); view.ErrorCode != "INTEGRATION_QQ_GATEWAY_INVALID" {
					t.Fatal("gateway rejection lost its owner reason", view.ErrorCode)
				}
				assertUnchanged()
				phase.Store("gateway-invalid-response")
				if view := refresh("fixture-candidate-credential", "failed"); view.ErrorCode != "INTEGRATION_QQ_RESPONSE_INVALID" {
					t.Fatal("malformed QQ gateway response lost its owner reason", view.ErrorCode)
				}
				assertUnchanged()
			}
			phase.Store("success")
			completed := refresh("fixture-confirmed-new-credential", "completed")
			if completed.TargetRef != id || completed.ErrorCode != "" {
				t.Fatal("verified same identity created a different connection")
			}
			stored, err := s.loadTarget(context.Background(), consumer.AccountID, id)
			if err != nil || stored.CredentialGeneration != 2 || !s.permitted(context.Background(), consumer.AccountID, consumer.RegisteredAppSubject, id, operation) {
				t.Fatal("successful refresh lost generation or original permission")
			}
			secret, found, err := s.secrets.ReadSecret("integration:" + id)
			if err != nil || !found || secret != "fixture-confirmed-new-credential" {
				t.Fatal("successful refresh did not commit its actual candidate credential")
			}
			var afterPermissions string
			if err := s.backend.DB().QueryRow(`SELECT operations_json FROM runtime_integration_permission WHERE target_ref=?`, id).Scan(&afterPermissions); err != nil || permissions != afterPermissions {
				t.Fatal("refresh expanded or replaced resource permission")
			}
			requireNativeIdentityCounts(t, s, 1, 1)
		})
	}
}

func TestOnebotSetupActualIdentityRejectionIsAReadableTerminalFact(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	value := onebotTestTarget(t, s)
	consumer := testDecision("onebot-setup-error-consumer", 18)
	grantTestTarget(t, s, consumer, value.Public.TargetRef, "onebot-v11.messages.send")
	var before, permission string
	if err := s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE target_ref=?`, value.Public.TargetRef).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := s.backend.DB().QueryRow(`SELECT operations_json FROM runtime_integration_permission WHERE target_ref=?`, value.Public.TargetRef).Scan(&permission); err != nil {
		t.Fatal(err)
	}
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
	started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{TargetRef: value.Public.TargetRef, Adapter: "onebot-v11", DisplayName: "OneBot setup regression", Config: value.Config})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, Secret: "private-token"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		conn, _, err := dialOnebot(t, value, "Universal", "12345", "private-token")
		if err != nil {
			if time.Now().After(deadline) {
				t.Fatal("setup listener did not start")
			}
			time.Sleep(time.Millisecond)
			continue
		}
		conn.SetReadDeadline(time.Now().Add(time.Second))
		var request struct {
			Action string `json:"action"`
			Echo   string `json:"echo"`
		}
		if err := conn.ReadJSON(&request); err != nil {
			conn.Close()
			t.Fatal(err)
		}
		if request.Action != "get_login_info" || request.Echo == "" {
			conn.Close()
			t.Fatal("actual identity verification was not requested")
		}
		if err := conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "echo": request.Echo, "data": map[string]any{"user_id": 999, "nickname": "PRIVATE_PROVIDER_SENTINEL"}}); err != nil {
			conn.Close()
			t.Fatal(err)
		}
		defer conn.Close()
		break
	}
	waitSetupStatus(t, s, ctx, started.Setup.SetupId, "failed")
	s.workers.Wait()
	view, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
	if err != nil || view.Setup.ErrorCode != "INTEGRATION_ONEBOT_IDENTITY_INVALID" {
		t.Fatal("lost actual OneBot setup rejection")
	}
	stored, err := s.loadTarget(context.Background(), "test-account", value.Public.TargetRef)
	if err != nil || stored.CredentialGeneration != value.CredentialGeneration || stored.Identity != value.Identity {
		t.Fatal("identity refusal replaced the existing connection")
	}
	var after, afterPermission string
	if err := s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE target_ref=?`, value.Public.TargetRef).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if err := s.backend.DB().QueryRow(`SELECT operations_json FROM runtime_integration_permission WHERE target_ref=?`, value.Public.TargetRef).Scan(&afterPermission); err != nil {
		t.Fatal(err)
	}
	secret, found, err := s.secrets.ReadSecret("integration:" + value.Public.TargetRef)
	if err != nil || !found || secret != "private-token" || before != after || permission != afterPermission {
		t.Fatal("identity refusal changed connection, credential or permission")
	}
	requireNativeIdentityCounts(t, s, 1, 1)
}

func TestWeixinSetupChangedCaptureRemainsAnExplicitTerminalRefusal(t *testing.T) {
	var bot atomic.Value
	bot.Store("fixture-bot@im.bot")
	s := newIntegrationTestService(t, weixinNameTransport(t, &bot))
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
	created := completedWeixinNameSetup(t, s, ctx, "", "Original Weixin connection", "completed")
	id := created.TargetRef
	originalSecret, found, err := s.secrets.ReadSecret("integration:" + id)
	if err != nil || !found {
		t.Fatal("fixture credential is missing")
	}
	consumer := testDecision("weixin-setup-error-consumer", 37)
	grantTestTarget(t, s, consumer, id, "message.send")
	var permission string
	if err := s.backend.DB().QueryRow(`SELECT operations_json FROM runtime_integration_permission WHERE target_ref=?`, id).Scan(&permission); err != nil {
		t.Fatal(err)
	}
	base := s.http.Transport
	var changed atomic.Bool
	s.http.Transport = testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path == "/ilink/bot/get_bot_qrcode" && changed.CompareAndSwap(false, true) {
			// Model another already-committed generation while the captured QR
			// request is in flight. The failed setup must not overwrite it.
			current, err := s.loadTarget(context.Background(), "test-account", id)
			if err != nil {
				return nil, err
			}
			current.CredentialGeneration++
			if err := s.saveTarget(context.Background(), current); err != nil {
				return nil, err
			}
		}
		return base.RoundTrip(request)
	})
	failed := completedWeixinNameSetup(t, s, ctx, id, "Candidate Weixin connection", "failed")
	if !changed.Load() || failed.ErrorCode != "INTEGRATION_CONFIGURATION_CHANGED" {
		t.Fatal("captured generation rejection lost its typed setup reason", failed.ErrorCode)
	}
	stored, err := s.loadTarget(context.Background(), "test-account", id)
	if err != nil || stored.CredentialGeneration != 2 || stored.Public.DisplayName != "Original Weixin connection" {
		t.Fatal("failed setup overwrote the current connection")
	}
	secret, found, err := s.secrets.ReadSecret("integration:" + id)
	if err != nil || !found || secret != originalSecret {
		t.Fatal("failed setup replaced the captured credential")
	}
	var afterPermission string
	if err := s.backend.DB().QueryRow(`SELECT operations_json FROM runtime_integration_permission WHERE target_ref=?`, id).Scan(&afterPermission); err != nil || permission != afterPermission {
		t.Fatal("failed setup changed existing resource permission")
	}
	requireNativeIdentityCounts(t, s, 1, 1)
}
