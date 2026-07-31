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
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if desktopAgain := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1"); desktopAgain != anchorID {
		t.Fatalf("repeated desktop open resolved %q, want %q", desktopAgain, anchorID)
	}
	otherAppAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "web.app", "user-1")
	if otherAppAnchorID != anchorID {
		t.Fatalf("cross-app open resolved %q, want %q", otherAppAnchorID, anchorID)
	}
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("agent-beta")}); err != nil {
		t.Fatalf("RealmSourceMaterialization beta: %v", err)
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
	entry.Agent.SourceContextStatus = localAgentSourceContextStatusV2(sourceSnapshot)
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("persist test source status: %v", err)
	}

	newUpdatedAt := time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC)
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript([2]string{"Other app prompt", "Other app assistant"})
	svc.chatAnchors[anchorID].LastMessageID = ""
	svc.chatAnchors[anchorID].LastTurnSnapshot = &publicChatTurnProjectionState{
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
	svc.chatAnchors[anchorID].UpdatedAt = newUpdatedAt.Add(time.Hour)
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
	if first.GetLastTurnContextSummary().GetContextContentHash() != strings.Repeat("a", 64) || first.GetLastTurnContextSummary().GetTranscriptTurnCount() != 1 {
		t.Fatalf("expected bounded last turn context summary, got %+v", first.GetLastTurnContextSummary())
	}
	if !first.GetSourceContextStatus().GetReady() {
		t.Fatalf("expected bounded source status, got %+v", first.GetSourceContextStatus())
	}
	if resp.GetNextPageToken() != "" {
		t.Fatalf("singleton conversation summary must not have another page, got %q", resp.GetNextPageToken())
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
