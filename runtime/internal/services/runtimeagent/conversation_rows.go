package runtimeagent

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const conversationStorageVersion = 3

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
		header := anchor
		if header.ActiveTurnSnapshot != nil {
			header.ActiveSnapshotID = header.ActiveTurnSnapshot.TurnID
		}
		if header.LastTurnSnapshot != nil {
			header.LastSnapshotID = header.LastTurnSnapshot.TurnID
		}
		header.CommittedTranscript, header.ActiveTurnSnapshot, header.LastTurnSnapshot = nil, nil, nil
		header.CompletedTurnSnapshots, header.VoiceSidecars, header.VoiceRenderRequests = nil, nil, nil
		watermark := header.LocalAppSequence
		header.LocalAppSequence = 0
		raw, err := json.Marshal(header)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_conversation_anchor(anchor_id,version,local_agent_ref,through_sequence,anchor_json) VALUES(?,?,?,?,?) ON CONFLICT(anchor_id) DO UPDATE SET version=excluded.version,local_agent_ref=excluded.local_agent_ref,through_sequence=MAX(through_sequence,excluded.through_sequence),anchor_json=excluded.anchor_json`, id, snapshot.Version, anchor.LocalAgentRef, watermark, string(raw)); err != nil {
			return err
		}
		for i, turn := range turns {
			if err := writeCommittedConversationTurn(tx, id, turn, uint64(anchor.TranscriptFrom+i), turn.Sequence < uint64(stored)); err != nil {
				return err
			}
		}
		if err := writeConversationChildren(tx, &anchor); err != nil {
			return err
		}
		for _, item := range anchor.Recoveries {
			if err := persistPublicChatRecoveryTx(tx, id, snapshot.Version, item, true); err != nil {
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
		if _, err := tx.Exec(`UPDATE runtime_conversation_anchor SET anchor_json=NULL,local_agent_ref=NULL,through_sequence=0,message_count=0,title_preview='',last_role='',last_preview='',version=? WHERE anchor_id=?`, snapshot.Version, id); err != nil {
			return err
		}
		for _, table := range []string{"runtime_conversation_message_ref", "runtime_conversation_turn", "runtime_conversation_recovery", "runtime_conversation_projection", "runtime_conversation_voice", "runtime_conversation_voice_request"} {
			if _, err := tx.Exec("DELETE FROM "+table+" WHERE anchor_id=?", id); err != nil {
				return err
			}
		}
	}
	followups := make(map[string]bool, len(snapshot.FollowUps))
	for _, followup := range snapshot.FollowUps {
		var live int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_conversation_anchor WHERE anchor_id=? AND version<=? AND anchor_json IS NOT NULL`, followup.ConversationAnchorID, snapshot.Version).Scan(&live); err != nil {
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
	marker, err := json.Marshal(persistedPublicChatSurfaceState{StorageVersion: conversationStorageVersion, Version: snapshot.Version, SavedAt: snapshot.SavedAt})
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE COALESCE(CAST(json_extract(value,'$.version') AS INTEGER),0)<=?`, runtimeAgentMetaPublicChatSurfaceStateKey, string(marker), snapshot.Version); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<=?`, runtimeAgentMetaPublicChatSurfaceVersionKey, encodeSequenceValue(snapshot.Version), snapshot.Version)
	return err
}

