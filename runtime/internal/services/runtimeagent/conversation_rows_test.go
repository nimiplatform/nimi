package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

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
	if len(svc.chatAnchors[a].CommittedTranscript) != 2 || len(svc.chatAnchors[b].CommittedTranscript) != 1 {
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
	svc.chatSurfaceMu.Unlock()
	for _, snapshot := range []persistedPublicChatSurfaceState{newer, older} {
		if err := svc.chatStateRepo.persistPublicChatSurfaceState(snapshot); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.loadPublicChatSurfaceStateFromDB(); err != nil {
		t.Fatal(err)
	}
	if svc.chatAnchors[a] == nil || svc.chatAnchors[b] == nil {
		t.Fatal("unrelated newer anchor dropped older scoped write")
	}
	deleted := persistedPublicChatSurfaceState{Version: newer.Version + 1, AnchorScope: []string{a}}
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
	if got := svc.chatAnchors[id].CommittedTranscript; len(got) != 1 || got[0].InputText != "preserve this" || got[0].AssistantText != "durable reply" {
		t.Fatalf("conversion lost transcript: %+v", got)
	}
	if changed, err := ConvertConversationStorage(context.Background(), svc.backend.DB(), true); err != nil || changed {
		t.Fatalf("conversion retry: %v %v", changed, err)
	}
}
