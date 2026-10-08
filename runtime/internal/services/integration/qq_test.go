package integration

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func seedQQCall(t *testing.T, s *Service, conversation nativeConversation, sourceTime string) (target, *invocation, string) {
	t.Helper()
	value := target{Account: "test-account", CredentialGeneration: 1, Subject: "123456", Identity: "qq-official:123456", Config: &runtimev1.IntegrationConnectionConfig{QqOfficial: &runtimev1.IntegrationQQOfficialConfig{AppId: "123456"}}, Public: &runtimev1.IntegrationTarget{TargetRef: "qq-test", Kind: "qq-official", IntegrationId: "qq-official", Available: true, Operations: nativeOperations("qq-official")}}
	if err := s.saveTarget(context.Background(), value); err != nil {
		t.Fatal(err)
	}
	s.secrets.WriteSecret("integration:"+value.Public.TargetRef, "private-secret")
	c := admittedNativePhaseCall(t, s, testDecision("consumer", 1), value, operation(value, "qq-official.updates.read"))
	f := newNativeFeed()
	f.readers = 1
	f.leases[c] = struct{}{}
	f.publish = func(commit func() error) error { return s.commitNativeFeed(f, commit) }
	receive, cancel := context.WithCancel(s.ctx)
	done := make(chan struct{})
	close(done)
	s.nativeReceivers[value.Public.TargetRef] = &nativeReceiver{feed: f, ctx: receive, cancel: cancel, done: done, generation: 1}
	eventType := "C2C_MESSAGE_CREATE"
	author := map[string]string{"user_openid": conversation.ID}
	if conversation.Kind == "group" {
		eventType = "GROUP_AT_MESSAGE_CREATE"
		author = map[string]string{"member_openid": "sender"}
	}
	if err := s.acceptQQMessage(c.ctx, f, eventType, []byte(schemaJSON(map[string]any{"id": "source-message", "content": "actual fixture source", "timestamp": sourceTime, "group_openid": conversation.ID, "author": author}))); err != nil {
		t.Fatal(err)
	}
	var message nativeMessage
	json.Unmarshal(f.events[0].payload, &message)
	c.op = operation(value, "qq-official.messages.send")
	c.fact.Operation = c.op.Name
	grantTestTarget(t, s, c.decision, value.Public.TargetRef, c.op.Name)
	return value, c, message.ReplyRef
}

func TestQQInboundCDNLocationNormalizationAndPrivateRejections(t *testing.T) {
	for _, location := range []struct{ raw, want string }{
		{"https://fixture.qpic.cn/private/path?signature=PRIVATE_QUERY", "https://fixture.qpic.cn/private/path?signature=PRIVATE_QUERY"},
		{" \thttps://fixture.qq.com:443/private/path?signature=PRIVATE_QUERY\r\n", "https://fixture.qq.com:443/private/path?signature=PRIVATE_QUERY"},
		{" \t//fixture.qpic.cn/private/path?signature=PRIVATE_QUERY\r\n", "https://fixture.qpic.cn/private/path?signature=PRIVATE_QUERY"},
		{"https://multimedia.nt.qq.com.cn/private/path?signature=PRIVATE_QUERY", "https://multimedia.nt.qq.com.cn/private/path?signature=PRIVATE_QUERY"},
		{" \thttps://multimedia.nt.qq.com.cn:443/private/path?signature=PRIVATE_QUERY\r\n", "https://multimedia.nt.qq.com.cn:443/private/path?signature=PRIVATE_QUERY"},
		{" \t//multimedia.nt.qq.com.cn/private/path?signature=PRIVATE_QUERY\r\n", "https://multimedia.nt.qq.com.cn/private/path?signature=PRIVATE_QUERY"},
	} {
		var output bytes.Buffer
		s := &Service{logger: slog.New(slog.NewJSONHandler(&output, nil))}
		got, err := s.nativeCDNURL(location.raw)
		if err != nil || got != location.want || output.Len() != 0 {
			t.Fatal("official normalization did not preserve the signed HTTPS location", err)
		}
	}
	for _, tc := range []struct{ name, raw, stage, scheme, host string }{
		{"http", "http://fixture.qpic.cn/PRIVATE_PATH?key=PRIVATE_QUERY", "scheme", "http", "qpic"},
		{"userinfo", "//PRIVATE_USER:PRIVATE_SECRET@fixture.qq.com/PRIVATE_PATH", "userinfo", "network_path", "qq_com"},
		{"fragment", "https://fixture.qpic.cn/PRIVATE_PATH#PRIVATE_FRAGMENT", "fragment", "https", "qpic"},
		{"port", "https://fixture.qpic.cn:444/PRIVATE_PATH", "port", "https", "qpic"},
		{"foreign", "https://PRIVATE_HOST.example/PRIVATE_PATH?key=PRIVATE_QUERY", "host", "https", "other"},
		{"suffix", "https://qq.com.PRIVATE_HOST.example/PRIVATE_PATH", "host", "https", "other"},
		{"cn-http", "http://multimedia.nt.qq.com.cn/PRIVATE_PATH", "scheme", "http", "multimedia_nt_qq_com_cn"},
		{"cn-userinfo", "//PRIVATE_USER:PRIVATE_SECRET@multimedia.nt.qq.com.cn/PRIVATE_PATH", "userinfo", "network_path", "multimedia_nt_qq_com_cn"},
		{"cn-fragment", "https://multimedia.nt.qq.com.cn/PRIVATE_PATH#PRIVATE_FRAGMENT", "fragment", "https", "multimedia_nt_qq_com_cn"},
		{"cn-port", "https://multimedia.nt.qq.com.cn:444/PRIVATE_PATH", "port", "https", "multimedia_nt_qq_com_cn"},
		{"cn-subdomain", "https://sub.multimedia.nt.qq.com.cn/PRIVATE_PATH", "host", "https", "other"},
		{"cn-parent", "https://nt.qq.com.cn/PRIVATE_PATH", "host", "https", "other"},
		{"cn-sibling", "https://other.qq.com.cn/PRIVATE_PATH", "host", "https", "other"},
		{"cn-suffix", "https://multimedia.nt.qq.com.cn.PRIVATE_HOST.example/PRIVATE_PATH", "host", "https", "other"},
		{"cn-trailing-dot", "https://multimedia.nt.qq.com.cn./PRIVATE_PATH", "host", "https", "other"},
		{"parse", "https://PRIVATE_HOST.example/%PRIVATE_ESCAPE", "parse", "other", "unparsed"},
		{"bounds", strings.Repeat("PRIVATE_", 1025), "bounds", "other", "unparsed"},
		{"missing-host", "https:/PRIVATE_PATH", "host", "https", "absent"},
		{"relative", "PRIVATE_PATH", "scheme", "absent", "absent"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			s := &Service{logger: slog.New(slog.NewJSONHandler(&output, nil))}
			got, err := s.nativeCDNURL(tc.raw)
			if got != "" || publicAdapterError(err) != "INTEGRATION_MEDIA_LOCATION_UNAVAILABLE" {
				t.Fatal("location boundary was widened", err)
			}
			var record map[string]any
			if json.Unmarshal(output.Bytes(), &record) != nil || record["stage"] != tc.stage || record["scheme_class"] != tc.scheme || record["host_class"] != tc.host {
				t.Fatal("rejection did not provide exactly one finite classification")
			}
			if len(record) != 6 || strings.Contains(output.String(), "PRIVATE_") || strings.Contains(output.String(), "qq.com.cn") {
				t.Fatal("rejection leaked a location or added unapproved metadata")
			}
		})
	}
}

func TestQQServerFailureCannotBecomeDefiniteRejection(t *testing.T) {
	s := newIntegrationTestService(t, testRoundTripper(func(*http.Request) (*http.Response, error) {
		response := jsonResponse(map[string]any{"code": 999, "message": "server error"})
		response.StatusCode = 503
		return response, nil
	}))
	_, outcome, err := s.qqAPI(context.Background(), "token", http.MethodPost, "/v2/users/spec/messages", map[string]string{"content": "one"})
	if err == nil || outcome != effectUnknown {
		t.Fatal("server uncertainty treated as definite effect-free rejection", outcome, err)
	}
}

