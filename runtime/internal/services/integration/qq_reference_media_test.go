package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

func qqReferenceFrame(attachments []qqAttachment) map[string]any {
	return map[string]any{"id": "current-message", "content": "current text", "message_type": 103,
		"group_openid": "specified-group", "author": map[string]string{"member_openid": "specified-author"},
		"msg_elements": []any{map[string]any{"msg_idx": "not-a-native-id", "attachments": attachments,
			"msg_elements": []any{map[string]any{"content": "nested-not-followed"}}},
			map[string]any{"content": "second-reference-not-followed"}}}
}

func TestQQReferenceMediaProjectionAndBounds(t *testing.T) {
	valid := qqAttachment{Type: "application/octet-stream", Name: "中文引用文件.txt", URL: "//multimedia.nt.qq.com.cn/file?key=PRIVATE_KEY", Size: 390084}
	for _, name := range []string{"available", "missing", "rejected", "url-bound", "size-bound", "name-bound", "type-bound", "media-limit", "total-media", "private-bytes", "public-bytes"} {
		t.Run(name, func(t *testing.T) {
			s, feed, lease := feedFixture(t)
			attachment := valid
			switch name {
			case "missing":
				attachment.URL = " \t"
			case "rejected":
				attachment.URL = "https://foreign.invalid/private?key=PRIVATE_KEY"
			case "url-bound":
				attachment.URL = strings.Repeat("x", 8193)
			case "size-bound":
				attachment.Size = maxMediaBytes + 1
			case "name-bound":
				attachment.Name = strings.Repeat("x", 256)
			case "type-bound":
				attachment.Type = strings.Repeat("x", 129)
			}
			frame := qqReferenceFrame([]qqAttachment{attachment})
			if name == "media-limit" || name == "total-media" || name == "private-bytes" {
				items := make([]qqAttachment, 64)
				for i := range items {
					items[i] = valid
					if name == "private-bytes" {
						items[i].URL = "https://fixture.qq.com/" + strings.Repeat("x", 1500)
					}
				}
				frame = qqReferenceFrame(items)
				if name == "total-media" {
					frame["attachments"] = []qqAttachment{valid}
				}
			}
			if name == "public-bytes" {
				frame["content"] = strings.Repeat("字", 24000)
			}
			err := s.acceptQQMessage(lease.ctx, feed, "GROUP_AT_MESSAGE_CREATE", []byte(schemaJSON(frame)))
			if name != "available" && name != "media-limit" && name != "missing" && name != "rejected" {
				if err == nil || len(feed.events) != 0 {
					t.Fatal("excess material committed", name, err)
				}
				return
			}
			if err != nil || len(feed.events) != 1 {
				t.Fatal(err)
			}
			if name == "media-limit" {
				if len(feed.events[0].sources) != 65 {
					t.Fatal("exact 64 media bound rejected or sources missing")
				}
				return
			}
			var event nativeMessage
			if json.Unmarshal(feed.events[0].payload, &event) != nil || len(event.References) != 1 || len(event.References[0].Media) != 1 {
				t.Fatal("reference ownership missing")
			}
			ref, media := event.References[0], event.References[0].Media[0]
			if ref.MessageID != "" || media.FileName != valid.Name || media.Kind != "file" || len(event.Segments) != 1 {
				t.Fatal("invented original identity or promoted reference to current attachment")
			}
			if strings.Contains(string(feed.events[0].payload), "PRIVATE_KEY") || strings.Contains(string(feed.events[0].payload), "nested-not-followed") || strings.Contains(string(feed.events[0].payload), "second-reference-not-followed") {
				t.Fatal("private or recursive material escaped")
			}
			if name == "available" {
				if ref.ContentStatus != "media-provided" || media.MediaRef == "" || media.MediaRef == event.ReplyRef || len(feed.events[0].sources) != 2 {
					t.Fatal("independent media capability missing")
				}
				source := feed.events[0].sources[media.MediaRef]
				if source.MessageID != "" || source.QQReplies != nil || source.MediaKind != "file" || source.Conversation != event.Conversation {
					t.Fatal("quote inherited current reply identity")
				}
			} else if media.MediaRef != "" || media.UnavailableReason != map[string]string{"missing": "source-not-provided", "rejected": "source-rejected"}[name] || len(feed.events[0].sources) != 1 {
				t.Fatal("unavailable source manufactured a capability")
			}
		})
	}
}

