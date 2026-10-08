package integration

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

func seedNativeMediaSource(t *testing.T, s *Service, adapter string, plain []byte) target {
	t.Helper()
	target := target{Account: "test-account", CredentialGeneration: 1, Identity: adapter + ":verified-fixture", Public: &runtimev1.IntegrationTarget{TargetRef: "native-fixture", IntegrationId: adapter, Kind: adapter, DisplayName: "Protocol fixture", Available: true, Operations: nativeOperations(adapter)}}
	secret := "private-secret"
	source := nativeSource{Conversation: nativeConversation{Kind: "user", ID: "specified"}, MessageID: "native-id", MediaKind: "file", FileName: "data.json", SizeBytes: int64(len(plain))}
	if adapter == "feishu" {
		target.Config = &runtimev1.IntegrationConnectionConfig{Feishu: &runtimev1.IntegrationFeishuConfig{AppId: "cli_fixture", SetupMode: "manual"}}
		source.Media = json.RawMessage(`{"key":"file-key","type":"file"}`)
	} else {
		source.Conversation.Kind = "private"
		source.Context = "private-context"
		target.Config = &runtimev1.IntegrationConnectionConfig{Weixin: &runtimev1.IntegrationWeixinConfig{}}
		secret = schemaJSON(weixinCredential{BotID: "bot", Token: "private-token", BaseURL: weixinAPIBase})
		keyHex := hex.EncodeToString([]byte("0123456789abcdef"))
		source.Media = json.RawMessage(schemaJSON(map[string]any{"media": weixinMedia{Parameter: "signed-parameter", Key: base64.StdEncoding.EncodeToString([]byte(keyHex))}}))
	}
	if err := s.saveTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	if err := s.secrets.WriteSecret("integration:"+target.Public.TargetRef, secret); err != nil {
		t.Fatal(err)
	}
	feed := newNativeFeed()
	reply := nativeSource{Conversation: source.Conversation, MessageID: source.MessageID, Context: source.Context}
	feed.events = []nativeEvent{{received: time.Now(), sources: map[string]nativeSource{"opaque-media": source, "opaque-reply": reply}}}
	ctx, cancel := context.WithCancel(s.ctx)
	done := make(chan struct{})
	close(done)
	s.nativeReceivers[target.Public.TargetRef] = &nativeReceiver{feed: feed, generation: 1, ctx: ctx, cancel: cancel, done: done}
	return target
}

