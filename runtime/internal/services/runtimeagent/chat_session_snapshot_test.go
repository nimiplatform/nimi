package runtimeagent

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatMessageEnvelopePayloadsOwnReplayIdentityAndParentBinding(t *testing.T) {
	payloads := publicChatMessageEnvelopePayloads(
		[]*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
			{Role: "assistant", Content: "hi"},
			{Role: "user", Content: "next"},
		},
		"anchor-1",
		time.Unix(5, 0).UTC(),
		time.Unix(5, 0).UTC(),
	)

	if got := len(payloads); got != 3 {
		t.Fatalf("expected three replay payloads, got=%d", got)
	}
	assistant, ok := payloads[1].(map[string]any)
	if !ok {
		t.Fatalf("expected replay payload map, got=%T", payloads[1])
	}
	if got := assistant["id"]; got != "anchor-1:transcript:1" {
		t.Fatalf("expected Runtime-owned assistant replay id, got=%v", got)
	}
	if got := assistant["parent_message_id"]; got != "anchor-1:transcript:0" {
		t.Fatalf("expected Runtime-owned assistant parent binding, got=%v", got)
	}
	if got := assistant["status"]; got != "complete" {
		t.Fatalf("expected Runtime-owned replay status, got=%v", got)
	}
	if got := assistant["kind"]; got != "text" {
		t.Fatalf("expected Runtime-owned replay kind, got=%v", got)
	}
	if got := assistant["created_at"]; got != "1970-01-01T00:00:05.001Z" {
		t.Fatalf("expected Runtime-owned replay timestamp, got=%v", got)
	}
}

func TestReconcilePublicChatSessionTranscriptDoesNotDuplicateIncomingAroundCommittedAssistant(t *testing.T) {
	current := []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "previous runtime reply"},
		{Role: "user", Content: "new user message"},
	}
	incoming := []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
		{Role: "user", Content: "new user message"},
	}

	merged := reconcilePublicChatSessionTranscript(current, incoming)

	if got := len(merged); got != 3 {
		t.Fatalf("expected no duplicate incoming user message, got len=%d merged=%v", got, merged)
	}
	if got := merged[1].GetContent(); got != "previous runtime reply" {
		t.Fatalf("expected committed assistant to remain at index 1, got=%q merged=%v", got, merged)
	}
	if got := merged[2].GetContent(); got != "new user message" {
		t.Fatalf("expected existing latest user message to remain at index 2, got=%q merged=%v", got, merged)
	}
}

func TestReconcilePublicChatSessionTranscriptAppendsOnlyNewIncomingAfterCommittedAssistant(t *testing.T) {
	current := []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "previous runtime reply"},
		{Role: "user", Content: "new user message"},
	}
	incoming := []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
		{Role: "user", Content: "new user message"},
		{Role: "user", Content: "follow-up user message"},
	}

	merged := reconcilePublicChatSessionTranscript(current, incoming)

	if got := len(merged); got != 4 {
		t.Fatalf("expected one new incoming message appended, got len=%d merged=%v", got, merged)
	}
	if got := merged[3].GetContent(); got != "follow-up user message" {
		t.Fatalf("expected only unmatched incoming user message appended, got=%q merged=%v", got, merged)
	}
}
