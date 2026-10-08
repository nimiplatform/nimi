package integration

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestFeishuAPIDiagnosticsKeepOnlyDeclaredStageStatusAndNumericCode(t *testing.T) {
	for _, tc := range []struct {
		name, path, body, stage, endpoint string
		status                            int
		code                              any
	}{
		{"image-rejected", "/open-apis/im/v1/images", `{"code":234001,"msg":"PRIVATE_BODY_SENTINEL","data":{"image_key":"PRIVATE_KEY_SENTINEL"}}`, "image-upload", "/open-apis/im/v1/images", 400, float64(234001)},
		{"reply", "/open-apis/im/v1/messages/:message_id/reply", `{"code":230002,"msg":"PRIVATE_BODY_SENTINEL"}`, "message-reply", "/open-apis/im/v1/messages/:message_id/reply", 200, float64(230002)},
		{"message-create", "/open-apis/im/v1/messages", `{"code":230101,"msg":"PRIVATE_BODY_SENTINEL"}`, "message-create", "/open-apis/im/v1/messages", 200, float64(230101)},
		{"missing-code", "/open-apis/im/v1/images", `{"data":{"image_key":"PRIVATE_KEY_SENTINEL"}}`, "image-upload", "/open-apis/im/v1/images", 200, nil},
		{"invalid-code", "/open-apis/im/v1/images", `{"code":"PRIVATE_BODY_SENTINEL"}`, "image-upload", "/open-apis/im/v1/images", 200, nil},
		{"unclassified", "/open-apis/PRIVATE_PATH_SENTINEL", `{"code":230002}`, "unclassified", "unclassified", 400, float64(230002)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: http.Header{}}, nil
			}))
			var output bytes.Buffer
			s.logger = slog.New(slog.NewJSONHandler(&output, nil))
			_, _, _ = s.feishuAPI(context.Background(), "PRIVATE_APP_SENTINEL", "PRIVATE_SECRET_SENTINEL", "PRIVATE_TOKEN_SENTINEL", &larkcore.ApiReq{HttpMethod: http.MethodPost, ApiPath: tc.path, PathParams: larkcore.PathParams{"message_id": "PRIVATE_MESSAGE_SENTINEL"}, Body: map[string]string{"text": "PRIVATE_REQUEST_SENTINEL"}})
			var record map[string]any
			if json.Unmarshal(output.Bytes(), &record) != nil || record["stage"] != tc.stage || record["endpoint_template"] != tc.endpoint || record["http_status"] != float64(tc.status) || record["provider_code"] != tc.code || record["provider_code_present"] != (tc.code != nil) {
				t.Fatal("API stage or exact numeric code missing")
			}
			if strings.Contains(output.String(), "PRIVATE_") {
				t.Fatal("API diagnostic exposed request or response state")
			}
		})
	}
}

// Protocol fixtures exercise the real SDK/adapter and owner boundaries. They
// are engineering regressions, not evidence of a live platform account journey.
func TestFeishuOfficialSDKOutcomesAndNoBusinessRetry(t *testing.T) {
	for _, outcome := range []string{"confirmed", "missing-id", "rejected", "unknown", "missing-code"} {
		t.Run(outcome, func(t *testing.T) {
			var dispatched atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.URL.Host != "open.feishu.cn" {
					t.Error("foreign API host")
				}
				if strings.Contains(req.URL.Path, "tenant_access_token") {
					return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "private-token", "expire": 7200}), nil
				}
				dispatched.Add(1)
				if req.Header.Get("Authorization") != "Bearer private-token" {
					t.Error("missing SDK tenant token")
				}
				var body map[string]any
				if json.NewDecoder(req.Body).Decode(&body) != nil || body["receive_id"] != "specified" || body["msg_type"] != "text" {
					t.Error("message request rewritten")
				}
				switch outcome {
				case "confirmed":
					return jsonResponse(map[string]any{"code": 0, "data": map[string]string{"message_id": "om_real"}}), nil
				case "missing-id":
					return jsonResponse(map[string]any{"code": 0}), nil
				case "rejected":
					return jsonResponse(map[string]any{"code": 230002, "msg": "do not expose body"}), nil
				case "missing-code":
					return jsonResponse(map[string]any{"data": map[string]string{"message_id": "not-proof"}}), nil
				default:
					if trace := httptrace.ContextClientTrace(req.Context()); trace != nil && trace.GotConn != nil {
						trace.GotConn(httptrace.GotConnInfo{})
					}
					return nil, errors.New("connection lost after dispatch")
				}
			}))
			target := seedNativeMediaSource(t, s, "feishu", []byte("fixture"))
			call := admittedNativePhaseCall(t, s, testDecision("consumer", 1), target, nativeOperations("feishu")[0])
			ctx := call.ctx
			result, actual, err := s.executeFeishu(ctx, target, nativeOperations("feishu")[0], `{"conversation":{"kind":"user","id":"specified"},"body":{"kind":"text","text":"once"}}`, "private-secret")
			want := effectUnknown
			if outcome == "confirmed" {
				want = providerConfirmed
				if err != nil || !strings.Contains(result, "om_real") {
					t.Fatal(result, err)
				}
			} else if outcome == "rejected" {
				want = providerRejected
			}
			if actual != want || dispatched.Load() != 1 {
				t.Fatal("wrong effect/retry", actual, want, dispatched.Load(), err)
			}
			if err != nil && strings.Contains(err.Error(), "do not expose") {
				t.Fatal("provider body leaked")
			}
		})
	}
}

