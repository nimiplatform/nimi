package runtimeagent

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func TestRuntimeAgentDropsPreCoreHardcutRealmAgentState(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)

	const localRef = "local-agent:user-legacy:runtime-source-legacy"
	if err := seedPreCoreHardcutRuntimeAgentState(memorySvc.PersistenceBackend().WriteTx, localRef); err != nil {
		t.Fatalf("seed pre-core hardcut state: %v", err)
	}

	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	for _, table := range []string{
		"runtime_local_agent",
		"runtime_local_agent_state_projection",
		"runtime_local_agent_hook",
		"runtime_local_agent_event_log",
		"runtime_local_agent_behavioral_posture",
		"runtime_local_agent_review_run",
	} {
		if got := runtimeAgentRowCount(t, svc, table, "local_agent_ref", localRef); got != 0 {
			t.Fatalf("%s rows for pre-core local agent = %d, want 0", table, got)
		}
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_review_followup", "bank_locator_key", "agent-core:legacy"); got != 0 {
		t.Fatalf("runtime_local_agent_review_followup rows for pre-core agent bank = %d, want 0", got)
	}
	var sequence string
	if err := svc.backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'agent_event_sequence'`).Scan(&sequence); err != nil {
		t.Fatalf("query reset agent_event_sequence: %v", err)
	}
	if sequence != "0" {
		t.Fatalf("agent_event_sequence = %q, want 0", sequence)
	}
	publicChatState, err := svc.runtimeAgentMetaValue(runtimeAgentMetaPublicChatSurfaceStateKey)
	if err != nil {
		t.Fatalf("query public chat surface state: %v", err)
	}
	if publicChatState != "" {
		t.Fatalf("public chat surface state survived hardcut purge: %s", publicChatState)
	}
	anchorMetadata, err := svc.runtimeAgentMetaValue(runtimeAgentConversationAnchorMetadataKey("agent_anchor_legacy"))
	if err != nil {
		t.Fatalf("query public chat anchor metadata: %v", err)
	}
	if anchorMetadata != "" {
		t.Fatalf("public chat anchor metadata survived hardcut purge: %s", anchorMetadata)
	}
}

func TestRuntimeAgentDropsPreCoreHardcutPublicChatSurfaceStateWithoutAgentRows(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)

	const localRef = "local-agent:user-legacy:realm-agent-legacy"
	if err := seedPreCoreHardcutPublicChatSurfaceState(memorySvc.PersistenceBackend().WriteTx, localRef); err != nil {
		t.Fatalf("seed pre-core public chat state: %v", err)
	}

	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	publicChatState, err := svc.runtimeAgentMetaValue(runtimeAgentMetaPublicChatSurfaceStateKey)
	if err != nil {
		t.Fatalf("query public chat surface state: %v", err)
	}
	if publicChatState != "" {
		t.Fatalf("public chat surface state survived standalone hardcut purge: %s", publicChatState)
	}
}

func seedPreCoreHardcutRuntimeAgentState(writeTx func(context.Context, func(*sql.Tx) error) error, localRef string) error {
	return writeTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(
			`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`,
			localRef,
			`{"agentId":"agent-legacy","displayName":"Legacy","localAgentRef":"`+localRef+`","ownerUserId":"user-legacy","runtimeSourceRef":"runtime-source-legacy","realmAgentId":"realm-agent-legacy"}`,
		); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_state_projection(local_agent_ref, state_json) VALUES (?, '{}')`, localRef); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_hook(local_agent_ref, hook_id, status, scheduled_for, hook_json) VALUES (?, 'hook-legacy', 1, '2026-06-18T00:00:00Z', '{}')`, localRef); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_event_log(sequence, local_agent_ref, event_type, timestamp, event_json) VALUES (17, ?, 1, '2026-06-18T00:00:00Z', '{}')`, localRef); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_behavioral_posture(local_agent_ref, status_text, truth_basis_json, posture_json, updated_at) VALUES (?, '', '{}', '{}', '2026-06-18T00:00:00Z')`, localRef); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_review_run(review_run_id, local_agent_ref, bank_locator_key, status, prepared_outcomes_json, created_at, updated_at) VALUES ('review-legacy', ?, 'agent-core:legacy', 'prepared', '{}', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z')`, localRef); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_review_followup(bank_locator_key, review_run_id, completed_at) VALUES ('agent-core:legacy', 'review-legacy', '2026-06-18T00:00:00Z')`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('agent_event_sequence', '17') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, '8')`, runtimeAgentMetaPublicChatSurfaceVersionKey); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)`, runtimeAgentMetaPublicChatSurfaceStateKey, `{"version":8,"anchors":[{"conversationAnchorId":"agent_anchor_legacy","agentId":"agent-legacy","localAgentRef":"`+localRef+`","ownerUserId":"user-legacy","callerAppId":"desktop","subjectUserId":"user-legacy","threadId":"thread-legacy","binding":{},"systemPrompt":"","maxTokens":1,"transcript":[]}],"followUps":[],"avatarLiveInstances":[]}`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, '{}')`, runtimeAgentConversationAnchorMetadataKey("agent_anchor_legacy")); err != nil {
			return err
		}
		return nil
	})
}

func seedPreCoreHardcutPublicChatSurfaceState(writeTx func(context.Context, func(*sql.Tx) error) error, localRef string) error {
	return writeTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, '3')`, runtimeAgentMetaPublicChatSurfaceVersionKey); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)`, runtimeAgentMetaPublicChatSurfaceStateKey, `{"version":3,"anchors":[{"conversationAnchorId":"agent_anchor_legacy","agentId":"agent-legacy","localAgentRef":"`+localRef+`","ownerUserId":"user-legacy","callerAppId":"desktop","subjectUserId":"user-legacy","threadId":"thread-legacy","binding":{},"systemPrompt":"","maxTokens":1,"transcript":[]}],"followUps":[],"avatarLiveInstances":[]}`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, '{}')`, runtimeAgentConversationAnchorMetadataKey("agent_anchor_legacy")); err != nil {
			return err
		}
		return nil
	})
}
