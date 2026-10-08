package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type tracedWeixinSecrets struct {
	*testSecrets
	traceMu sync.Mutex
	reads   []string
	writes  int
}

func (s *tracedWeixinSecrets) ReadSecret(id string) (string, bool, error) {
	s.traceMu.Lock()
	s.reads = append(s.reads, id)
	s.traceMu.Unlock()
	return s.testSecrets.ReadSecret(id)
}
func (s *tracedWeixinSecrets) WriteSecret(id, value string) error {
	s.traceMu.Lock()
	s.writes++
	s.traceMu.Unlock()
	return s.testSecrets.WriteSecret(id, value)
}

// Protocol fixtures exercise actual owner setup, custody and SQLite. They do
// not assert a live WeChat scanner identity or product acceptance.
func TestWeixinRefreshSelectedTokenAndAlreadyBound(t *testing.T) {
	for _, result := range []string{"binded_redirect", "confirmed", "confirmed-other-scanner-base", "confirmed-scanner-absent", "different-bot"} {
		t.Run(result, func(t *testing.T) {
			var mode atomic.Value
			mode.Store("initial")
			var s *Service
			var custody *tracedWeixinSecrets
			var selected string
			s = newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path == "/ilink/bot/get_bot_qrcode" {
					var body struct {
						Tokens []string `json:"local_token_list"`
					}
					if json.NewDecoder(req.Body).Decode(&body) != nil || req.URL.Host != "ilinkai.weixin.qq.com" || req.URL.Query().Get("bot_type") != "3" || req.Header.Get("Authorization") != "" {
						t.Error("invalid fixed QR request")
					}
					if mode.Load() == "initial" {
						if len(body.Tokens) != 0 {
							t.Error("new setup consulted old credentials")
						}
					} else {
						if len(body.Tokens) != 1 || body.Tokens[0] != "selected-token" {
							t.Error("refresh did not carry only the selected token")
						}
						custody.traceMu.Lock()
						defer custody.traceMu.Unlock()
						if len(custody.reads) != 1 || custody.reads[0] != "integration:"+selected {
							t.Error("QR capture read beyond selected target")
						}
					}
					return jsonResponse(map[string]string{"qrcode": "private-fixture", "qrcode_img_content": "https://liteapp.weixin.qq.com/fixture"}), nil
				}
				if mode.Load() == "binded_redirect" {
					return jsonResponse(map[string]string{"status": "binded_redirect"}), nil
				}
				bot := "original@im.bot"
				token := "selected-token"
				if mode.Load() != "initial" {
					token = "fresh-token"
				}
				if mode.Load() == "different-bot" {
					bot = "replacement@im.bot"
				}
				scanner, base := "same-scanner", weixinAPIBase
				if mode.Load() == "confirmed-other-scanner-base" {
					scanner, base = "other-scanner", "https://alternate.weixin.qq.com"
				} else if mode.Load() == "confirmed-scanner-absent" {
					scanner = ""
				}
				return jsonResponse(map[string]string{"status": "confirmed", "bot_token": token, "ilink_bot_id": bot, "baseurl": base, "ilink_user_id": scanner}), nil
			}))
			var diagnostic bytes.Buffer
			s.logger = slog.New(slog.NewJSONHandler(&diagnostic, nil))
			ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
			first := completedWeixinNameSetup(t, s, ctx, "", "Saved name", "completed")
			selected = first.TargetRef
			before, err := s.loadTarget(context.Background(), "test-account", selected)
			if err != nil {
				t.Fatal(err)
			}
			originalSecret, err := s.captureCredential(before)
			if err != nil {
				t.Fatal(err)
			}
			// Other current-account and foreign-account targets must never be read.
			for _, account := range []string{"test-account", "foreign-account"} {
				other := before
				other.Public = proto.Clone(before.Public).(*runtimev1.IntegrationTarget)
				other.Public.TargetRef = "other-" + account
				other.Account = account
				other.Identity = "weixin:" + other.Public.TargetRef
				if err := s.saveTarget(context.Background(), other); err != nil {
					t.Fatal(err)
				}
				if err := s.secrets.WriteSecret("integration:"+other.Public.TargetRef, "foreign-token"); err != nil {
					t.Fatal(err)
				}
			}
			// A saved old schema is not part of native refresh admission: the
			// owner loads its current descriptor before comparing. No-op and
			// refusal must leave even this stored row untouched.
			stale := before
			stale.Public = proto.Clone(before.Public).(*runtimev1.IntegrationTarget)
			stale.Public.Operations[2].OutputSchemaJson = `{"old-descriptor-fixture":true}`
			if err := s.saveTarget(context.Background(), stale); err != nil {
				t.Fatal(err)
			}
			var rowBefore string
			if err := s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE account_id=? AND target_ref=?`, "test-account", selected).Scan(&rowBefore); err != nil {
				t.Fatal(err)
			}
			consumer := testDecision("consumer", 1)
			grantTestTarget(t, s, consumer, selected, "weixin.messages.reply")
			custody = &tracedWeixinSecrets{testSecrets: s.secrets.(*testSecrets)}
			s.secrets = custody
			receiverCtx, receiverCancel := context.WithCancel(context.Background())
			defer receiverCancel()
			var drains atomic.Int32
			done := make(chan struct{})
			close(done)
			s.nativeReceivers[selected] = &nativeReceiver{ctx: receiverCtx, cancel: func() { drains.Add(1); receiverCancel() }, done: done}
			mode.Store(result)
			want := "already-bound"
			confirms := strings.HasPrefix(result, "confirmed")
			if confirms {
				want = "completed"
			}
			if result == "different-bot" {
				want = "awaiting-new-target"
			}
			view := completedWeixinNameSetup(t, s, ctx, selected, "", want)
			after, err := s.loadTarget(context.Background(), "test-account", selected)
			if err != nil {
				t.Fatal(err)
			}
			currentSecret, err := s.captureCredential(after)
			if err != nil {
				t.Fatal(err)
			}
			custody.traceMu.Lock()
			defer custody.traceMu.Unlock()
			for _, key := range custody.reads {
				if key != "integration:"+selected {
					t.Fatal("foreign custody read")
				}
			}
			if view.TargetRef != selected || !s.permitted(context.Background(), "test-account", "consumer", selected, "weixin.messages.reply") {
				t.Fatal("target or permission changed")
			}
			if confirms {
				if after.CredentialGeneration != before.CredentialGeneration+1 || currentSecret == originalSecret || drains.Load() != 1 || custody.writes != 1 {
					t.Fatal("confirmed refresh failed to update and drain")
				}
			} else {
				var rowAfter string
				if err := s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE account_id=? AND target_ref=?`, "test-account", selected).Scan(&rowAfter); err != nil || rowAfter != rowBefore {
					t.Fatal("no-op or refusal changed the stored target row", err)
				}
				if after.CredentialGeneration != before.CredentialGeneration || currentSecret != originalSecret || !proto.Equal(after.Public, before.Public) || drains.Load() != 0 || custody.writes != 0 || receiverCtx.Err() != nil {
					t.Fatal("no-op or refusal changed credentials, target or receiver")
				}
				if result == "different-bot" && (view.ErrorCode != "" || view.Status != "awaiting-new-target" || view.VerificationUrl != "" || view.AccountLabel != "replacement@im.bot") {
					t.Fatal("different bot bypassed explicit new-target confirmation")
				}
				if result == "binded_redirect" && (view.ErrorCode != "" || view.VerificationUrl != "" || view.AccountLabel != before.Public.AccountLabel) {
					t.Fatal("no-op projection was not truthful")
				}
			}
			if result == "different-bot" {
				if _, err := s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: view.SetupId}); err != nil {
					t.Fatal(err)
				}
				s.workers.Wait()
				requireIntegrationAuditCount(t, s, "integration.connection.setup.commit", 1, 1)
			} else {
				requireIntegrationAuditCount(t, s, "integration.connection.setup.commit", 2, 0)
			}
			requireNoSecretInIntegrationAudit(t, s, "selected-token", "fresh-token", "foreign-token", "same-scanner", "private-fixture")
			events := requireWeixinSetupDiagnosticAllowlist(t, diagnostic.String(), "selected-token", "fresh-token", "foreign-token", "same-scanner", "other-scanner", "private-fixture", "original@im.bot", "replacement@im.bot", selected, "https://liteapp.weixin.qq.com/fixture", weixinAPIBase, "https://alternate.weixin.qq.com", "test-account", "foreign-account")
			wantEvents := 2
			if len(events) != wantEvents {
				t.Fatal("missing or duplicate decision diagnostics")
			}
			terminal := events[1]
			if terminal["stage"] != "qr-terminal" || terminal["selected_refresh"] != true || terminal["confirmed"] != (result != "binded_redirect") || terminal["already_bound"] != (result == "binded_redirect") || terminal["identity_equal"] != confirms || terminal["base_equal"] != (result != "binded_redirect" && result != "confirmed-other-scanner-base") || terminal["scanner_comparable"] != (result != "binded_redirect" && result != "confirmed-scanner-absent") || terminal["scanner_matches_capture"] != (result == "confirmed" || result == "different-bot") {
				t.Fatal("protocol terminal comparisons were misclassified")
			}
		})
	}
}