func TestWeixinQRNeverReadsOrEnumeratesOtherAccountTokens(t *testing.T) {
	var qrs atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "get_bot_qrcode") {
			qrs.Add(1)
			var body map[string]json.RawMessage
			if json.NewDecoder(req.Body).Decode(&body) != nil || string(body["local_token_list"]) != "[]" || len(body) != 1 || req.Header.Get("Authorization") != "" {
				t.Error("QR crossed token custody", body)
			}
			return jsonResponse(map[string]string{"qrcode": "private-poll", "qrcode_img_content": "https://liteapp.weixin.qq.com/q?test"}), nil
		}
		if req.Header.Get("Authorization") != "" || req.Header.Get("AuthorizationType") != "" || req.Header.Get("X-WECHAT-UIN") != "" {
			t.Error("QR polling leaked auth headers")
		}
		<-req.Context().Done()
		return nil, req.Context().Err()
	}))
	s.secrets = &failOnSecretRead{t: t}
	for _, account := range []string{"account-a", "account-b"} {
		ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
		d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
		d.AccountID = account
		ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d)
		started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: "weixin", DisplayName: account, Config: &runtimev1.IntegrationConnectionConfig{Weixin: &runtimev1.IntegrationWeixinConfig{}}})
		if err != nil {
			t.Fatal(err)
		}
		waitSetupStatus(t, s, ctx, started.Setup.SetupId, "awaiting-confirmation")
		if _, err = s.CancelIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupCancel), &runtimev1.CancelIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId}); err != nil {
			t.Fatal(err)
		}
	}
	if qrs.Load() != 2 {
		t.Fatal("expected two account-scoped QR requests", qrs.Load())
	}
}