func TestNativeOutboundMediaUsesOwnedBytesAndNeverResendsUnknownUpload(t *testing.T) {
	for _, adapter := range []string{"feishu", "weixin"} {
		for _, kind := range []string{"image", "file"} {
			for _, unknown := range []bool{false, true} {
				t.Run(adapter+"/"+kind+"/unknown="+strconv.FormatBool(unknown), func(t *testing.T) {
					plain, mediaType := []byte("owned file bytes"), "application/octet-stream"
					if kind == "image" {
						var encoded bytes.Buffer
						if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
							t.Fatal(err)
						}
						plain, mediaType = encoded.Bytes(), "image/png"
					}
					var uploads, sends atomic.Int32
					var encryptionKey []byte
					s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
						if strings.Contains(req.URL.Path, "tenant_access_token") {
							return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "private-token", "expire": 7200}), nil
						}
						if strings.HasSuffix(req.URL.Path, "getuploadurl") {
							var body struct {
								Key     string `json:"aeskey"`
								RawSize int    `json:"rawsize"`
								Digest  string `json:"rawfilemd5"`
							}
							if json.NewDecoder(req.Body).Decode(&body) != nil {
								t.Error("invalid upload request")
							}
							encryptionKey, _ = hex.DecodeString(body.Key)
							digest := md5.Sum(plain)
							if body.RawSize != len(plain) || body.Digest != hex.EncodeToString(digest[:]) {
								t.Error("upload changed source bytes")
							}
							return jsonResponse(map[string]any{"upload_param": "private-upload"}), nil
						}
						if strings.HasSuffix(req.URL.Path, "/upload") {
							uploads.Add(1)
							cipher, err := io.ReadAll(req.Body)
							if err != nil {
								t.Error(err)
							}
							actual, err := weixinDecrypt(cipher, encryptionKey)
							if err != nil || !bytes.Equal(actual, plain) {
								t.Error("CDN bytes not owned plaintext", err)
							}
							if req.Header.Get("Authorization") != "" {
								t.Error("credential sent to CDN")
							}
							headers := http.Header{}
							if !unknown {
								headers.Set("x-encrypted-param", "private-result")
							}
							return &http.Response{StatusCode: 200, Header: headers, Body: io.NopCloser(strings.NewReader(""))}, nil
						}
						if req.URL.Path == "/open-apis/im/v1/images" || req.URL.Path == "/open-apis/im/v1/files" {
							uploads.Add(1)
							if err := req.ParseMultipartForm(1 << 20); err != nil {
								t.Fatal(err)
							}
							defer req.MultipartForm.RemoveAll()
							if kind == "image" {
								if req.FormValue("image_type") != "message" || len(req.MultipartForm.Value) != 1 {
									t.Error("SDK image upload changed required multipart fields")
								}
							} else if req.FormValue("file_type") != "stream" || req.FormValue("file_name") != "owned.txt" || len(req.MultipartForm.Value) != 2 {
								t.Error("SDK file upload changed required multipart fields")
							}
							file, _, err := req.FormFile(kind)
							if err != nil {
								t.Fatal(err)
							}
							defer file.Close()
							actual, _ := io.ReadAll(file)
							if !bytes.Equal(actual, plain) {
								t.Error("SDK multipart changed owned bytes")
							}
							data := map[string]string{}
							if !unknown {
								data[kind+"_key"] = "private-result"
							}
							return jsonResponse(map[string]any{"code": 0, "data": data}), nil
						}
						sends.Add(1)
						if adapter == "feishu" {
							var message struct {
								ReceiveID string `json:"receive_id"`
								Type      string `json:"msg_type"`
								Content   string `json:"content"`
							}
							var content map[string]string
							if req.URL.Path != "/open-apis/im/v1/messages" || req.URL.Query().Get("receive_id_type") != "open_id" || json.NewDecoder(req.Body).Decode(&message) != nil || message.ReceiveID != "specified" || message.Type != kind || json.Unmarshal([]byte(message.Content), &content) != nil || len(content) != 1 || content[kind+"_key"] != "private-result" {
								t.Error("SDK media message changed declared recipient, kind or uploaded key")
							}
							return jsonResponse(map[string]any{"code": 0, "data": map[string]string{"message_id": "actual-message"}}), nil
						}
						var sent struct {
							Message struct {
								Context string            `json:"context_token"`
								Peer    string            `json:"to_user_id"`
								Items   []json.RawMessage `json:"item_list"`
							} `json:"msg"`
						}
						if json.NewDecoder(req.Body).Decode(&sent) != nil || sent.Message.Context != "private-context" || sent.Message.Peer != "specified" || len(sent.Message.Items) != 1 {
							t.Error("message crossed private peer context")
						}
						return jsonResponse(map[string]any{"ret": 0}), nil
					}))
					target := seedNativeMediaSource(t, s, adapter, plain)
					store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
					if err != nil {
						t.Fatal(err)
					}
					s.assets = &publicationAssets{store: store}
					d := testDecision("app-a", 1)
					owned, err := store.Write(context.Background(), appstorage.ManagedOwner{AccountID: d.AccountID, RegisteredAppSubject: d.RegisteredAppSubject}, "outbound/media", mediaType, false, io.NopCloser(bytes.NewReader(plain)))
					if err != nil {
						t.Fatal(err)
					}
					grantTestTarget(t, s, d, target.Public.TargetRef, adapter+".messages.send")
					body := map[string]any{"kind": kind, "asset": outboundAsset{RelativePath: owned.RelativePath, SHA256: owned.SHA256, MediaType: owned.MediaType, SizeBytes: owned.SizeBytes}}
					if kind == "file" {
						body["fileName"] = "owned.txt"
					}
					conversation := nativeConversation{Kind: "user", ID: "specified"}
					input := map[string]any{"conversation": conversation, "body": body}
					if adapter == "weixin" {
						conversation.Kind = "private"
						input["conversation"] = conversation
						input["contextRef"] = "opaque-reply"
					}
					accepted, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target.Public.TargetRef, Operation: adapter + ".messages.send", InputJson: schemaJSON(input)})
					if err != nil {
						t.Fatal(err)
					}
					result := waitTestCall(t, s, d, accepted.Call.CallId)
					wantStatus, wantSends := "completed", int32(1)
					if unknown {
						wantStatus, wantSends = "unconfirmed", 0
					}
					if result.Status != wantStatus || uploads.Load() != 1 || sends.Load() != wantSends {
						t.Fatal("upload outcome or retry wrong", result, uploads.Load(), sends.Load())
					}
				})
			}
		}
	}
}
func nativeMediaTransport(t *testing.T, plain []byte) http.RoundTripper {
	t.Helper()
	cipher, err := weixinEncrypt(plain, []byte("0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	return testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "tenant_access_token") {
			return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "private-token", "expire": 7200}), nil
		}
		if req.URL.Host == "open.feishu.cn" {
			if req.URL.Path != "/open-apis/im/v1/messages/native-id/resources/file-key" || req.URL.Query().Get("type") != "file" || req.Header.Get("Authorization") != "Bearer private-token" {
				t.Error("resource identity not preserved", req.URL.Path)
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}, "Content-Disposition": {"attachment; filename=\"data.json\""}}, Body: io.NopCloser(bytes.NewReader(plain))}, nil
		}
		if req.URL.Host != "novac2c.cdn.weixin.qq.com" || req.URL.Query().Get("encrypted_query_param") != "signed-parameter" || req.Header.Get("Authorization") != "" {
			t.Error("CDN request crossed custody", req.URL.Host)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/octet-stream"}}, Body: io.NopCloser(bytes.NewReader(cipher))}, nil
	})
}

