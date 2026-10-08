package integration

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

func TestFeishuOfficialBeginDefaultsBoundsAndStrictWire(t *testing.T) {
	for _, tc := range []struct {
		name, timings, verification string
		interval, expires           int
		invalid                     bool
	}{
		{name: "omitted", interval: 5, expires: 600},
		{name: "zero", timings: `,"interval":0,"expire_in":0`, interval: 5, expires: 600},
		{name: "negative", timings: `,"interval":-3,"expire_in":-1`, interval: 5, expires: 600},
		{name: "positive", timings: `,"interval":2,"expire_in":120`, interval: 2, expires: 120},
		{name: "bounded", timings: `,"interval":999,"expire_in":99999`, interval: 30, expires: 600},
		{name: "null-interval", timings: `,"interval":null`, invalid: true},
		{name: "null-expiry", timings: `,"expire_in":null`, invalid: true},
		{name: "string", timings: `,"interval":"5"`, invalid: true},
		{name: "fraction", timings: `,"expire_in":1.5`, invalid: true},
		{name: "boolean", timings: `,"interval":true`, invalid: true},
		{name: "international", verification: "https://accounts.larksuite.com/verify", invalid: true},
		{name: "wrong-suffix", verification: "https://accounts.feishu.cn.example.com/verify", invalid: true},
		{name: "http", verification: "http://accounts.feishu.cn/verify", invalid: true},
		{name: "userinfo", verification: "https://private@accounts.feishu.cn/verify", invalid: true},
		{name: "port", verification: "https://accounts.feishu.cn:443/verify", invalid: true},
		{name: "fragment", verification: "https://accounts.feishu.cn/verify#private", invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			verification := tc.verification
			if verification == "" {
				verification = "https://accounts.feishu.cn/verify?user_code=private"
			}
			encodedURL, _ := json.Marshal(verification)
			data := []byte(`{"device_code":"private-device","verification_uri_complete":` + string(encodedURL) + tc.timings + `}`)
			begin, u, err := decodeFeishuRegistrationBegin(data)
			if tc.invalid {
				if err == nil || u != nil {
					t.Fatal("invalid registration produced a QR URL")
				}
				return
			}
			if err != nil || begin.Interval != tc.interval || begin.Expires != tc.expires || u.Hostname() != "accounts.feishu.cn" {
				t.Fatal("official defaults or local limits changed", begin.Interval, begin.Expires, err)
			}
		})
	}
}

