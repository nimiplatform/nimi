package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type conversationWindow struct {
	truncated bool
	anchor    publicChatAnchorState
	control   *runtimev1.LocalAppConversationState
	live      map[string]*publicChatTurnProjectionState
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r176
func (s *Service) readConversationWindow(ctx context.Context, resolved localAppAgentIdentity, id, centeredMessage string) (*conversationWindow, error) {
	tx, err := s.chatStateRepo.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	out, header, err := readConversationWindowHeader(ctx, tx, resolved, id)
	if err != nil {
		return nil, err
	}
	if err := readConversationWindowTurns(ctx, tx, out, header, centeredMessage); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func readConversationWindowHeader(ctx context.Context, tx *sql.Tx, resolved localAppAgentIdentity, id string) (*conversationWindow, persistedPublicChatAnchor, error) {
	var header persistedPublicChatAnchor
	var raw string
	var water uint64
	err := tx.QueryRowContext(ctx, `SELECT anchor_json,through_sequence FROM runtime_conversation_anchor WHERE anchor_id=? AND local_agent_ref=? AND anchor_json IS NOT NULL`, id, resolved.identity.LocalAgentRef).Scan(&raw, &water)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, header, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	if err != nil {
		return nil, header, err
	}
	if err := decodeConversationRow(raw, &header); err != nil {
		return nil, header, err
	}
	if header.ConversationAnchorID != id || header.AgentID != resolved.identity.LocalAgentRef || header.LocalAgentRef != resolved.identity.LocalAgentRef ||
		header.OwnerUserID != resolved.decision.AccountID || header.SubjectUserID != resolved.decision.AccountID || header.RuntimeSourceRef != resolved.identity.RuntimeSourceRef ||
		!conversationAnchorIsResumable(runtimev1.ConversationAnchorStatus(header.Status)) {
		return nil, header, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND)
	}
	out := &conversationWindow{
		anchor: publicChatAnchorState{ConversationAnchorID: id, ActiveTurnID: header.ActiveTurnID, LatestAcceptedTurnID: header.LatestAcceptedTurnID,
			LocalAppSequence: water, Recoveries: make(map[string]*publicChatTurnRecovery), CompletedTurnSnapshots: make(map[string]*publicChatTurnProjectionState),
			VoiceSidecars: make(map[string]*publicChatVoiceSidecarState), windowInputs: make(map[string]*publicChatRecoveryInput)},
		control: &runtimev1.LocalAppConversationState{FreeContactEnabled: header.EffectiveFreeContactEnabled, MaxFollowUpTurns: publicChatMaxFollowUpTurns},
		live:    make(map[string]*publicChatTurnProjectionState),
	}
	if header.ActiveTurnID != "" {
		out.control.TextTurnId = &header.ActiveTurnID
	}
	if header.PendingFollowUpID != "" {
		var raw string
		err := tx.QueryRowContext(ctx, `SELECT followup_json FROM runtime_conversation_followup WHERE followup_id=? AND anchor_id=? AND followup_json IS NOT NULL`, header.PendingFollowUpID, id).Scan(&raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, header, err
		}
		if err == nil {
			var item persistedPublicChatFollowUp
			if err := decodeConversationRow(raw, &item); err != nil {
				return nil, header, err
			}
			scheduled, err := time.Parse(time.RFC3339Nano, item.ScheduledFor)
			if err != nil {
				return nil, header, err
			}
			if item.FollowUpID != header.PendingFollowUpID || item.ConversationAnchorID != id {
				return nil, header, fmt.Errorf("conversation follow-up identity mismatch")
			}
			out.control.PendingFollowUp = &runtimev1.LocalAppConversationFollowUp{TaskId: item.FollowUpID, Revision: item.Revision, ScheduledFor: timestamppb.New(scheduled), SourceTurnId: item.SourceTurnID}
		}
	}
	return out, header, nil
}

func readConversationWindowTurns(ctx context.Context, tx *sql.Tx, out *conversationWindow, header persistedPublicChatAnchor, centeredMessage string) error {
	id := header.ConversationAnchorID
	var selector string
	var args []any
	if centeredMessage == "" {
		ids, truncated, err := selectDisplayTurnIDs(ctx, tx, header)
		if err != nil {
			return err
		}
		out.truncated = truncated
		if len(ids) == 0 {
			return nil
		}
		selector = "WITH selected(turn_id) AS (VALUES " + strings.TrimSuffix(strings.Repeat("(?),", len(ids)), ",") + ")"
		args = ids
	} else {
		// Three neighbors on each side include the one-row lookahead used to
		// report truncation. Lookup chronology uses accepted time then id.
		selector = `WITH target AS (
			SELECT p.locate_order,p.turn_id FROM runtime_conversation_message_ref m JOIN runtime_conversation_projection p
			ON p.anchor_id=m.anchor_id AND p.turn_id=m.turn_id WHERE m.anchor_id=? AND m.message_id=?
		), before AS (
			SELECT p.turn_id FROM runtime_conversation_projection p WHERE p.anchor_id=? AND (p.locate_order,p.turn_id)<(SELECT locate_order,turn_id FROM target)
			AND (p.sequence IS NOT NULL OR p.accepted_order IS NOT NULL) ORDER BY p.locate_order DESC,p.turn_id DESC LIMIT 3
		), after AS (
			SELECT p.turn_id FROM runtime_conversation_projection p WHERE p.anchor_id=? AND (p.locate_order,p.turn_id)>(SELECT locate_order,turn_id FROM target)
			AND (p.sequence IS NOT NULL OR p.accepted_order IS NOT NULL) ORDER BY p.locate_order,p.turn_id LIMIT 3
		), selected AS (SELECT turn_id FROM target UNION ALL SELECT turn_id FROM before UNION ALL SELECT turn_id FROM after)`
		args = []any{id, centeredMessage, id, id}
	}
	rows, err := tx.QueryContext(ctx, selector+`
	SELECT p.turn_id,t.sequence,t.turn_json,p.completed,p.projection_json,r.recovery_json,v.voice_json
	FROM selected JOIN runtime_conversation_projection p ON p.anchor_id=? AND p.turn_id=selected.turn_id
	LEFT JOIN runtime_conversation_turn t ON t.anchor_id=p.anchor_id AND t.turn_id=p.turn_id
	LEFT JOIN runtime_conversation_recovery r ON r.anchor_id=p.anchor_id AND r.turn_id=p.turn_id
	LEFT JOIN runtime_conversation_voice v ON v.anchor_id=p.anchor_id AND v.turn_id=p.turn_id`,
		append(args, id)...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var turnID string
		var seq sql.NullInt64
		var transcript, projection, recovery, voice sql.NullString
		var completed bool
		if err := rows.Scan(&turnID, &seq, &transcript, &completed, &projection, &recovery, &voice); err != nil {
			return err
		}
		var body string
		if transcript.Valid {
			var turn publicChatCommittedTranscriptTurn
			if err := decodeConversationRow(transcript.String, &turn); err != nil {
				return err
			}
			if !seq.Valid || seq.Int64 < 0 || turn.TurnID != turnID {
				return fmt.Errorf("conversation transcript identity mismatch")
			}
			if err := validateCommittedConversationTurn(turn, uint64(seq.Int64)); err != nil {
				return err
			}
			body = turn.AssistantText
			out.anchor.CommittedTranscript = append(out.anchor.CommittedTranscript, turn)
		}
		if projection.Valid {
			var item persistedPublicChatTurnSnapshot
			if err := decodeConversationRow(projection.String, &item); err != nil {
				return err
			}
			if item.TurnID != turnID {
				return fmt.Errorf("conversation turn projection identity mismatch")
			}
			if err := restoreConversationProjectionText(&item, body); err != nil {
				return err
			}
			turn := fromPersistedPublicChatTurnSnapshot(&item)
			if completed {
				out.anchor.CompletedTurnSnapshots[turnID] = turn
			}
			if turnID == header.ActiveSnapshotID {
				out.anchor.ActiveTurnSnapshot = turn
				out.live[turnID] = turn
			}
			if !publicChatTurnProjectionIsTerminal(turn) {
				out.live[turnID] = turn
			}
		}
		if recovery.Valid {
			item, err := decodeConversationRecovery(recovery.String, turnID)
			if err != nil {
				return err
			}
			out.anchor.Recoveries[turnID] = item
			if item.Input != nil {
				out.anchor.windowInputs[item.TurnID] = item.Input
			}
		}
		if voice.Valid {
			var value publicChatVoiceSidecarState
			if err := decodeConversationRow(voice.String, &value); err != nil {
				return err
			}
			if value.TurnID != turnID {
				return fmt.Errorf("conversation voice identity mismatch")
			}
			out.anchor.VoiceSidecars[turnID] = &value
		}
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return err
	}
	sort.Slice(out.anchor.CommittedTranscript, func(i, j int) bool {
		return out.anchor.CommittedTranscript[i].Sequence < out.anchor.CommittedTranscript[j].Sequence
	})
	for _, turn := range out.anchor.CommittedTranscript {
		inputID := firstNonEmpty(turn.InputTurnID, turn.TurnID)
		if out.anchor.windowInputs[inputID] == nil {
			out.anchor.windowInputs[inputID] = recoveryInputFromTranscript(turn)
		}
	}
	for _, item := range out.anchor.Recoveries {
		if out.anchor.windowInputs[item.InputTurnID] != nil {
			continue
		}
		input, err := readOriginalConversationInput(ctx, tx, id, item.InputTurnID)
		if err != nil {
			return err
		}
		out.anchor.windowInputs[item.InputTurnID] = input
	}
	return nil
}

// Size the ordered candidates from committed counters before decoding bodies.
// A retry's input belongs to its original turn even outside this window.
func selectDisplayTurnIDs(ctx context.Context, tx *sql.Tx, header persistedPublicChatAnchor) ([]any, bool, error) {
	const costs = `SELECT p.turn_id,t.display_count,t.display_bytes,coalesce(t.answered,0),
		r.input_turn_id,coalesce(o.input_bytes,(SELECT orig.input_bytes FROM runtime_conversation_turn orig WHERE orig.anchor_id=r.anchor_id AND orig.input_turn_id=r.input_turn_id ORDER BY sequence LIMIT 1)),coalesce(r.public_bytes,0)
		FROM runtime_conversation_projection p
		LEFT JOIN runtime_conversation_turn t ON t.anchor_id=p.anchor_id AND t.turn_id=p.turn_id
		LEFT JOIN runtime_conversation_recovery r ON r.anchor_id=p.anchor_id AND r.turn_id=p.turn_id
		LEFT JOIN runtime_conversation_recovery o ON o.anchor_id=r.anchor_id AND o.turn_id=r.input_turn_id
		WHERE p.anchor_id=? `
	var ids []any
	forced := map[string]bool{}
	if header.ActiveTurnID != "" {
		ids = append(ids, header.ActiveTurnID)
		forced[header.ActiveTurnID] = true
	}
	if header.ActiveSnapshotID != "" && !forced[header.ActiveSnapshotID] {
		ids = append(ids, header.ActiveSnapshotID)
		forced[header.ActiveSnapshotID] = true
	}
	type cost struct {
		id                  string
		count, bytes, input sql.NullInt64
		answered            bool
		inputID             sql.NullString
		partial             int
	}
	scan := func(row interface{ Scan(...any) error }) (cost, error) {
		var c cost
		err := row.Scan(&c.id, &c.count, &c.bytes, &c.answered, &c.inputID, &c.input, &c.partial)
		return c, err
	}
	if header.ActiveTurnID == "" && header.LatestAcceptedTurnID != "" && !forced[header.LatestAcceptedTurnID] {
		c, err := scan(tx.QueryRowContext(ctx, costs+" AND p.turn_id=?", header.ConversationAnchorID, header.LatestAcceptedTurnID))
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, false, err
		}
		if err == nil && !c.answered && c.inputID.Valid && c.input.Valid {
			ids = append(ids, c.id)
			forced[c.id] = true
		}
	}
	rows, err := tx.QueryContext(ctx, costs+` AND (p.sequence IS NOT NULL OR p.accepted_order IS NOT NULL OR (p.completed=1 AND p.unfinished=0))
		ORDER BY p.display_order DESC,(p.sequence IS NULL) DESC,p.sequence DESC,p.projection_order DESC,p.turn_id DESC LIMIT ?`, header.ConversationAnchorID, localAppConversationSnapshotMaxMessages+len(forced)+1)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = rows.Close() }()
	var groups, n, bytes int
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			return nil, false, err
		}
		if forced[c.id] {
			continue
		}
		msgs, size := int(c.count.Int64), int(c.bytes.Int64)
		if !c.count.Valid && c.input.Valid {
			msgs++
			size += int(c.input.Int64)
		}
		if !c.answered && c.partial > 0 {
			msgs++
			size += c.partial
		}
		if groups == localAppConversationSnapshotMaxMessages || n+msgs > localAppConversationSnapshotMaxMessages || bytes+size > localAppConversationSnapshotMaxTextBytes {
			return ids, true, nil
		}
		ids = append(ids, c.id)
		groups++
		n += msgs
		bytes += size
	}
	return ids, false, rows.Err()
}

func readOriginalConversationInput(ctx context.Context, tx *sql.Tx, anchorID, inputID string) (*publicChatRecoveryInput, error) {
	var raw string
	err := tx.QueryRowContext(ctx, `SELECT recovery_json FROM runtime_conversation_recovery WHERE anchor_id=? AND turn_id=?`, anchorID, inputID).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		item, err := decodeConversationRecovery(raw, inputID)
		if err != nil {
			return nil, err
		}
		if item.Input != nil {
			return item.Input, nil
		}
	}
	err = tx.QueryRowContext(ctx, `SELECT turn_json FROM runtime_conversation_turn WHERE anchor_id=? AND input_turn_id=? ORDER BY sequence LIMIT 1`, anchorID, inputID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var turn publicChatCommittedTranscriptTurn
	if err := decodeConversationRow(raw, &turn); err != nil {
		return nil, err
	}
	if firstNonEmpty(turn.InputTurnID, turn.TurnID) != inputID {
		return nil, fmt.Errorf("conversation original input identity mismatch")
	}
	if err := validateCommittedConversationTurn(turn, turn.Sequence); err != nil {
		return nil, err
	}
	return recoveryInputFromTranscript(turn), nil
}
