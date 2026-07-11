package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestListAgentConversationSummariesProjectsRuntimeOwnedAnchorsAcrossApps(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	oldAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	newAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	otherAppAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "web.app", "user-1")
	if _, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{Context: testRuntimeAgentIdentityContext("agent-beta"), DisplayName: "Beta"}); err != nil {
		t.Fatalf("InitializeAgent beta: %v", err)
	}
	_ = openPublicChatTestAnchor(t, svc, "agent-beta", "desktop.app", "user-1")
	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-alpha"))
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	sourceSnapshot, found, err := svc.publicChatSourceSnapshotResolve(context.Background(), testRuntimeAgentLocalRef("agent-alpha"))
	if err != nil || !found {
		t.Fatalf("load test source snapshot: found=%v err=%v", found, err)
	}
	entry.Agent.SourceContextStatus = localAgentSourceContextStatus(sourceSnapshot)
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("persist test source status: %v", err)
	}

	oldUpdatedAt := time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC)
	newUpdatedAt := time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC)
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[oldAnchorID].CommittedTranscript = testPublicChatCommittedTranscript([2]string{"Older prompt from runtime owned transcript", "Older assistant reply"})
	svc.chatAnchors[oldAnchorID].LastMessageID = "message-old"
	svc.chatAnchors[oldAnchorID].UpdatedAt = oldUpdatedAt
	svc.chatAnchors[newAnchorID].CommittedTranscript = testPublicChatCommittedTranscript([2]string{"Newer prompt from runtime owned transcript", "Newer assistant reply"})
	svc.chatAnchors[newAnchorID].LastMessageID = "message-new"
	svc.chatAnchors[newAnchorID].LastTurnSnapshot = &publicChatTurnProjectionState{
		TurnID: "turn-new",
		ContextSummary: &runtimev1.AgentTurnContextSummary{
			SchemaVersion:       runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1,
			Ready:               true,
			State:               runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_READY,
			ReasonCode:          runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
			ContextContentHash:  strings.Repeat("a", 64),
			PromptHash:          strings.Repeat("b", 64),
			LocalAgentRef:       testRuntimeAgentLocalRef("agent-alpha"),
			TranscriptTurnCount: 1,
		},
	}
	svc.chatAnchors[newAnchorID].UpdatedAt = newUpdatedAt
	svc.chatAnchors[otherAppAnchorID].CommittedTranscript = testPublicChatCommittedTranscript([2]string{"Other app prompt", "Other app assistant"})
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
	if first.GetAnchor().GetConversationAnchorId() != otherAppAnchorID {
		t.Fatalf("expected newest anchor regardless of opening app, got %q", first.GetAnchor().GetConversationAnchorId())
	}
	if first.GetTitle() != "Other app prompt" {
		t.Fatalf("expected cross-app title derived from runtime transcript, got %q", first.GetTitle())
	}
	if first.GetLastMessageRole() != "assistant" || first.GetLastMessageText() != "Other app assistant" {
		t.Fatalf("unexpected last message projection: role=%q text=%q", first.GetLastMessageRole(), first.GetLastMessageText())
	}
	if first.GetLastMessageId() != "" || first.GetTranscriptMessageCount() != 2 {
		t.Fatalf("unexpected transcript summary: id=%q count=%d", first.GetLastMessageId(), first.GetTranscriptMessageCount())
	}
	if first.GetUpdatedAt().AsTime() != newUpdatedAt.Add(time.Hour) {
		t.Fatalf("unexpected updated_at: got %s want %s", first.GetUpdatedAt().AsTime(), newUpdatedAt.Add(time.Hour))
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
	second := nextResp.GetSummaries()[0]
	if got := second.GetAnchor().GetConversationAnchorId(); got != newAnchorID {
		t.Fatalf("expected next newest anchor on second page, got %q", got)
	}
	if second.GetLastTurnContextSummary().GetContextContentHash() != strings.Repeat("a", 64) || second.GetLastTurnContextSummary().GetTranscriptTurnCount() != 1 {
		t.Fatalf("expected bounded last turn context summary, got %+v", second.GetLastTurnContextSummary())
	}
	if !second.GetSourceContextStatus().GetReady() {
		t.Fatalf("expected bounded source status, got %+v", second.GetSourceContextStatus())
	}
	if nextResp.GetNextPageToken() != "2" {
		t.Fatalf("expected third-page token 2, got %q", nextResp.GetNextPageToken())
	}
	lastResp, err := svc.ListAgentConversationSummaries(context.Background(), &runtimev1.ListAgentConversationSummariesRequest{
		Context: ctx, AgentId: ctx.GetLocalAgentRef(), PageSize: 1, PageToken: nextResp.GetNextPageToken(),
	})
	if err != nil {
		t.Fatalf("ListAgentConversationSummaries page 3: %v", err)
	}
	if got := lastResp.GetSummaries()[0].GetAnchor().GetConversationAnchorId(); got != oldAnchorID {
		t.Fatalf("expected oldest anchor on third page, got %q", got)
	}
	if lastResp.GetNextPageToken() != "" {
		t.Fatalf("expected final page to omit token, got %q", lastResp.GetNextPageToken())
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