func TestFeishuOmittedTimingsPublishQRAndCancelWithoutConnection(t *testing.T) {
	var polls atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != feishuRegistrationURL {
			t.Error("registration escaped domestic endpoint")
		}
		if err := req.ParseForm(); err != nil {
			return nil, err
		}
		if req.Form.Get("action") != "begin" {
			polls.Add(1)
			t.Error("canceled QR setup polled")
		}
		return jsonResponse(map[string]string{"device_code": "private-device", "verification_uri_complete": "https://accounts.feishu.cn/verify?user_code=private"}), nil
	}))
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
	started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: "feishu", DisplayName: "Nimi bot", Config: &runtimev1.IntegrationConnectionConfig{Feishu: &runtimev1.IntegrationFeishuConfig{SetupMode: "create"}}})
	if err != nil {
		t.Fatal(err)
	}
	waitSetupStatus(t, s, ctx, started.Setup.SetupId, "awaiting-confirmation")
	if _, err := s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_integration_target`).Scan(&count); err != nil || count != 0 || polls.Load() != 0 {
		t.Fatal("cancel committed a connection or continued polling", count, err)
	}
}

func TestFeishuBeginDiagnosticNeverLogsPrivateProviderMaterial(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	var output bytes.Buffer
	s.logger = slog.New(slog.NewJSONHandler(&output, nil))
	data := []byte(`{"device_code":"PRIVATE_DEVICE_SENTINEL","verification_uri_complete":"https://accounts.feishu.cn/verify?user_code=PRIVATE_QR_SENTINEL","client_secret":"PRIVATE_SECRET_SENTINEL","other":"PRIVATE_BODY_SENTINEL"}`)
	begin, u, err := decodeFeishuRegistrationBegin(data)
	if err != nil {
		t.Fatal(err)
	}
	s.logFeishuRegistrationBeginShape(data, begin, u, true)
	var record map[string]any
	if json.Unmarshal(output.Bytes(), &record) != nil || record["device_code_type"] != "string" || record["interval_type"] != "absent" || record["expire_in_type"] != "absent" || record["interval_seconds"] != float64(5) || record["expire_in_seconds"] != float64(600) || record["verification_host"] != "accounts.feishu.cn" {
		t.Fatal("safe begin shape missing")
	}
	if strings.Contains(output.String(), "PRIVATE_") || strings.Contains(output.String(), "user_code") || strings.Contains(output.String(), "client_secret") {
		t.Fatal("begin diagnostic exposed provider material")
	}
}

func TestFeishuRegistrationHTTPStatesNeverConfirmErrorCredentials(t *testing.T) {
	for _, tc := range []struct {
		name, action, body string
		status             int
		accepted           bool
	}{
		{"pending", "poll", `{"error":"authorization_pending"}`, 400, true},
		{"slow-down", "poll", `{"error":"slow_down"}`, 400, true},
		{"denied", "poll", `{"error":"access_denied"}`, 400, true},
		{"expired", "poll", `{"error":"expired_token"}`, 400, true},
		{"begin-error", "begin", `{"error":"authorization_pending"}`, 400, false},
		{"server-error", "poll", `{"error":"authorization_pending"}`, 500, false},
		{"unknown", "poll", `{"error":"PRIVATE_ERROR_SENTINEL"}`, 400, false},
		{"null", "poll", `null`, 200, false},
		{"null-error", "poll", `{"error":null}`, 200, false},
		{"typed-error-invalid", "poll", `{"error":400}`, 400, false},
		{"no-credentials", "poll", `{}`, 200, true},
		{"error-credentials", "poll", `{"error":"authorization_pending","client_id":"PRIVATE_ID_SENTINEL","client_secret":"PRIVATE_SECRET_SENTINEL"}`, 400, false},
		{"error-secret-null", "poll", `{"error":"authorization_pending","client_secret":null}`, 400, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: http.Header{}}, nil
			}))
			var output bytes.Buffer
			s.logger = slog.New(slog.NewJSONHandler(&output, nil))
			data, err := s.feishuRegistration(context.Background(), url.Values{"action": {tc.action}})
			if (err == nil) != tc.accepted || (tc.accepted && string(data) != tc.body) {
				t.Fatal("registration HTTP state misclassified", err)
			}
			if strings.Contains(output.String(), "PRIVATE_") || strings.Contains(output.String(), "client_secret") {
				t.Fatal("HTTP diagnostic exposed private provider fields")
			}
		})
	}
}

func TestWeixinVerificationConfirmationOrdersCancellation(t *testing.T) {
	for _, cancelFirst := range []bool{false, true} {
		t.Run(map[bool]string{false: "confirmation-first", true: "cancel-first"}[cancelFirst], func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if strings.Contains(req.URL.Path, "get_bot_qrcode") {
					return jsonResponse(map[string]string{"qrcode": "poll-code", "qrcode_img_content": "https://liteapp.weixin.qq.com/q?scan"}), nil
				}
				if req.URL.Query().Get("verify_code") == "" {
					return jsonResponse(map[string]string{"status": "need_verifycode"}), nil
				}
				if req.URL.Query().Get("verify_code") != "123456" {
					t.Error("verification rewritten")
				}
				close(entered)
				<-release // Deliberately return a late response after cancellation.
				return jsonResponse(map[string]string{"status": "confirmed", "bot_token": "private-token", "ilink_bot_id": "verified-bot", "baseurl": weixinAPIBase, "ilink_user_id": "scanner"}), nil
			}))
			ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
			started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: "weixin", DisplayName: "WeChat", Config: &runtimev1.IntegrationConnectionConfig{Weixin: &runtimev1.IntegrationWeixinConfig{}}})
			if err != nil {
				t.Fatal(err)
			}
			waitSetupStatus(t, s, ctx, started.Setup.SetupId, "awaiting-input")
			if _, err = s.SubmitIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, VerificationCode: "123456"}); err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("code not polled")
			}
			if cancelFirst {
				if _, err = s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId}); err != nil {
					t.Fatal(err)
				}
			}
			close(release)
			if cancelFirst {
				// Close drains the actual setup worker, so no late write can hide
				// after the assertion behind a canceled in-memory status.
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
				var count int
				if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_integration_target`).Scan(&count); err != nil || count != 0 {
					t.Fatal("late connection committed", count, err)
				}
				secrets := s.secrets.(*testSecrets)
				secrets.mu.Lock()
				defer secrets.mu.Unlock()
				if len(secrets.values) != 0 {
					t.Fatal("late credentials persisted")
				}
			} else {
				waitSetupStatus(t, s, ctx, started.Setup.SetupId, "completed")
				observed, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
				if err != nil {
					t.Fatal(err)
				}
				if observed.Setup.VerificationUrl != "" || strings.Contains(observed.String(), "private-token") {
					t.Fatal("private material in setup view")
				}
				stored, err := s.loadTarget(context.Background(), "test-account", observed.Setup.TargetRef)
				if err != nil || stored.Identity != "weixin:verified-bot" {
					t.Fatal("unverified identity", stored, err)
				}
				if _, err = s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId}); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestFeishuOfficialRegistrationMinimalScopesAndDomesticOnly(t *testing.T) {
	for _, brand := range []string{"feishu", "lark"} {
		t.Run(brand, func(t *testing.T) {
			var polls atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.URL.Host == "accounts.feishu.cn" {
					body, err := io.ReadAll(req.Body)
					if err != nil {
						return nil, err
					}
					form, err := url.ParseQuery(string(body))
					if err != nil {
						return nil, err
					}
					if form.Get("action") == "begin" {
						if form.Get("archetype") != "PersonalAgent" || form.Get("auth_method") != "client_secret" || form.Get("request_user_info") != "open_id" {
							t.Error("registration broadened")
						}
						return jsonResponse(map[string]any{"device_code": "private-device", "verification_uri_complete": "https://accounts.feishu.cn/verify?user_code=public", "interval": 1, "expire_in": 600}), nil
					}
					if form.Get("device_code") != "private-device" {
						t.Error("wrong private device state")
					}
					if polls.Add(1) == 1 {
						return &http.Response{StatusCode: http.StatusBadRequest, Body: io.NopCloser(strings.NewReader(`{"error":"authorization_pending"}`)), Header: http.Header{}}, nil
					}
					return jsonResponse(map[string]any{"client_id": "cli_verified", "client_secret": "private-secret", "user_info": map[string]string{"tenant_brand": brand}}), nil
				}
				if req.URL.Host != "open.feishu.cn" {
					t.Error("domestic registration redirected")
				}
				if strings.Contains(req.URL.Path, "tenant_access_token") {
					return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "private-tenant", "expire": 7200}), nil
				}
				return jsonResponse(map[string]any{"code": 0, "bot": map[string]string{"open_id": "bot-verified", "app_name": "Created bot"}}), nil
			}))
			ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
			started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: "feishu", DisplayName: "Nimi bot", Config: &runtimev1.IntegrationConnectionConfig{Feishu: &runtimev1.IntegrationFeishuConfig{SetupMode: "create"}}})
			if err != nil {
				t.Fatal(err)
			}
			waitSetupStatus(t, s, ctx, started.Setup.SetupId, "awaiting-confirmation")
			view, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := url.Parse(view.Setup.VerificationUrl)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := base64.RawURLEncoding.DecodeString(parsed.Query().Get("addons"))
			if err != nil {
				t.Fatal(err)
			}
			reader, err := gzip.NewReader(strings.NewReader(string(encoded)))
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(io.LimitReader(reader, 4097))
			reader.Close()
			if err != nil || len(body) > 4096 {
				t.Fatal("bad addon payload")
			}
			var addons struct {
				Preset *bool `json:"preset"`
				Scopes struct {
					Tenant []string `json:"tenant"`
					User   []string `json:"user"`
				} `json:"scopes"`
				Events struct {
					Items struct {
						Tenant []string `json:"tenant"`
						User   []string `json:"user"`
					} `json:"items"`
				} `json:"events"`
			}
			decoder := json.NewDecoder(bytes.NewReader(body))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&addons); err != nil || addons.Preset == nil || *addons.Preset || len(addons.Scopes.User) != 0 {
				t.Fatal("nonminimal registration template or identity", err)
			}
			wantTenant := map[string]struct{}{
				"im:message:send_as_bot":           {},
				"im:message.p2p_msg:readonly":      {},
				"im:message.group_at_msg:readonly": {},
				"im:resource":                      {},
				"im:message:readonly":              {},
			}
			if len(addons.Scopes.Tenant) != len(wantTenant) {
				t.Fatal("registration must request the exact five tenant scopes", addons.Scopes.Tenant)
			}
			for _, scope := range addons.Scopes.Tenant {
				if _, exists := wantTenant[scope]; !exists {
					t.Fatal("unexpected or duplicate tenant scope", scope)
				}
				delete(wantTenant, scope)
			}
			if len(addons.Events.Items.Tenant) != 1 || addons.Events.Items.Tenant[0] != "im.message.receive_v1" || len(addons.Events.Items.User) != 0 {
				t.Fatal("registration must subscribe only to the declared tenant message event")
			}
			if strings.Contains(string(body), `"im:message"`) || strings.Contains(string(body), "im:message:update") || strings.Contains(view.Setup.VerificationUrl, "private-device") {
				t.Fatal("broad scope or private code in QR")
			}
			want := "completed"
			if brand == "lark" {
				want = "failed"
			}
			waitSetupStatus(t, s, ctx, started.Setup.SetupId, want)
			if brand == "feishu" {
				view, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
				if err != nil {
					t.Fatal(err)
				}
				stored, err := s.loadTarget(context.Background(), "test-account", view.Setup.TargetRef)
				if err != nil || stored.Config.Feishu.SetupMode != "manual" || stored.Config.Feishu.AppId != "cli_verified" {
					t.Fatal("created config not canonical", stored, err)
				}
			}
		})
	}
}
