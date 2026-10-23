package runtimeagent

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

func persistAgentLifeTx(tx *sql.Tx, ref string, life *agentLifeState) error {
	if life == nil {
		life = newAgentLifeState()
	}
	raw, err := json.Marshal(life)
	if err != nil {
		return fmt.Errorf("encode life state: %w", err)
	}
	_, err = tx.Exec(`INSERT INTO runtime_local_agent_life(local_agent_ref,life_json) VALUES(?,?) ON CONFLICT(local_agent_ref) DO UPDATE SET life_json=excluded.life_json WHERE life_json<>excluded.life_json`, ref, string(raw))
	if err != nil {
		return fmt.Errorf("persist life state: %w", err)
	}
	return nil
}

func (r *runtimeAgentStateRepository) loadAgentLifeState(s *Service) error {
	rows, err := r.backend.DB().Query(`SELECT local_agent_ref,life_json FROM runtime_local_agent_life`)
	if err != nil {
		return fmt.Errorf("load life state: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var ref string
		var raw []byte
		if err := rows.Scan(&ref, &raw); err != nil {
			return err
		}
		entry := s.agents[ref]
		if entry == nil {
			return fmt.Errorf("life state references missing Agent")
		}
		life := newAgentLifeState()
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(life); err != nil {
			return fmt.Errorf("decode life state: %w", err)
		}
		if decoder.Decode(new(any)) != io.EOF {
			return fmt.Errorf("life state has trailing data")
		}
		if err := validateLifeState(life); err != nil {
			return err
		}
		if err := life.recoverAt(time.Now().UTC()); err != nil {
			return err
		}
		entry.Life = life
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for ref, entry := range s.agents {
		if entry.Life == nil {
			return fmt.Errorf("persisted Agent %s has no life-frame state; inspect the explicit pre-release tool with pnpm runtime:initialize-local-agent-life --help", ref)
		}
	}
	return nil
}

func validateLifeState(l *agentLifeState) error {
	if l == nil || l.Revision == 0 || len(l.Future) > lifeFutureLimit || len(l.Recent) > lifeRecentLimit {
		return fmt.Errorf("invalid persisted life state bounds")
	}
	frames := append(append([]lifeFrame(nil), l.Recent...), l.Future...)
	if l.Current != nil {
		frames = append(frames, *l.Current)
		if l.Current.Phase != lifeActive {
			return fmt.Errorf("invalid current life phase")
		}
	}
	seen := map[string]bool{}
	for _, f := range frames {
		if f.ID == "" || f.Title == "" || len([]rune(f.Title)) > 160 || seen[f.ID] || !f.Interaction && l.Activities[f.ActivityRef] == nil || !f.EndsAt.After(f.StartsAt) || f.EndProgress < 0 || f.EndProgress > 100 {
			return fmt.Errorf("invalid persisted life frame")
		}
		seen[f.ID] = true
	}
	for ref, a := range l.Activities {
		if a == nil || a.Ref != ref || ref == "" || a.Progress < 0 || a.Progress > 100 {
			return fmt.Errorf("invalid persisted life activity")
		}
	}
	if err := l.validateActivityCapacity(); err != nil {
		return err
	}

	for i, f := range l.Future {
		if f.Phase != lifePlanned || i > 0 && f.StartsAt.Before(l.Future[i-1].EndsAt) || l.Current != nil && f.StartsAt.Before(l.Current.EndsAt) {
			return fmt.Errorf("overlapping future life frames")
		}
	}
	return nil
}