func TestQQInboundKnownSizeMustMatchBeforeActualAssetCommit(t *testing.T) {
	plain := []byte("actual private CDN fixture bytes")
	for _, offset := range []int64{-1, 1, 0, -int64(len(plain))} {
		t.Run(strconv.FormatInt(offset, 10), func(t *testing.T) {
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.Method != http.MethodGet || req.URL.String() != "https://multimedia.nt.qq.com.cn/private/file" || req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
					t.Error("download crossed protocol custody", req.Method, req.URL)
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/octet-stream"}}, Body: io.NopCloser(bytes.NewReader(plain))}, nil
			}))
			value, lease, _ := seedQQCall(t, s, nativeConversation{Kind: "c2c", ID: "specified"}, time.Now().UTC().Format(time.RFC3339Nano))
			feed := s.nativeReceivers[value.Public.TargetRef].feed
			location := "https://multimedia.nt.qq.com.cn/private/file"
			if offset == 0 {
				location = " \t//multimedia.nt.qq.com.cn/private/file\r\n"
			}
			if err := s.acceptQQMessage(lease.ctx, feed, "C2C_MESSAGE_CREATE", []byte(schemaJSON(map[string]any{"id": "media-source", "author": map[string]string{"user_openid": "specified"}, "attachments": []map[string]any{{"url": location, "content_type": "application/octet-stream", "filename": "file.bin", "size": int64(len(plain)) + offset}}}))); err != nil {
				t.Fatal(err)
			}
			var event nativeMessage
			if err := json.Unmarshal(feed.events[len(feed.events)-1].payload, &event); err != nil {
				t.Fatal(err)
			}
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			close(assets.release)
			s.assets = assets
			grantTestTarget(t, s, lease.decision, value.Public.TargetRef, "qq-official.media.fetch")
			accepted, err := s.InvokeIntegrationCall(testContext(lease.decision, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "qq-official.media.fetch", InputJson: schemaJSON(map[string]string{"mediaRef": event.Segments[0]["mediaRef"].(string), "relativePath": "received/file.bin"})})
			if err != nil {
				t.Fatal(err)
			}
			fact := waitTestCall(t, s, lease.decision, accepted.Call.CallId)
			owner := appstorage.ManagedOwner{AccountID: lease.decision.AccountID, RegisteredAppSubject: lease.decision.RegisteredAppSubject}
			page, err := store.List(context.Background(), owner, "received/", "", 10)
			if err != nil {
				t.Fatal(err)
			}
			if offset == -1 || offset == 1 {
				if fact.Status != "failed" || fact.ErrorCode != "INTEGRATION_MEDIA_INTEGRITY_INVALID" || fact.ResultJson != "" || len(page.Assets) != 0 {
					t.Fatal("size mismatch committed an asset or success", fact, page)
				}
				select {
				case <-assets.prepared:
					t.Fatal("mismatched bytes entered the asset candidate owner")
				default:
				}
				return
			}
			if fact.Status != "completed" || len(page.Assets) != 1 || page.Assets[0].SizeBytes != int64(len(plain)) || !strings.Contains(fact.ResultJson, mediaDigest(plain)) {
				t.Fatal("matching or unknown source size did not save actual bytes", fact, page)
			}
			stored, err := store.Open(context.Background(), owner, "received/file.bin")
			if err != nil {
				t.Fatal(err)
			}
			defer stored.Body.Close()
			data, err := io.ReadAll(stored.Body)
			if err != nil || !bytes.Equal(data, plain) {
				t.Fatal("stored bytes differ", err)
			}
		})
	}
}

func TestQQExactCDNPublicPNGFetchKeepsFinalCandidateGuard(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	for _, outcome := range []string{"publish", "cancel", "revoke", "invalid-image"} {
		t.Run(outcome, func(t *testing.T) {
			plain := encoded.Bytes()
			if outcome == "invalid-image" {
				plain = []byte("not an image despite the provider MIME")
			}
			var downloads atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				downloads.Add(1)
				if req.Method != http.MethodGet || req.URL.String() != "https://multimedia.nt.qq.com.cn/download?fileid=PRIVATE_FILE&key=PRIVATE_KEY" || req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
					t.Error("private CDN download changed destination or disclosed credentials")
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"image/png"}}, Body: io.NopCloser(bytes.NewReader(plain))}, nil
			}))
			value, lease, _ := seedQQCall(t, s, nativeConversation{Kind: "c2c", ID: "specified"}, time.Now().UTC().Format(time.RFC3339Nano))
			feed := s.nativeReceivers[value.Public.TargetRef].feed
			if err := s.acceptQQMessage(lease.ctx, feed, "C2C_MESSAGE_CREATE", []byte(schemaJSON(map[string]any{
				"id": "png-source", "author": map[string]string{"user_openid": "specified"},
				"attachments": []map[string]any{{"url": "https://multimedia.nt.qq.com.cn/download?fileid=PRIVATE_FILE&key=PRIVATE_KEY", "content_type": "image/png", "filename": "fixture.png", "size": len(plain)}},
			}))); err != nil {
				t.Fatal(err)
			}
			var event nativeMessage
			if err := json.Unmarshal(feed.events[len(feed.events)-1].payload, &event); err != nil {
				t.Fatal(err)
			}
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(assets.release) }) }
			t.Cleanup(release)
			s.assets = assets
			grantTestTarget(t, s, lease.decision, value.Public.TargetRef, "qq-official.media.fetch")
			accepted, err := s.InvokeIntegrationCall(testContext(lease.decision, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{
				TargetRef: value.Public.TargetRef, Operation: "qq-official.media.fetch",
				InputJson: schemaJSON(map[string]string{"mediaRef": event.Segments[0]["mediaRef"].(string), "relativePath": "received/fixture.png"}),
			})
			if err != nil {
				t.Fatal(err)
			}
			if outcome != "invalid-image" {
				select {
				case <-assets.prepared: // Real EOF, candidate metadata and sync, before the original guard.
				case <-time.After(3 * time.Second):
					t.Fatal("PNG candidate was not prepared")
				}
				if outcome != "publish" {
					s.mu.Lock()
					call := s.calls[accepted.Call.CallId]
					s.mu.Unlock()
					stopPublication(t, s, call, outcome, nil)
				}
			}
			release()
			finished := make(chan struct{})
			go func() { s.workers.Wait(); close(finished) }()
			select {
			case <-finished: // Wait past the final guard, not merely the earlier cancellation fact.
			case <-time.After(3 * time.Second):
				t.Fatal("public PNG fetch worker did not finish")
			}
			fact := waitTestCall(t, s, lease.decision, accepted.Call.CallId)
			owner := appstorage.ManagedOwner{AccountID: lease.decision.AccountID, RegisteredAppSubject: lease.decision.RegisteredAppSubject}
			page, err := store.List(context.Background(), owner, "received/", "", 10)
			if err != nil || downloads.Load() != 1 {
				t.Fatal("download or final asset lookup failed", err, downloads.Load())
			}
			if outcome == "publish" {
				if fact.Status != "completed" || len(page.Assets) != 1 || page.Assets[0].SizeBytes != int64(len(plain)) || page.Assets[0].MediaType != "image/png" || page.Assets[0].SHA256 != mediaDigest(plain) || !strings.Contains(fact.ResultJson, "transport-and-local-digest") {
					t.Fatal("public PNG fetch did not commit verified bytes and accurate provenance", fact, page)
				}
				stored, err := store.Open(context.Background(), owner, "received/fixture.png")
				if err != nil {
					t.Fatal(err)
				}
				defer stored.Body.Close()
				actual, err := io.ReadAll(stored.Body)
				if err != nil || !bytes.Equal(actual, plain) {
					t.Fatal("committed PNG bytes differ", err)
				}
				return
			}
			if outcome == "invalid-image" {
				if fact.Status != "failed" || fact.ErrorCode != "INTEGRATION_MEDIA_INVALID" {
					t.Fatal("provider MIME bypassed actual image validation", fact)
				}
				select {
				case <-assets.prepared:
					t.Fatal("invalid image reached the candidate owner")
				default:
				}
			} else if fact.Status != "canceled" {
				t.Fatal("stopped public PNG fetch changed its terminal fact", fact)
			}
			if len(page.Assets) != 0 || fact.ResultJson != "" {
				t.Fatal("rejected PNG produced a final asset or result", fact, page)
			}
			if _, err := store.Open(context.Background(), owner, "received/fixture.png"); err == nil {
				t.Fatal("rejected PNG is readable")
			}
			chargedBytes, objects, err := store.Usage(context.Background(), owner)
			if err != nil || chargedBytes != 0 || objects != 0 {
				t.Fatal("rejected candidate charged final quota", chargedBytes, objects, err)
			}
		})
	}
}

// Runs the registered adapter through actual Invoke/terminal-fact recording.
// The isolated protocol peer remains a fixture, not live QQ acceptance.
func TestQQInvocationRecordsNativeReceiptOrUnconfirmedWithoutRetry(t *testing.T) {
	for _, nativeID := range []string{"fixture-native-id", ""} {
		t.Run(nativeID, func(t *testing.T) {
			var sends atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.URL.String() == qqTokenURL {
					return jsonResponse(map[string]any{"access_token": "private-token", "expires_in": 7200}), nil
				}
				sends.Add(1)
				return jsonResponse(map[string]string{"id": nativeID}), nil
			}))
			conversation := nativeConversation{Kind: "c2c", ID: "specified"}
			value, c, ref := seedQQCall(t, s, conversation, time.Now().UTC().Format(time.RFC3339Nano))
			accepted, err := s.InvokeIntegrationCall(testContext(c.decision, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "qq-official.messages.send", InputJson: schemaJSON(map[string]any{"conversation": conversation, "contextRef": ref, "body": map[string]string{"kind": "text", "text": "one fixture write"}})})
			if err != nil {
				t.Fatal(err)
			}
			fact := waitTestCall(t, s, c.decision, accepted.Call.CallId)
			expected := "completed"
			if nativeID == "" {
				expected = "unconfirmed"
			}
			if fact.Status != expected || sends.Load() != 1 || nativeID != "" && !strings.Contains(fact.ResultJson, nativeID) {
				t.Fatal("registered dispatch recorded a false outcome", fact, sends.Load())
			}
		})
	}
}