func TestFeishuDownloadUsesHTTPStatusWithoutInterpretingFileContents(t *testing.T) {
	for _, tc := range []struct {
		name, body, contentType, wantError string
		status                             int
		code                               any
	}{
		{"json-file-with-error-fields", `{"code":234003,"msg":"PRIVATE_FILE_CONTENT"}`, "application/json", "", 200, nil},
		{"json-file-with-string-code", `{"code":"PRIVATE_FILE_CONTENT","msg":"stored data"}`, "application/json", "", 200, nil},
		{"provider-rejection", `{"code":234003,"msg":"PRIVATE_RESPONSE_CONTENT"}`, "application/json", "INTEGRATION_FEISHU_DOWNLOAD_REJECTED", 400, float64(234003)},
		{"non-json-rejection", "PRIVATE_RESPONSE_CONTENT", "text/plain", "INTEGRATION_FEISHU_DOWNLOAD_REJECTED", 403, nil},
		{"invalid-code", `{"code":"PRIVATE_RESPONSE_CONTENT"}`, "application/json", "INTEGRATION_FEISHU_DOWNLOAD_REJECTED", 400, nil},
		{"incomplete-json", `{"code":234003,"msg":`, "application/json", "INTEGRATION_FEISHU_DOWNLOAD_REJECTED", 400, nil},
		{"empty-success", "", "application/octet-stream", "INTEGRATION_FEISHU_DOWNLOAD_REJECTED", 200, nil},
		{"redirect-rejected", "", "application/octet-stream", "INTEGRATION_FEISHU_DOWNLOAD_REJECTED", 302, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var downloads atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if strings.Contains(req.URL.Path, "tenant_access_token") {
					return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "private-token", "expire": 7200}), nil
				}
				downloads.Add(1)
				if req.URL.Host != "open.feishu.cn" || req.URL.Path != "/open-apis/im/v1/messages/native-id/resources/file-key" || req.URL.Query().Get("type") != "file" || req.Header.Get("Authorization") != "Bearer private-token" {
					t.Error("download changed the source or followed a redirect")
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": {tc.contentType}, "Location": {"https://PRIVATE_LOCATION.example/PRIVATE_KEY"}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			}))
			target := seedNativeMediaSource(t, s, "feishu", []byte(tc.body))
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			close(assets.release)
			s.assets = assets
			var logs bytes.Buffer
			s.logger = slog.New(slog.NewJSONHandler(&logs, nil))
			d := testDecision("app-a", 1)
			grantTestTarget(t, s, d, target.Public.TargetRef, "feishu.media.fetch")
			accepted, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target.Public.TargetRef, Operation: "feishu.media.fetch", InputJson: `{"mediaRef":"opaque-media","relativePath":"received/resource.json"}`})
			if err != nil {
				t.Fatal(err)
			}
			result := waitTestCall(t, s, d, accepted.Call.CallId)
			actual, openErr := store.Open(context.Background(), appstorage.ManagedOwner{AccountID: d.AccountID, RegisteredAppSubject: d.RegisteredAppSubject}, "received/resource.json")
			if tc.wantError == "" {
				if result.Status != "completed" || openErr != nil {
					t.Fatal("HTTP 200 file was not adopted", result.Status, result.ErrorCode, openErr)
				}
				body, err := io.ReadAll(actual.Body)
				actual.Body.Close()
				if err != nil || !bytes.Equal(body, []byte(tc.body)) || !strings.Contains(result.ResultJson, mediaDigest([]byte(tc.body))) {
					t.Fatal("download changed file bytes or digest")
				}
			} else if result.Status != "failed" || result.ErrorCode != tc.wantError || openErr == nil {
				if openErr == nil {
					actual.Body.Close()
				}
				t.Fatal("rejected download published an asset or changed error", result.Status, result.ErrorCode, openErr)
			}
			if downloads.Load() != 1 {
				t.Fatal("download was repeated")
			}
			decoder := json.NewDecoder(bytes.NewReader(logs.Bytes()))
			var diagnostic map[string]any
			for {
				var record map[string]any
				if err := decoder.Decode(&record); err != nil {
					if err != io.EOF {
						t.Fatal(err)
					}
					break
				}
				if record["stage"] == "media-download" {
					if diagnostic != nil {
						t.Fatal("duplicate download diagnostic")
					}
					diagnostic = record
				}
			}
			if diagnostic == nil || diagnostic["endpoint_template"] != "/open-apis/im/v1/messages/:message_id/resources/:file_key" || diagnostic["http_status"] != float64(tc.status) || diagnostic["provider_code"] != tc.code || diagnostic["provider_code_present"] != (tc.code != nil) {
				t.Fatal("download diagnostic changed status or interpreted file contents", diagnostic)
			}
			if strings.Contains(logs.String(), "PRIVATE_") || strings.Contains(logs.String(), "native-id") || strings.Contains(logs.String(), "file-key") || strings.Contains(logs.String(), "private-token") {
				t.Fatal("download diagnostic exposed private content or source identifiers")
			}
		})
	}
}

