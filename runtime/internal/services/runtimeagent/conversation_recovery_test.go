package runtimeagent

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestConversationRecoveryRestartsWithInputPrefixAndScopedAdmission(t *testing.T) {
	path := t.TempDir() + "/runtime-state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	req := publicChatTurnRequestPayload{LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"), OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchorID, RequestID: "durable-request", RegisteredAppSubject: "registered-app-subject", Messages: []publicChatMessagePayload{{Role: "user", Content: "original question"}}}
	_, turn, _, err := svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{"conversation_anchor_id": anchorID, "turn_id": turn.TurnID, "timeline": map[string]any{"sequence": int64(1)}, "detail": map[string]any{"text": "reliable prefix\n"}}); err != nil {
		t.Fatal(err)
	}
	// Simulate a process stop without a successful assistant commit or terminal.
	closeSvc()
	svc, closeSvc = newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	defer closeSvc()
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x51, "user-1")
	handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	read := func() *runtimev1.LocalAppConversationSnapshot {
		t.Helper()
		result, err := svc.GetLocalAppConversationSnapshot(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID})
		if err != nil {
			t.Fatal(err)
		}
		return result.GetSnapshot()
	}
	snapshot := read()
	if snapshot.ThroughSequence != 1 || len(snapshot.Messages) != 2 || len(snapshot.Turns) != 1 {
		t.Fatalf("recovery closure: %+v", snapshot)
	}
	var input, partial bool
	for _, m := range snapshot.Messages {
		if m.Role == runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER {
			input = m.Parts[0].GetText().Text == "original question" && !m.Partial
		}
		if m.Partial {
			partial = m.Parts[0].GetText().Text == "reliable prefix\n"
		}
	}
	if !input || !partial || !snapshot.Turns[0].CanRegenerate || snapshot.Turns[0].GetRequestId() != req.RequestID {
		t.Fatalf("input/partial/regeneration lost: %+v", snapshot)
	}
	// Same-id reconciliation does not need a model executor or consume a new turn.
	decision.Operation = accountservice.LocalAppOperationSendConversationTurn
	send := &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: handle, ConversationAnchorId: anchorID, RequestId: req.RequestID, Parts: []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "original question"}}}}}
	result, err := svc.SendLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), send)
	if err != nil || result.GetTurnId() != turn.TurnID {
		t.Fatalf("same-id reconciliation=%+v err=%v", result, err)
	}
	send.Parts[0].GetText().Text = "different question"
	if _, err := svc.SendLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), send); err == nil {
		t.Fatal("same id accepted different input")
	}
	decision.Operation = accountservice.LocalAppOperationConversationSnapshot
	decision.RegisteredAppSubject = "another-app-subject"
	handle = mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	snapshot = read()
	if len(snapshot.Messages) != 2 || snapshot.Turns[0].GetRequestId() != "" {
		t.Fatalf("shared body / private request scope broken: %+v", snapshot)
	}
}

func TestConversationRegenerationUsesSavedInputAndDoesNotDuplicateUserMessage(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	req := publicChatTurnRequestPayload{LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"), OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchorID, RequestID: "original", RegisteredAppSubject: "registered-app-subject", Messages: []publicChatMessagePayload{{Role: "user", Content: "original question"}}}
	_, first, _, err := svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{"conversation_anchor_id": anchorID, "turn_id": first.TurnID, "timeline": map[string]any{"sequence": int64(1)}, "detail": map[string]any{"text": "unfinished"}}); err != nil {
		t.Fatal(err)
	}
	svc.releasePublicChatTurn(anchorID, first.TurnID)
	req.RequestID = "regenerate"
	req.RetryOfTurnID = first.TurnID
	_, second, _, err := svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.releasePublicChatTurn(anchorID, second.TurnID)
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	record := anchor.Recoveries[second.TurnID]
	input := publicChatRecoveryInputForTurn(anchor, record)
	if record.Input != nil || record.InputTurnID != first.TurnID || input == nil || input.Text != "original question" || anchor.Recoveries[first.TurnID].PublicText != "unfinished" {
		t.Fatalf("retry copied/mutated original: record=%+v input=%+v", record, input)
	}
	svc.chatSurfaceMu.Unlock()
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x51, "user-1")
	result, err := svc.GetLocalAppConversationSnapshot(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID})
	if err != nil {
		t.Fatal(err)
	}
	users := 0
	for _, m := range result.GetSnapshot().Messages {
		if m.Role == runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER {
			users++
		}
	}
	if users != 1 {
		t.Fatalf("retry duplicated original input: %+v", result)
	}
}

