package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"reflect"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestConversationDeltaDoesNotWriteUnchangedHistoryOrOtherAnchor(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	a := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("agent-beta")}); err != nil {
		t.Fatal(err)
	}
	b := openPublicChatTestAnchor(t, svc, "agent-beta", "desktop.app", "user-1")
	commit := func(anchor, text string) {
		t.Helper()
		if err := svc.commitPublicChatTurnTranscript(anchor, &runtimev1.ChatMessage{Role: "user", Content: text}, "reply "+text); err != nil {
			t.Fatal(err)
		}
	}
	commit(a, "first")
	commit(b, "other")
	for _, stmt := range []string{
		fmt.Sprintf(`CREATE TRIGGER reject_other_anchor BEFORE UPDATE ON runtime_conversation_anchor WHEN OLD.anchor_id='%s' BEGIN SELECT RAISE(ABORT,'unrelated anchor rewritten'); END`, b),
		fmt.Sprintf(`CREATE TRIGGER reject_old_turn BEFORE INSERT ON runtime_conversation_turn WHEN NEW.anchor_id='%s' OR (NEW.anchor_id='%s' AND NEW.sequence=0) BEGIN SELECT RAISE(ABORT,'unchanged turn rewritten'); END`, b, a),
	} {
		if _, err := svc.backend.DB().Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	commit(a, "second")
	var count int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_conversation_turn WHERE anchor_id=?`, a).Scan(&count); err != nil || count != 2 {
		t.Fatalf("turns=%d %v", count, err)
	}
	if err := svc.loadPublicChatSurfaceStateFromDB(); err != nil {
		t.Fatal(err)
	}
	if !svc.chatAnchors[a].coldFacts || !svc.chatAnchors[b].coldFacts {
		t.Fatal("boot hydrated idle history")
	}
	aHistory, _, _, _, err := svc.snapshotPublicChatAnchorForCaller("desktop.app", a)
	if err != nil {
		t.Fatal(err)
	}
	bHistory, _, _, _, err := svc.snapshotPublicChatAnchorForCaller("desktop.app", b)
	if err != nil {
		t.Fatal(err)
	}
	if len(aHistory.CommittedTranscript) != 2 || len(bHistory.CommittedTranscript) != 1 {
		t.Fatal("delta lost durable history")
	}
}

func TestConversationRowsOrderPerAnchorAndFenceDeletedProjection(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	a := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("agent-beta")}); err != nil {
		t.Fatal(err)
	}
	b := openPublicChatTestAnchor(t, svc, "agent-beta", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	older, err := svc.capturePublicChatSurfaceSnapshotLocked(a)
	if err != nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatal(err)
	}
	newer, err := svc.capturePublicChatSurfaceSnapshotLocked(b)
	if err != nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatal(err)
	}
	svc.chatAnchors[a].ConversationContext.Revision = 2
	svc.chatAnchors[a].LocalAppSequence = 9
	latest, err := svc.capturePublicChatSurfaceSnapshotLocked(a)
	svc.chatSurfaceMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	older.FollowUps = []persistedPublicChatFollowUp{{FollowUpID: "outdated-timer", ConversationAnchorID: a}}
	for _, snapshot := range []persistedPublicChatSurfaceState{newer, latest, older} {
		if err := svc.chatStateRepo.persistPublicChatSurfaceState(snapshot); err != nil {
			t.Fatal(err)
		}
	}
	var timers int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_conversation_followup WHERE anchor_id=? AND followup_json IS NOT NULL`, a).Scan(&timers); err != nil || timers != 0 {
		t.Fatalf("late snapshot revived stale timer: %d %v", timers, err)
	}
	if err := svc.loadPublicChatSurfaceStateFromDB(); err != nil {
		t.Fatal(err)
	}
	if svc.chatAnchors[a] == nil || svc.chatAnchors[b] == nil {
		t.Fatal("unrelated newer anchor dropped older scoped write")
	}
	if svc.chatAnchors[a].LocalAppSequence != 9 || svc.chatAnchors[a].ConversationContext.Revision != 2 {
		t.Fatal("late capture overwrote the same anchor")
	}
	deleted := persistedPublicChatSurfaceState{Version: latest.Version + 1, AnchorScope: []string{a}}
	if err := svc.chatStateRepo.persistPublicChatSurfaceState(deleted); err != nil {
		t.Fatal(err)
	}
	older.FollowUps = []persistedPublicChatFollowUp{{FollowUpID: "late-followup", ConversationAnchorID: a}}
	if err := svc.chatStateRepo.persistPublicChatSurfaceState(older); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_conversation_anchor WHERE anchor_id=? AND anchor_json IS NOT NULL`, a).Scan(&count); err != nil || count != 0 {
		t.Fatalf("deleted anchor revived: %d %v", count, err)
	}
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_conversation_followup WHERE anchor_id=? AND followup_json IS NOT NULL`, a).Scan(&count); err != nil || count != 0 {
		t.Fatalf("late followup revived: %d %v", count, err)
	}
}

