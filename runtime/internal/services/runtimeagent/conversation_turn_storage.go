package runtimeagent

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"time"
)

func conversationOrderTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02T15:04:05.000000000Z")
}

// A later capture includes all unacknowledged turn changes. A late writer
// can only acknowledge the exact revisions that it captured.
func (a *publicChatAnchorState) markTurnChanged(id string) {
	if a.dirtyTurns == nil {
		a.dirtyTurns = make(map[string]uint64)
	}
	a.dirtyTurnRevision++
	a.dirtyTurns[id] = a.dirtyTurnRevision
}

func (a *persistedPublicChatAnchor) captureTurnChanges(live *publicChatAnchorState, all bool) {
	a.capturedActive, a.capturedLast = live.ActiveTurnSnapshot, live.LastTurnSnapshot
	if p := live.ActiveTurnSnapshot; p != nil {
		a.ActiveSnapshotID = p.TurnID
		if all || p != live.persistedActive {
			a.ActiveTurnSnapshot = toPersistedPublicChatTurnSnapshot(p)
		}
	}
	if p := live.LastTurnSnapshot; p != nil {
		a.LastSnapshotID = p.TurnID
		if all || p != live.persistedLast {
			a.LastTurnSnapshot = toPersistedPublicChatTurnSnapshot(p)
		}
	}
	a.capturedTurns = maps.Clone(live.dirtyTurns)
	if all {
		a.CompletedTurnSnapshots = toPersistedPublicChatTurnSnapshotMap(live.CompletedTurnSnapshots)
		a.Recoveries = clonePublicChatRecoveries(live.Recoveries)
		a.VoiceSidecars = clonePublicChatVoiceSidecars(live.VoiceSidecars)
		a.VoiceRenderRequests = maps.Clone(live.VoiceRenderRequests)
		return
	}
	a.VoiceRenderRequests = maps.Clone(live.dirtyVoiceRequests)
	for id := range a.capturedTurns {
		if p := live.CompletedTurnSnapshots[id]; p != nil {
			if a.CompletedTurnSnapshots == nil {
				a.CompletedTurnSnapshots = map[string]*persistedPublicChatTurnSnapshot{}
			}
			a.CompletedTurnSnapshots[id] = toPersistedPublicChatTurnSnapshot(p)
		}
		if r := live.Recoveries[id]; r != nil {
			if a.Recoveries == nil {
				a.Recoveries = map[string]*publicChatTurnRecovery{}
			}
			a.Recoveries[id] = cloneConversationRecovery(r)
		}
		if v := live.VoiceSidecars[id]; v != nil {
			if a.VoiceSidecars == nil {
				a.VoiceSidecars = map[string]*publicChatVoiceSidecarState{}
			}
			copy := *v
			a.VoiceSidecars[id] = &copy
		}
	}
}