func TestWeixinRefreshLateAlreadyBoundCannotCommitChangedScopeOrTarget(t *testing.T) {
	for _, stop := range []string{"cancel", "expiry", "session", "remove", "generation", "identity", "credential", "audit"} {
		t.Run(stop, func(t *testing.T) {
			var refreshing atomic.Bool
			entered, release := make(chan struct{}), make(chan struct{})
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path == "/ilink/bot/get_bot_qrcode" {
					return jsonResponse(map[string]string{"qrcode": "private", "qrcode_img_content": "https://liteapp.weixin.qq.com/fixture"}), nil
				}
				if refreshing.Load() {
					close(entered)
					<-release
					return jsonResponse(map[string]string{"status": "binded_redirect"}), nil
				}
				return jsonResponse(map[string]string{"status": "confirmed", "bot_token": "original-token", "ilink_bot_id": "original@im.bot", "baseurl": weixinAPIBase}), nil
			}))
			ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
			first := completedWeixinNameSetup(t, s, ctx, "", "", "completed")
			before, err := s.loadTarget(context.Background(), "test-account", first.TargetRef)
			if err != nil {
				t.Fatal(err)
			}
			invalidated := make(chan struct{})
			decision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
			decision.SessionInvalidated = invalidated
			ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision)
			refreshing.Store(true)
			started, err := s.StartIntegrationConnectionSetup(ctx, weixinNameRequest(first.TargetRef, ""))
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("refresh did not enter polling")
			}
			switch stop {
			case "cancel":
				_, err = s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
			case "session":
				close(invalidated)
			case "expiry":
				s.mu.Lock()
				s.setups[started.Setup.SetupId].view.ExpiresAt = timestamppb.New(time.Now().Add(-time.Second))
				s.mu.Unlock()
			case "remove":
				_, err = s.RemoveIntegrationConnection(setupTestContext(ctx, localappop.OperationIntegrationConnectionRemove), &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: first.TargetRef})
			case "generation":
				before.CredentialGeneration++
				err = s.saveTarget(context.Background(), before)
			case "identity":
				before.Identity = "weixin:changed@im.bot"
				err = s.saveTarget(context.Background(), before)
			case "credential":
				err = s.secrets.WriteSecret("integration:"+first.TargetRef, "newer-credential")
			case "audit":
				unblock := blockIntegrationAudit(t, s)
				defer unblock()
			}
			if err != nil {
				t.Fatal(err)
			}
			close(release)
			s.workers.Wait()
			s.mu.Lock()
			view := proto.Clone(s.setups[started.Setup.SetupId].view).(*runtimev1.IntegrationConnectionSetup)
			s.mu.Unlock()
			if view.Status == "already-bound" || view.Status == "completed" || view.VerificationUrl != "" {
				t.Fatal("late no-op published success or QR", view.Status)
			}
			if stop == "remove" {
				if _, e := s.loadTarget(context.Background(), "test-account", first.TargetRef); e == nil {
					t.Fatal("late no-op recreated removed target")
				}
			} else {
				current, e := s.loadTarget(context.Background(), "test-account", first.TargetRef)
				if e != nil || current.CredentialGeneration != before.CredentialGeneration {
					t.Fatal("late no-op mutated target", e)
				}
				secret, e := s.captureCredential(current)
				wantSecret := schemaJSON(weixinCredential{Token: "original-token", BotID: "original@im.bot", BaseURL: weixinAPIBase})
				if stop == "credential" {
					wantSecret = "newer-credential"
				}
				if e != nil || secret != wantSecret {
					t.Fatal("late no-op overwrote credential", e)
				}
			}
		})
	}
}

