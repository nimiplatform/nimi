package runtimeagent

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.agent-service.r021
// Snapshots scoped to one anchor never overwrite another anchor. Versions are
// checked per row because best-effort projections may commit out of order.
func persistPublicChatSurfaceStateTx(tx *sql.Tx, snapshot persistedPublicChatSurfaceState) error {
	anchors := make(map[string]bool, len(snapshot.Anchors))
	for _, anchor := range snapshot.Anchors {
		id := anchor.ConversationAnchorID
		anchors[id] = true
		var version uint64
		err := tx.QueryRow(`SELECT version FROM runtime_conversation_anchor WHERE anchor_id=?`, id).Scan(&version)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if version > snapshot.Version {
			continue
		}
		var stored int
		if err := tx.QueryRow(`SELECT COALESCE(MAX(sequence)+1,0) FROM runtime_conversation_turn WHERE anchor_id=?`, id).Scan(&stored); err != nil {
			return err
		}
		count := anchor.TranscriptFrom + len(anchor.CommittedTranscript)
		if anchor.TranscriptFrom > stored || count < stored {
			return fmt.Errorf("conversation %s transcript continuity changed", id)
		}
		turns := anchor.CommittedTranscript
		anchor.CommittedTranscript = nil
		raw, err := json.Marshal(anchor)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_conversation_anchor(anchor_id,version,anchor_json) VALUES(?,?,?) ON CONFLICT(anchor_id) DO UPDATE SET version=excluded.version,anchor_json=excluded.anchor_json`, id, snapshot.Version, string(raw)); err != nil {
			return err
		}
		for i, turn := range turns {
			if turn.Sequence != uint64(anchor.TranscriptFrom+i) {
				return fmt.Errorf("conversation %s transcript sequence invalid", id)
			}
			raw, err := json.Marshal(turn)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_conversation_turn(anchor_id,sequence,turn_json) VALUES(?,?,?) ON CONFLICT(anchor_id,sequence) DO UPDATE SET turn_json=excluded.turn_json WHERE turn_json<>excluded.turn_json`, id, turn.Sequence, string(raw)); err != nil {
				return err
			}
		}
	}
	// Deletion retains only a content-free version tombstone, so a previously
	// captured projection cannot recreate the deleted history.
	anchorFilter, anchorArgs := conversationScope(snapshot.AnchorScope, "anchor_id", snapshot.Version)
	rows, err := tx.Query(`SELECT anchor_id FROM runtime_conversation_anchor WHERE anchor_json IS NOT NULL AND version<=?`+anchorFilter, anchorArgs...)
	if err != nil {
		return err
	}
	var removed []string
	scope := make(map[string]bool, len(snapshot.AnchorScope))
	for _, id := range snapshot.AnchorScope {
		scope[id] = true
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return err
		}
		if !anchors[id] && (len(scope) == 0 || scope[id]) {
			removed = append(removed, id)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range removed {
		if _, err := tx.Exec(`UPDATE runtime_conversation_anchor SET anchor_json=NULL,version=? WHERE anchor_id=?`, snapshot.Version, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_conversation_turn WHERE anchor_id=?`, id); err != nil {
			return err
		}
	}
	followups := make(map[string]bool, len(snapshot.FollowUps))
	for _, followup := range snapshot.FollowUps {
		var live int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_conversation_anchor WHERE anchor_id=? AND anchor_json IS NOT NULL`, followup.ConversationAnchorID).Scan(&live); err != nil {
			return err
		}
		if live == 0 {
			continue
		}
		followups[followup.FollowUpID] = true
		raw, err := json.Marshal(followup)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_conversation_followup(followup_id,anchor_id,version,followup_json) VALUES(?,?,?,?) ON CONFLICT(followup_id) DO UPDATE SET anchor_id=excluded.anchor_id,version=excluded.version,followup_json=excluded.followup_json WHERE version<=excluded.version`, followup.FollowUpID, followup.ConversationAnchorID, snapshot.Version, string(raw)); err != nil {
			return err
		}
	}
	rows, err = tx.Query(`SELECT followup_id,anchor_id FROM runtime_conversation_followup WHERE followup_json IS NOT NULL AND version<=?`+anchorFilter, anchorArgs...)
	if err != nil {
		return err
	}
	removed = nil
	for rows.Next() {
		var id, anchor string
		if err := rows.Scan(&id, &anchor); err != nil {
			_ = rows.Close()
			return err
		}
		if !followups[id] && (len(scope) == 0 || scope[anchor]) {
			removed = append(removed, id)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range removed {
		if _, err := tx.Exec(`UPDATE runtime_conversation_followup SET followup_json=NULL,version=? WHERE followup_id=?`, snapshot.Version, id); err != nil {
			return err
		}
	}
	marker, err := json.Marshal(persistedPublicChatSurfaceState{StorageVersion: 2, Version: snapshot.Version, SavedAt: snapshot.SavedAt})
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE COALESCE(CAST(json_extract(value,'$.version') AS INTEGER),0)<=?`, runtimeAgentMetaPublicChatSurfaceStateKey, string(marker), snapshot.Version); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<=?`, runtimeAgentMetaPublicChatSurfaceVersionKey, encodeSequenceValue(snapshot.Version), snapshot.Version)
	return err
}

func conversationScope(ids []string, column string, version uint64) (string, []any) {
	args := []any{version}
	if len(ids) == 0 {
		return "", args
	}
	for _, id := range ids {
		args = append(args, id)
	}
	return " AND " + column + " IN (" + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + ")", args
}

func (s *Service) markPersistedTranscriptLocked(snapshot persistedPublicChatSurfaceState) {
	for _, item := range snapshot.Anchors {
		count := item.TranscriptFrom + len(item.CommittedTranscript)
		if live := s.chatAnchors[item.ConversationAnchorID]; live != nil && count > live.persistedTranscriptCount {
			live.persistedTranscriptCount = count
		}
	}
}

func decodeConversationRow(raw string, out any) error {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("conversation storage contains trailing JSON")
	}
	return nil
}

func readConversationRows(db *sql.DB, raw string) (persistedPublicChatSurfaceState, error) {
	var snapshot persistedPublicChatSurfaceState
	if err := decodeConversationRow(raw, &snapshot); err != nil {
		return snapshot, err
	}
	if snapshot.StorageVersion != 2 {
		return snapshot, fmt.Errorf("conversation storage requires explicit offline conversion: run runtime:convert-chat-storage with the stopped Runtime database")
	}
	if len(snapshot.Anchors) > 0 || len(snapshot.FollowUps) > 0 {
		return snapshot, fmt.Errorf("conversation storage marker contains inline history")
	}
	rows, err := db.Query(`SELECT anchor_id,anchor_json FROM runtime_conversation_anchor WHERE anchor_json IS NOT NULL ORDER BY anchor_id`)
	if err != nil {
		return snapshot, err
	}
	indices := make(map[string]int)
	for rows.Next() {
		var id, text string
		if err := rows.Scan(&id, &text); err != nil {
			_ = rows.Close()
			return snapshot, err
		}
		var anchor persistedPublicChatAnchor
		if err := decodeConversationRow(text, &anchor); err != nil {
			_ = rows.Close()
			return snapshot, err
		}
		if anchor.ConversationAnchorID != id || len(anchor.CommittedTranscript) > 0 {
			_ = rows.Close()
			return snapshot, fmt.Errorf("conversation row identity or transcript invalid")
		}
		indices[id] = len(snapshot.Anchors)
		snapshot.Anchors = append(snapshot.Anchors, anchor)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return snapshot, err
	}
	if err := rows.Close(); err != nil {
		return snapshot, err
	}
	rows, err = db.Query(`SELECT anchor_id,sequence,turn_json FROM runtime_conversation_turn ORDER BY anchor_id,sequence`)
	if err != nil {
		return snapshot, err
	}
	for rows.Next() {
		var id, text string
		var seq uint64
		if err := rows.Scan(&id, &seq, &text); err != nil {
			_ = rows.Close()
			return snapshot, err
		}
		index, ok := indices[id]
		if !ok {
			_ = rows.Close()
			return snapshot, fmt.Errorf("orphaned conversation turn")
		}
		var turn publicChatCommittedTranscriptTurn
		if err := decodeConversationRow(text, &turn); err != nil {
			_ = rows.Close()
			return snapshot, err
		}
		if seq != turn.Sequence || seq != uint64(len(snapshot.Anchors[index].CommittedTranscript)) {
			_ = rows.Close()
			return snapshot, fmt.Errorf("conversation sequence mismatch")
		}
		snapshot.Anchors[index].CommittedTranscript = append(snapshot.Anchors[index].CommittedTranscript, turn)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return snapshot, err
	}
	if err := rows.Close(); err != nil {
		return snapshot, err
	}
	rows, err = db.Query(`SELECT followup_id,followup_json FROM runtime_conversation_followup WHERE followup_json IS NOT NULL ORDER BY followup_id`)
	if err != nil {
		return snapshot, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id, text string
		if err := rows.Scan(&id, &text); err != nil {
			return snapshot, err
		}
		var followup persistedPublicChatFollowUp
		if err := decodeConversationRow(text, &followup); err != nil {
			return snapshot, err
		}
		if id != followup.FollowUpID {
			return snapshot, fmt.Errorf("conversation followup identity mismatch")
		}
		snapshot.FollowUps = append(snapshot.FollowUps, followup)
	}
	return snapshot, rows.Err()
}