func writeCommittedConversationTurn(tx *sql.Tx, anchorID string, turn publicChatCommittedTranscriptTurn, sequence uint64, existing bool) error {
	if err := validateCommittedConversationTurn(turn, sequence); err != nil {
		return err
	}
	raw, err := json.Marshal(turn)
	if err != nil {
		return err
	}
	inputID := firstNonEmpty(turn.InputTurnID, turn.TurnID)
	if err := indexConversationMessageRefs(tx, anchorID, turn.TurnID, inputID, turn.InputAttachment, turn.OutputArtifacts); err != nil {
		return err
	}
	visible := 0
	role, lastText := "", ""
	if turn.Origin == publicChatTurnOriginUser || turn.Origin == publicChatTurnOriginApp {
		visible = 1 + len(turn.OutputArtifacts)
		if turn.InputText != "" {
			role, lastText = "user", turn.InputText
			if turn.Origin == publicChatTurnOriginApp {
				role = "system"
			}
		}
		if turn.AssistantText != "" {
			role, lastText = "assistant", turn.AssistantText
			visible++
		}
	}
	displayCount, displayBytes := len(turn.OutputArtifacts), len(turn.AssistantText)
	answered := turn.AssistantText != ""
	if answered {
		displayCount++
	}
	var inputBytes any
	if turn.Origin == publicChatTurnOriginUser || turn.Origin == publicChatTurnOriginApp {
		displayCount++
		n := conversationMessageContentBytes(localAppConversationUserMessage(turn))
		displayBytes += n
		inputBytes = n
	}
	if existing {
		var before int
		if err := tx.QueryRow(`SELECT visible_count FROM runtime_conversation_turn WHERE anchor_id=? AND turn_id=? AND sequence=? AND input_turn_id=?`, anchorID, turn.TurnID, sequence, inputID).Scan(&before); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE runtime_conversation_turn SET turn_json=?,visible_count=?,display_count=?,display_bytes=? WHERE anchor_id=? AND turn_id=? AND turn_json<>?`, string(raw), visible, displayCount, displayBytes, anchorID, turn.TurnID, string(raw)); err != nil {
			return err
		}
		if visible != before {
			_, err = tx.Exec(`UPDATE runtime_conversation_anchor SET message_count=message_count+? WHERE anchor_id=?`, visible-before, anchorID)
		}
		return err
	}
	if _, err := tx.Exec(`INSERT INTO runtime_conversation_turn(anchor_id,turn_id,sequence,input_turn_id,visible_count,display_count,display_bytes,input_bytes,answered,turn_json) VALUES(?,?,?,?,?,?,?,?,?,?)`, anchorID, turn.TurnID, sequence, inputID, visible, displayCount, displayBytes, inputBytes, answered, string(raw)); err != nil {
		return err
	}
	title := ""
	if turn.Origin == publicChatTurnOriginUser {
		title = compactAgentConversationSummaryText(turn.InputText, 80)
	}
	if _, err := tx.Exec(`UPDATE runtime_conversation_anchor SET message_count=message_count+?,
		title_preview=CASE WHEN title_preview='' THEN ? ELSE title_preview END,
		last_role=CASE WHEN ?<>'' THEN ? ELSE last_role END,
		last_preview=CASE WHEN ?<>'' THEN ? ELSE last_preview END WHERE anchor_id=?`,
		visible, title, role, role, role, compactAgentConversationSummaryText(lastText, 280), anchorID); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO runtime_conversation_projection(anchor_id,turn_id,sequence,committed_order) VALUES(?,?,?,?) ON CONFLICT(anchor_id,turn_id) DO UPDATE SET sequence=excluded.sequence,committed_order=excluded.committed_order WHERE sequence IS NULL`, anchorID, turn.TurnID, sequence, conversationOrderTime(turn.CommittedAt))
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
		if live := s.chatAnchors[item.ConversationAnchorID]; live != nil {
			live.persistedTranscriptCount = max(live.persistedTranscriptCount, count)
			for id, revision := range item.capturedTurns {
				if live.dirtyTurns[id] == revision {
					delete(live.dirtyTurns, id)
				}
			}
			for key, id := range item.VoiceRenderRequests {
				if live.dirtyVoiceRequests[key] == id {
					delete(live.dirtyVoiceRequests, key)
				}
			}
			if live.ActiveTurnSnapshot == item.capturedActive {
				live.persistedActive = item.capturedActive
			}
			if live.LastTurnSnapshot == item.capturedLast {
				live.persistedLast = item.capturedLast
			}
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

func readConversationHeaders(db conversationRowReader, raw string) (persistedPublicChatSurfaceState, map[string]int, error) {
	var snapshot persistedPublicChatSurfaceState
	if err := decodeConversationRow(raw, &snapshot); err != nil {
		return snapshot, nil, err
	}
	if snapshot.StorageVersion != conversationStorageVersion {
		return snapshot, nil, conversationStorageConversionRefusal()
	}
	if len(snapshot.Anchors) > 0 || len(snapshot.FollowUps) > 0 {
		return snapshot, nil, fmt.Errorf("conversation storage marker contains inline history")
	}
	rows, err := db.Query(`SELECT anchor_id,anchor_json,through_sequence FROM runtime_conversation_anchor WHERE anchor_json IS NOT NULL ORDER BY anchor_id`)
	if err != nil {
		return snapshot, nil, err
	}
	indices := make(map[string]int)
	for rows.Next() {
		var id, text string
		var watermark uint64
		if err := rows.Scan(&id, &text, &watermark); err != nil {
			_ = rows.Close()
			return snapshot, nil, err
		}
		var anchor persistedPublicChatAnchor
		if err := decodeConversationRow(text, &anchor); err != nil {
			_ = rows.Close()
			return snapshot, nil, err
		}
		if anchor.ConversationAnchorID != id || len(anchor.CommittedTranscript) > 0 || anchor.LastTurnSnapshot != nil ||
			anchor.ActiveTurnSnapshot != nil || len(anchor.CompletedTurnSnapshots) > 0 || len(anchor.VoiceSidecars) > 0 || len(anchor.VoiceRenderRequests) > 0 {
			_ = rows.Close()
			return snapshot, nil, fmt.Errorf("conversation row identity or transcript invalid")
		}
		anchor.LocalAppSequence = watermark
		indices[id] = len(snapshot.Anchors)
		snapshot.Anchors = append(snapshot.Anchors, anchor)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return snapshot, nil, err
	}
	if err := rows.Close(); err != nil {
		return snapshot, nil, err
	}
	return snapshot, indices, nil
}

func readConversationRows(db conversationRowReader, raw string) (persistedPublicChatSurfaceState, error) {
	snapshot, indices, err := readConversationHeaders(db, raw)
	if err != nil {
		return snapshot, err
	}
	if err := readConversationFacts(db, &snapshot, indices, "", 0, true); err != nil {
		return snapshot, err
	}
	return snapshot, readConversationTimers(db, &snapshot)
}

func conversationAnchorPredicate(scope string) (string, []any) {
	if scope == "" {
		return "", nil
	}
	return " AND anchor_id=?", []any{scope}
}

func readConversationFacts(db conversationRowReader, snapshot *persistedPublicChatSurfaceState, indices map[string]int, scope string, first int, children bool) error {
	where, args := conversationAnchorPredicate(scope)
	rows, err := db.Query(`SELECT anchor_id,turn_id,sequence,turn_json FROM runtime_conversation_turn WHERE sequence>=?`+where+" ORDER BY anchor_id,sequence", append([]any{first}, args...)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, text string
		var seq uint64
		var turnID string
		if err := rows.Scan(&id, &turnID, &seq, &text); err != nil {
			_ = rows.Close()
			return err
		}
		index, ok := indices[id]
		if !ok {
			_ = rows.Close()
			return fmt.Errorf("orphaned conversation turn")
		}
		var turn publicChatCommittedTranscriptTurn
		if err := decodeConversationRow(text, &turn); err != nil {
			_ = rows.Close()
			return err
		}
		if turnID != turn.TurnID || seq != turn.Sequence || seq != uint64(first+len(snapshot.Anchors[index].CommittedTranscript)) {
			_ = rows.Close()
			return fmt.Errorf("conversation sequence mismatch")
		}
		if err := validateCommittedConversationTurn(turn, seq); err != nil {
			_ = rows.Close()
			return err
		}
		snapshot.Anchors[index].CommittedTranscript = append(snapshot.Anchors[index].CommittedTranscript, turn)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if !children {
		return nil
	}
	if err := readConversationChildren(db, snapshot, indices, scope); err != nil {
		return err
	}
	if err := readPublicChatRecoveries(db, snapshot, indices, scope); err != nil {
		return err
	}
	return nil
}

func readConversationTimers(db conversationRowReader, snapshot *persistedPublicChatSurfaceState) error {
	rows, err := db.Query(`SELECT followup_id,followup_json FROM runtime_conversation_followup WHERE followup_json IS NOT NULL ORDER BY followup_id`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id, text string
		if err := rows.Scan(&id, &text); err != nil {
			return err
		}
		var followup persistedPublicChatFollowUp
		if err := decodeConversationRow(text, &followup); err != nil {
			return err
		}
		if id != followup.FollowUpID {
			return fmt.Errorf("conversation followup identity mismatch")
		}
		snapshot.FollowUps = append(snapshot.FollowUps, followup)
	}
	return rows.Err()
}