func TestWeixinSendUsesProviderEvidenceAndNeverResends(t *testing.T) {
	for _, test := range []struct {
		name, body, status, code, id, confirmation string
		httpStatus                                 int
	}{
		{"id", `{"ret":0,"message_id":18446744073709551615}`, "completed", "", "18446744073709551615", "message-created", 200},
		{"id-without-ret", `{"message_id":18446744073709551615}`, "completed", "", "18446744073709551615", "message-created", 200},
		{"string-id-without-ret", `{"message_id":"18446744073709551615"}`, "completed", "", "18446744073709551615", "message-created", 200},
		{"id-error-zero", `{"errcode":0,"message_id":1}`, "completed", "", "1", "message-created", 200},
		{"no-id", `{"ret":0}`, "completed", "", "", "provider-accepted", 200},
		{"rejected", `{"ret":1,"message_id":1}`, "failed", "INTEGRATION_WEIXIN_PROVIDER_REJECTED", "", "", 200},
		{"rejected-error", `{"errcode":17,"message_id":1}`, "failed", "INTEGRATION_WEIXIN_PROVIDER_REJECTED", "", "", 200},
		{"expired", `{"ret":-14,"message_id":1}`, "failed", "INTEGRATION_CREDENTIAL_EXPIRED", "", "", 200},
		{"expired-error", `{"errcode":-14,"message_id":1}`, "failed", "INTEGRATION_CREDENTIAL_EXPIRED", "", "", 200},
		{"missing-proof", `{}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"error-zero-only", `{"errcode":0}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"null-ret-with-id", `{"ret":null,"message_id":1}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"null-error-with-id", `{"errcode":null,"message_id":1}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"zero-id", `{"ret":0,"message_id":0}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"null-id", `{"ret":0,"message_id":null}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"empty-id", `{"ret":0,"message_id":""}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"nonnumeric-id", `{"ret":0,"message_id":"server-id"}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"negative-id", `{"ret":0,"message_id":-1}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"fractional-id", `{"ret":0,"message_id":1.5}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"exponent-id", `{"ret":0,"message_id":1e3}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"overflow-id", `{"ret":0,"message_id":18446744073709551616}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"object-id", `{"ret":0,"message_id":{}}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"boolean-id", `{"ret":0,"message_id":true}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 200},
		{"http-error-with-id", `{"ret":0,"message_id":1}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 500},
		{"http-no-content-with-id", `{"message_id":1}`, "unconfirmed", "INTEGRATION_WEIXIN_RESPONSE_INVALID", "", "", 204},
		{"lost-after-dispatch", "", "unconfirmed", "INTEGRATION_NETWORK_FAILED", "", "", 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			var sends atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				sends.Add(1)
				if !strings.HasSuffix(req.URL.Path, "sendmessage") {
					t.Error("unexpected platform operation")
				}
				if test.body == "" {
					httptrace.ContextClientTrace(req.Context()).GotConn(httptrace.GotConnInfo{})
					return nil, errors.New("lost after dispatch")
				}
				response := jsonResponse(json.RawMessage(test.body))
				response.StatusCode = test.httpStatus
				return response, nil
			}))
			nativeTarget := seedNativeMediaSource(t, s, "weixin", []byte("fixture"))
			consumer := testDecision("registered-lab", 1)
			grantTestTarget(t, s, consumer, nativeTarget.Public.TargetRef, "weixin.messages.send")
			response, err := s.InvokeIntegrationCall(testContext(consumer, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: nativeTarget.Public.TargetRef, Operation: "weixin.messages.send", InputJson: `{"conversation":{"kind":"private","id":"specified"},"contextRef":"opaque-reply","body":{"kind":"text","text":"一次😀"}}`})
			if err != nil {
				t.Fatal(err)
			}
			call := waitTestCall(t, s, consumer, response.Call.CallId)
			if call.Status != test.status || sends.Load() != 1 || call.ErrorCode != test.code {
				t.Fatal(call.Status, call.ErrorCode, sends.Load())
			}
			if test.status == "completed" {
				var receipt map[string]string
				if json.Unmarshal([]byte(call.ResultJson), &receipt) != nil || receipt["messageId"] != test.id || receipt["confirmation"] != test.confirmation {
					t.Fatal("native confirmation diverged", call.ResultJson)
				}
			} else if call.ResultJson != "" {
				t.Fatal("unconfirmed or rejected send fabricated a receipt")
			}
		})
	}
}

type failOnSecretRead struct{ t *testing.T }

func (s *failOnSecretRead) ReadSecret(string) (string, bool, error) {
	s.t.Error("QR read a stored token")
	return "", false, errors.New("forbidden")
}
func (s *failOnSecretRead) WriteSecret(string, string) error {
	s.t.Error("canceled QR wrote custody")
	return errors.New("forbidden")
}
func (s *failOnSecretRead) DeleteSecret(string) error {
	s.t.Error("QR deleted custody")
	return errors.New("forbidden")
}
func waitSetupStatus(t *testing.T, s *Service, ctx context.Context, id, want string) {
	t.Helper()
	ctx = setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet)
	deadline := time.Now().Add(3 * time.Second)
	for {
		result, err := s.GetIntegrationConnectionSetup(ctx, &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: id})
		if err != nil {
			t.Fatal(err)
		}
		if result.Setup.Status == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal(result.Setup.Status, result.Setup.ErrorCode)
		}
		time.Sleep(time.Millisecond)
	}
}
func setupTestContext(ctx context.Context, op localappop.Operation) context.Context {
	d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	return context.WithValue(testContext(d, op), verifiedDesktopTestKey{}, true)
}

func TestNativePrivateSourcesNeverEnterFeedAndExpireWithItsEvent(t *testing.T) {
	s, feed, call := feedFixture(t)
	run, stop := context.WithCancel(s.ctx)
	done := make(chan struct{})
	close(done)
	s.nativeReceivers[call.target.Public.TargetRef] = &nativeReceiver{feed: feed, generation: call.target.CredentialGeneration, ctx: run, cancel: stop, done: done}
	credential := weixinCredential{BotID: "bot", Token: "never-public", BaseURL: weixinAPIBase}
	message := weixinMessage{ID: json.Number("18446744073709551615"), From: "specified", Type: 1, Context: "never-public-context", Items: []weixinItem{{Type: 1}}}
	message.Items[0].Text.Text = "received"
	if err := feed.acceptWeixin(call.ctx, call.target, credential, message); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(feed.events[0].payload), "never-public") {
		t.Fatal("private context entered public buffer")
	}
	var event nativeMessage
	if json.Unmarshal(feed.events[0].payload, &event) != nil || event.MessageID != "18446744073709551615" {
		t.Fatal("lossy message ID")
	}
	source, err := s.nativeSource(call.target, event.ReplyRef)
	if err != nil || source.Context != "never-public-context" {
		t.Fatal(source, err)
	}
	feed.mu.Lock()
	feed.events[0].received = time.Now().Add(-25 * time.Hour)
	feed.mu.Unlock()
	if _, err = s.nativeSource(call.target, event.ReplyRef); err == nil {
		t.Fatal("private source outlived event")
	}
}

func TestFeishuPreallocationFragmentBounds(t *testing.T) {
	frame := func(id string, sum, seq int, payload []byte) *larkws.Frame {
		return &larkws.Frame{Headers: []larkws.Header{{Key: "message_id", Value: id}, {Key: "sum", Value: strconvI(sum)}, {Key: "seq", Value: strconvI(seq)}}, Payload: payload}
	}
	a := &feishuAssembler{}
	defer a.close()
	now := time.Now()
	for index := 0; index < feishuAssemblyCount; index++ {
		if _, err := a.add(frame(strconvI(index), 64, 0, make([]byte, feishuFrameLimit)), now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.add(frame("ninth", 2, 0, []byte("x")), now); err == nil {
		t.Fatal("ninth group admitted")
	}
	if _, err := a.add(frame("0", 64, 1, []byte("x")), now); err == nil {
		t.Fatal("aggregate bytes exceeded")
	}
	if _, err := a.add(frame("bad", 65, 0, nil), now); err == nil {
		t.Fatal("65 parts admitted")
	}
	if _, err := a.add(frame("bad", 2, 2, nil), now); err == nil {
		t.Fatal("invalid sequence admitted")
	}
	if _, err := a.add(frame("later", 2, 0, []byte("x")), now.Add(31*time.Second)); publicAdapterError(err) != "INTEGRATION_FEISHU_FRAGMENT_EXPIRED" {
		t.Fatal("expired fragments must report loss", err)
	}
	if len(a.groups) != 0 || a.bytes != 0 {
		t.Fatal("stale assemblies retained")
	}
	oversized := &larkws.Frame{Headers: make([]larkws.Header, 33)}
	encoded, _ := oversized.Marshal()
	if boundedFeishuWireFrame(encoded) {
		t.Fatal("header allocation admitted")
	}
	b := &feishuAssembler{}
	defer b.close()
	if _, err := b.add(frame("joined", 2, 1, []byte("b")), now); err != nil {
		t.Fatal(err)
	}
	joined, err := b.add(frame("joined", 2, 0, []byte("a")), now)
	if err != nil || string(joined) != "ab" || b.bytes != 0 || len(b.groups) != 0 {
		t.Fatal("fragment reassembly", string(joined), err)
	}
	c := &feishuAssembler{}
	defer c.close()
	if _, err := c.add(frame("active", 3, 0, []byte("a")), now); err != nil {
		t.Fatal(err)
	}
	if _, err := c.add(frame("active", 3, 1, []byte("b")), now.Add(25*time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.add(frame("other", 2, 0, []byte("x")), now.Add(31*time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(c.groups) != 2 || c.bytes != 3 {
		t.Fatal("active fragments expired before thirty seconds of inactivity")
	}
}
func strconvI(value int) string { return fmt.Sprint(value) }

func TestWeixinMediaKeysPaddingAndBounds(t *testing.T) {
	key := []byte("0123456789abcdef")
	plain := []byte("verified local bytes")
	cipher, err := weixinEncrypt(plain, key)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := weixinDecrypt(cipher, key)
	if err != nil || string(decoded) != string(plain) {
		t.Fatal(err)
	}
	for _, encoded := range []string{base64.StdEncoding.EncodeToString(key), base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString(key)))} {
		source := nativeSource{MediaKind: "file", Media: json.RawMessage(schemaJSON(map[string]any{"media": weixinMedia{Parameter: "signed", Key: encoded}}))}
		_, actual, encrypted, err := weixinMediaAddress(source)
		if err != nil || !encrypted || string(actual) != string(key) {
			t.Fatal("key encoding", err)
		}
	}
	if _, err := weixinDecrypt(cipher[:len(cipher)-1], key); err == nil {
		t.Fatal("partial block admitted")
	}
	if _, err := weixinDecrypt(make([]byte, maxMediaBytes+32), key); err == nil {
		t.Fatal("oversized ciphertext allocated")
	}
	if _, err := weixinCDNURL("https://attacker.invalid/download?secret"); err == nil {
		t.Fatal("foreign CDN admitted")
	}
	if _, _, _, err := weixinMediaAddress(nativeSource{MediaKind: "file", Media: json.RawMessage(`{"media":{"encrypt_query_param":"x"}}`)}); err == nil {
		t.Fatal("unencrypted file admitted")
	}
}