// Actual public invocation, asset candidate and committed AssetStore bytes;
// this isolated protocol fixture is not live QQ product acceptance.
func TestQQReferencePublicFetchPreservesBytesAndFinalGuard(t *testing.T) {
	plain := bytes.Repeat([]byte("a"), 390084)
	for _, outcome := range []string{"publish", "cancel", "revoke", "expired", "size-mismatch"} {
		t.Run(outcome, func(t *testing.T) {
			var downloads atomic.Int32
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				downloads.Add(1)
				if req.Method != "GET" || req.URL.String() != "https://multimedia.nt.qq.com.cn/file?key=PRIVATE_KEY" || req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
					t.Error("download disclosed credentials or changed source")
				}
				status := 200
				if outcome == "expired" {
					status = 403
				}
				return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"text/plain; charset=utf-8"}}, Body: io.NopCloser(bytes.NewReader(plain))}, nil
			}))
			value, lease, _ := seedQQCall(t, s, nativeConversation{Kind: "group", ID: "specified-group"}, time.Now().UTC().Format(time.RFC3339Nano))
			feed := s.nativeReceivers[value.Public.TargetRef].feed
			size := int64(len(plain))
			if outcome == "size-mismatch" {
				size++
			}
			frame := qqReferenceFrame([]qqAttachment{{Type: "text/plain", Name: "中文引用文件.txt", URL: "//multimedia.nt.qq.com.cn/file?key=PRIVATE_KEY", Size: size}})
			if err := s.acceptQQMessage(lease.ctx, feed, "GROUP_AT_MESSAGE_CREATE", []byte(schemaJSON(frame))); err != nil {
				t.Fatal(err)
			}
			var event nativeMessage
			if json.Unmarshal(feed.events[len(feed.events)-1].payload, &event) != nil {
				t.Fatal("invalid event")
			}
			store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
			if err != nil {
				t.Fatal(err)
			}
			assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
			var once sync.Once
			release := func() { once.Do(func() { close(assets.release) }) }
			t.Cleanup(release)
			s.assets = assets
			grantTestTarget(t, s, lease.decision, value.Public.TargetRef, "qq-official.media.fetch")
			accepted, err := s.InvokeIntegrationCall(testContext(lease.decision, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "qq-official.media.fetch", InputJson: schemaJSON(map[string]string{"mediaRef": event.References[0].Media[0].MediaRef, "relativePath": "received/中文引用文件.txt"})})
			if err != nil {
				t.Fatal(err)
			}
			if outcome == "publish" || outcome == "cancel" || outcome == "revoke" {
				select {
				case <-assets.prepared:
				case <-time.After(3 * time.Second):
					t.Fatal("reference media never reached actual candidate")
				}
				if outcome != "publish" {
					s.mu.Lock()
					call := s.calls[accepted.Call.CallId]
					s.mu.Unlock()
					stopPublication(t, s, call, outcome, nil)
				}
			}
			release()
			done := make(chan struct{})
			go func() { s.workers.Wait(); close(done) }()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("reference fetch worker did not finish")
			}
			fact := waitTestCall(t, s, lease.decision, accepted.Call.CallId)
			owner := appstorage.ManagedOwner{AccountID: lease.decision.AccountID, RegisteredAppSubject: lease.decision.RegisteredAppSubject}
			page, err := store.List(context.Background(), owner, "received/", "", 10)
			if err != nil || downloads.Load() != 1 {
				t.Fatal("not one explicit download", err, downloads.Load())
			}
			if outcome == "publish" {
				if fact.Status != "completed" || len(page.Assets) != 1 || page.Assets[0].SizeBytes != 390084 || page.Assets[0].SHA256 != mediaDigest(plain) || !strings.Contains(fact.ResultJson, "transport-and-local-digest") {
					t.Fatal("actual committed bytes or provenance lost", fact)
				}
				stored, err := store.Open(context.Background(), owner, "received/中文引用文件.txt")
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(stored.Body)
				stored.Body.Close()
				if err != nil || !bytes.Equal(body, plain) {
					t.Fatal("reference bytes changed")
				}
			} else {
				if len(page.Assets) != 0 || fact.ResultJson != "" {
					t.Fatal("stopped/rejected quote created a final asset")
				}
				if outcome == "expired" && (fact.Status != "failed" || fact.ErrorCode != "INTEGRATION_MEDIA_DOWNLOAD_REJECTED") {
					t.Fatal("expired URL became success", fact)
				}
				if outcome == "size-mismatch" && (fact.Status != "failed" || fact.ErrorCode != "INTEGRATION_MEDIA_INTEGRITY_INVALID") {
					t.Fatal("mismatched file became success", fact)
				}
				if (outcome == "cancel" || outcome == "revoke") && fact.Status != "canceled" {
					t.Fatal("final stop lost", fact)
				}
			}
		})
	}
}