func TestWeixinRefreshMissingSelectedTokenDoesNotFallBackToNewQR(t *testing.T) {
	var requests atomic.Int32
	var bot atomic.Value
	bot.Store("original@im.bot")
	transport := weixinNameTransport(t, &bot)
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/ilink/bot/get_bot_qrcode" {
			requests.Add(1)
		}
		return transport.RoundTrip(req)
	}))
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
	first := completedWeixinNameSetup(t, s, ctx, "", "", "completed")
	if err := s.secrets.WriteSecret("integration:"+first.TargetRef, schemaJSON(weixinCredential{BotID: "original@im.bot", BaseURL: weixinAPIBase})); err != nil {
		t.Fatal(err)
	}
	view := completedWeixinNameSetup(t, s, ctx, first.TargetRef, "", "failed")
	if requests.Load() != 1 || view.Status != "failed" {
		t.Fatal("empty selected token started another QR")
	}
}

func TestWeixinAlreadyBoundWithoutSelectedCredentialIsRejected(t *testing.T) {
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/ilink/bot/get_bot_qrcode" {
			return jsonResponse(map[string]string{"qrcode": "private", "qrcode_img_content": "https://liteapp.weixin.qq.com/fixture"}), nil
		}
		return jsonResponse(map[string]string{"status": "binded_redirect"}), nil
	}))
	var diagnostic bytes.Buffer
	s.logger = slog.New(slog.NewJSONHandler(&diagnostic, nil))
	s.secrets = &failOnSecretRead{t: t}
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
	view := completedWeixinNameSetup(t, s, ctx, "", "", "failed")
	if view.ErrorCode != "INTEGRATION_WEIXIN_NEW_CONFIRMATION_REQUIRED" {
		t.Fatal("unselected binding accepted", view.ErrorCode)
	}
	events := requireWeixinSetupDiagnosticAllowlist(t, diagnostic.String(), "private", "https://liteapp.weixin.qq.com/fixture")
	if len(events) != 1 || events[0]["already_bound"] != true || events[0]["confirmed"] != false || events[0]["selected_refresh"] != false || events[0]["scanner_comparable"] != false || events[0]["scanner_matches_capture"] != false {
		t.Fatal("unowned already-bound classification claimed a selected identity")
	}
}