func TestOfflineConversationConversionPreservesHistoryAndIsExplicit(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	id := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.commitPublicChatTurnTranscript(id, &runtimev1.ChatMessage{Role: "user", Content: "preserve this"}, "durable reply"); err != nil {
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Lock()
	snapshot, err := svc.capturePublicChatSurfaceSnapshotLocked()
	svc.chatSurfaceMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	// The offline converter requires a stopped Runtime. Drain the fixture's
	// background writers before replacing its durable layout.
	svc.Close()
	snapshot.StorageVersion = 0
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"runtime_conversation_anchor", "runtime_conversation_turn", "runtime_conversation_followup"} {
		if _, err := svc.backend.DB().Exec("DELETE FROM " + table); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.backend.DB().Exec(`UPDATE runtime_local_agent_meta SET value=? WHERE key=?`, string(raw), runtimeAgentMetaPublicChatSurfaceStateKey); err != nil {
		t.Fatal(err)
	}
	if err := svc.loadPublicChatSurfaceStateFromDB(); err == nil {
		t.Fatal("startup silently read retired storage")
	}
	if needed, err := ConvertConversationStorage(context.Background(), svc.backend.DB(), false); err != nil || !needed {
		t.Fatalf("inspect conversion: %v %v", needed, err)
	}
	var untouched string
	if err := svc.backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key=?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&untouched); err != nil || untouched != string(raw) {
		t.Fatal("dry run changed canonical history")
	}
	if changed, err := ConvertConversationStorage(context.Background(), svc.backend.DB(), true); err != nil || !changed {
		t.Fatalf("convert: %v %v", changed, err)
	}
	if err := svc.loadPublicChatSurfaceStateFromDB(); err != nil {
		t.Fatal(err)
	}
	reopened, _, _, _, err := svc.snapshotPublicChatAnchorForCaller("desktop.app", id)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.CommittedTranscript; len(got) != 1 || got[0].InputText != "preserve this" || got[0].AssistantText != "durable reply" {
		t.Fatalf("conversion lost transcript: %+v", got)
	}
	if changed, err := ConvertConversationStorage(context.Background(), svc.backend.DB(), true); err != nil || changed {
		t.Fatalf("conversion retry: %v %v", changed, err)
	}
}

