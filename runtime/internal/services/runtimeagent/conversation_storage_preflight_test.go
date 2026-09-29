package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/storedformat"
)

func runtimeDatabaseDigest(t *testing.T, localStatePath string) [32]byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(localStatePath), "memory.db"))
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(raw)
}

// retireConversationStorage rewrites the fixture into the retired inline
// layout the offline converter handles, then closes every owner.
func retireConversationStorage(t *testing.T, localStatePath string) {
	t.Helper()
	svc, closeFn := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	id := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.commitPublicChatTurnTranscript(id, &runtimev1.ChatMessage{Role: "user", Content: "keep me"}, "kept"); err != nil {
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Lock()
	snapshot, err := svc.capturePublicChatSurfaceSnapshotLocked()
	svc.chatSurfaceMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
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
	closeFn()
}

func TestPreflightRefusesRetiredConversationStorageReadOnlyAndMatchesTheOrdinaryLoad(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	retireConversationStorage(t, localStatePath)
	before := runtimeDatabaseDigest(t, localStatePath)

	refusal := PreflightStoredConversation(localStatePath)
	if refusal == nil {
		t.Fatal("retired conversation storage was not classified")
	}
	if refusal.Owner() != conversationStorageOwner || refusal.Handling() != storedformat.OfflineConversion {
		t.Fatalf("refusal = %q/%q", refusal.Owner(), refusal.Handling())
	}
	if runtimeDatabaseDigest(t, localStatePath) != before {
		t.Fatal("classification changed the refused Runtime database")
	}

	// The ordinary owner construction refuses the same data with the same
	// typed refusal, so preflight and load cannot disagree.
	backend, err := runtimepersistence.Open(nil, localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	if _, loadErr := NewWithBackend(nil, localStatePath, backend); loadErr == nil {
		t.Fatal("ordinary construction read retired storage")
	} else if loaded, ok := storedformat.As(loadErr); !ok || loaded.Handling() != storedformat.OfflineConversion {
		t.Fatalf("ordinary construction error = %v", loadErr)
	}

	if changed, err := ConvertConversationStorage(context.Background(), backend.DB(), true); err != nil || !changed {
		t.Fatalf("convert: %v %v", changed, err)
	}
	if refusal := PreflightStoredConversation(localStatePath); refusal != nil {
		t.Fatalf("converted storage still refused: %v", refusal)
	}
}

func TestPreflightLeavesAbsentCurrentAndUnclassifiedStorageToTheOrdinaryOwner(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "local-state.json")
	if refusal := PreflightStoredConversation(missing); refusal != nil {
		t.Fatalf("absent database refused: %v", refusal)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(missing), "memory.db")); !os.IsNotExist(err) {
		t.Fatalf("classification created a database: %v", err)
	}

	current := filepath.Join(t.TempDir(), "local-state.json")
	svc, closeFn := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, current)
	id := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if err := svc.commitPublicChatTurnTranscript(id, &runtimev1.ChatMessage{Role: "user", Content: "hello"}, "hi"); err != nil {
		t.Fatal(err)
	}
	svc.Close()
	closeFn()
	if refusal := PreflightStoredConversation(current); refusal != nil {
		t.Fatalf("current storage refused: %v", refusal)
	}

	// A damaged marker is not this owner's classification; the ordinary load
	// must keep reporting it instead of Runtime entering maintenance.
	damaged := filepath.Join(t.TempDir(), "local-state.json")
	svc, closeFn = newRuntimeAgentServiceForPublicChatStatePathWithClose(t, damaged)
	svc.Close()
	if _, err := svc.backend.DB().Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, '{"storageVersion":2,') ON CONFLICT(key) DO UPDATE SET value=excluded.value`, runtimeAgentMetaPublicChatSurfaceStateKey); err != nil {
		t.Fatal(err)
	}
	closeFn()
	if refusal := PreflightStoredConversation(damaged); refusal != nil {
		t.Fatalf("damaged marker misattributed as refused format: %v", refusal)
	}
}