func requireWeixinSetupDiagnosticAllowlist(t *testing.T, output string, sensitive ...string) []map[string]any {
	t.Helper()
	for _, value := range sensitive {
		if strings.Contains(output, value) {
			t.Fatal("setup diagnostic leaked a sensitive fixture")
		}
	}
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		var record map[string]any
		if json.Unmarshal([]byte(line), &record) != nil || record["msg"] != "Weixin setup decision" || record["level"] != "INFO" {
			t.Fatal("missing or unexpected setup diagnostic")
		}
		var flags []string
		switch record["stage"] {
		case "qr-terminal":
			flags = []string{"confirmed", "already_bound", "selected_refresh", "identity_equal", "base_equal", "scanner_comparable", "scanner_matches_capture"}
		case "refresh-admission":
			flags = []string{"identity_equal", "operations_compatible"}
		default:
			t.Fatal("unbounded setup diagnostic stage")
		}
		if len(record) != len(flags)+4 {
			t.Fatal("setup diagnostic added a field outside its allowlist")
		}
		if _, ok := record["time"].(string); !ok {
			t.Fatal("invalid logger timestamp")
		}
		for _, key := range flags {
			if _, ok := record[key].(bool); !ok {
				t.Fatal("setup diagnostic exposed a nonboolean comparison")
			}
		}
		records = append(records, record)
	}
	return records
}