func TestQQReferenceCapabilitiesRejectPurposeScopeAndGenerationMixing(t *testing.T) {
	var requests atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		t.Error("invalid capability dispatched")
		return jsonResponse(map[string]any{}), nil
	}))
	value, lease, _ := seedQQCall(t, s, nativeConversation{Kind: "group", ID: "specified-group"}, time.Now().UTC().Format(time.RFC3339Nano))
	feed := s.nativeReceivers[value.Public.TargetRef].feed
	frame := qqReferenceFrame([]qqAttachment{{Type: "text/plain", Name: "quote.txt", URL: "https://fixture.qq.com/file"}})
	if err := s.acceptQQMessage(lease.ctx, feed, "GROUP_AT_MESSAGE_CREATE", []byte(schemaJSON(frame))); err != nil {
		t.Fatal(err)
	}
	var event nativeMessage
	json.Unmarshal(feed.events[len(feed.events)-1].payload, &event)
	mediaRef := event.References[0].Media[0].MediaRef
	for _, spec := range []struct {
		op    string
		input any
	}{
		{"qq-official.media.fetch", map[string]string{"mediaRef": event.ReplyRef, "relativePath": "received/wrong.txt"}},
		{"qq-official.messages.reply", map[string]any{"replyRef": mediaRef, "body": map[string]string{"kind": "text", "text": "wrong"}}},
		{"qq-official.messages.send", map[string]any{"contextRef": mediaRef, "conversation": event.Conversation, "body": map[string]string{"kind": "text", "text": "wrong"}}},
	} {
		grantTestTarget(t, s, lease.decision, value.Public.TargetRef, spec.op)
		accepted, err := s.InvokeIntegrationCall(testContext(lease.decision, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: spec.op, InputJson: schemaJSON(spec.input)})
		if err != nil {
			t.Fatal(err)
		}
		fact := waitTestCall(t, s, lease.decision, accepted.Call.CallId)
		if fact.Status != "failed" || fact.ErrorCode != "INTEGRATION_SOURCE_INVALID" {
			t.Fatal("purpose mixing accepted", fact)
		}
	}
	foreignTarget := value
	foreignTarget.Public = &runtimev1.IntegrationTarget{TargetRef: "another-target"}
	if _, err := s.nativeSourceFor(foreignTarget, mediaRef, true); err == nil {
		t.Fatal("foreign target source accepted")
	}
	changed := value
	changed.CredentialGeneration++
	if _, err := s.nativeSourceFor(changed, mediaRef, true); err == nil {
		t.Fatal("old generation source accepted")
	}
	foreign := lease.decision
	foreign.AccountID = "another-account"
	if _, err := s.InvokeIntegrationCall(testContext(foreign, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "qq-official.media.fetch", InputJson: schemaJSON(map[string]string{"mediaRef": mediaRef, "relativePath": "received/wrong.txt"})}); err == nil {
		t.Fatal("foreign account invoked source")
	}
	// A subject with no standing permission cannot retrieve this reference.
	if _, err := s.InvokeIntegrationCall(testContext(testDecision("unpermitted-app", 7), localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "qq-official.media.fetch", InputJson: schemaJSON(map[string]string{"mediaRef": mediaRef, "relativePath": "received/wrong.txt"})}); err == nil {
		t.Fatal("unpermitted subject invoked source")
	}
	if requests.Load() != 0 {
		t.Fatal("invalid reference caused external request")
	}
}