func TestConversationRecoveryPrefixSaveFailureNeverAdvancesSnapshotCursor(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	turnID := reserveConversationPublicationTestTurn(t, svc, anchorID)
	publish := func(text string) error {
		return svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{"conversation_anchor_id": anchorID, "turn_id": turnID, "timeline": map[string]any{"sequence": int64(1)}, "detail": map[string]any{"text": text}})
	}
	if err := publish("saved prefix"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER reject_prefix BEFORE UPDATE OF recovery_json ON runtime_conversation_recovery BEGIN SELECT RAISE(FAIL,'save unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := publish(" must not appear"); err == nil {
		t.Fatal("failed prefix save reported successful publication")
	}
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x51, "user-1")
	response, err := svc.GetLocalAppConversationSnapshot(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := response.GetSnapshot()
	if snapshot.ThroughSequence != 1 {
		t.Fatalf("cursor advanced on failed prefix save: %d", snapshot.ThroughSequence)
	}
	for _, message := range snapshot.Messages {
		if message.Partial && message.Parts[0].GetText().Text != "saved prefix" {
			t.Fatalf("unsaved prefix visible: %+v", message)
		}
	}
}

func TestConversationRegenerationExecutesOriginalInputOnceAndNoActions(t *testing.T) {
	svc, scope, decision, anchorID := localAppConversationStreamFixture(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	actions := &stubPublicChatActionExecutor{}
	svc.SetPublicChatActionExecutor(actions)
	calls := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(ctx context.Context, request *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		calls++
		originalCount := 0
		for _, message := range request.Messages {
			originalCount += strings.Count(message.GetContent(), "original-recovery-canary")
			if strings.Contains(message.GetContent(), "previous unfinished response") {
				t.Error("old partial entered the new model context")
			}
		}
		if originalCount != 1 {
			t.Errorf("original input occurs %d times", originalCount)
		}
		raw := `<message>previous unfinished response`
		if calls > 1 {
			raw = publicChatImageActionAPML("ignored", "regenerated answer", "ignored-action", "do not replay") + `<time-hook><delay-ms>600000</delay-ms><effect kind="follow-up-turn"><prompt-text>do not replay</prompt-text></effect></time-hook>`
		}
		return emitPublicChatImageActionStream("recovery", raw)(ctx, request, emit)
	}})
	decision.Operation = accountservice.LocalAppOperationSendConversationTurn
	callCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	first, err := svc.SendLocalAppConversationTurn(callCtx, &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: scope.AgentHandle, ConversationAnchorId: anchorID, RequestId: "original-request", Parts: []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "original-recovery-canary"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAsyncDrain(t, svc)
	retryOf := first.TurnId
	_, err = svc.SendLocalAppConversationTurn(callCtx, &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: scope.AgentHandle, ConversationAnchorId: anchorID, RequestId: "retry-request", RetryOfTurnId: &retryOf})
	if err != nil {
		t.Fatal(err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAsyncDrain(t, svc)
	if calls != 2 || actions.calls != 0 {
		t.Fatalf("attempts=%d actions=%d", calls, actions.calls)
	}
	decision.Operation = accountservice.LocalAppOperationConversationSnapshot
	response, err := svc.GetLocalAppConversationSnapshot(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: scope.AgentHandle, ConversationAnchorId: anchorID})
	if err != nil {
		t.Fatal(err)
	}
	users, partial, complete := 0, 0, 0
	for _, message := range response.GetSnapshot().Messages {
		if message.Role == runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER {
			users++
		} else if message.Partial {
			partial++
		} else if message.Parts[0].GetText().Text == "regenerated answer" {
			complete++
		}
	}
	if users != 1 || partial != 1 || complete != 1 || response.GetSnapshot().State.PendingFollowUp != nil {
		t.Fatalf("regeneration projection or effects wrong: %+v", response)
	}
}

