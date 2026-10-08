package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestFeishuInboundChatRoutingAndMessageDedupRetainOriginalRefs(t *testing.T) {
	for _, chatType := range []string{"p2p", "group"} {
		t.Run(chatType, func(t *testing.T) {
			chatID := "actual-chat-" + chatType
			var creates, replies int
			s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				if strings.Contains(req.URL.Path, "tenant_access_token") {
					return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "private-token", "expire": 7200}), nil
				}
				var body map[string]any
				if json.NewDecoder(req.Body).Decode(&body) != nil {
					t.Error("invalid actual SDK message body")
				}
				switch req.URL.Path {
				case "/open-apis/im/v1/messages":
					creates++
					if req.URL.Query().Get("receive_id_type") != "chat_id" || body["receive_id"] != chatID {
						t.Error("received chat was rewritten as an open_id recipient")
					}
				case "/open-apis/im/v1/messages/native-one/reply":
					replies++
				default:
					t.Error("unexpected SDK route", req.URL.Path)
				}
				return jsonResponse(map[string]any{"code": 0, "data": map[string]string{"message_id": "actual-created"}}), nil
			}))
			value := seedNativeMediaSource(t, s, "feishu", []byte("fixture"))
			call := admittedNativePhaseCall(t, s, testDecision("consumer", 1), value, operation(value, "feishu.updates.read"))
			feed := newNativeFeed()
			feed.readers = 1
			feed.leases[call] = struct{}{}
			feed.publish = func(commit func() error) error { return s.commitNativeFeed(feed, commit) }
			s.nativeReceivers[value.Public.TargetRef].feed = feed
			payload := func(eventID, messageID, imageKey string) []byte {
				return []byte(schemaJSON(map[string]any{"header": map[string]any{"app_id": "cli_fixture", "event_type": "im.message.receive_v1", "event_id": eventID}, "event": map[string]any{"sender": map[string]any{"sender_id": map[string]string{"open_id": "actual-sender"}}, "message": map[string]any{"message_id": messageID, "chat_id": chatID, "chat_type": chatType, "message_type": "image", "content": schemaJSON(map[string]string{"image_key": imageKey})}}}))
			}
			if err := feed.acceptFeishu(call.ctx, value, payload("original-envelope", "native-one", "original-image")); err != nil {
				t.Fatal(err)
			}
			original := append([]byte(nil), feed.events[0].payload...)
			var first nativeMessage
			if json.Unmarshal(original, &first) != nil || first.EventID != "original-envelope" || first.Conversation != (nativeConversation{Kind: "chat", ID: chatID}) || first.SenderID != "actual-sender" {
				t.Fatal("incoming conversation or actual envelope identity was lost")
			}
			mediaRef := first.Segments[0]["mediaRef"].(string)
			for _, envelope := range []string{"redelivery-envelope", "another-envelope"} {
				if err := feed.acceptFeishu(call.ctx, value, payload(envelope, "native-one", "changed-image")); err != nil {
					t.Fatal(err)
				}
			}
			if feed.next != 1 || len(feed.events) != 1 || string(feed.events[0].payload) != string(original) {
				t.Fatal("message redelivery advanced the cursor or replaced retained refs")
			}
			media, err := s.nativeSource(value, mediaRef)
			if err != nil || !strings.Contains(string(media.Media), "original-image") {
				t.Fatal("original media ref changed on redelivery", err)
			}
			// The envelope ID is data, not the Feishu dedup key.
			if err := feed.acceptFeishu(call.ctx, value, payload("original-envelope", "native-two", "second-image")); err != nil {
				t.Fatal(err)
			}
			if feed.next != 2 || len(feed.events) != 2 {
				t.Fatal("a distinct native message was deduplicated by envelope ID")
			}
			var second nativeMessage
			if json.Unmarshal(feed.events[1].payload, &second) != nil || second.EventID != "original-envelope" || second.MessageID != "native-two" || second.ReplyRef == first.ReplyRef {
				t.Fatal("distinct message lost its actual envelope or independent refs")
			}
			// Dedup is bounded by retained events; there is no eternal receipt set.
			feed.mu.Lock()
			feed.events[0].received = time.Now().Add(-25 * time.Hour)
			feed.pruneLocked(time.Now())
			feed.mu.Unlock()
			if err := feed.acceptFeishu(call.ctx, value, payload("after-expiry", "native-one", "new-image")); err != nil {
				t.Fatal(err)
			}
			if feed.next != 3 || len(feed.events) != 2 {
				t.Fatal("retention expiry left an unbounded message dedup record")
			}
			var retained nativeMessage
			json.Unmarshal(feed.events[1].payload, &retained)
			grantTestTarget(t, s, call.decision, value.Public.TargetRef, "feishu.updates.read", "feishu.messages.send", "feishu.messages.reply")
			for _, op := range []string{"send", "reply"} {
				input := map[string]any{"body": map[string]string{"kind": "text", "text": "one explicit message"}}
				if op == "send" {
					input["conversation"] = retained.Conversation
				} else {
					input["replyRef"] = retained.ReplyRef
				}
				id := invokeTestCall(t, s, call.decision, value.Public.TargetRef, "feishu.messages."+op, schemaJSON(input))
				fact := waitTestCall(t, s, call.decision, id)
				if fact.Status != "completed" || !strings.Contains(fact.ResultJson, "actual-created") {
					t.Fatal("actual SDK route did not record its native result", fact)
				}
			}
			if creates != 1 || replies != 1 {
				t.Fatal("message route retried or failed to dispatch exactly once")
			}
		})
	}
}

