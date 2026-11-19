package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
)

func combineConversationReads(a, b *lifeConversationRead) (*lifeConversationRead, error) {
	if a == nil {
		return b, nil
	}
	if b == nil {
		return a, nil
	}
	if a.AnchorID != b.AnchorID || a.Revision != b.Revision {
		return nil, fmt.Errorf("Conversation context changed between reads")
	}
	out := *a
	out.FirstSequence = min(a.FirstSequence, b.FirstSequence)
	return &out, nil
}

func (s *Service) lifeConversationSelection(ref string) *lifeConversationRead {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	for _, anchor := range s.chatAnchors {
		if anchor.LocalAgentRef == ref && conversationAnchorIsResumable(anchor.Status) {
			return &lifeConversationRead{AnchorID: anchor.ConversationAnchorID, Revision: conversationContextRevision(anchor.ConversationContext), FirstSequence: anchor.ConversationContext.FirstTurnSequence}
		}
	}
	return nil
}

func (s *Service) lifeConversationInput(ctx context.Context, ref string) ([]agentTurnTranscriptPairInput, *lifeConversationRead, bool, error) {
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, false, err
	}
	defer tx.Rollback()
	var raw string
	err = tx.QueryRowContext(ctx, `SELECT anchor_json FROM runtime_conversation_anchor WHERE local_agent_ref=? AND anchor_json IS NOT NULL`, ref).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, false, nil
	}
	if err != nil {
		return nil, nil, false, err
	}
	var anchor persistedPublicChatAnchor
	if err := decodeConversationRow(raw, &anchor); err != nil {
		return nil, nil, false, err
	}
	if anchor.LocalAgentRef != ref {
		return nil, nil, false, fmt.Errorf("Life conversation scope mismatch")
	}
	read := &lifeConversationRead{AnchorID: anchor.ConversationAnchorID, Revision: conversationContextRevision(anchor.ConversationContext), FirstSequence: anchor.ConversationContext.FirstTurnSequence}
	rows, err := tx.QueryContext(ctx, `SELECT turn_id,sequence,turn_json FROM runtime_conversation_turn WHERE anchor_id=? AND sequence>=?
		AND json_extract(turn_json,'$.assistantText')<>'' ORDER BY sequence DESC LIMIT ?`, read.AnchorID, read.FirstSequence, publicChatRecentVerbatimTurnLimit)
	if err != nil {
		return nil, nil, false, err
	}
	defer rows.Close()
	var pairs []agentTurnTranscriptPairInput
	for rows.Next() {
		var id, raw string
		var sequence uint64
		if err := rows.Scan(&id, &sequence, &raw); err != nil {
			return nil, nil, false, err
		}
		var turn publicChatCommittedTranscriptTurn
		if err := decodeConversationRow(raw, &turn); err != nil {
			return nil, nil, false, err
		}
		if err := validateCommittedConversationTurn(turn, sequence); err != nil {
			return nil, nil, false, err
		}
		pair, ok := publicChatCommittedTranscriptPair(turn)
		if !ok || turn.TurnID != id {
			return nil, nil, false, fmt.Errorf("stored Life conversation pair invalid")
		}
		pair.KnownAt = turn.CommittedAt
		pairs = append(pairs, pair)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, false, err
	}
	slices.Reverse(pairs)
	return pairs, read, anchor.ConversationContext.OmitSupplementalContext, nil
}

func sourceConversationAllowed(source, selection *lifeConversationRead) bool {
	return source == nil || selection != nil && source.AnchorID == selection.AnchorID && source.FirstSequence >= selection.FirstSequence
}

func projectConversationRead(source, selection *lifeConversationRead) *lifeConversationRead {
	if source == nil || !sourceConversationAllowed(source, selection) {
		return nil
	}
	out := *source
	out.Revision = selection.Revision
	return &out
}

func (s *Service) lifeConversationReadCurrentLocked(read *lifeConversationRead) bool {
	if read == nil {
		return true
	}
	anchor := s.chatAnchors[read.AnchorID]
	return anchor != nil && conversationContextRevision(anchor.ConversationContext) == read.Revision && anchor.ConversationContext.FirstTurnSequence <= read.FirstSequence
}
