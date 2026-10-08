package integration

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestWeixinTranscriptAndBoundedOldReferenceFacts(t *testing.T) {
	_, feed, call := feedFixture(t)
	item := weixinItem{Type: 3, Reference: json.RawMessage(`{"svr_id":"18446744073709551615","title":"真实摘要","message_item":{"type":1,"text_item":{"text":"旧原文😀"},"ref_msg":{"svr_id":"nested-not-followed"}},"partial_text":{"start":"旧","end":"😀","startindex":0,"endindex":4,"quotemd5":"supplied-metadata"}}`)}
	item.Voice.Text = "平台转录原文😀"
	if err := feed.acceptWeixin(call.ctx, call.target, weixinCredential{}, weixinMessage{ID: json.Number("18446744073709551614"), From: "specified", Context: "private-context", Items: []weixinItem{item}}); err != nil {
		t.Fatal(err)
	}
	var event nativeMessage
	if json.Unmarshal(feed.events[0].payload, &event) != nil || len(event.Segments) != 1 || event.Segments[0]["text"] != item.Voice.Text || event.Segments[0]["origin"] != "platform-transcription" {
		t.Fatal(string(feed.events[0].payload))
	}
	if len(event.References) != 1 || event.References[0].MessageID != "18446744073709551615" || event.References[0].Text != "旧原文😀" || event.References[0].ContentStatus != "text-provided" || event.References[0].PartialText.QuoteMD5 != "supplied-metadata" {
		t.Fatal(event.References)
	}
	if strings.Contains(string(feed.events[0].payload), "nested-not-followed") || strings.Contains(string(feed.events[0].payload), "private-context") {
		t.Fatal("nested/private source escaped")
	}
	for _, test := range []struct{ raw, id, status, text, title string }{
		{`{"svr_id":"id-only","title":"摘要"}`, "id-only", "not-provided", "", "摘要"},
		{`{"svr_id":"empty-item","title":"摘要","message_item":{}}`, "empty-item", "not-provided", "", "摘要"},
		{`{"svr_id":"18446744073709551615","title":"真实摘要","message_item":{"type":0,"msg_id":"ignored-fallback","text_item":{"text":"untyped-not-body"},"ref_msg":{"svr_id":"nested-not-followed"}}}`, "18446744073709551615", "not-provided", "", "真实摘要"},
		{`{"message_item":{"type":0,"msg_id":"supplied-item-id"}}`, "supplied-item-id", "not-provided", "", ""},
		{`{"title":"摘要","message_item":{"type":1,"msg_id":"quoted-text","text_item":{"text":"旧原文😀"}}}`, "quoted-text", "text-provided", "旧原文😀", "摘要"},
		{`{"message_item":{"type":4,"msg_id":"supplied-item-id","file_item":{"file_name":"中文附件.txt","media":{"aes_key":"private","full_url":"https://private.invalid"}}}}`, "supplied-item-id", "media-metadata-only", "", ""},
		{`{"message_item":{"type":11}}`, "", "unsupported", "", ""},
		{`{"svr_id":"unknown-type","title":"摘要","message_item":{"type":99,"text_item":{"text":"untyped-not-body"}}}`, "unknown-type", "unsupported", "", "摘要"},
	} {
		ref, err := weixinReference(json.RawMessage(test.raw))
		if err != nil || ref.MessageID != test.id || ref.ContentStatus != test.status || ref.Text != test.text || ref.Title != test.title {
			t.Fatal(ref, err)
		}
		serialized := schemaJSON(ref)
		if strings.Contains(serialized, "private") || strings.Contains(serialized, "nested-not-followed") || strings.Contains(serialized, "untyped-not-body") {
			t.Fatal("private, nested or untyped quote material escaped", serialized)
		}
	}
	if _, err := weixinReference(json.RawMessage(`{"message_item":{"type":1,"text_item":{"text":"` + strings.Repeat("x", 32769) + `"}}}`)); err == nil {
		t.Fatal("oversized quote accepted")
	}
	if _, err := weixinReference(json.RawMessage(`{"partial_text":{"startindex":2,"endindex":1}}`)); err == nil {
		t.Fatal("invalid selected range accepted")
	}
	if err := feed.acceptWeixin(call.ctx, call.target, weixinCredential{}, weixinMessage{From: "specified", Context: "private-context", Items: []weixinItem{{Type: 1}}}); err != nil {
		t.Fatal("missing native ID was replaced by failure", err)
	}
	var missing nativeMessage
	if json.Unmarshal(feed.events[1].payload, &missing) != nil || missing.MessageID != "" || missing.EventID == "" {
		t.Fatal("invented native identifier", missing)
	}
}
