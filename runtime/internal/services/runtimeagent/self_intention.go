package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/oklog/ulid/v2"
	"io"
	"strings"
	"time"
)

type selfIntentionProposal struct {
	Description *lifeSelfDescription `json:"experience,omitempty"`
	Action      string               `json:"action"`
	ActivityRef string               `json:"activity_ref,omitempty"`
	Title       string               `json:"title,omitempty"`
	Kind        string               `json:"kind,omitempty"`
}

type selfIntentionResult struct {
	Accepted     bool   `json:"accepted"`
	Action       string `json:"action,omitempty"`
	ActivityRef  string `json:"activityRef,omitempty"`
	Title        string `json:"title,omitempty"`
	Confirmation string `json:"confirmation,omitempty"`
}

const selfIntentionPrompt = `Optional own direction after the reply: <self-intention>{"action":"adopt","title":"Cloud study","kind":"project"}</self-intention><intention-confirmation>I've decided to explore cloud studies.</intention-confirmation>. Write the actual confirmation in the user's language; it is shown only after acceptance. Without a suggestion omit both tags. Top-level action: adopt/change/pause/resume/abandon only. Adopt: title, kind (project/routine). Others: existing activity_ref; change also title. Change/abandon: experience with action=create/practice/explore/reflect, object=your specific work or subject, result=direction_changed/abandoned respectively, optional outcome. These experience actions are never top-level actions. No other fields, user tasks, schedules, recipients, tools or settings.`

func decodeSelfIntention(raw string) (*selfIntentionProposal, error) {
	if len(raw) > 2048 {
		return nil, fmt.Errorf("self-intention exceeds bound")
	}
	d := json.NewDecoder(bytes.NewBufferString(raw))
	d.DisallowUnknownFields()
	var p selfIntentionProposal
	if err := d.Decode(&p); err != nil {
		return nil, err
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, fmt.Errorf("trailing self-intention input")
	}
	if p.Action != "adopt" && p.Action != "change" && p.Action != "pause" && p.Action != "resume" && p.Action != "abandon" {
		return nil, fmt.Errorf("unsupported self-intention")
	}
	if p.Action == "adopt" || p.Action == "change" {
		if len([]rune(p.Title)) > 160 || !validLocalAppConversationText(p.Title, 160*4, false) {
			return nil, fmt.Errorf("bounded own direction required")
		}
	} else if p.Title != "" || p.Kind != "" {
		return nil, fmt.Errorf("unexpected direction fields")
	}
	if p.Action == "adopt" {
		if p.ActivityRef != "" || p.Kind != "project" && p.Kind != "routine" {
			return nil, fmt.Errorf("invalid new self-intention")
		}
	} else if p.Kind != "" || !validLocalAppConversationText(p.ActivityRef, 256, false) {
		return nil, fmt.Errorf("existing intention required")
	}
	p.Description = normalizeLifeSelfDescription(p.Description)
	if (p.Action == "change" || p.Action == "abandon") && (p.Description == nil || p.Action == "change" && p.Description.Result != "direction_changed" || p.Action == "abandon" && p.Description.Result != "abandoned") {
		return nil, fmt.Errorf("concrete own direction change description required")
	}
	if err := validateLifeSelfDescription(p.Description); err != nil {
		return nil, err
	}
	return &p, nil
}

func acceptSelfIntention(l *agentLifeState, p *selfIntentionProposal, now time.Time) (*selfIntentionResult, error) {
	if p == nil {
		return nil, fmt.Errorf("missing self-intention")
	}
	a := l.Activities[p.ActivityRef]
	if p.Action == "adopt" {
		if l.unfinishedNameConflict(p.Title, "") {
			return nil, fmt.Errorf("direction already exists")
		}
		a = &lifeActivity{Ref: "activity_" + ulid.Make().String(), Title: strings.TrimSpace(p.Title), Kind: p.Kind, Phase: lifePlanned}
		l.Activities[a.Ref] = a
	} else {
		if a == nil || a.Phase == lifeCompleted || a.Phase == lifeCanceled {
			return nil, fmt.Errorf("intention is no longer applicable")
		}
		if p.Action == "change" {
			if l.unfinishedNameConflict(p.Title, a.Ref) {
				return nil, fmt.Errorf("direction already exists")
			}
			a.Title = strings.TrimSpace(p.Title)
			a.RedactedNameKey = ""
			a.MemoryRefs = nil
			a.ConversationRead = nil
		}
		if p.Action != "resume" {
			if l.Current != nil && l.Current.ActivityRef == a.Ref {
				l.interruptCurrent(now)
			}
			kept := l.Future[:0]
			for _, f := range l.Future {
				if f.ActivityRef != a.Ref {
					kept = append(kept, f)
				}
			}
			l.Future = kept
			keptIntents := l.Intents[:0]
			for _, i := range l.Intents {
				if i.ActivityRef != a.Ref {
					keptIntents = append(keptIntents, i)
				}
			}
			l.Intents = keptIntents
		}
		a.Phase = lifePaused
		if p.Action == "abandon" {
			a.Phase = lifeCanceled
		}
		if p.Action == "resume" || p.Action == "change" {
			a.Phase = lifePlanned
		}
	}
	if err := l.validateActivityCapacity(); err != nil {
		return nil, err
	}
	l.NextCheckAt = now
	l.Explanation = nil
	if l.Interaction != nil {
		l.Interaction.IntentionChanged = true
	}
	if err := l.changed(); err != nil {
		return nil, err
	}
	return &selfIntentionResult{Accepted: true, Action: p.Action, ActivityRef: a.Ref, Title: a.Title}, nil
}

