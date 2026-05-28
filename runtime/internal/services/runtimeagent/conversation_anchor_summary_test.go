package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestListAgentConversationSummariesProjectsRuntimeOwnedAnchors(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	oldAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	newAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	otherAppAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "web.app", "user-1")

	oldUpdatedAt := time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC)
	newUpdatedAt := time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC)
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[oldAnchorID].Transcript = []*runtimev1.ChatMessage{
		{Role: "user", Content: "Older prompt from runtime owned transcript"},
		{Role: "assistant", Content: "Older assistant reply"},
	}
	svc.chatAnchors[oldAnchorID].LastMessageID = "message-old"
	svc.chatAnchors[oldAnchorID].UpdatedAt = oldUpdatedAt
	svc.chatAnchors[newAnchorID].Transcript = []*runtimev1.ChatMessage{
		{Role: "user", Content: "Newer prompt from runtime owned transcript"},
		{Role: "assistant", Content: "Newer assistant reply"},
	}
	svc.chatAnchors[newAnchorID].LastMessageID = "message-new"
	svc.chatAnchors[newAnchorID].UpdatedAt = newUpdatedAt
	svc.chatAnchors[otherAppAnchorID].Transcript = []*runtimev1.ChatMessage{
		{Role: "user", Content: "Other app prompt"},
	}
	svc.chatAnchors[otherAppAnchorID].UpdatedAt = newUpdatedAt.Add(time.Hour)
	svc.chatSurfaceMu.Unlock()

	ctx := testLocalAgentContext("user-1", "agent-alpha")
	ctx.AppId = "desktop.app"
	resp, err := svc.ListAgentConversationSummaries(context.Background(), &runtimev1.ListAgentConversationSummariesRequest{
		Context:      ctx,
		AgentId:      ctx.GetLocalAgentRef(),
		StatusFilter: []runtimev1.ConversationAnchorStatus{runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE},
		PageSize:     1,
	})
	if err != nil {
		t.Fatalf("ListAgentConversationSummaries: %v", err)
	}
	if got := len(resp.GetSummaries()); got != 1 {
		t.Fatalf("expected one paged summary, got %d", got)
	}
	first := resp.GetSummaries()[0]
	if first.GetAnchor().GetConversationAnchorId() != newAnchorID {
		t.Fatalf("expected newest desktop anchor first, got %q", first.GetAnchor().GetConversationAnchorId())
	}
	if first.GetTitle() != "Newer prompt from runtime owned transcript" {
		t.Fatalf("expected title derived from first user message, got %q", first.GetTitle())
	}
	if first.GetLastMessageRole() != "assistant" || first.GetLastMessageText() != "Newer assistant reply" {
		t.Fatalf("unexpected last message projection: role=%q text=%q", first.GetLastMessageRole(), first.GetLastMessageText())
	}
	if first.GetLastMessageId() != "message-new" || first.GetTranscriptMessageCount() != 2 {
		t.Fatalf("unexpected transcript summary: id=%q count=%d", first.GetLastMessageId(), first.GetTranscriptMessageCount())
	}
	if first.GetUpdatedAt().AsTime() != newUpdatedAt {
		t.Fatalf("unexpected updated_at: got %s want %s", first.GetUpdatedAt().AsTime(), newUpdatedAt)
	}
	if resp.GetNextPageToken() != "1" {
		t.Fatalf("expected next page token 1, got %q", resp.GetNextPageToken())
	}

	nextResp, err := svc.ListAgentConversationSummaries(context.Background(), &runtimev1.ListAgentConversationSummariesRequest{
		Context:   ctx,
		AgentId:   ctx.GetLocalAgentRef(),
		PageSize:  1,
		PageToken: resp.GetNextPageToken(),
	})
	if err != nil {
		t.Fatalf("ListAgentConversationSummaries page 2: %v", err)
	}
	if got := len(nextResp.GetSummaries()); got != 1 {
		t.Fatalf("expected one second-page summary, got %d", got)
	}
	if got := nextResp.GetSummaries()[0].GetAnchor().GetConversationAnchorId(); got != oldAnchorID {
		t.Fatalf("expected older desktop anchor on second page, got %q", got)
	}
	if nextResp.GetNextPageToken() != "" {
		t.Fatalf("expected final page to omit token, got %q", nextResp.GetNextPageToken())
	}
}

func TestListAgentConversationSummariesRejectsMalformedPageToken(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := testLocalAgentContext("user-1", "agent-alpha")
	ctx.AppId = "desktop.app"
	_, err := svc.ListAgentConversationSummaries(context.Background(), &runtimev1.ListAgentConversationSummariesRequest{
		Context:   ctx,
		AgentId:   ctx.GetLocalAgentRef(),
		PageToken: "not-an-offset",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for malformed page_token, got %v", err)
	}
}