func TestQQUploadCompletionCannotExtendSourceOrUploadExpiry(t *testing.T) {
	for _, reason := range []string{"source", "upload"} {
		t.Run(reason, func(t *testing.T) {
			var uploads, sends atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.URL.String() == qqTokenURL {
					return jsonResponse(map[string]any{"access_token": "private-token", "expires_in": 7200}), nil
				}
				if strings.HasSuffix(req.URL.Path, "/files") {
					uploads.Add(1)
					ttl := 60
					if reason == "source" {
						time.Sleep(4200 * time.Millisecond)
					} else {
						ttl = 1
						time.Sleep(1100 * time.Millisecond)
					}
					return jsonResponse(map[string]any{"file_uuid": "actual-upload", "file_info": "private-upload", "ttl": ttl}), nil
				}
				sends.Add(1)
				return jsonResponse(map[string]string{"id": "must-not-send"}), nil
			}))
			timestamp := time.Now()
			if reason == "source" {
				timestamp = timestamp.Add(-5*time.Minute + 4*time.Second)
			}
			conversation := nativeConversation{Kind: "group", ID: "specified"}
			value, c, ref := seedQQCall(t, s, conversation, timestamp.UTC().Format(time.RFC3339Nano))
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			close(assets.release)
			s.assets = assets
			owned, err := store.Write(context.Background(), appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}, "outbound/file", "text/plain", false, io.NopCloser(strings.NewReader("owned file")))
			if err != nil {
				t.Fatal(err)
			}
			input := schemaJSON(map[string]any{"conversation": conversation, "contextRef": ref, "body": nativeBody{Kind: "file", FileName: "owned.txt", Asset: outboundAsset{RelativePath: owned.RelativePath, SHA256: owned.SHA256, MediaType: owned.MediaType, SizeBytes: owned.SizeBytes}}})
			_, outcome, err := s.executeQQ(c.ctx, value, c.op, input, "private-secret")
			expected := map[string]string{"source": "INTEGRATION_QQ_CONTEXT_EXPIRED", "upload": "INTEGRATION_QQ_UPLOAD_EXPIRED"}[reason]
			if publicAdapterError(err) != expected || outcome != notDispatched || uploads.Load() != 1 || sends.Load() != 0 {
				t.Fatal("late upload extended a deadline", outcome, err, uploads.Load(), sends.Load())
			}
		})
	}
}

func TestQQLaterUploadAndSendPhasesRejectActualLogout(t *testing.T) {
	for _, phase := range []string{"token", "upload"} {
		t.Run(phase, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var requests atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				requests.Add(1)
				token := req.URL.String() == qqTokenURL
				if phase == "token" && token || phase == "upload" && strings.HasSuffix(req.URL.Path, "/files") {
					close(entered)
					<-release
				}
				if token {
					return jsonResponse(map[string]any{"access_token": "private-token", "expires_in": 7200}), nil
				}
				if strings.HasSuffix(req.URL.Path, "/files") {
					return jsonResponse(map[string]any{"file_uuid": "actual-upload", "file_info": "private-upload", "ttl": 60}), nil
				}
				t.Error("message dispatched after actual logout")
				return jsonResponse(map[string]string{"id": "unexpected"}), nil
			}))
			conversation := nativeConversation{Kind: "group", ID: "specified"}
			value, c, ref := seedQQCall(t, s, conversation, time.Now().UTC().Format(time.RFC3339Nano))
			account := accountservice.New(nil, accountservice.WithAuditStore(s.audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&generationTestCustody{material: accountservice.AccountMaterial{AccountID: "test-account", RealmEnvironmentID: "realm", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
			projection, generation, _, ok := account.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("authentication absent")
			}
			s.revalidator = generationTestRevalidator{Revalidator: s.revalidator, account: account}
			c.decision.AccountID, c.decision.RealmEnvironmentID, c.decision.AccountGeneration = projection.AccountId, projection.RealmEnvironmentId, generation
			c.ctx = context.WithValue(testContext(c.decision, localappop.OperationIntegrationCallInvoke), invocationContextKey{}, c)
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			close(assets.release)
			s.assets = assets
			owned, err := store.Write(context.Background(), appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}, "outbound/file", "application/octet-stream", false, io.NopCloser(strings.NewReader("owned file")))
			if err != nil {
				t.Fatal(err)
			}
			input := schemaJSON(map[string]any{"conversation": conversation, "contextRef": ref, "body": nativeBody{Kind: "file", FileName: "owned.txt", Asset: outboundAsset{RelativePath: owned.RelativePath, SHA256: owned.SHA256, MediaType: owned.MediaType, SizeBytes: owned.SizeBytes}}})
			done := make(chan error, 1)
			go func() { _, _, err := s.executeQQ(c.ctx, value, c.op, input, "private-secret"); done <- err }()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("phase not blocked")
			}
			logout, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop", DeviceId: "device", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
			if err != nil || !logout.GetAccepted() {
				t.Fatal("actual logout failed", logout, err)
			}
			if c.ctx.Err() != nil || closed(c.decision.SessionInvalidated) {
				t.Fatal("test relies on watcher cancellation")
			}
			before := requests.Load()
			close(release)
			if err = <-done; publicAdapterError(err) != "INTEGRATION_SCOPE_ENDED" || requests.Load() != before {
				t.Fatal("late phase escaped actual Account fence", err, requests.Load(), before)
			}
		})
	}
}

