package runtimeagent

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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