// Pin the first query, commit a new watermark and turn on the writer, then
// read the window and an out-of-window original on the original transaction.
func TestConversationWindowUsesOneReadVersionAndOnlyTargetedOriginal(t *testing.T) {
	s := newRuntimeAgentServiceForPublicChatTest(t)
	id := openPublicChatTestAnchor(t, s, "agent-alpha", "desktop.app", "user-1")
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x51, "user-1")
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	resolved, _, err := s.resolveLocalAppAgent(ctx, decision.Operation, mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")))
	if err != nil {
		t.Fatal(err)
	}
	var pairs [][2]string
	for i := 0; i < 120; i++ {
		pairs = append(pairs, [2]string{fmt.Sprintf("input %d", i), "answer"})
	}
	s.chatSurfaceMu.Lock()
	a := s.chatAnchors[id]
	a.CommittedTranscript = testPublicChatCommittedTranscript(pairs...)
	for i := range a.CommittedTranscript {
		a.CommittedTranscript[i].TurnID = fmt.Sprintf("turn-%03d", i)
	}
	a.LocalAppSequence = 11
	a.LatestAcceptedTurnID = "retry"
	a.Recoveries = map[string]*publicChatTurnRecovery{"retry": {TurnID: "retry", InputTurnID: "turn-000", Fingerprint: strings.Repeat("a", 64), AcceptedAt: time.Now().UTC(), PublicText: "saved"}}
	if err := s.persistPublicChatSurfaceStateLocked(); err != nil {
		s.chatSurfaceMu.Unlock()
		t.Fatal(err)
	}
	s.chatSurfaceMu.Unlock()
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	old, header, err := readConversationWindowHeader(ctx, tx, resolved, id)
	if err != nil {
		t.Fatal(err)
	}
	s.chatSurfaceMu.Lock()
	a.CommittedTranscript = append(a.CommittedTranscript, publicChatCommittedTranscriptTurn{TurnID: "new-turn", Sequence: 120, Origin: "user", InputText: "new", AssistantText: "new answer"})
	a.LocalAppSequence = 12
	if err := s.persistPublicChatSurfaceStateLocked(id); err != nil {
		s.chatSurfaceMu.Unlock()
		t.Fatal(err)
	}
	s.chatSurfaceMu.Unlock()
	if err := readConversationWindowTurns(ctx, tx, old, header, ""); err != nil {
		t.Fatal(err)
	}
	if old.anchor.LocalAppSequence != 11 || !old.truncated || len(old.anchor.CommittedTranscript) != 100 || old.anchor.CommittedTranscript[0].TurnID != "turn-020" || old.anchor.CommittedTranscript[99].TurnID != "turn-119" {
		t.Fatalf("old read mixed versions or loaded unrelated turns: water=%d count=%d", old.anchor.LocalAppSequence, len(old.anchor.CommittedTranscript))
	}
	if orig := publicChatRecoveryInputForTurn(&old.anchor, old.anchor.Recoveries["retry"]); orig == nil || orig.Text != "input 0" {
		t.Fatalf("out-of-window input: %v", orig)
	}
	current, err := s.readConversationWindow(ctx, resolved, id, "")
	if err != nil {
		t.Fatal(err)
	}
	if current.anchor.LocalAppSequence != 12 || current.anchor.CommittedTranscript[99].TurnID != "new-turn" {
		t.Fatal("next read missed the concurrent commit")
	}
}

func TestWindowAndMetadataWithGrowingHistory(t *testing.T) {
	for _, count := range []int{100, 1000, 10000} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			s := newRuntimeAgentServiceForPublicChatTest(t)
			id := openPublicChatTestAnchor(t, s, "agent-alpha", "desktop.app", "user-1")
			decision := localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x51, "user-1")
			ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
			resolved, _, err := s.resolveLocalAppAgent(ctx, decision.Operation, mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")))
			if err != nil {
				t.Fatal(err)
			}
			body := strings.Repeat("x", 256)
			s.chatSurfaceMu.Lock()
			a := s.chatAnchors[id]
			for i := 0; i < count; i++ {
				a.CommittedTranscript = append(a.CommittedTranscript, publicChatCommittedTranscriptTurn{TurnID: fmt.Sprintf("turn-%05d", i), Sequence: uint64(i), Origin: "user", InputText: body, AssistantText: body})
			}
			err = s.persistPublicChatSurfaceStateLocked(id)
			s.chatSurfaceMu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			if err := s.loadPublicChatSurfaceStateFromDB(); err != nil {
				t.Fatal(err)
			}
			for _, op := range []string{"INSERT", "UPDATE", "DELETE"} {
				if _, err := s.backend.DB().Exec("CREATE TRIGGER deny_turn_" + op + " BEFORE " + op + " ON runtime_conversation_turn BEGIN SELECT RAISE(ABORT,'metadata rewrote history'); END"); err != nil {
					t.Fatal(err)
				}
			}
			for sample := 0; sample < 3; sample++ {
				start := time.Now()
				w, err := s.readConversationWindow(ctx, resolved, id, "")
				if err != nil {
					t.Fatal(err)
				}
				if len(w.anchor.CommittedTranscript) != 100 || w.anchor.CommittedTranscript[0].Sequence != uint64(count-100) || w.truncated != (count > 100) {
					t.Fatal("wrong fixed window")
				}
				read := time.Since(start)
				start = time.Now()
				s.chatSurfaceMu.Lock()
				a = s.chatAnchors[id]
				a.ConversationContext.Revision++
				err = s.persistPublicChatSurfaceStateLocked(id)
				s.chatSurfaceMu.Unlock()
				if err != nil {
					t.Fatal(err)
				}
				if !a.coldFacts || len(a.CommittedTranscript) != 0 {
					t.Fatal("metadata edit hydrated history")
				}
				t.Logf("rows=%d read=%v metadata=%v", count, read, time.Since(start))
			}
		})
	}
}

