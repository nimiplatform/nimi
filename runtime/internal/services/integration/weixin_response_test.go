package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

func TestWeixinOptionalReadCodesKeepEnvelope(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
		want       effectOutcome
		code       string
	}{
		{"read-optional-codes", `{"msgs":[],"get_updates_buf":""}`, 200, providerConfirmed, ""},
		{"read-optional-fields", `{}`, 200, providerConfirmed, ""},
		{"read-zero-code", `{"ret":0}`, 200, providerConfirmed, ""},
		{"read-null", `null`, 200, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-array", `[]`, 200, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-malformed", `{`, 200, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-null-ret", `{"ret":null}`, 200, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-null-error", `{"errcode":null}`, 200, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-string-ret", `{"ret":"0"}`, 200, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-fractional-ret", `{"ret":0.5}`, 200, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-nonzero-error", `{"errcode":17}`, 200, providerRejected, "INTEGRATION_WEIXIN_PROVIDER_REJECTED"},
		{"read-expired-ret", `{"ret":-14}`, 200, providerRejected, "INTEGRATION_CREDENTIAL_EXPIRED"},
		{"read-expired-error", `{"errcode":-14}`, 200, providerRejected, "INTEGRATION_CREDENTIAL_EXPIRED"},
		{"read-rate-limit", `{"errcode":17}`, 429, providerRejected, "INTEGRATION_RATE_LIMITED"},
		{"read-http-error", `{}`, 500, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
		{"read-no-content", `{}`, 204, effectUnknown, "INTEGRATION_WEIXIN_RESPONSE_INVALID"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := newIntegrationTestService(t, testRoundTripper(func(*http.Request) (*http.Response, error) {
				response := jsonResponse(json.RawMessage(test.body))
				response.StatusCode = test.status
				return response, nil
			}))
			_, outcome, err := s.weixinAPI(context.Background(), weixinCredential{Token: "fixture-token", BotID: "fixture-bot", BaseURL: weixinAPIBase}, "getupdates", map[string]any{})
			code := ""
			if err != nil {
				code = publicAdapterError(err)
			}
			if outcome != test.want || code != test.code {
				t.Fatal("response proof diverged", outcome, code)
			}
		})
	}
}

func TestWeixinResponseShapeNeverLogsProviderMaterial(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	var output bytes.Buffer
	s.logger = slog.New(slog.NewJSONHandler(&output, nil))
	s.logWeixinResponseShape("sendmessage", "send-id-invalid", 200, []byte(`{"message_id":"PRIVATE_ID_SENTINEL","msgs":[{"text":"PRIVATE_BODY_SENTINEL","context_token":"PRIVATE_CONTEXT_SENTINEL","aes_key":"PRIVATE_KEY_SENTINEL"}],"get_updates_buf":"PRIVATE_CURSOR_SENTINEL","token":"PRIVATE_TOKEN_SENTINEL"}`))
	var record map[string]any
	if json.Unmarshal(output.Bytes(), &record) != nil || record["ret_type"] != "absent" || record["errcode_type"] != "absent" || record["message_id_type"] != "string" || record["msgs_type"] != "array" || record["cursor_type"] != "string" {
		t.Fatal("safe diagnostic shape missing", output.String())
	}
	if strings.Contains(output.String(), "PRIVATE_") {
		t.Fatal("diagnostic exposed provider material")
	}
}