func TestNativeEncodingReservationsPrecedeAllocationAndReturnCapacity(t *testing.T) {
	var budget nativeEncodingBudget
	releases := []func(){}
	for i := 0; i < 4; i++ {
		release, err := budget.reserve(4 * 1024 * 1024)
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
	}
	if _, err := budget.reserve(1); err == nil {
		t.Fatal("fifth encoder admitted")
	}
	for _, release := range releases {
		release()
	}
	release, err := budget.reserve(qqInlineMediaLimit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = budget.reserve(4 * 1024 * 1024); err == nil {
		t.Fatal("aggregate encoding envelope exceeded")
	}
	release()
	if budget.bytes != 0 || budget.count != 0 {
		t.Fatal("reservation leaked")
	}
}
func TestQQContextRequiredExpiryAndSharedFiveReplySlots(t *testing.T) {
	var sends atomic.Int32
	seen := map[uint32]bool{}
	var mu sync.Mutex
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() == qqTokenURL {
			return jsonResponse(map[string]any{"access_token": "private-token", "expires_in": 7200}), nil
		}
		var body struct {
			Message  string `json:"msg_id"`
			Sequence uint32 `json:"msg_seq"`
		}
		json.NewDecoder(req.Body).Decode(&body)
		if body.Message != "source-message" || body.Sequence == 0 {
			t.Error("context missing", body)
		}
		mu.Lock()
		if seen[body.Sequence] {
			t.Error("sequence reused")
		}
		seen[body.Sequence] = true
		mu.Unlock()
		sends.Add(1)
		return jsonResponse(map[string]string{"id": "native-receipt"}), nil
	}))
	conversation := nativeConversation{Kind: "group", ID: "specified"}
	value, c, ref := seedQQCall(t, s, conversation, time.Now().UTC().Format(time.RFC3339Nano))
	input := map[string]any{"conversation": conversation, "body": map[string]string{"kind": "text", "text": "one message"}}
	if _, outcome, err := s.executeQQ(c.ctx, value, c.op, schemaJSON(input), "private-secret"); err == nil || outcome != notDispatched || sends.Load() != 0 {
		t.Fatal("active push admitted")
	}
	input["contextRef"] = ref
	input["conversation"] = nativeConversation{Kind: "group", ID: "different"}
	if _, outcome, err := s.executeQQ(c.ctx, value, c.op, schemaJSON(input), "private-secret"); publicAdapterError(err) != "INTEGRATION_SOURCE_INVALID" || outcome != notDispatched || sends.Load() != 0 {
		t.Fatal("context admitted for another exact target", outcome, err)
	}
	input["conversation"] = conversation
	var wg sync.WaitGroup
	var completed, rejected atomic.Int32
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, outcome, err := s.executeQQ(c.ctx, value, c.op, schemaJSON(input), "private-secret")
			if err == nil && outcome == providerConfirmed {
				completed.Add(1)
			} else if publicAdapterError(err) == "INTEGRATION_QQ_CONTEXT_EXHAUSTED" {
				rejected.Add(1)
			} else {
				t.Error("unexpected shared outcome", outcome, err)
			}
		}()
	}
	wg.Wait()
	if completed.Load() != 5 || rejected.Load() != 3 || sends.Load() != 5 {
		t.Fatal("budget split by call/App", completed.Load(), rejected.Load(), sends.Load())
	}
	for _, sourceTime := range []string{"", time.Now().Add(-61 * time.Minute).Format(time.RFC3339Nano)} {
		other := newIntegrationTestService(t, s.http.Transport)
		v, call, contextRef := seedQQCall(t, other, nativeConversation{Kind: "c2c", ID: "specified"}, sourceTime)
		if _, outcome, err := other.executeQQ(call.ctx, v, call.op, schemaJSON(map[string]any{"conversation": nativeConversation{Kind: "c2c", ID: "specified"}, "contextRef": contextRef, "body": map[string]string{"kind": "text", "text": "expired"}}), "private-secret"); err == nil || outcome != notDispatched {
			t.Fatal("source time renewed locally", sourceTime, outcome, err)
		}
	}
}
func TestQQOwnedImageFileUploadsAndUnknownReceiptSingleAttempt(t *testing.T) {
	for _, kind := range []string{"image", "file"} {
		for _, scope := range []string{"c2c", "group"} {
			for _, unknown := range []bool{false, true} {
				t.Run(kind+scope+map[bool]string{true: "unknown", false: "confirmed"}[unknown], func(t *testing.T) {
					plain, mediaType := []byte("owned file bytes"), "application/octet-stream"
					if kind == "image" {
						var buffer bytes.Buffer
						png.Encode(&buffer, image.NewNRGBA(image.Rect(0, 0, 1, 1)))
						plain, mediaType = buffer.Bytes(), "image/png"
					}
					var uploads, sends atomic.Int32
					s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
						if req.URL.String() == qqTokenURL {
							return jsonResponse(map[string]any{"access_token": "private-token", "expires_in": "7200"}), nil
						}
						if req.Header.Get("Authorization") != "QQBot private-token" {
							t.Error("wrong official authorization")
						}
						expectedScope := "users"
						if scope == "group" {
							expectedScope = "groups"
						}
						if !strings.HasPrefix(req.URL.Path, "/v2/"+expectedScope+"/specified/") {
							t.Error("cross-scope API", req.URL.Path)
						}
						if strings.HasSuffix(req.URL.Path, "/files") {
							uploads.Add(1)
							var body struct {
								Data string `json:"file_data"`
								Type int    `json:"file_type"`
								Name string `json:"file_name"`
								Send bool   `json:"srv_send_msg"`
							}
							json.NewDecoder(req.Body).Decode(&body)
							decoded, err := base64.StdEncoding.DecodeString(body.Data)
							if err != nil || !bytes.Equal(decoded, plain) || body.Send || kind == "file" && (body.Type != 4 || body.Name != "owned.txt") || kind == "image" && body.Type != 1 {
								t.Error("upload changed source or sent autonomously", body.Type, body.Name)
							}
							if unknown {
								return jsonResponse(map[string]string{"file_uuid": "actual-upload"}), nil
							}
							return jsonResponse(map[string]any{"file_uuid": "actual-upload", "file_info": "private-upload-reference", "ttl": 60}), nil
						}
						sends.Add(1)
						var body struct {
							Context string            `json:"msg_id"`
							Type    int               `json:"msg_type"`
							Media   map[string]string `json:"media"`
							Content string            `json:"content"`
						}
						json.NewDecoder(req.Body).Decode(&body)
						if body.Context != "source-message" || body.Type != 7 || body.Media["file_info"] != "private-upload-reference" || body.Content != " " {
							t.Error("upload not handed to exact message", body)
						}
						return jsonResponse(map[string]string{"id": "actual-provider-id"}), nil
					}))
					conversation := nativeConversation{Kind: scope, ID: "specified"}
					value, c, ref := seedQQCall(t, s, conversation, time.Now().UTC().Format(time.RFC3339Nano))
					store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
					if err != nil {
						t.Fatal(err)
					}
					assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
					close(assets.release)
					s.assets = assets
					owned, err := store.Write(context.Background(), appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}, "outbound/media", mediaType, false, io.NopCloser(bytes.NewReader(plain)))
					if err != nil {
						t.Fatal(err)
					}
					input := schemaJSON(map[string]any{"conversation": conversation, "contextRef": ref, "body": map[string]any{"kind": kind, "fileName": "owned.txt", "asset": outboundAsset{RelativePath: owned.RelativePath, SHA256: owned.SHA256, MediaType: owned.MediaType, SizeBytes: owned.SizeBytes}}})
					result, outcome, err := s.executeQQ(c.ctx, value, c.op, input, "private-secret")
					if uploads.Load() != 1 || unknown && (sends.Load() != 0 || outcome != effectUnknown || err == nil) || !unknown && (sends.Load() != 1 || outcome != providerConfirmed || err != nil || !strings.Contains(result, "actual-provider-id")) {
						t.Fatal("dishonest upload/send outcome", uploads.Load(), sends.Load(), outcome, err)
					}
				})
			}
		}
	}
}
func TestQQMissingMessageReceiptRemainsUnknownAndSequenceNotReused(t *testing.T) {
	var sends atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() == qqTokenURL {
			return jsonResponse(map[string]any{"access_token": "private-token", "expires_in": 7200}), nil
		}
		sends.Add(1)
		return jsonResponse(map[string]any{}), nil
	}))
	conversation := nativeConversation{Kind: "c2c", ID: "specified"}
	value, c, ref := seedQQCall(t, s, conversation, time.Now().UTC().Format(time.RFC3339Nano))
	input := schemaJSON(map[string]any{"conversation": conversation, "contextRef": ref, "body": map[string]string{"kind": "text", "text": "unknown"}})
	for i := 0; i < 5; i++ {
		_, outcome, err := s.executeQQ(c.ctx, value, c.op, input, "private-secret")
		if outcome != effectUnknown || err == nil {
			t.Fatal("missing native receipt confirmed", outcome, err)
		}
	}
	if _, _, err := s.executeQQ(c.ctx, value, c.op, input, "private-secret"); publicAdapterError(err) != "INTEGRATION_QQ_CONTEXT_EXHAUSTED" || sends.Load() != 5 {
		t.Fatal("unknown write retried/released", sends.Load(), err)
	}
}
func TestQQActualWebSocketIdentifyHeartbeatCommittedSequenceAndExplicitResume(t *testing.T) {
	s, feed, call := feedFixture(t)
	_ = s
	ctx, cancel := context.WithCancel(call.ctx)
	defer cancel()
	results := make(chan error, 2)
	connections := make(chan *websocket.Conn, 2)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		connections <- conn
		results <- s.consumeQQ(ctx, conn, "private-token", feed)
	}))
	defer server.Close()
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	<-connections
	client.WriteJSON(map[string]any{"op": 10, "d": map[string]int{"heartbeat_interval": 1000}})
	var identify struct {
		Op   int                        `json:"op"`
		Data map[string]json.RawMessage `json:"d"`
	}
	client.ReadJSON(&identify)
	if identify.Op != 2 || string(identify.Data["intents"]) != "33554432" || string(identify.Data["token"]) != `"QQBot private-token"` {
		t.Fatal("wrong identity/intents", identify)
	}
	client.WriteJSON(map[string]any{"op": 0, "s": 1, "t": "READY", "d": map[string]any{"session_id": "private-session", "user": map[string]string{"id": "actual-bot"}}})
	client.WriteJSON(map[string]any{"op": 0, "s": 2, "t": "C2C_MESSAGE_CREATE", "d": map[string]any{"id": "actual-message", "content": "actual text", "timestamp": time.Now().UTC().Format(time.RFC3339Nano), "author": map[string]string{"user_openid": "specified"}}})
	var heartbeat struct {
		Op   int   `json:"op"`
		Data int64 `json:"d"`
	}
	client.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err = client.ReadJSON(&heartbeat); err != nil || heartbeat.Op != 1 || heartbeat.Data != 2 {
		t.Fatal("heartbeat did not use committed sequence", heartbeat, err)
	}
	client.WriteJSON(map[string]any{"op": 11})
	client.WriteJSON(map[string]any{"op": 7})
	if err = <-results; publicAdapterError(err) != "INTEGRATION_QQ_RECONNECT_REQUIRED" {
		t.Fatal(err)
	}
	feed.mu.Lock()
	if len(feed.events) != 1 {
		t.Error("message never reached actual guarded feed")
	}
	feed.mu.Unlock()
	// No connection is opened automatically. A second explicitly initiated
	// physical socket uses the in-memory sequence from committed reception.
	next, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	<-connections
	next.WriteJSON(map[string]any{"op": 10, "d": map[string]int{"heartbeat_interval": 1000}})
	var resume struct {
		Op   int `json:"op"`
		Data struct {
			Session  string `json:"session_id"`
			Sequence int64  `json:"seq"`
		} `json:"d"`
	}
	if err = next.ReadJSON(&resume); err != nil || resume.Op != 6 || resume.Data.Session != "private-session" || resume.Data.Sequence != 2 {
		t.Fatal("wrong resume", resume, err)
	}
	next.WriteJSON(map[string]any{"op": 9, "d": false})
	if err = <-results; publicAdapterError(err) != "INTEGRATION_QQ_SESSION_INVALID" {
		t.Fatal(err)
	}
	feed.mu.Lock()
	defer feed.mu.Unlock()
	if feed.qqSession != "" || feed.qqHasSequence {
		t.Fatal("invalid session retained resume")
	}
}

