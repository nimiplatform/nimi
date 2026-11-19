package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

// ConvertConversationStorage is used only by the explicit offline tool. Runtime
// startup never reads the retired inline layout as an alternate storage path.
// It preserves canonical records and refuses malformed history before writing.
func ConvertConversationStorage(ctx context.Context, db *sql.DB, apply bool) (bool, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: !apply})
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	raw, err := readRuntimeAgentMetaValue(tx, runtimeAgentMetaPublicChatSurfaceStateKey)
	if err != nil {
		return false, err
	}
	var oldColumns int
	if err := tx.QueryRow(`SELECT count(*) FROM pragma_table_info('runtime_conversation_anchor') WHERE name='anchor_json' AND NOT EXISTS (SELECT 1 FROM pragma_table_info('runtime_conversation_anchor') WHERE name='through_sequence')`).Scan(&oldColumns); err != nil {
		return false, err
	}
	var snapshot persistedPublicChatSurfaceState
	if raw == "" && oldColumns == 0 {
		return false, nil
	}
	if raw != "" {
		if err := decodeConversationRow(raw, &snapshot); err != nil {
			return false, err
		}
		if snapshot.StorageVersion == conversationStorageVersion && oldColumns == 0 {
			return false, nil
		}
	}
	switch snapshot.StorageVersion {
	case 0:
	case 2:
		if oldColumns != 1 {
			return false, fmt.Errorf("retired conversation schema does not match its marker")
		}
		if err := readOfflineConversationV2(tx, &snapshot); err != nil {
			return false, err
		}
	default:
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
	if oldColumns != 0 && snapshot.StorageVersion == 0 {
		for _, table := range []string{"runtime_conversation_anchor", "runtime_conversation_turn", "runtime_conversation_recovery", "runtime_conversation_followup"} {
			var exists int
			if err := tx.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='table' AND name=?`, table).Scan(&exists); err != nil {
				return false, err
			}
			if exists == 0 {
				continue
			}
			var populated bool
			if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM " + table + ")").Scan(&populated); err != nil {
				return false, err
			}
			if populated {
				return false, fmt.Errorf("conversation storage contains rows without a matching v2 marker")
			}
		}
	}
	if oldColumns != 0 {
		for _, table := range []string{"runtime_conversation_recovery", "runtime_conversation_followup", "runtime_conversation_turn", "runtime_conversation_anchor"} {
			if _, err := tx.Exec("DROP TABLE IF EXISTS " + table); err != nil {
				return false, err
			}
		}
		if _, err := tx.Exec(`DELETE FROM runtime_local_agent_meta WHERE key='local_app_conversation_sequences'`); err != nil {
			return false, err
		}
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

// Only the stopped-database converter accepts v2. Its caller takes a backup
// before apply. No service entry uses this reader.
func readOfflineConversationV2(tx *sql.Tx, snapshot *persistedPublicChatSurfaceState) error {
	if len(snapshot.Anchors) != 0 || len(snapshot.FollowUps) != 0 {
		return fmt.Errorf("v2 marker contains inline records")
	}
	sequences := map[string]uint64{}
	raw, err := readRuntimeAgentMetaValue(tx, "local_app_conversation_sequences")
	if err != nil {
		return err
	}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &sequences); err != nil {
			return err
		}
	}
	indices := map[string]int{}
	rows, err := tx.Query(`SELECT anchor_id,anchor_json FROM runtime_conversation_anchor WHERE anchor_json IS NOT NULL`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, raw string
		var a persistedPublicChatAnchor
		if err := rows.Scan(&id, &raw); err != nil {
			rows.Close()
			return err
		}
		if err := decodeConversationRow(raw, &a); err != nil {
			rows.Close()
			return err
		}
		if id != a.ConversationAnchorID || len(a.CommittedTranscript) > 0 {
			rows.Close()
			return fmt.Errorf("invalid v2 conversation header")
		}
		a.LocalAppSequence = max(a.LocalAppSequence, sequences[id])
		indices[id] = len(snapshot.Anchors)
		snapshot.Anchors = append(snapshot.Anchors, a)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	rows, err = tx.Query(`SELECT anchor_id,sequence,turn_json FROM runtime_conversation_turn ORDER BY anchor_id,sequence`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, raw string
		var seq uint64
		var turn publicChatCommittedTranscriptTurn
		if err := rows.Scan(&id, &seq, &raw); err != nil {
			rows.Close()
			return err
		}
		if err := decodeConversationRow(raw, &turn); err != nil {
			rows.Close()
			return err
		}
		i, ok := indices[id]
		if !ok || seq != turn.Sequence || seq != uint64(len(snapshot.Anchors[i].CommittedTranscript)) {
			rows.Close()
			return fmt.Errorf("v2 conversation sequence invalid")
		}
		snapshot.Anchors[i].CommittedTranscript = append(snapshot.Anchors[i].CommittedTranscript, turn)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := readPublicChatRecoveries(tx, snapshot, indices, ""); err != nil {
		return err
	}
	return readConversationTimers(tx, snapshot)
}
