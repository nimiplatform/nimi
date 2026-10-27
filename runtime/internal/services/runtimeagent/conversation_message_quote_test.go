package runtimeagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestConversationQuoteTextSemanticVectors(t *testing.T) {
	data, err := os.ReadFile("../../../../config/conversation-quote-text-v1.cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Format string                                  `json:"format"`
		Cases  []struct{ Name, Markdown, Text string } `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Format != conversationQuoteFormat {
		t.Fatal("fixture format drift")
	}
	for _, sample := range fixture.Cases {
		t.Run(sample.Name, func(t *testing.T) {
			actual, err := conversationQuoteText(sample.Markdown)
			if err != nil || actual != sample.Text {
				t.Fatalf("quoteText=%q want=%q err=%v", actual, sample.Text, err)
			}
		})
	}
}

func quotationReadFixture(t *testing.T) (*Service, string, accountservice.LocalAppCallerDecision, string) {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationMessageRead, 0x61, "user-1")
	return svc, anchorID, decision, mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
}

func TestConversationMessageReadLocatesOutsideSnapshotAndRevalidates(t *testing.T) {
	svc, anchorID, decision, handle := quotationReadFixture(t)
	for i := 0; i < 110; i++ {
		if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, fmt.Sprintf("quote-source-%03d", i), &runtimev1.ChatMessage{Role: "user", Content: fmt.Sprintf("question-%d", i)}, fmt.Sprintf("answer-%d **重复🙂** 重复🙂", i)); err != nil {
			t.Fatal(err)
		}
	}
	messageID := localAppConversationMessageID("quote-source-001", "assistant", "")
	response, err := svc.ReadLocalAppConversationMessage(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.ReadLocalAppConversationMessageRequest{AgentHandle: handle, ConversationAnchorId: anchorID, MessageId: messageID})
	if err != nil {
		t.Fatal(err)
	}
	if response.Message.MessageId != messageID || response.GetQuoteFormat() != conversationQuoteFormat || response.GetQuoteText() != "answer-1 重复🙂 重复🙂" || len(response.Window.Messages) > 15 || len(response.Window.Turns) > 10 || !response.Window.TruncatedAfter {
		t.Fatalf("read=%+v", response)
	}
	decision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetLocalAppConversationSnapshot(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID})
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range snapshot.Snapshot.Messages {
		if message.MessageId == messageID {
			t.Fatal("test source unexpectedly within tail snapshot")
		}
	}
	decision.Operation = accountservice.LocalAppOperationConversationMessageRead
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(context.Context, localappop.Ingress) (context.Context, error) {
		return nil, errors.New("access revoked")
	}))
	if _, err := svc.ReadLocalAppConversationMessage(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.ReadLocalAppConversationMessageRequest{AgentHandle: handle, ConversationAnchorId: anchorID, MessageId: messageID}); err == nil {
		t.Fatal("read leaked after access revocation")
	}
}

func TestConversationQuoteUsesExactUnicodeRangeAndStableBody(t *testing.T) {
	svc, anchorID, _, _ := quotationReadFixture(t)
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "source", &runtimev1.ChatMessage{Role: "user", Content: "question"}, "重复🙂 重复🙂"); err != nil {
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	anchor := svc.chatAnchors[anchorID]
	// The committed body remains quotable while its independent media turn is active.
	anchor.ActiveTurnSnapshot = &publicChatTurnProjectionState{TurnID: "source", Status: publicChatTurnStatusCommitted}
	id := localAppConversationMessageID("source", "assistant", "")
	start := uint32(len("重复🙂 "))
	end := uint32(len("重复🙂 重复🙂"))
	quote, err := resolveConversationQuoteLocked(anchor, &publicChatQuoteSelector{id, conversationQuoteFormat, start, end})
	if err != nil || quote.Text != "重复🙂" || quote.StartByte != start {
		t.Fatalf("quote=%+v err=%v", quote, err)
	}
	if _, err := resolveConversationQuoteLocked(anchor, &publicChatQuoteSelector{id, conversationQuoteFormat, start + 1, end}); err == nil {
		t.Fatal("split Unicode scalar accepted")
	}
	anchor.Recoveries = map[string]*publicChatTurnRecovery{"live": {TurnID: "live", InputTurnID: "live", PublicText: "changing prefix", AcceptedAt: time.Now()}}
	anchor.ActiveTurnSnapshot = &publicChatTurnProjectionState{TurnID: "live", Status: publicChatTurnStatusStarted}
	liveID := localAppConversationMessageID("live", "assistant", "")
	if _, err := resolveConversationQuoteLocked(anchor, &publicChatQuoteSelector{liveID, conversationQuoteFormat, 0, 8}); err == nil {
		t.Fatal("live prefix was quotable")
	}
	anchor.ActiveTurnSnapshot.Status = publicChatTurnStatusFailed
	if partial, err := resolveConversationQuoteLocked(anchor, &publicChatQuoteSelector{liveID, conversationQuoteFormat, 0, 8}); err != nil || !partial.SourcePartial {
		t.Fatalf("stable partial=%+v err=%v", partial, err)
	}
}

func TestConversationQuotedSendIdempotencyAndRegeneration(t *testing.T) {
	svc, scope, decision, anchorID := localAppConversationStreamFixture(t)
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "source", &runtimev1.ChatMessage{Role: "user", Content: "history-neighbor-should-be-excluded"}, "first second"); err != nil {
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].ConversationContext = publicChatConversationContextSelection{Revision: 1, FirstTurnSequence: 1, OmitSupplementalContext: true}
	svc.chatSurfaceMu.Unlock()
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	var calls atomic.Int32
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(ctx context.Context, request *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		calls.Add(1)
		found := false
		for _, message := range request.Messages {
			if strings.Contains(message.Content, "history-neighbor-should-be-excluded") {
				t.Error("quote restored excluded neighboring history")
			}
			if strings.Contains(message.Content, "Quoted conversation reference") {
				found = true
				if message.Role != "user" {
					t.Error("quote promoted out of user role")
				}
			}
		}
		if !found {
			t.Error("validated quote missing from model context")
		}
		return errors.New("controlled model failure")
	}})
	decision.Operation = accountservice.LocalAppOperationSendConversationTurn
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	req := &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: scope.AgentHandle, ConversationAnchorId: anchorID, RequestId: "quoted-input", Parts: []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "respond to this"}}}}, Quote: &runtimev1.LocalAppConversationQuoteIntent{SourceMessageId: localAppConversationMessageID("source", "assistant", ""), Format: conversationQuoteFormat, StartByte: 6, EndByte: 12}}
	first, err := svc.SendLocalAppConversationTurn(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAsyncDrain(t, svc)
	repeated, err := svc.SendLocalAppConversationTurn(ctx, req)
	if err != nil || repeated.TurnId != first.TurnId || calls.Load() != 1 {
		t.Fatalf("duplicate=%+v calls=%d err=%v", repeated, calls.Load(), err)
	}
	req.Quote.StartByte = 0
	req.Quote.EndByte = 5
	if _, err := svc.SendLocalAppConversationTurn(ctx, req); err == nil {
		t.Fatal("same id accepted different quote")
	}
	retry := first.TurnId
	if _, err := svc.SendLocalAppConversationTurn(ctx, &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: scope.AgentHandle, ConversationAnchorId: anchorID, RequestId: "quoted-retry", RetryOfTurnId: &retry}); err != nil {
		t.Fatal(err)
	}
	waitForPublicChatAsyncDrain(t, svc)
	if calls.Load() != 2 {
		t.Fatalf("calls=%d", calls.Load())
	}
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	input := publicChatRecoveryInputForTurn(svc.chatAnchors[anchorID], svc.chatAnchors[anchorID].Recoveries[svc.chatAnchors[anchorID].LatestAcceptedTurnID])
	if input == nil || input.Quote == nil || input.Quote.Text != "second" {
		t.Fatalf("regeneration input=%+v", input)
	}
}

func TestConversationQuoteRecoveryAndRollback(t *testing.T) {
	path := t.TempDir() + "/state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "source", &runtimev1.ChatMessage{Role: "user", Content: "source question"}, "quoted text"); err != nil {
		t.Fatal(err)
	}
	selector := &publicChatQuoteSelector{localAppConversationMessageID("source", "assistant", ""), conversationQuoteFormat, 0, 11}
	svc.chatSurfaceMu.Lock()
	quote, err := resolveConversationQuoteLocked(svc.chatAnchors[anchorID], selector)
	svc.chatSurfaceMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	req := publicChatTurnRequestPayload{LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"), OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchorID, RequestID: "quote-recovery", RegisteredAppSubject: "registered-app-subject", Messages: []publicChatMessagePayload{{Role: "user", Content: "continue", quoteSelector: selector, quote: quote}}}
	_, turn, _, err := svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
	if err != nil {
		t.Fatal(err)
	}
	closeSvc()
	svc, closeSvc = newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	defer closeSvc()
	svc.chatSurfaceMu.Lock()
	restored := publicChatRecoveryInputForTurn(svc.chatAnchors[anchorID], svc.chatAnchors[anchorID].Recoveries[turn.TurnID])
	svc.chatSurfaceMu.Unlock()
	if restored == nil || restored.Quote == nil || *restored.Quote != *quote {
		t.Fatalf("restored quote=%+v", restored)
	}
	reused, found, err := reusedPublicChatAdmission(svc.chatAnchors[anchorID], req)
	if err != nil || !found || reused.TurnID != turn.TurnID {
		t.Fatalf("reused=%+v found=%v err=%v", reused, found, err)
	}
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER reject_quote BEFORE INSERT ON runtime_conversation_recovery BEGIN SELECT RAISE(FAIL,'storage unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	req.RequestID = "must-rollback"
	_, _, _, err = svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
	if err == nil {
		t.Fatal("failed commit accepted")
	}
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	if findPublicChatRequest(svc.chatAnchors[anchorID], req.RegisteredAppSubject, req.RequestID) != nil || svc.chatAnchors[anchorID].ActiveTurnID != "" {
		t.Fatal("rollback left input/fingerprint/reservation")
	}
}

func TestConversationQuotedSnapshotAndReadWindowUseContentBudget(t *testing.T) {
	svc, anchorID, decision, handle := quotationReadFixture(t)
	quoted := strings.Repeat("🙂", conversationQuoteMaxScalars)
	quote := &publicChatMessageQuote{publicChatQuoteSelector: publicChatQuoteSelector{localAppConversationMessageID("budget-0", "assistant", ""), conversationQuoteFormat, 0, uint32(len(quoted))}, SourceRole: "assistant", Text: quoted}
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	for i := 0; i < 12; i++ {
		anchor.CommittedTranscript = append(anchor.CommittedTranscript, publicChatCommittedTranscriptTurn{TurnID: fmt.Sprintf("budget-%d", i), Sequence: uint64(i), Origin: publicChatTurnOriginUser, InputText: strings.Repeat("u", 64*1024), AssistantText: strings.Repeat("a", 64*1024), InputQuote: clonePublicChatQuote(quote), CommittedAt: time.Unix(int64(i+1), 0)})
	}
	svc.chatSurfaceMu.Unlock()
	decision.Operation = accountservice.LocalAppOperationConversationSnapshot
	response, err := svc.GetLocalAppConversationSnapshot(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID})
	if err != nil {
		t.Fatal(err)
	}
	size := 0
	quotedInputs := 0
	for _, message := range response.Snapshot.Messages {
		size += conversationMessageContentBytes(message)
		if message.Role == runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER {
			quotedInputs++
			if message.Quote == nil || message.Quote.Text != quoted {
				t.Fatal("budget enforcement dropped quote")
			}
		}
	}
	if size > 1024*1024 || !response.Snapshot.TruncatedBefore || quotedInputs == 0 || len(response.Snapshot.Messages)%2 != 0 {
		t.Fatalf("snapshot bytes=%d inputs=%d snapshot=%+v", size, quotedInputs, response.Snapshot)
	}
	decision.Operation = accountservice.LocalAppOperationConversationMessageRead
	read, err := svc.ReadLocalAppConversationMessage(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.ReadLocalAppConversationMessageRequest{AgentHandle: handle, ConversationAnchorId: anchorID, MessageId: localAppConversationMessageID("budget-4", "assistant", "")})
	if err != nil {
		t.Fatal(err)
	}
	size = 0
	for _, message := range read.Window.Messages {
		size += conversationMessageContentBytes(message)
	}
	if size > conversationReadWindowMaxBytes || size+len(read.GetQuoteText()) > 327680 || len(read.Window.Messages) != 2 {
		t.Fatalf("read bytes=%d messages=%d", size, len(read.Window.Messages))
	}
}

func TestConversationQuoteBoundaryRejectsMalformedSelectorsAndScalarOverflow(t *testing.T) {
	for _, input := range []*runtimev1.LocalAppConversationQuoteIntent{
		{SourceMessageId: "source", Format: "other", EndByte: 1},
		{SourceMessageId: "source", Format: conversationQuoteFormat, StartByte: 1, EndByte: 1},
		{SourceMessageId: "source", Format: conversationQuoteFormat, EndByte: 65537},
		{SourceMessageId: "source", Format: conversationQuoteFormat, EndByte: 16385},
	} {
		if _, err := parseConversationQuoteIntent(input); err == nil {
			t.Fatalf("accepted malformed selector=%+v", input)
		}
	}
	svc, anchorID, decision, handle := quotationReadFixture(t)
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "source", &runtimev1.ChatMessage{Role: "user", Content: "source"}, strings.Repeat("x", 4097)); err != nil {
		t.Fatal(err)
	}
	decision.Operation = accountservice.LocalAppOperationSendConversationTurn
	_, err := svc.SendLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: handle, ConversationAnchorId: anchorID, RequestId: "oversized-quote", Parts: []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "reply"}}}}, Quote: &runtimev1.LocalAppConversationQuoteIntent{SourceMessageId: localAppConversationMessageID("source", "assistant", ""), Format: conversationQuoteFormat, EndByte: 4097}})
	if err == nil {
		t.Fatal("scalar-overflow quote admitted")
	}
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	if svc.chatAnchors[anchorID].ActiveTurnID != "" || findPublicChatRequest(svc.chatAnchors[anchorID], decision.RegisteredAppSubject, "oversized-quote") != nil {
		t.Fatal("invalid quote created work")
	}
}

func TestConversationCommittedQuoteSurvivesRestartWithoutRecoveryInputCopy(t *testing.T) {
	path := t.TempDir() + "/state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, "source", &runtimev1.ChatMessage{Role: "user", Content: "source"}, "quoted text"); err != nil {
		t.Fatal(err)
	}
	selector := &publicChatQuoteSelector{localAppConversationMessageID("source", "assistant", ""), conversationQuoteFormat, 0, 11}
	svc.chatSurfaceMu.Lock()
	quote, err := resolveConversationQuoteLocked(svc.chatAnchors[anchorID], selector)
	svc.chatSurfaceMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	req := publicChatTurnRequestPayload{LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"), OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchorID, RequestID: "committed-quote", RegisteredAppSubject: "registered-app-subject", Messages: []publicChatMessagePayload{{Role: "user", Content: "response", quoteSelector: selector, quote: quote}}}
	_, turn, _, err := svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, turn.TurnID, &runtimev1.ChatMessage{Role: "user", Content: "response"}, "answer"); err != nil {
		t.Fatal(err)
	}
	svc.releasePublicChatTurn(anchorID, turn.TurnID)
	if svc.chatAnchors[anchorID].Recoveries[turn.TurnID].Input != nil {
		t.Fatal("finished input kept parallel recovery copy")
	}
	closeSvc()
	svc, closeSvc = newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	defer closeSvc()
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationMessageRead, 0x63, "user-1")
	messageID := localAppConversationMessageID(turn.TurnID, "user", "")
	result, err := svc.ReadLocalAppConversationMessage(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.ReadLocalAppConversationMessageRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID, MessageId: messageID})
	if err != nil {
		t.Fatal(err)
	}
	if result.Message.Quote == nil || result.Message.Quote.Text != "quoted text" || result.Message.Quote.SourceMessageId != selector.SourceMessageID || result.GetQuoteText() != "response" {
		t.Fatalf("committed quotation lost or recursively quoted: %+v", result)
	}
	input := publicChatRecoveryInputForTurn(svc.chatAnchors[anchorID], svc.chatAnchors[anchorID].Recoveries[turn.TurnID])
	if input == nil || input.Quote == nil || input.Quote.Text != "quoted text" {
		t.Fatalf("original input quote lost after compaction: %+v", input)
	}
}