func assertQQRejectionLog(t *testing.T, output []byte, stage, opcode, event, sequence, decode string, size int) map[string]any {
	t.Helper()
	var record map[string]any
	decoder := json.NewDecoder(bytes.NewReader(output))
	if err := decoder.Decode(&record); err != nil {
		t.Fatal("missing rejection record", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		t.Fatal("more than one rejection record", err)
	}
	want := map[string]any{"level": "INFO", "msg": "QQ WebSocket frame rejected", "stage": stage, "opcode": opcode,
		"event_type": event, "sequence_state": sequence, "json_error": decode, "frame_bytes": float64(size)}
	for key, value := range want {
		if record[key] != value {
			t.Fatalf("%s: got %v, want %v", key, record[key], value)
		}
	}
	for key := range record {
		if _, ok := want[key]; !ok && key != "time" && key != "hello" && key != "ready" && key != "resume_requested" && key != "ack_pending" {
			t.Fatal("unexpected log field", key)
		}
	}
	for _, private := range []string{"private-token", "private-session", "private-event", "private-id", "private-body", "https://private-url", "private-error"} {
		if bytes.Contains(output, []byte(private)) {
			t.Fatal("provider data leaked into rejection record", private)
		}
	}
	return record
}

func TestQQFrameRejectionClassificationsDoNotExposeProviderValues(t *testing.T) {
	for _, tc := range []struct {
		name, frame, opcode, event, sequence, decode string
		otherError                                   bool
	}{
		{"absent", `{"t":"private-event","d":{"content":"private-body","id":"private-id","session_id":"private-session","token":"private-token","url":"https://private-url"}}`, "absent", "other", "absent", "none", false},
		{"null", `{"op":null,"s":null,"t":"RESUMED"}`, "null", "RESUMED", "null", "none", false},
		{"negative", `{"op":0,"s":-1,"t":"READY"}`, "dispatch", "READY", "negative", "none", false},
		{"zero", `{"op":0,"s":0,"t":"C2C_MESSAGE_CREATE"}`, "dispatch", "C2C_MESSAGE_CREATE", "nonnegative", "none", false},
		{"unknown-op", `{"op":987654,"s":1,"t":"GROUP_AT_MESSAGE_CREATE"}`, "other", "GROUP_AT_MESSAGE_CREATE", "nonnegative", "none", false},
		{"wrong-op", `{"op":"private-token","s":1,"t":"GROUP_MESSAGE_CREATE"}`, "wrong_type", "GROUP_MESSAGE_CREATE", "nonnegative", "type", false},
		{"wrong-sequence", `{"op":11,"s":"private-id","t":"private-event"}`, "heartbeat_ack", "other", "wrong_type", "type", false},
		{"overflow-sequence", `{"op":1,"s":9223372036854775808}`, "heartbeat", "other", "wrong_type", "type", false},
		{"wrong-event", `{"op":2,"t":{"private-body":"private-token"}}`, "identify", "other", "absent", "type", false},
		{"root-type", `["private-body","private-token"]`, "absent", "other", "absent", "type", false},
		{"syntax", `{"op":0,"t":"private-event","d":"private-body"`, "absent", "other", "absent", "syntax", false},
		{"other-error", `{"op":6,"s":2}`, "resume", "other", "nonnegative", "other", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			s := &Service{logger: slog.New(slog.NewJSONHandler(&output, nil))}
			data := []byte(tc.frame)
			var frame qqFrame
			decodeErr := json.Unmarshal(data, &frame)
			if tc.otherError {
				decodeErr = errors.New("private-error private-token")
			}
			s.logQQFrameRejection("frame_decode", data, decodeErr, true, false, true, true)
			record := assertQQRejectionLog(t, output.Bytes(), "frame_decode", tc.opcode, tc.event, tc.sequence, tc.decode, len(data))
			if record["hello"] != true || record["ready"] != false || record["resume_requested"] != true || record["ack_pending"] != true {
				t.Fatal("incorrect state classifications")
			}
		})
	}
}

func TestQQActualWebSocketRejectionStagesPreservePublicReasonsAndState(t *testing.T) {
	for _, tc := range []struct {
		name, frame, opcode, event, sequence, decode string
		hello, ready, resume, binary                 bool
	}{
		{"frame_decode", `{"op":"private-token","s":1,"t":"private-event","d":"private-body"}`, "wrong_type", "other", "nonnegative", "type", false, false, false, false},
		{"duplicate_hello", `{"op":10}`, "hello", "other", "absent", "none", true, false, false, false},
		{"ack_before_hello", `{"op":11}`, "heartbeat_ack", "other", "absent", "none", false, false, false, false},
		{"dispatch_before_hello", `{"op":0,"s":1,"t":"READY"}`, "dispatch", "READY", "nonnegative", "none", false, false, false, false},
		{"dispatch_sequence_invalid", `{"op":0,"t":"RESUMED","d":{"token":"private-token","session_id":"private-session"}}`, "dispatch", "RESUMED", "absent", "none", true, false, true, false},
		{"dispatch_sequence_invalid", `{"op":0,"s":null,"t":"RESUMED"}`, "dispatch", "RESUMED", "null", "none", true, false, true, false},
		{"dispatch_sequence_invalid", `{"op":0,"s":-1,"t":"RESUMED"}`, "dispatch", "RESUMED", "negative", "none", true, false, true, false},
		{"unexpected_resumed", `{"op":0,"s":2,"t":"RESUMED"}`, "dispatch", "RESUMED", "nonnegative", "none", true, false, false, false},
		{"message_before_ready", `{"op":0,"s":3,"t":"C2C_MESSAGE_CREATE","d":{"id":"private-id","content":"private-body"}}`, "dispatch", "C2C_MESSAGE_CREATE", "nonnegative", "none", true, false, false, false},
		{"other_dispatch_before_ready", `{"op":0,"s":3,"t":"private-event","d":"private-body"}`, "dispatch", "other", "nonnegative", "none", true, false, false, false},
		{"other_dispatch_before_ready", `{"op":0,"s":3,"t":"FRIEND_ADD","d":"private-body"}`, "dispatch", "other", "nonnegative", "none", true, false, false, false},
		{"other_dispatch_before_ready", `{"op":0,"s":3,"t":"private-event","d":"private-body"}`, "dispatch", "other", "nonnegative", "none", true, false, true, false},
		{"heartbeat_before_hello", `{"op":1}`, "heartbeat", "other", "absent", "none", false, false, false, false},
		{"unsupported_opcode", `{"op":987654,"s":1,"t":"private-event","d":"private-body"}`, "other", "other", "nonnegative", "none", true, true, false, false},
		{"non_text_frame", `{"op":0,"t":"private-event","d":"private-body"}`, "dispatch", "other", "absent", "none", false, false, false, true},
	} {
		t.Run(tc.name+"/"+tc.sequence, func(t *testing.T) {
			s, feed, call := feedFixture(t)
			var output bytes.Buffer
			s.logger = slog.New(slog.NewJSONHandler(&output, nil))
			ctx, cancel := context.WithCancel(call.ctx)
			defer cancel()
			var expectedSequence int64
			if tc.resume {
				feed.qqSession, feed.qqSequence, feed.qqHasSequence = "private-session", 2, true
				expectedSequence = 2
			}
			results := make(chan error, 1)
			upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := upgrader.Upgrade(w, r, nil)
				if err == nil {
					results <- s.consumeQQ(ctx, conn, "private-token", feed)
				}
			}))
			defer server.Close()
			client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			client.SetWriteDeadline(time.Now().Add(3 * time.Second))
			if tc.hello {
				if err = client.WriteJSON(map[string]any{"op": 10, "d": map[string]int{"heartbeat_interval": 300000}}); err != nil {
					t.Fatal(err)
				}
				client.SetReadDeadline(time.Now().Add(3 * time.Second))
				var handshake qqFrame
				if err = client.ReadJSON(&handshake); err != nil || (tc.resume && handshake.Op != 6) || (!tc.resume && handshake.Op != 2) {
					t.Fatal("incorrect handshake", err, handshake.Op)
				}
			}
			if tc.ready {
				ready := `{"op":0,"s":1,"t":"READY","d":{"session_id":"private-session","user":{"id":"private-id"}}}`
				expectedSequence = 1
				if tc.resume {
					ready, expectedSequence = `{"op":0,"s":3,"t":"RESUMED"}`, 3
				}
				if err = client.WriteMessage(websocket.TextMessage, []byte(ready)); err != nil {
					t.Fatal(err)
				}
			}
			kind := websocket.TextMessage
			if tc.binary {
				kind = websocket.BinaryMessage
			}
			if err = client.WriteMessage(kind, []byte(tc.frame)); err != nil {
				t.Fatal(err)
			}
			select {
			case err = <-results:
			case <-time.After(3 * time.Second):
				t.Fatal("rejection did not terminate the socket")
			}
			reason := "INTEGRATION_QQ_FRAME_INVALID"
			if tc.binary {
				reason = "INTEGRATION_QQ_GATEWAY_CLOSED"
			}
			if publicAdapterError(err) != reason {
				t.Fatal("public reason changed", err)
			}
			record := assertQQRejectionLog(t, output.Bytes(), tc.name, tc.opcode, tc.event, tc.sequence, tc.decode, len(tc.frame))
			if record["hello"] != tc.hello || record["ready"] != tc.ready || record["resume_requested"] != tc.resume || record["ack_pending"] != false {
				t.Fatal("incorrect socket state", record)
			}
			feed.mu.Lock()
			if feed.qqSequence != expectedSequence || len(feed.events) != 0 {
				t.Error("rejected frame changed committed reception")
			}
			feed.mu.Unlock()
		})
	}
}