// @nimi-authority: rule.nimi.runtime.agent-service.r021
// The anchor stores two selectors. A turn that is also the latest reply
// still owns a single persisted projection.
func writeConversationChildren(tx *sql.Tx, anchor *persistedPublicChatAnchor) error {
	id := anchor.ConversationAnchorID
	projections := make(map[string]*persistedPublicChatTurnSnapshot, len(anchor.CompletedTurnSnapshots)+2)
	for key, value := range anchor.CompletedTurnSnapshots {
		projections[key] = value
	}
	if last := anchor.LastTurnSnapshot; last != nil {
		projections[last.TurnID] = last
	}
	if active := anchor.ActiveTurnSnapshot; active != nil {
		projections[active.TurnID] = active
	}
	for key, projection := range projections {
		if key == "" || projection == nil || key != projection.TurnID {
			return fmt.Errorf("invalid stored conversation projection identity")
		}
		if projection.AssistantText != "" || projection.Structured != nil && projection.Structured.Message.Text != "" {
			var body string
			err := tx.QueryRow(`SELECT json_extract(turn_json,'$.assistantText') FROM runtime_conversation_turn WHERE anchor_id=? AND turn_id=?`, id, key).Scan(&body)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if body != "" {
				copy := *projection
				if copy.AssistantText == body {
					copy.TranscriptFields |= 1
					copy.AssistantText = ""
				}
				if copy.Structured != nil && copy.Structured.Message.Text == body {
					envelope := *copy.Structured
					envelope.Message.Text = ""
					copy.Structured = &envelope
					copy.TranscriptFields |= 2
				}
				projection = &copy
			}
		}
		raw, err := json.Marshal(projection)
		if err != nil {
			return err
		}
		_, completed := anchor.CompletedTurnSnapshots[key]
		_, err = tx.Exec(`INSERT INTO runtime_conversation_projection(anchor_id,turn_id,completed,projection_json,projection_order,unfinished) VALUES(?,?,?,?,?,?)
			ON CONFLICT(anchor_id,turn_id) DO UPDATE SET completed=MAX(completed,excluded.completed),projection_json=excluded.projection_json,projection_order=excluded.projection_order,unfinished=excluded.unfinished
			WHERE completed<>excluded.completed OR projection_json IS NOT excluded.projection_json`, id, key, completed, string(raw), conversationOrderTime(parseOptionalTime(firstNonEmpty(projection.TimelineStartedAt, projection.UpdatedAt))), !terminalProjectionStatus(projection.Status))
		if err != nil {
			return err
		}
	}
	for key, voice := range anchor.VoiceSidecars {
		if voice == nil || key != voice.TurnID {
			return fmt.Errorf("invalid stored conversation voice identity")
		}
		raw, err := json.Marshal(voice)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT INTO runtime_conversation_voice VALUES(?,?,?)
			ON CONFLICT(anchor_id,turn_id) DO UPDATE SET voice_json=excluded.voice_json WHERE voice_json<>excluded.voice_json`, id, key, string(raw)); err != nil {
			return err
		}
	}
	for key, turnID := range anchor.VoiceRenderRequests {
		if _, err := tx.Exec(`INSERT INTO runtime_conversation_voice_request VALUES(?,?,?)
			ON CONFLICT(anchor_id,request_key) DO UPDATE SET turn_id=excluded.turn_id WHERE turn_id<>excluded.turn_id`, id, key, turnID); err != nil {
			return err
		}
	}
	return nil
}

func restoreConversationProjectionText(p *persistedPublicChatTurnSnapshot, body string) error {
	if p.TranscriptFields == 0 {
		return nil
	}
	if body == "" || p.TranscriptFields > 3 {
		return fmt.Errorf("invalid conversation transcript reference")
	}
	if p.TranscriptFields&1 != 0 {
		p.AssistantText = body
	}
	if p.TranscriptFields&2 != 0 {
		if p.Structured == nil {
			return fmt.Errorf("conversation structured body reference without envelope")
		}
		p.Structured.Message.Text = body
	}
	p.TranscriptFields = 0
	return nil
}

type conversationRowReader interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

func readConversationChildren(db conversationRowReader, snapshot *persistedPublicChatSurfaceState, indices map[string]int, scope string) error {
	where, args := conversationAnchorPredicate(scope)
	queries := []struct {
		sql  string
		scan func(*persistedPublicChatAnchor, string, string, bool, string) error
	}{
		{`SELECT anchor_id,turn_id,projection_json,completed,coalesce((SELECT json_extract(t.turn_json,'$.assistantText') FROM runtime_conversation_turn t WHERE t.anchor_id=p.anchor_id AND t.turn_id=p.turn_id),'') FROM runtime_conversation_projection p WHERE projection_json IS NOT NULL`,
			func(a *persistedPublicChatAnchor, key, raw string, completed bool, body string) error {
				var projection persistedPublicChatTurnSnapshot
				if err := decodeConversationRow(raw, &projection); err != nil {
					return err
				}
				if err := restoreConversationProjectionText(&projection, body); err != nil {
					return err
				}
				if projection.TurnID != key || key == "" {
					return fmt.Errorf("conversation projection identity mismatch")
				}
				if key == a.ActiveSnapshotID {
					a.ActiveTurnSnapshot = &projection
				}
				if key == a.LastSnapshotID {
					a.LastTurnSnapshot = &projection
				}
				if completed {
					if a.CompletedTurnSnapshots == nil {
						a.CompletedTurnSnapshots = make(map[string]*persistedPublicChatTurnSnapshot)
					}
					a.CompletedTurnSnapshots[key] = &projection
				}
				return nil
			}},
		{`SELECT anchor_id,turn_id,voice_json,0,'' FROM runtime_conversation_voice WHERE 1=1`,
			func(a *persistedPublicChatAnchor, key, raw string, _ bool, _ string) error {
				var voice publicChatVoiceSidecarState
				if err := decodeConversationRow(raw, &voice); err != nil {
					return err
				}
				if key == "" || voice.TurnID != key {
					return fmt.Errorf("conversation voice identity mismatch")
				}
				if a.VoiceSidecars == nil {
					a.VoiceSidecars = make(map[string]*publicChatVoiceSidecarState)
				}
				a.VoiceSidecars[key] = &voice
				return nil
			}},
		{`SELECT anchor_id,request_key,turn_id,0,'' FROM runtime_conversation_voice_request WHERE 1=1`,
			func(a *persistedPublicChatAnchor, key, turnID string, _ bool, _ string) error {
				if key == "" || turnID == "" {
					return fmt.Errorf("conversation voice request identity missing")
				}
				if a.VoiceRenderRequests == nil {
					a.VoiceRenderRequests = make(map[string]string)
				}
				a.VoiceRenderRequests[key] = turnID
				return nil
			}},
	}
	for _, query := range queries {
		rows, err := db.Query(query.sql+where, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, key, raw, body string
			var completed bool
			if err := rows.Scan(&id, &key, &raw, &completed, &body); err != nil {
				rows.Close()
				return err
			}
			i, ok := indices[id]
			if !ok {
				rows.Close()
				return fmt.Errorf("orphaned conversation child")
			}
			if err := query.scan(&snapshot.Anchors[i], key, raw, completed, body); err != nil {
				rows.Close()
				return err
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
	}
	for _, a := range snapshot.Anchors {
		if a.ActiveSnapshotID != "" && a.ActiveTurnSnapshot == nil || a.LastSnapshotID != "" && a.LastTurnSnapshot == nil {
			return fmt.Errorf("conversation projection selector not found")
		}
	}
	return nil
}
