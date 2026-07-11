package runtimeagent

import (
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func testPublicChatCommittedTranscript(pairs ...[2]string) []publicChatCommittedTranscriptTurn {
	transcript := make([]publicChatCommittedTranscriptTurn, 0, len(pairs))
	for index, pair := range pairs {
		transcript = append(transcript, publicChatCommittedTranscriptTurn{
			TurnID:        fmt.Sprintf("test-committed-turn-%d", index),
			Sequence:      uint64(index),
			Origin:        publicChatTurnOriginUser,
			InputText:     pair[0],
			AssistantText: pair[1],
		})
	}
	return transcript
}

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