type qqPublicReadFixture struct {
	s                            *Service
	value                        target
	decision                     accountservice.LocalAppCallerDecision
	mu                           sync.Mutex
	messages                     []map[string]any
	peers                        []*websocket.Conn
	resumes                      []int64
	closed                       atomic.Int32
	commitEntered, commitRelease chan struct{}
	commitOnce                   sync.Once
}

// Only token discovery and production gateway dialing are replaced by a
// loopback protocol peer. Invoke/GetCall, reader leases, consumeQQ, guarded
// insertion, cursor delivery and last-reader socket teardown are real.
func newQQPublicReadFixture(t *testing.T, pauseSecondSocket bool) *qqPublicReadFixture {
	t.Helper()
	f := &qqPublicReadFixture{s: newIntegrationTestService(t, nil), decision: testDecision("registered-lab", 1)}
	f.value = target{Account: "test-account", CredentialGeneration: 1, Subject: "123456", Identity: "qq-official:123456", Config: &runtimev1.IntegrationConnectionConfig{QqOfficial: &runtimev1.IntegrationQQOfficialConfig{AppId: "123456"}}, Public: &runtimev1.IntegrationTarget{TargetRef: "qq-public-read", Kind: "qq-official", IntegrationId: "qq-official", Available: true, Operations: nativeOperations("qq-official")}}
	if err := f.s.saveTarget(context.Background(), f.value); err != nil {
		t.Fatal(err)
	}
	if err := f.s.secrets.WriteSecret("integration:"+f.value.Public.TargetRef, "private-secret"); err != nil {
		t.Fatal(err)
	}
	f.s.registrations = integrationTestRegistrations{{Subject: f.decision.RegisteredAppSubject, AppID: f.decision.AppID, DisplayName: "Lab"}}
	grantTestTarget(t, f.s, f.decision, f.value.Public.TargetRef, "qq-official.updates.read")
	if pauseSecondSocket {
		f.commitEntered, f.commitRelease = make(chan struct{}), make(chan struct{})
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		peer, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		f.mu.Lock()
		f.peers = append(f.peers, peer)
		f.mu.Unlock()
		defer func() { peer.Close(); f.closed.Add(1) }()
		peer.SetReadDeadline(time.Now().Add(5 * time.Second))
		peer.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if peer.WriteJSON(map[string]any{"op": 10, "d": map[string]int{"heartbeat_interval": 300000}}) != nil {
			return
		}
		var handshake struct {
			Op   int `json:"op"`
			Data struct {
				Token    string `json:"token"`
				Session  string `json:"session_id"`
				Sequence int64  `json:"seq"`
			} `json:"d"`
		}
		if peer.ReadJSON(&handshake) != nil { // an already-buffered page may close before Hello
			return
		}
		if handshake.Data.Token != "QQBot private-token" || (handshake.Op != 2 && handshake.Op != 6) {
			t.Error("public read did not use the QQ protocol handshake")
			return
		}
		sequence := int64(1)
		if handshake.Op == 2 {
			if peer.WriteJSON(map[string]any{"op": 0, "s": sequence, "t": "READY", "d": map[string]any{"session_id": "public-session", "user": map[string]string{"id": "actual-bot"}}}) != nil {
				return
			}
		} else {
			if handshake.Data.Session != "public-session" {
				t.Error("next public read discarded the verified QQ session")
				return
			}
			sequence = handshake.Data.Sequence
			f.mu.Lock()
			f.resumes = append(f.resumes, sequence)
			f.mu.Unlock()
		}
		f.mu.Lock()
		messages := append([]map[string]any(nil), f.messages...)
		f.mu.Unlock()
		for _, frame := range messages {
			if frame["s"].(int64) <= sequence {
				continue
			}
			if peer.WriteJSON(frame) != nil {
				return
			}
		}
		if handshake.Op == 6 {
			resumedSequence := sequence + 1
			if len(messages) > 0 && messages[len(messages)-1]["s"].(int64) >= resumedSequence {
				resumedSequence = messages[len(messages)-1]["s"].(int64) + 1
			}
			if peer.WriteJSON(map[string]any{"op": 0, "s": resumedSequence, "t": "RESUMED", "d": map[string]any{}}) != nil {
				return
			}
		}
		for { // observe actual socket EOF, not a synthetic receiver completion
			if _, _, err := peer.ReadMessage(); err != nil {
				return
			}
		}
	}))
	var sockets atomic.Int32
	adapter := f.s.adapters["qq-official"]
	adapter.receive = func(ctx context.Context, _ target, _ string, feed *nativeFeed) error {
		if err := f.s.admitNativeReception(feed); err != nil {
			return err
		}
		if sockets.Add(1) == 2 && f.commitEntered != nil {
			protected := feed.publish
			feed.publish = func(commit func() error) error {
				f.commitOnce.Do(func() { close(f.commitEntered) })
				<-f.commitRelease
				return protected(commit) // the actual owner still decides publication
			}
		}
		conn, _, err := websocket.DefaultDialer.DialContext(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
		if err != nil {
			return err
		}
		defer conn.Close()
		return f.s.consumeQQ(ctx, conn, "private-token", feed)
	}
	f.s.adapters["qq-official"] = adapter
	t.Cleanup(func() {
		if f.commitRelease != nil && !closed(f.commitRelease) {
			close(f.commitRelease)
		}
		server.Close()
		f.mu.Lock()
		defer f.mu.Unlock()
		for _, peer := range f.peers {
			peer.Close()
		}
	})
	return f
}

func (f *qqPublicReadFixture) add(id string, sequence int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.messages = append(f.messages, qqReplayFrame("C2C_MESSAGE_CREATE", id, sequence, "protocol fixture body"))
}

func (f *qqPublicReadFixture) invoke(t *testing.T, cursor string, waitMS int) string {
	t.Helper()
	return invokeTestCall(t, f.s, f.decision, f.value.Public.TargetRef, "qq-official.updates.read", schemaJSON(map[string]any{"conversations": []string{"c2c:specified"}, "cursor": cursor, "waitMs": waitMS}))
}

func (f *qqPublicReadFixture) drained(t *testing.T) *nativeFeed {
	t.Helper()
	f.s.mu.Lock()
	r := f.s.nativeReceivers[f.value.Public.TargetRef]
	f.s.mu.Unlock()
	if r == nil {
		t.Fatal("public read did not create its native receiver")
	}
	select {
	case <-r.done:
	case <-time.After(4 * time.Second):
		t.Fatal("last reader did not drain the real QQ socket")
	}
	r.feed.mu.Lock()
	if r.ctx.Err() == nil || r.feed.readers != 0 || len(r.feed.leases) != 0 {
		r.feed.mu.Unlock()
		t.Fatal("completed public read retained an unadmitted receiver")
	}
	r.feed.mu.Unlock()
	until := time.Now().Add(4 * time.Second)
	for {
		f.mu.Lock()
		peers := len(f.peers)
		f.mu.Unlock()
		if int(f.closed.Load()) == peers {
			break
		}
		if time.Now().After(until) {
			t.Fatal("protocol peer did not observe actual socket EOF")
		}
		time.Sleep(time.Millisecond)
	}
	return r.feed
}