func TestExecutionRestoresSelectedRangeAndReopensOmittedHistory(t *testing.T) {
	s := newRuntimeAgentServiceForPublicChatTest(t)
	id := openPublicChatTestAnchor(t, s, "agent-alpha", "desktop.app", "user-1")
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	a := s.chatAnchors[id]
	for i := 0; i < 120; i++ {
		a.CommittedTranscript = append(a.CommittedTranscript, publicChatCommittedTranscriptTurn{TurnID: fmt.Sprintf("turn-%03d", i), Sequence: uint64(i), Origin: "user", InputText: fmt.Sprintf("question %d", i), AssistantText: "answer"})
	}
	now := time.Now().UTC()
	a.ConversationContext = publicChatConversationContextSelection{Revision: 2, FirstTurnSequence: 20}
	a.ConversationSummary = &publicChatConversationSummaryState{ContextRevision: 2,
		LastValid:   &publicChatConversationSummaryValidState{Revision: 1, CoveredSequenceStart: 20, CoveredSequenceEnd: 113, Text: "summary", RouteCorrelation: strings.Repeat("a", 64), GeneratedAt: now},
		LastAttempt: publicChatConversationSummaryAttemptState{Status: "ready", TargetSequenceEnd: 113, AttemptedAt: now}}
	expected := captureConversationHistory(*a)
	if expected.err != nil {
		t.Fatal(expected.err)
	}
	if err := s.persistPublicChatSurfaceStateLocked(id); err != nil {
		t.Fatal(err)
	}
	s.chatSurfaceMu.Unlock()
	err := s.loadPublicChatSurfaceStateFromDB()
	s.chatSurfaceMu.Lock()
	if err != nil {
		t.Fatal(err)
	}
	a = s.chatAnchors[id]
	if err := s.loadConversationRowsLocked(context.Background(), a, true); err != nil {
		t.Fatal(err)
	}
	got := captureConversationHistory(*a)
	if !reflect.DeepEqual(expected, got) || len(a.CommittedTranscript) != 7 || a.transcriptBase != 113 || a.transcriptCount() != 120 {
		t.Fatalf("bounded snapshot base=%d count=%d input=%+v", a.transcriptBase, a.transcriptCount(), got)
	}
	original, err := s.committedTurn(a, "turn-001")
	if err != nil || original == nil || original.InputText != "question 1" || len(a.CommittedTranscript) != 7 {
		t.Fatalf("targeted original: %+v %v", original, err)
	}
	a.ConversationContext = publicChatConversationContextSelection{Revision: 3, FirstTurnSequence: 20}
	if err := s.loadConversationRowsLocked(context.Background(), a, true); err != nil {
		t.Fatal(err)
	}
	if len(a.CommittedTranscript) != 100 || a.transcriptBase != 20 {
		t.Fatal("new revision did not restore the unsummarized selection")
	}
	got = captureConversationHistory(*a)
	if got.err != nil || len(got.pairs) != 100 || got.pairs[0].Sequence != 20 {
		t.Fatal("unsummarized selected input was lost")
	}
	if err := s.loadConversationFactsLocked(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if a.transcriptBase != 0 || len(a.CommittedTranscript) != 120 || a.workingFacts {
		t.Fatal("explicit full read lost older facts")
	}
}

func clonePublicChatAnchorState(anchor *publicChatAnchorState) *publicChatAnchorState {
	if anchor == nil {
		return nil
	}
	cloned := *anchor
	cloned.CommittedTranscript = clonePublicChatCommittedTranscript(anchor.CommittedTranscript)
	cloned.ConversationSummary = clonePublicChatConversationSummary(anchor.ConversationSummary)
	cloned.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(anchor.ActiveTurnSnapshot)
	cloned.LastTurnSnapshot = clonePublicChatTurnProjectionState(anchor.LastTurnSnapshot)
	cloned.CompletedTurnSnapshots = clonePublicChatTurnProjectionStateMap(anchor.CompletedTurnSnapshots)
	cloned.VoiceSidecars = clonePublicChatVoiceSidecars(anchor.VoiceSidecars)
	return &cloned
}