func TestAcceptedPictureRemainsConversationMemberAfterRestart(t *testing.T) {
	path := t.TempDir() + "/state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	disk, err := runtimeartifact.NewDiskStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	svc.SetRuntimeArtifactStore(disk)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationAttachmentUpload, 0x51, "user-1")
	handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	uploaded, err := svc.UploadLocalAppConversationAttachment(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.UploadLocalAppConversationAttachmentRequest{AgentHandle: handle, ConversationAnchorId: anchorID, MimeType: "image/png", Data: localAppConversationTestPNG(t)})
	if err != nil {
		t.Fatal(err)
	}
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
		return fmt.Errorf("provider unavailable")
	}})
	decision.Operation = accountservice.LocalAppOperationSendConversationTurn
	parts := []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_ArtifactRef{ArtifactRef: &runtimev1.LocalAppConversationInputArtifactRef{ArtifactId: uploaded.ArtifactId}}}}
	admitted, err := svc.SendLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: handle, ConversationAnchorId: anchorID, RequestId: "image-input", Parts: parts})
	if err != nil {
		t.Fatal(err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAsyncDrain(t, svc)
	closeSvc()
	svc, closeSvc = newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	defer closeSvc()
	disk, err = runtimeartifact.NewDiskStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	svc.SetRuntimeArtifactStore(disk)
	reader := localAppConversationDecision(accountservice.LocalAppOperationConversationArtifactRead, 0x66, "user-1")
	reader.AppID = "other.authorized.app"
	reader.RegisteredAppSubject = "other-authorized-subject"
	freshHandle := mintLocalAppAgentHandle(reader, testRuntimeAgentLocalRef("agent-alpha"))
	read, err := svc.ReadLocalAppConversationArtifact(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), reader), &runtimev1.ReadLocalAppConversationArtifactRequest{AgentHandle: freshHandle, ConversationAnchorId: anchorID, ArtifactId: uploaded.ArtifactId})
	if err != nil || !bytes.Equal(read.GetData(), localAppConversationTestPNG(t)) {
		t.Fatalf("accepted picture lost Conversation membership: read=%+v err=%v", read, err)
	}
	capture = newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	received := 0
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(ctx context.Context, request *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		for _, message := range request.Messages {
			for _, part := range message.Parts {
				if part.GetArtifactRef().GetLocalArtifactId() == uploaded.ArtifactId {
					received++
				}
			}
		}
		return emitPublicChatImageActionStream("image-recovery", `<message>image answer</message>`)(ctx, request, emit)
	}})
	reader.Operation = accountservice.LocalAppOperationSendConversationTurn
	_, err = svc.SendLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), reader), &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: freshHandle, ConversationAnchorId: anchorID, RequestId: "image-retry", RetryOfTurnId: &admitted.TurnId})
	if err != nil {
		t.Fatal(err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAsyncDrain(t, svc)
	if received != 1 {
		t.Fatalf("original attachment entered retry %d times", received)
	}
	if _, err := svc.SendLocalAppConversationTurn(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), reader), &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: freshHandle, ConversationAnchorId: anchorID, RequestId: "unrelated-image-input", Parts: parts}); err == nil {
		t.Fatal("Conversation membership granted new upload adoption")
	}
	foreign := reader
	foreign.AccountID = "other-account"
	foreign.Operation = accountservice.LocalAppOperationConversationArtifactRead
	if _, err := svc.ReadLocalAppConversationArtifact(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), foreign), &runtimev1.ReadLocalAppConversationArtifactRequest{AgentHandle: freshHandle, ConversationAnchorId: anchorID, ArtifactId: uploaded.ArtifactId}); err == nil {
		t.Fatal("accepted attachment crossed account boundary")
	}
}

func TestPrivateProjectionDoesNotAdvancePublicConversationCursor(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	before, _ := svc.publicChatAnchorSnapshot(anchorID)
	if err := svc.publishLocalAppConversationEvent("user-1", publicChatTurnStructuredType, map[string]any{"conversation_anchor_id": anchorID}); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.publicChatAnchorSnapshot(anchorID)
	if after.LocalAppSequence != before.LocalAppSequence {
		t.Fatal("an internal event introduced a public sequence gap")
	}
}