func (f *qqPublicReadFixture) page(t *testing.T, id string) (string, []nativeMessage, *nativeFeed) {
	t.Helper()
	fact := waitTestCall(t, f.s, f.decision, id)
	var page struct {
		Cursor string
		Events []nativeMessage
	}
	if fact.Status != "completed" || json.Unmarshal([]byte(fact.ResultJson), &page) != nil || page.Cursor == "" {
		t.Fatal("public QQ page did not complete", fact)
	}
	return page.Cursor, page.Events, f.drained(t)
}

func TestQQPublicReadPagesCloseLastReaderAndResumeTwoReplayMessages(t *testing.T) {
	f := newQQPublicReadFixture(t, false)
	f.add("seed", 2)
	cursor, events, _ := f.page(t, f.invoke(t, "", 25000))
	if len(events) != 1 || events[0].MessageID != "seed" {
		t.Fatal("initial public read lost the seed")
	}
	f.add("replay-one", 3)
	f.add("replay-two", 4)
	seen := map[string]bool{"seed": true}
	var feed *nativeFeed
	for reads := 0; reads < 3 && len(seen) < 3; reads++ {
		cursor, events, feed = f.page(t, f.invoke(t, cursor, 25000))
		if len(events) == 0 {
			t.Fatal("explicit resume lost both pending replay frames")
		}
		for _, event := range events {
			if seen[event.MessageID] {
				t.Fatal("cursor continuation redelivered an already returned message")
			}
			seen[event.MessageID] = true
		}
		feed.mu.Lock()
		position, err := feed.parseCursor(cursor, nativeBinding(f.decision, f.value, []string{"c2c:specified"}))
		feed.mu.Unlock()
		if err != nil || position != uint64(len(seen)) {
			t.Fatal("cursor skipped or invented a committed message", err)
		}
	}
	if !seen["replay-one"] || !seen["replay-two"] {
		t.Fatal("last-reader teardown lost a resumed message")
	}
	previous := cursor
	cursor, events, feed = f.page(t, f.invoke(t, cursor, 1000))
	if len(events) != 0 || cursor != previous {
		t.Fatal("empty page advanced beyond the committed message view")
	}
	feed.mu.Lock()
	sequence := feed.qqSequence
	feed.mu.Unlock()
	f.add("after-empty", sequence+2)
	_, events, _ = f.page(t, f.invoke(t, cursor, 25000))
	if len(events) != 1 || events[0].MessageID != "after-empty" {
		t.Fatal("empty-page continuation lost the next actual frame")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.resumes) < 2 || f.resumes[0] != 2 {
		t.Fatal("public continuation did not Resume from the committed seed", f.resumes)
	}
}

func TestQQPublicReadStopRejectsPendingReplayWithoutSequenceAdvance(t *testing.T) {
	for _, stop := range []string{"cancel", "revoke"} {
		t.Run(stop, func(t *testing.T) {
			f := newQQPublicReadFixture(t, true)
			f.add("seed", 2)
			cursor, _, _ := f.page(t, f.invoke(t, "", 25000))
			f.add("pending", 3)
			id := f.invoke(t, cursor, 25000)
			select {
			case <-f.commitEntered: // actual WS frame has reached guarded insertion
			case <-time.After(4 * time.Second):
				t.Fatal("replayed frame never reached the publication boundary")
			}
			if stop == "cancel" {
				if _, err := f.s.CancelIntegrationCall(testContext(f.decision, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: id}); err != nil {
					t.Fatal(err)
				}
			} else if _, err := f.s.SetIntegrationPermission(desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet), &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", f.decision.AccountID, f.decision.RegisteredAppSubject), TargetRef: f.value.Public.TargetRef}); err != nil {
				t.Fatal(err)
			}
			fact := waitTestCall(t, f.s, f.decision, id)
			if fact.Status != "canceled" || fact.ResultJson != "" {
				t.Fatal("stopped public read delivered a late body", fact)
			}
			close(f.commitRelease)
			feed := f.drained(t)
			feed.mu.Lock()
			sequence, count := feed.qqSequence, len(feed.events)
			feed.mu.Unlock()
			if sequence != 2 || count != 1 {
				t.Fatal("rejected pending replay advanced sequence or entered the feed", sequence, count)
			}
			if stop == "revoke" {
				if _, err := f.s.SetIntegrationPermission(desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet), &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", f.decision.AccountID, f.decision.RegisteredAppSubject), TargetRef: f.value.Public.TargetRef, Operations: []string{"qq-official.updates.read"}}); err != nil {
					t.Fatal(err)
				}
			}
			_, events, _ := f.page(t, f.invoke(t, cursor, 25000))
			if len(events) != 1 || events[0].MessageID != "pending" {
				t.Fatal("new explicit read could not resume the uncommitted replay")
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if len(f.resumes) != 2 || f.resumes[0] != 2 || f.resumes[1] != 2 {
				t.Fatal("stopped message changed the next Resume sequence", f.resumes)
			}
		})
	}
}

func qqResumeSocketFixture(t *testing.T) (*Service, *nativeFeed, *invocation, *websocket.Conn, <-chan error, *bytes.Buffer) {
	t.Helper()
	s := newIntegrationTestService(t, nil)
	target := target{Account: "test-account", CredentialGeneration: 1, Subject: "123456", Identity: "qq-official:123456", Config: &runtimev1.IntegrationConnectionConfig{QqOfficial: &runtimev1.IntegrationQQOfficialConfig{AppId: "123456"}}, Public: &runtimev1.IntegrationTarget{TargetRef: "qq-test", Kind: "qq-official", IntegrationId: "qq-official", Available: true, Operations: nativeOperations("qq-official")}}
	if err := s.saveTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	call := admittedNativePhaseCall(t, s, testDecision("consumer", 1), target, operation(target, "qq-official.updates.read"))
	feed := newNativeFeed()
	feed.readers = 1
	feed.leases[call] = struct{}{}
	feed.publish = func(commit func() error) error { return s.commitNativeFeed(feed, commit) }
	feed.qqSession, feed.qqSequence, feed.qqHasSequence = "private-session", 2, true
	output := new(bytes.Buffer)
	s.logger = slog.New(slog.NewJSONHandler(output, nil))
	// Like the shared receiver, socket lifetime is independent of one reader.
	ctx, cancel := context.WithCancel(s.ctx)
	results := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err == nil {
			results <- s.consumeQQ(ctx, conn, "private-token", feed)
		}
	}))
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		cancel()
		server.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { cancel(); client.Close(); server.Close() })
	client.SetWriteDeadline(time.Now().Add(5 * time.Second))
	client.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err = client.WriteJSON(map[string]any{"op": 10, "d": map[string]int{"heartbeat_interval": 300000}}); err != nil {
		t.Fatal(err)
	}
	var resume struct {
		Op   int `json:"op"`
		Data struct {
			Session  string `json:"session_id"`
			Sequence int64  `json:"seq"`
		} `json:"d"`
	}
	if err = client.ReadJSON(&resume); err != nil || resume.Op != 6 || resume.Data.Session != "private-session" || resume.Data.Sequence != 2 {
		t.Fatal("did not resume actual committed session", err)
	}
	return s, feed, call, client, results, output
}

func qqReplayFrame(eventType, id string, sequence int64, content string) map[string]any {
	return map[string]any{"op": 0, "s": sequence, "t": eventType, "d": map[string]any{
		"id": id, "content": content, "timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"group_openid": "specified-group", "author": map[string]string{"user_openid": "specified", "member_openid": "specified-member"},
	}}
}

func assertQQHeartbeatSequence(t *testing.T, client *websocket.Conn, sequence int64) {
	t.Helper()
	if err := client.WriteJSON(map[string]any{"op": 1}); err != nil {
		t.Fatal(err)
	}
	var heartbeat struct {
		Op   int   `json:"op"`
		Data int64 `json:"d"`
	}
	if err := client.ReadJSON(&heartbeat); err != nil || heartbeat.Op != 1 || heartbeat.Data != sequence {
		t.Fatal("heartbeat did not acknowledge the committed sequence", heartbeat, err)
	}
}

