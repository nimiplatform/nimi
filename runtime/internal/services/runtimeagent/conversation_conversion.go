package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

// ConvertConversationStorage is used only by the explicit offline tool. Runtime
// startup never reads the retired inline layout as an alternate storage path.
// It preserves canonical records and refuses malformed history before writing.
func ConvertConversationStorage(ctx context.Context, db *sql.DB, apply bool) (bool, error) {
	var raw string
	err := db.QueryRowContext(ctx, `SELECT value FROM runtime_local_agent_meta WHERE key=?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var snapshot persistedPublicChatSurfaceState
	if err := decodeConversationRow(raw, &snapshot); err != nil {
		return false, err
	}
	if snapshot.StorageVersion == 2 {
		return false, nil
	}
	if snapshot.StorageVersion != 0 {
		return false, fmt.Errorf("unsupported conversation storage version %d", snapshot.StorageVersion)
	}
	if err := validatePersistedPublicChatConversationSingletons(snapshot.Anchors); err != nil {
		return false, err
	}
	for _, anchor := range snapshot.Anchors {
		if err := validatePublicChatCommittedTranscript(anchor.CommittedTranscript); err != nil {
			return false, err
		}
		if err := validatePublicChatConversationSummary(anchor.ConversationSummary, anchor.CommittedTranscript); err != nil {
			return false, err
		}
	}
	if !apply {
		return true, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	// A concurrently changed input is never silently overwritten.
	var current string
	if err := tx.QueryRowContext(ctx, `SELECT value FROM runtime_local_agent_meta WHERE key=?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&current); err != nil {
		return false, err
	}
	if current != raw {
		return false, fmt.Errorf("conversation storage changed during offline conversion")
	}
	for _, stmt := range runtimepersistence.ConversationStorageSchema() {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return false, err
		}
	}
	for _, table := range []string{"runtime_conversation_anchor", "runtime_conversation_turn", "runtime_conversation_followup"} {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
			return false, err
		}
		if count != 0 {
			return false, fmt.Errorf("conversation row storage already contains data")
		}
	}
	if err := persistPublicChatSurfaceStateTx(tx, snapshot); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}