func TestNativeConnectionDescriptorsComeFromCurrentRuntime(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	target := seedNativeMediaSource(t, s, "feishu", []byte("fixture"))
	target.Public.Operations = nil
	if err := s.saveTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	current, err := s.loadTarget(context.Background(), target.Account, target.Public.TargetRef)
	if err != nil || operation(current, "feishu.updates.read") == nil {
		t.Fatal("saved row displaced Runtime descriptors", current, err)
	}
	for _, path := range []string{"invoke", "catalog"} {
		ops := current.Public.Operations
		if path == "catalog" {
			catalog, err := s.targets(context.Background(), testDecision("consumer", 1))
			if err != nil || len(catalog) != 1 {
				t.Fatal(catalog, err)
			}
			ops = catalog[0].Operations
		}
		for _, op := range ops {
			if op.Name == "feishu.updates.read" && !strings.Contains(op.OutputSchemaJson, `"relation"`) {
				t.Fatal("reply relationship missing from current schema", path)
			}
		}
	}
	var raw string
	if err := s.backend.DB().QueryRow(`SELECT config_json FROM runtime_integration_target WHERE target_ref=?`, target.Public.TargetRef).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, "feishu.updates.read") {
		t.Fatal("projection migrated stored connection")
	}
}

func TestFeishuMentionOrderAndRealReplyRelationshipsReachValidatedFeed(t *testing.T) {
	for _, rich := range []bool{false, true} {
		t.Run(map[bool]string{false: "text", true: "post"}[rich], func(t *testing.T) {
			s := newIntegrationTestService(t, nil)
			target := seedNativeMediaSource(t, s, "feishu", []byte("fixture"))
			call := admittedNativePhaseCall(t, s, testDecision("consumer", 1), target, operation(target, "feishu.updates.read"))
			feed := newNativeFeed()
			feed.readers = 1
			feed.leases[call] = struct{}{}
			feed.publish = func(commit func() error) error { return s.commitNativeFeed(feed, commit) }
			content := `{"text":"你好 @_user_2，然后 @_user_1！@_user_10"}`
			kind := "text"
			if rich {
				kind = "post"
				content = `{"content":[[{"tag":"text","text":"你好 "},{"tag":"at","user_id":"@_user_2"},{"tag":"text","text":"，然后 "},{"tag":"at","user_id":"ou_first"},{"tag":"text","text":"！@_user_10"}]]}`
			}
			payload := schemaJSON(map[string]any{"header": map[string]any{"app_id": "cli_fixture", "event_type": "im.message.receive_v1", "event_id": "event"}, "event": map[string]any{"sender": map[string]any{"sender_id": map[string]string{"open_id": "specified"}}, "message": map[string]any{"message_id": "current", "parent_id": "actual-parent", "root_id": "actual-root", "chat_id": "chat", "chat_type": "p2p", "message_type": kind, "content": content, "mentions": []any{map[string]any{"key": "@_user_1", "id": map[string]string{"open_id": "ou_first"}, "name": "一"}, map[string]any{"key": "@_user_2", "id": map[string]string{"open_id": "ou_second"}, "name": "二"}}}}})
			if err := feed.acceptFeishu(call.ctx, target, []byte(payload)); err != nil {
				t.Fatal(err)
			}
			cursor := feed.cursor(nativeBinding(call.decision, target, []string{"chat:chat"}), 0)
			result, err := feed.read(call.ctx, call.decision, target, []string{"chat:chat"}, cursor, 0)
			if err != nil {
				t.Fatal(err)
			}
			var page struct{ Events []nativeMessage }
			if json.Unmarshal([]byte(result), &page) != nil || len(page.Events) != 1 {
				t.Fatal(result)
			}
			event := page.Events[0]
			want := []map[string]any{{"kind": "text", "text": "你好 "}, {"kind": "mention", "id": "ou_second", "displayName": "二"}, {"kind": "text", "text": "，然后 "}, {"kind": "mention", "id": "ou_first", "displayName": "一"}, {"kind": "text", "text": "！@_user_10"}}
			if !reflect.DeepEqual(event.Segments, want) {
				t.Fatal("mention association/order or rich-text duplication", event.Segments)
			}
			if len(event.References) != 2 || event.References[0].MessageID != "actual-parent" || event.References[0].Relation != "parent" || event.References[1].MessageID != "actual-root" || event.References[1].Relation != "root" {
				t.Fatal(event.References)
			}
			for _, reference := range event.References {
				if reference.Text != "" || reference.ContentStatus != "not-provided" {
					t.Fatal("old content fabricated", reference)
				}
			}
			if event.ReplyRef == "actual-parent" || event.ReplyRef == "actual-root" || event.ReplyRef == "" {
				t.Fatal("current reply capability misrepresents old reference")
			}
		})
	}
}

