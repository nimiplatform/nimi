package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.service-operations.r092
func readConversationStartup(tx *sql.Tx, raw string) (persistedPublicChatSurfaceState, error) {
	snapshot, indices, err := readConversationHeaders(tx, raw)
	if err != nil {
		return snapshot, err
	}
	for i := range snapshot.Anchors {
		a := &snapshot.Anchors[i]
		if err := tx.QueryRow(`SELECT coalesce(max(sequence)+1,0) FROM runtime_conversation_turn WHERE anchor_id=?`, a.ConversationAnchorID).Scan(&a.storedTurnCount); err != nil {
			return snapshot, err
		}
		rows, err := tx.Query(`SELECT turn_id,projection_json,completed,coalesce((SELECT json_extract(t.turn_json,'$.assistantText') FROM runtime_conversation_turn t WHERE t.anchor_id=p.anchor_id AND t.turn_id=p.turn_id),'') FROM runtime_conversation_projection p WHERE anchor_id=? AND turn_id IN (?,?) AND projection_json IS NOT NULL
			UNION ALL SELECT turn_id,projection_json,completed,coalesce((SELECT json_extract(t.turn_json,'$.assistantText') FROM runtime_conversation_turn t WHERE t.anchor_id=p.anchor_id AND t.turn_id=p.turn_id),'') FROM runtime_conversation_projection p WHERE anchor_id=? AND unfinished=1 AND turn_id NOT IN (?,?)`,
			a.ConversationAnchorID, a.ActiveSnapshotID, a.LastSnapshotID, a.ConversationAnchorID, a.ActiveSnapshotID, a.LastSnapshotID)
		if err != nil {
			return snapshot, err
		}
		for rows.Next() {
			var key, raw, body string
			var completed bool
			if err := rows.Scan(&key, &raw, &completed, &body); err != nil {
				rows.Close()
				return snapshot, err
			}
			var p persistedPublicChatTurnSnapshot
			if err := decodeConversationRow(raw, &p); err != nil {
				rows.Close()
				return snapshot, err
			}
			if err := restoreConversationProjectionText(&p, body); err != nil {
				rows.Close()
				return snapshot, err
			}
			if key != p.TurnID {
				rows.Close()
				return snapshot, fmt.Errorf("conversation projection identity mismatch")
			}
			if key == a.ActiveSnapshotID {
				a.ActiveTurnSnapshot = &p
			}
			if key == a.LastSnapshotID {
				a.LastTurnSnapshot = &p
			}
			if completed {
				if a.CompletedTurnSnapshots == nil {
					a.CompletedTurnSnapshots = map[string]*persistedPublicChatTurnSnapshot{}
				}
				a.CompletedTurnSnapshots[key] = &p
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return snapshot, err
		}
		if err := rows.Close(); err != nil {
			return snapshot, err
		}
		if a.ActiveSnapshotID != "" && a.ActiveTurnSnapshot == nil || a.LastSnapshotID != "" && a.LastTurnSnapshot == nil {
			return snapshot, fmt.Errorf("stored conversation selector is missing")
		}
	}
	if err := readConversationTimers(tx, &snapshot); err != nil {
		return snapshot, err
	}
	for _, f := range snapshot.FollowUps {
		i, ok := indices[f.ConversationAnchorID]
		if !ok {
			return snapshot, fmt.Errorf("orphaned continuation")
		}
		a := &snapshot.Anchors[i]
		if a.PendingFollowUpID != f.FollowUpID {
			continue
		}
		var seq uint64
		err := tx.QueryRow(`SELECT sequence FROM runtime_conversation_turn WHERE anchor_id=? AND turn_id=?`, f.ConversationAnchorID, f.SourceTurnID).Scan(&seq)
		if err == nil {
			a.coldFollowUpTurn, a.coldFollowUpSequence = f.SourceTurnID, seq
		} else if !errors.Is(err, sql.ErrNoRows) {
			return snapshot, err
		}
	}
	return snapshot, nil
}

func (a *publicChatAnchorState) transcriptCount() int {
	if a.coldFacts {
		return a.persistedTranscriptCount
	}
	return a.transcriptBase + len(a.CommittedTranscript)
}

// Full history callers explicitly load this one anchor. Ordinary execution and
// bounded readers each select the rows they own.
func (s *Service) loadConversationFactsLocked(ctx context.Context, a *publicChatAnchorState) error {
	return s.loadConversationRowsLocked(ctx, a, false)
}

// Execution retains the selected unsummarized range and enough complete pairs
// to decide whether a new summary is due. The unbounded API explicitly asks
// for sequence zero. A failed or stale summary never hides a required gap.
func (s *Service) loadConversationRowsLocked(ctx context.Context, a *publicChatAnchorState, execution bool) error {
	if a == nil || !a.coldFacts && !execution && !a.workingFacts {
		return nil
	}
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	first := 0
	if execution {
		if !a.coldFacts && a.persistedTranscriptCount != a.transcriptCount() {
			return nil
		}
		first = int(a.ConversationContext.FirstTurnSequence)
		if valid := publicChatLastValidConversationSummary(activeConversationSummary(a)); valid != nil {
			var seventh int
			err := tx.QueryRowContext(ctx, `SELECT sequence FROM runtime_conversation_turn WHERE anchor_id=? AND sequence>=? AND json_extract(turn_json,'$.assistantText')<>'' ORDER BY sequence DESC LIMIT 1 OFFSET ?`, a.ConversationAnchorID, first, publicChatRecentVerbatimTurnLimit).Scan(&seventh)
			if err == nil {
				first = max(first, min(seventh, int(valid.CoveredSequenceEnd)+1))
			} else if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if !a.coldFacts && first == a.transcriptBase {
			s.retainExecutionChildrenLocked(a)
			return nil
		}
	}
	if first > a.transcriptCount() {
		return fmt.Errorf("execution context starts after the committed transcript")
	}
	if !a.coldFacts && first > a.transcriptBase {
		// Detach the retained slice so its backing array releases omitted bodies.
		a.CommittedTranscript = append([]publicChatCommittedTranscriptTurn(nil), a.CommittedTranscript[first-a.transcriptBase:]...)
		a.transcriptBase = first
		s.retainExecutionChildrenLocked(a)
		a.messageLookup = nil
		return nil
	}
	var raw string
	if err := tx.QueryRowContext(ctx, `SELECT anchor_json FROM runtime_conversation_anchor WHERE anchor_id=? AND anchor_json IS NOT NULL`, a.ConversationAnchorID).Scan(&raw); err != nil {
		return err
	}
	var header persistedPublicChatAnchor
	if err := decodeConversationRow(raw, &header); err != nil {
		return err
	}
	if header.ConversationAnchorID != a.ConversationAnchorID || header.LocalAgentRef != a.LocalAgentRef || header.OwnerUserID != a.OwnerUserID {
		return fmt.Errorf("conversation owner changed")
	}
	snapshot := persistedPublicChatSurfaceState{Anchors: []persistedPublicChatAnchor{header}}
	if err := readConversationFacts(tx, &snapshot, map[string]int{a.ConversationAnchorID: 0}, a.ConversationAnchorID, first, !execution); err != nil {
		return err
	}
	facts := snapshot.Anchors[0]
	if first+len(facts.CommittedTranscript) != a.persistedTranscriptCount {
		return fmt.Errorf("stored conversation count changed")
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	a.transcriptBase = first
	a.messageLookup = nil
	a.CommittedTranscript = facts.CommittedTranscript
	if execution {
		s.retainExecutionChildrenLocked(a)
	} else {
		projections := fromPersistedPublicChatTurnSnapshotMap(facts.CompletedTurnSnapshots)
		// An asynchronously captured write may still be waiting for its receipt.
		// Loading older facts must preserve those changes and their revision fences.
		for id := range a.dirtyTurns {
			if p := a.CompletedTurnSnapshots[id]; p != nil {
				if projections == nil {
					projections = make(map[string]*publicChatTurnProjectionState)
				}
				projections[id] = p
			}
			if r := a.Recoveries[id]; r != nil {
				if facts.Recoveries == nil {
					facts.Recoveries = make(map[string]*publicChatTurnRecovery)
				}
				facts.Recoveries[id] = r
			}
			if v := a.VoiceSidecars[id]; v != nil {
				if facts.VoiceSidecars == nil {
					facts.VoiceSidecars = make(map[string]*publicChatVoiceSidecarState)
				}
				facts.VoiceSidecars[id] = v
			}
		}
		if len(a.dirtyVoiceRequests) > 0 {
			if facts.VoiceRenderRequests == nil {
				facts.VoiceRenderRequests = make(map[string]string)
			}
			maps.Copy(facts.VoiceRenderRequests, a.dirtyVoiceRequests)
		}
		a.CompletedTurnSnapshots = projections
		a.Recoveries = facts.Recoveries
		a.VoiceSidecars = facts.VoiceSidecars
		a.VoiceRenderRequests = facts.VoiceRenderRequests
		a.workingFacts = false
	}
	a.coldFacts = false
	return nil
}

// Preserve active, late-media and unacknowledged rows. Completed history
// remains addressable by its durable message, turn or admission identity.
func (s *Service) retainExecutionChildrenLocked(a *publicChatAnchorState) {
	a.workingFacts = true
	a.windowInputs = nil
	projections := make(map[string]*publicChatTurnProjectionState)
	recoveries := make(map[string]*publicChatTurnRecovery)
	voices := make(map[string]*publicChatVoiceSidecarState)
	keep := func(id string) {
		if p := a.CompletedTurnSnapshots[id]; p != nil {
			projections[id] = p
		}
		if r := a.Recoveries[id]; r != nil {
			recoveries[id] = r
			if original := a.Recoveries[r.InputTurnID]; original != nil {
				recoveries[r.InputTurnID] = original
			}
		}
		if voice := a.VoiceSidecars[id]; voice != nil {
			voices[id] = voice
		}
	}
	keep(a.LatestAcceptedTurnID)
	keep(a.LastTurnID)
	for id := range a.dirtyTurns {
		keep(id)
	}
	for id, turn := range s.chatTurns {
		if turn.ConversationAnchorID == a.ConversationAnchorID {
			keep(id)
		}
	}
	// A concurrent manual voice render has independent ownership. Its request
	// fence and previous sidecar stay pinned until that render finishes.
	for id := range s.chatVoiceRenders {
		if strings.HasPrefix(id, a.ConversationAnchorID+"\x00") {
			return
		}
	}
	a.CompletedTurnSnapshots = projections
	a.Recoveries = recoveries
	a.VoiceSidecars = voices
	a.VoiceRenderRequests = maps.Clone(a.dirtyVoiceRequests)
	a.messageLookup = nil
}