func TestQQActualWebSocketResumeAcceptsResumedAfterReadiness(t *testing.T) {
	for _, first := range []string{"RESUMED", "READY"} {
		t.Run(first, func(t *testing.T) {
			_, feed, _, client, results, output := qqResumeSocketFixture(t)
			frame := map[string]any{"op": 0, "s": 3, "t": first}
			if first == "READY" {
				frame["d"] = map[string]any{"session_id": "private-session", "user": map[string]string{"id": "private-id"}}
			}
			if err := client.WriteJSON(frame); err != nil {
				t.Fatal(err)
			}
			if err := client.WriteJSON(map[string]any{"op": 0, "s": 4, "t": "RESUMED"}); err != nil {
				t.Fatal(err)
			}
			assertQQHeartbeatSequence(t, client, 4)
			feed.mu.Lock()
			if len(feed.events) != 0 || feed.qqSequence != 4 || feed.qqSession != "private-session" {
				t.Error("readiness notifications emitted messages or lost the session")
			}
			feed.mu.Unlock()
			if err := client.WriteJSON(qqReplayFrame("C2C_MESSAGE_CREATE", "continued", 5, "private-body")); err != nil {
				t.Fatal(err)
			}
			assertQQHeartbeatSequence(t, client, 5)
			feed.mu.Lock()
			if len(feed.events) != 1 || feed.events[0].id != "continued" || feed.qqSequence != 5 {
				t.Error("resumed socket did not commit the following message exactly once")
			}
			feed.mu.Unlock()
			// A repeated control notification must not relax other frame guards.
			invalid := []byte(`{"op":987654,"t":"private-event","d":"private-body"}`)
			if err := client.WriteMessage(websocket.TextMessage, invalid); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-results:
				if publicAdapterError(err) != "INTEGRATION_QQ_FRAME_INVALID" {
					t.Fatal("unknown opcode no longer rejected", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("unknown opcode did not terminate the socket")
			}
			record := assertQQRejectionLog(t, output.Bytes(), "unsupported_opcode", "other", "other", "absent", "none", len(invalid))
			if record["ready"] != true || record["resume_requested"] != true {
				t.Fatal("readiness was not preserved")
			}
		})
	}
}

func TestQQActualWebSocketResumeAcceptsMessagesBeforeResumedAndContinues(t *testing.T) {
	for _, eventType := range []string{"C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"} {
		t.Run(eventType, func(t *testing.T) {
			_, feed, _, client, results, output := qqResumeSocketFixture(t)
			for i := int64(1); i <= 2; i++ {
				if err := client.WriteJSON(qqReplayFrame(eventType, "replayed-"+strconv.FormatInt(i, 10), i+2, "private-body")); err != nil {
					t.Fatal(err)
				}
			}
			assertQQHeartbeatSequence(t, client, 4)
			feed.mu.Lock()
			if len(feed.events) != 2 || feed.events[0].id != "replayed-1" || feed.events[1].id != "replayed-2" || feed.qqSequence != 4 {
				t.Error("pre-RESUMED messages did not commit in order")
			}
			feed.mu.Unlock()
			// A message must not synthesize readiness: the actual RESUMED is
			// still accepted, and another message then commits on this socket.
			if err := client.WriteJSON(map[string]any{"op": 0, "s": 5, "t": "RESUMED"}); err != nil {
				t.Fatal(err)
			}
			if err := client.WriteJSON(qqReplayFrame(eventType, "continued", 6, "private-body")); err != nil {
				t.Fatal(err)
			}
			assertQQHeartbeatSequence(t, client, 6)
			frame := []byte(`{"op":987654,"t":"private-event","d":"private-body"}`)
			if err := client.WriteMessage(websocket.TextMessage, frame); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-results:
				if publicAdapterError(err) != "INTEGRATION_QQ_FRAME_INVALID" {
					t.Fatal("unknown opcode no longer rejected", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("socket did not terminate")
			}
			record := assertQQRejectionLog(t, output.Bytes(), "unsupported_opcode", "other", "other", "absent", "none", len(frame))
			if record["ready"] != true || record["resume_requested"] != true {
				t.Fatal("actual RESUMED state lost")
			}
			feed.mu.Lock()
			if len(feed.events) != 3 || feed.events[2].id != "continued" || feed.qqSequence != 6 || feed.qqSession != "private-session" {
				t.Error("resumed socket lost committed messages or session")
			}
			feed.mu.Unlock()
		})
	}
}

func TestQQActualWebSocketResumeRejectedMessageCannotAdvanceSequence(t *testing.T) {
	for _, failure := range []string{"id", "content-bounds", "encoded-event-bounds", "missing-sequence", "negative-sequence", "cancel", "revoke", "generation", "invalid-session", "lifecycle-cancel", "lifecycle-revoke", "lifecycle-generation"} {
		t.Run(failure, func(t *testing.T) {
			s, feed, call, client, results, _ := qqResumeSocketFixture(t)
			frame := qqReplayFrame("C2C_MESSAGE_CREATE", "replayed", 3, "private-body")
			reason := "INTEGRATION_QQ_EVENT_INVALID"
			if strings.HasPrefix(failure, "lifecycle-") {
				frame = map[string]any{"op": 0, "s": 3, "t": "C2C_MSG_RECEIVE", "d": "private-body"}
				reason = "INTEGRATION_SCOPE_ENDED"
				if failure == "lifecycle-generation" {
					current := call.target
					current.CredentialGeneration++
					if err := s.saveTarget(context.Background(), current); err != nil {
						t.Fatal(err)
					}
				} else {
					stopPublication(t, s, call, strings.TrimPrefix(failure, "lifecycle-"), nil)
				}
			}
			switch failure {
			case "id":
				frame["d"].(map[string]any)["id"] = ""
			case "content-bounds":
				frame["d"].(map[string]any)["content"] = strings.Repeat("x", 32769)
			case "encoded-event-bounds":
				frame["d"].(map[string]any)["content"] = strings.Repeat("🌏", 32768)
				reason = "INTEGRATION_EVENT_BOUNDS"
			case "missing-sequence":
				delete(frame, "s")
				reason = "INTEGRATION_QQ_FRAME_INVALID"
			case "negative-sequence":
				frame["s"] = -1
				reason = "INTEGRATION_QQ_FRAME_INVALID"
			case "cancel", "revoke":
				stopPublication(t, s, call, failure, nil)
			case "generation":
				current := call.target
				current.CredentialGeneration++
				if err := s.saveTarget(context.Background(), current); err != nil {
					t.Fatal(err)
				}
			case "invalid-session":
				frame = map[string]any{"op": 9, "d": false}
				reason = "INTEGRATION_QQ_SESSION_INVALID"
			}
			if err := client.WriteJSON(frame); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-results:
				if failure == "cancel" || failure == "revoke" || failure == "generation" {
					if !errors.Is(err, context.Canceled) {
						t.Fatal("stopped scope escaped protected feed commit", err)
					}
				} else if publicAdapterError(err) != reason {
					t.Fatal("wrong rejection", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("failed replay did not terminate")
			}
			feed.mu.Lock()
			if len(feed.events) != 0 || feed.qqSequence != 2 {
				t.Error("failed replay advanced the feed or QQ sequence")
			}
			if failure == "invalid-session" && (feed.qqHasSequence || feed.qqSession != "") {
				t.Error("invalid session still eligible for Resume")
			}
			feed.mu.Unlock()
		})
	}
}

func TestQQActualWebSocketResumeInterleavesSubscribedLifecycleWithoutMessagesOrReadiness(t *testing.T) {
	for _, eventType := range []string{"GROUP_ADD_ROBOT", "GROUP_DEL_ROBOT", "GROUP_MSG_REJECT", "GROUP_MSG_RECEIVE", "FRIEND_ADD", "FRIEND_DEL", "C2C_MSG_REJECT", "C2C_MSG_RECEIVE"} {
		t.Run(eventType, func(t *testing.T) {
			_, feed, _, client, results, output := qqResumeSocketFixture(t)
			frames := []any{
				map[string]any{"op": 0, "s": 3, "t": eventType, "d": "private-body"},
				qqReplayFrame("C2C_MESSAGE_CREATE", "first", 4, "private-body"),
				map[string]any{"op": 0, "s": 5, "t": eventType, "d": "private-body"},
				qqReplayFrame("C2C_MESSAGE_CREATE", "second", 6, "private-body"),
			}
			for _, frame := range frames {
				if err := client.WriteJSON(frame); err != nil {
					t.Fatal(err)
				}
			}
			assertQQHeartbeatSequence(t, client, 6)
			feed.mu.Lock()
			if len(feed.events) != 2 || feed.events[0].id != "first" || feed.events[1].id != "second" {
				t.Error("lifecycle dispatch became a fake message or blocked replay")
			}
			feed.mu.Unlock()
			if err := client.WriteJSON(map[string]any{"op": 0, "s": 7, "t": "RESUMED"}); err != nil {
				t.Fatal(err)
			}
			if err := client.WriteJSON(qqReplayFrame("C2C_MESSAGE_CREATE", "continued", 8, "private-body")); err != nil {
				t.Fatal(err)
			}
			assertQQHeartbeatSequence(t, client, 8)
			frame := []byte(`{"op":987654,"t":"private-event","d":"private-body"}`)
			if err := client.WriteMessage(websocket.TextMessage, frame); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-results:
				if publicAdapterError(err) != "INTEGRATION_QQ_FRAME_INVALID" {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("socket did not terminate")
			}
			record := assertQQRejectionLog(t, output.Bytes(), "unsupported_opcode", "other", "other", "absent", "none", len(frame))
			if record["ready"] != true {
				t.Fatal("real RESUMED failed after lifecycle replay")
			}
			feed.mu.Lock()
			if len(feed.events) != 3 || feed.events[2].id != "continued" || feed.qqSequence != 8 {
				t.Error("continued message or committed sequence lost")
			}
			feed.mu.Unlock()
		})
	}
}