func TestFeishuMentionNormalizationIsBoundedAndDoesNotInventMappings(t *testing.T) {
	var values []feishuMention
	if err := json.Unmarshal([]byte(`[{"key":"@_user_1","id":{"open_id":"ou_one"},"name":"一"}]`), &values); err != nil {
		t.Fatal(err)
	}
	index, err := feishuMentionIndex(values)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"literal @_user_10", "普通文本😀"} {
		segments, err := feishuTextSegments(text, index)
		if err != nil || len(segments) != 1 || segments[0]["text"] != text {
			t.Fatal(segments, err)
		}
	}
	segments, err := feishuTextSegments("@_user_1 / @_user_1", index)
	if err != nil || len(segments) != 3 || segments[0]["id"] != "ou_one" || segments[2]["id"] != "ou_one" {
		t.Fatal("repeated actual positions lost", segments, err)
	}
	if _, err := feishuTextSegments(strings.Repeat("@_user_1 ", 40), index); err == nil {
		t.Fatal("normalized segment bound escaped")
	}
	values = append(values, values[0])
	values[1].ID.OpenID = "ou_other"
	if _, err := feishuMentionIndex(values); err == nil {
		t.Fatal("ambiguous key identity accepted")
	}
	if _, _, err := feishuPostSegments(`{"content":[[{"tag":"at","user_id":"@_user_99"}]]}`, nativeSource{}, index); err == nil {
		t.Fatal("placeholder invented as actual user")
	}
}
