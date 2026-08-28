package runtimeagent

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestOptionalMemoryDoesNotRejectValidLargeConversationTurn(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	large := strings.Repeat("界", 6*1024) // 18 KiB UTF-8; Conversation admits up to 64 KiB.
	for _, turn := range []struct{ input, assistant string }{{large, "committed reply"}, {"next user turn", large}} {
		if err := svc.commitPublicChatTurnTranscript(anchorID, &runtimev1.ChatMessage{Role: "user", Content: turn.input}, turn.assistant); err != nil {
			t.Fatalf("valid Conversation turn was rolled back by optional Memory: %v", err)
		}
	}
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	transcript := svc.chatAnchors[anchorID].CommittedTranscript
	if len(transcript) != 2 || transcript[0].InputText != large || transcript[0].AssistantText != "committed reply" || transcript[1].AssistantText != large {
		t.Fatalf("valid large Conversation turn was not committed: %+v", transcript)
	}
}