func TestConversationNewAdmissionRejectsRevocationAfterBindingResolution(t *testing.T) {
	svc, scope, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetPublicChatAppEmitter(newPublicChatEmitCapture().emit)
	var modelCalls atomic.Int32
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
		modelCalls.Add(1)
		return fmt.Errorf("must not execute")
	}})
	enablePublicChatTestFollowUps(t, svc, anchorID)
	previousID := reserveConversationPublicationTestTurn(t, svc, anchorID)
	svc.chatSurfaceMu.Lock()
	anchor := *svc.chatAnchors[anchorID]
	previous := *svc.chatTurns[previousID]
	svc.chatSurfaceMu.Unlock()
	structured, err := parsePublicChatStructuredEnvelope(`<message>body</message><time-hook><delay-ms>3600000</delay-ms><effect kind="follow-up-turn"><prompt-text>later</prompt-text></effect></time-hook>`)
	if err != nil {
		t.Fatal(err)
	}
	assignPublicChatOutputIdentities(structured, previousID)
	scheduled := svc.schedulePublicChatFollowUp(anchor, previous, publicChatTurnRequestPayload{}, structured)
	if scheduled.Status != "scheduled" {
		t.Fatalf("schedule=%+v", scheduled)
	}
	svc.releasePublicChatTurn(anchorID, previousID)
	var timerCanceled atomic.Bool
	svc.chatSurfaceMu.Lock()
	pending := svc.chatFollowUps[scheduled.FollowUpID]
	oldCancel := pending.Cancel
	pending.Cancel = func() {
		timerCanceled.Store(true)
		if oldCancel != nil {
			oldCancel()
		}
	}
	before := *svc.chatAnchors[anchorID]
	svc.chatSurfaceMu.Unlock()
	var persistedBefore string
	if err := svc.backend.DB().QueryRow(`SELECT anchor_json FROM runtime_conversation_anchor WHERE anchor_id=?`, anchorID).Scan(&persistedBefore); err != nil {
		t.Fatal(err)
	}
	var rowsBefore int
	if err := svc.backend.DB().QueryRow(`SELECT count(*) FROM runtime_conversation_recovery WHERE anchor_id=?`, anchorID).Scan(&rowsBefore); err != nil {
		t.Fatal(err)
	}
	base := svc.currentPublicChatBindingResolver()
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	svc.SetPublicChatBindingResolver(stubPublicChatBindingResolver{resolve: func(ctx context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
		result, err := base.ResolvePublicChatBinding(ctx, req)
		if err == nil {
			once.Do(func() { close(entered); <-release })
		}
		return result, err
	}})
	decision.Operation = accountservice.LocalAppOperationSendConversationTurn
	invalidated := make(chan struct{})
	decision.SessionInvalidated = invalidated
	ctx, cancel := context.WithCancel(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision))
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := svc.SendLocalAppConversationTurn(ctx, &runtimev1.SendLocalAppConversationTurnRequest{AgentHandle: scope.AgentHandle, ConversationAnchorId: anchorID, RequestId: "revoked-before-admission", Parts: []*runtimev1.LocalAppConversationInputPart{{Part: &runtimev1.LocalAppConversationInputPart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: "must remain unaccepted"}}}}})
		result <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("binding was not reached")
	}
	close(invalidated)
	cancel()
	close(release)
	select {
	case err = <-result:
	case <-time.After(5 * time.Second):
		t.Fatal("admission did not return")
	}
	var rowsAfter int
	if e := svc.backend.DB().QueryRow(`SELECT count(*) FROM runtime_conversation_recovery WHERE anchor_id=?`, anchorID).Scan(&rowsAfter); e != nil {
		t.Fatal(e)
	}
	var persistedAfter string
	if e := svc.backend.DB().QueryRow(`SELECT anchor_json FROM runtime_conversation_anchor WHERE anchor_id=?`, anchorID).Scan(&persistedAfter); e != nil {
		t.Fatal(e)
	}
	svc.chatSurfaceMu.Lock()
	after := *svc.chatAnchors[anchorID]
	samePending := svc.chatFollowUps[scheduled.FollowUpID] == pending
	active := svc.chatActiveByAgent[testRuntimeAgentLocalRef("agent-alpha")]
	svc.chatSurfaceMu.Unlock()
	if err == nil || rowsAfter != rowsBefore || persistedAfter != persistedBefore || after.ActiveTurnID != before.ActiveTurnID || after.LatestAcceptedTurnID != before.LatestAcceptedTurnID || !samePending || timerCanceled.Load() || active != "" || modelCalls.Load() != 0 {
		t.Fatalf("revoked request changed durable owner: err=%v rows=%d/%d sameSQL=%v pending=%v canceled=%v active=%v calls=%v", err, rowsBefore, rowsAfter, persistedAfter == persistedBefore, samePending, timerCanceled.Load(), active, modelCalls.Load())
	}
}