func TestNativeMediaActualCustodySeparatesTwoAppSubjects(t *testing.T) {
	for _, adapter := range []string{"feishu", "weixin"} {
		t.Run(adapter, func(t *testing.T) {
			plain := []byte(`{"example":"a real fixture file"}`)
			s := newIntegrationTestService(t, nativeMediaTransport(t, plain))
			target := seedNativeMediaSource(t, s, adapter, plain)
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			close(assets.release)
			s.assets = assets
			for index, subject := range []string{"app-a", "app-b"} {
				d := testDecision(subject, byte(index+1))
				grantTestTarget(t, s, d, target.Public.TargetRef, adapter+".media.fetch")
				accepted, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target.Public.TargetRef, Operation: adapter + ".media.fetch", InputJson: `{"mediaRef":"opaque-media","relativePath":"received/data.json"}`})
				if err != nil {
					t.Fatal(err)
				}
				result := waitTestCall(t, s, d, accepted.Call.CallId)
				if result.Status != "completed" || !strings.Contains(result.ResultJson, mediaDigest(plain)) {
					t.Fatal("media custody failed", result)
				}
				if adapter == "weixin" && !strings.Contains(result.ResultJson, "decrypted-unverified") {
					t.Fatal("ECB invented authentication")
				}
				actual, err := store.Open(context.Background(), appstorage.ManagedOwner{AccountID: d.AccountID, RegisteredAppSubject: d.RegisteredAppSubject}, "received/data.json")
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(actual.Body)
				actual.Body.Close()
				if err != nil || !bytes.Equal(body, plain) {
					t.Fatal("wrong app-owned bytes")
				}
			}
		})
	}
}

func TestFeishuImageDimensionsRejectBeforeUpload(t *testing.T) {
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewNRGBA(image.Rect(0, 0, 12001, 1))); err != nil {
		t.Fatal(err)
	}
	if validFeishuImage(data.Bytes(), "image/png") {
		t.Fatal("oversized platform image admitted")
	}
	if validFeishuImage([]byte("not an image"), "image/png") {
		t.Fatal("invalid image admitted")
	}
}

func TestNativeDownloadedCandidateCannotPublishAfterCancel(t *testing.T) {
	for _, adapter := range []string{"feishu", "weixin"} {
		t.Run(adapter, func(t *testing.T) {
			plain := []byte("downloaded and verified, not yet published")
			s := newIntegrationTestService(t, nativeMediaTransport(t, plain))
			target := seedNativeMediaSource(t, s, adapter, plain)
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			s.assets = assets
			d := testDecision("app-a", 1)
			grantTestTarget(t, s, d, target.Public.TargetRef, adapter+".media.fetch")
			accepted, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: target.Public.TargetRef, Operation: adapter + ".media.fetch", InputJson: `{"mediaRef":"opaque-media","relativePath":"received/late.bin"}`})
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-assets.prepared:
			case <-time.After(3 * time.Second):
				t.Fatal("candidate not prepared")
			}
			if _, err = s.CancelIntegrationCall(testContext(d, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: accepted.Call.CallId}); err != nil {
				t.Fatal(err)
			}
			close(assets.release)
			result := waitTestCall(t, s, d, accepted.Call.CallId)
			if result.Status != "canceled" || result.ResultJson != "" {
				t.Fatal("late private result", result)
			}
			page, err := store.List(context.Background(), appstorage.ManagedOwner{AccountID: d.AccountID, RegisteredAppSubject: d.RegisteredAppSubject}, "", "", 100)
			if err != nil || len(page.Assets) != 0 {
				t.Fatal("late downloaded candidate published", page, err)
			}
		})
	}
}