func (s *Service) savedSelfIntention(anchorID, turnID string) *selfIntentionResult {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	a := s.chatAnchors[anchorID]
	if a == nil {
		return nil
	}
	r := a.Recoveries[turnID]
	if r == nil {
		return nil
	}
	original := a.Recoveries[r.InputTurnID]
	if original == nil || original.SelfIntention == nil {
		return nil
	}
	copy := *original.SelfIntention
	return &copy
}

// @nimi-authority: rule.nimi.runtime.agent-life.self-intention
func (s *Service) applySelfIntention(ctx context.Context, session publicChatAnchorState, turn publicChatTurnState, req publicChatTurnRequestPayload, p *selfIntentionProposal, confirmation string, invalid error) (*selfIntentionResult, error) {
	if saved := s.savedSelfIntention(session.ConversationAnchorID, turn.TurnID); saved != nil {
		return saved, nil
	}
	if req.RetryOfTurnID != "" || turn.Origin != publicChatTurnOriginUser {
		return &selfIntentionResult{}, nil
	}
	memoryPending := false
	defer func() {
		if memoryPending {
			s.triggerCognitionMemory(session.LocalAgentRef)
		}
	}()
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
	if err := s.qualifyConversationMemoryReads(ctx, session.LocalAgentRef, turn.TurnID); err != nil {
		invalid = err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	a := s.chatAnchors[session.ConversationAnchorID]
	live := s.chatTurns[turn.TurnID]
	entry := s.agents[session.LocalAgentRef]
	if ctx.Err() != nil || a == nil || live == nil || live.Interrupted || entry == nil || a.ActiveTurnID != turn.TurnID || s.agentTerminationFencedLocked(session.LocalAgentRef) {
		return nil, context.Canceled
	}
	r := a.Recoveries[turn.TurnID]
	if r == nil || r.InputTurnID != turn.TurnID {
		return nil, fmt.Errorf("original intention turn is unavailable")
	}
	if r.SelfIntention != nil {
		copy := *r.SelfIntention
		return &copy, nil
	}
	next := cloneAgentEntry(entry)
	result := &selfIntentionResult{}
	if live.LifeReadRevision == 0 || entry.Life.Revision != live.LifeReadRevision {
		invalid = fmt.Errorf("self-intention input changed")
	}
	if invalid == nil {
		var err error
		result, err = acceptSelfIntention(next.Life, p, time.Now().UTC())
		if err != nil {
			invalid = err
			result = &selfIntentionResult{}
			next = cloneAgentEntry(entry)
		}
	}
	if invalid != nil && s.logger != nil {
		s.logger.Info("self-intention rejected", "turn_id", turn.TurnID, "reason", invalid.Error())
	}
	if result.Accepted {
		result.Confirmation = confirmation
	}
	memoryHook, memoryErr := s.selfIntentionMemoryTxHook(next, p, result, turn.TurnID, time.Now().UTC())
	if memoryErr != nil {
		return nil, memoryErr
	}
	if result.Accepted {
		next.Life.pruneActivities()
	}
	before := a.Recoveries
	a.Recoveries = clonePublicChatRecoveries(before)
	a.Recoveries[turn.TurnID].SelfIntention = result
	hook := func(tx *sql.Tx) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := persistAgentLifeTx(tx, session.LocalAgentRef, next.Life); err != nil {
			return err
		}
		if memoryHook != nil {
			return memoryHook(tx)
		}
		return nil
	}
	var err error
	if req.localAppAdmission != nil {
		err = s.persistLocalAppConversationCommitLocked(ctx, localappop.IngressConversationTurnSend, *req.localAppAdmission, session.ConversationAnchorID, hook)
	} else {
		err = s.persistPublicChatSurfaceStateWithTxHookLocked(hook, session.ConversationAnchorID)
	}
	if err != nil {
		a.Recoveries = before
		return nil, err
	}
	s.agents[session.LocalAgentRef] = next
	memoryPending = memoryHook != nil
	return result, nil
}
