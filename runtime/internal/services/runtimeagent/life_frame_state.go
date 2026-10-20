package runtimeagent

import (
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

const (
	lifeFutureLimit = 6
	lifeRecentLimit = 12
	// Retain enough work for a bounded planning batch alongside reserved frames.
	lifeUnfinishedLimit = 12
)

type lifePhase string

const (
	lifePlanned     lifePhase = "planned"
	lifeActive      lifePhase = "active"
	lifePaused      lifePhase = "paused"
	lifeCompleted   lifePhase = "completed"
	lifeInterrupted lifePhase = "interrupted"
	lifeCanceled    lifePhase = "canceled"
)

// Activity is the stable identity; a frame is only one scheduled segment.
type lifeActivity struct {
	RedactedNameKey  string                `json:"redactedNameKey,omitempty"`
	ConversationRead *lifeConversationRead `json:"conversationRead,omitempty"`
	Ref              string                `json:"ref"`
	Title            string                `json:"title"`
	Kind             string                `json:"kind"`
	Phase            lifePhase             `json:"phase"`
	Progress         int                   `json:"progress"`
	StartedAt        time.Time             `json:"startedAt,omitempty"`
	CompletedAt      time.Time             `json:"completedAt,omitempty"`
	Retrospective    bool                  `json:"retrospective,omitempty"`

	MemoryRefs []string `json:"memoryRefs,omitempty"`
}

type lifeFrame struct {
	Description       *lifeSelfDescription  `json:"description,omitempty"`
	ActivityState     lifePhase             `json:"activityState,omitempty"`
	RecordedAt        time.Time             `json:"recordedAt,omitempty"`
	Invalidated       bool                  `json:"invalidated,omitempty"`
	Interaction       bool                  `json:"interaction,omitempty"`
	StartProgress     int                   `json:"startProgress"`
	Title             string                `json:"title"`
	MemoryRefs        []string              `json:"memoryRefs,omitempty"`
	ConversationRead  *lifeConversationRead `json:"conversationRead,omitempty"`
	ID                string                `json:"id"`
	ActivityRef       string                `json:"activityRef"`
	StartsAt          time.Time             `json:"startsAt"`
	EndsAt            time.Time             `json:"endsAt"`
	Phase             lifePhase             `json:"phase"`
	EndProgress       int                   `json:"endProgress"`
	CompletesActivity bool                  `json:"completesActivity"`
	Retrospective     bool                  `json:"retrospective"`
}

type lifeExplanation struct {
	Text             string                `json:"text"`
	MemoryRefs       []string              `json:"memoryRefs,omitempty"`
	ConversationRead *lifeConversationRead `json:"conversationRead,omitempty"`
}

type lifeConversationRead struct {
	AnchorID      string `json:"anchorId"`
	Revision      uint64 `json:"revision"`
	FirstSequence uint64 `json:"firstSequence"`
}

type lifeProactiveIntent struct {
	// Contact-only generation already produced this public text. Life intents
	// instead carry Purpose for their later expression generation.
	Text             string                `json:"text,omitempty"`
	MemoryRefs       []string              `json:"memoryRefs,omitempty"`
	ConversationRead *lifeConversationRead `json:"conversationRead,omitempty"`
	ID               string                `json:"id"`
	Source           string                `json:"source"`
	ActivityRef      string                `json:"activityRef,omitempty"`
	DueAt            time.Time             `json:"dueAt"`
	ExpiresAt        time.Time             `json:"expiresAt,omitempty"`
	Purpose          string                `json:"purpose"`
	// Runtime turn identity connects the occurrence to canonical recovery.
	TurnID string `json:"turnId,omitempty"`
}

// @nimi-authority: definition.nimi.runtime.agent-life.frame-timeline
type agentLifeState struct {
	LifeBudgetWaiting    bool                          `json:"lifeBudgetWaiting,omitempty"`
	ContactBudgetWaiting bool                          `json:"contactBudgetWaiting,omitempty"`
	ContactEpoch         uint64                        `json:"contactEpoch,omitempty"`
	ContactConsideredAt  time.Time                     `json:"contactConsideredAt,omitempty"`
	ContactNextAt        time.Time                     `json:"contactNextAt,omitempty"`
	LastLifeAttempt      time.Time                     `json:"lastLifeAttempt,omitempty"`
	ContactSinceUser     bool                          `json:"contactSinceUser,omitempty"`
	Interaction          *lifeInteraction              `json:"interaction,omitempty"`
	Revision             uint64                        `json:"revision"`
	StartedAt            time.Time                     `json:"startedAt,omitempty"`
	SettledAt            time.Time                     `json:"settledAt,omitempty"`
	Current              *lifeFrame                    `json:"current,omitempty"`
	Future               []lifeFrame                   `json:"future,omitempty"`
	Recent               []lifeFrame                   `json:"recent,omitempty"`
	Activities           map[string]*lifeActivity      `json:"activities,omitempty"`
	Explanation          *lifeExplanation              `json:"explanation,omitempty"`
	NextCheckAt          time.Time                     `json:"nextCheckAt,omitempty"`
	WaitReason           string                        `json:"waitReason,omitempty"`
	Intents              []lifeProactiveIntent         `json:"intents,omitempty"`
	ContactTimes         []time.Time                   `json:"contactTimes,omitempty"`
	MemoryReadSet        cognitionmemory.MemoryReadSet `json:"memoryReadSet,omitempty"`
	LastPlanningTokens   int64                         `json:"lastPlanningTokens,omitempty"`
}

func newAgentLifeState() *agentLifeState {
	return &agentLifeState{Revision: 1, Activities: map[string]*lifeActivity{}}
}

func cloneAgentLifeState(input *agentLifeState) *agentLifeState {
	if input == nil {
		return newAgentLifeState()
	}
	out := *input
	if input.Interaction != nil {
		value := *input.Interaction
		out.Interaction = &value
	}
	out.MemoryReadSet.Refs = append([]string(nil), input.MemoryReadSet.Refs...)
	out.Future = cloneLifeFrames(input.Future)
	out.Recent = cloneLifeFrames(input.Recent)
	out.Intents = append([]lifeProactiveIntent(nil), input.Intents...)
	for index := range out.Intents {
		out.Intents[index].MemoryRefs = append([]string(nil), input.Intents[index].MemoryRefs...)
	}
	out.ContactTimes = append([]time.Time(nil), input.ContactTimes...)
	if input.Current != nil {
		v := *input.Current
		v.MemoryRefs = append([]string(nil), input.Current.MemoryRefs...)
		out.Current = &v
	}
	if input.Explanation != nil {
		v := *input.Explanation
		v.MemoryRefs = append([]string(nil), v.MemoryRefs...)
		out.Explanation = &v
	}
	out.Activities = make(map[string]*lifeActivity, len(input.Activities))
	for k, v := range input.Activities {
		a := *v
		a.MemoryRefs = append([]string(nil), v.MemoryRefs...)
		out.Activities[k] = &a
	}
	return &out
}

func lifeStateEqual(a, b *agentLifeState) bool {
	// Values contain no interface payloads or unsupported JSON values.
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func cloneLifeFrames(input []lifeFrame) []lifeFrame {
	out := append([]lifeFrame(nil), input...)
	for i := range out {
		out[i].MemoryRefs = append([]string(nil), input[i].MemoryRefs...)
	}
	return out
}

func (l *agentLifeState) frames() []*lifeFrame {
	out := []*lifeFrame{}
	if l.Current != nil {
		out = append(out, l.Current)
	}
	for i := range l.Future {
		out = append(out, &l.Future[i])
	}
	for i := range l.Recent {
		out = append(out, &l.Recent[i])
	}
	return out
}

func (l *agentLifeState) changed() error {
	if l.Revision == math.MaxUint64 {
		return fmt.Errorf("life state revision exhausted")
	}
	l.Revision++
	return nil
}

func (l *agentLifeState) appendRecent(f lifeFrame) {
	l.Recent = append(l.Recent, f)
	if len(l.Recent) > lifeRecentLimit {
		l.Recent = append([]lifeFrame(nil), l.Recent[len(l.Recent)-lifeRecentLimit:]...)
	}
}

// @nimi-authority: rule.nimi.runtime.agent-life.timeline
// Returns newly completed activities for same-transaction Memory work.
func (l *agentLifeState) advance(now time.Time, paused bool) ([]string, error) {
	if now.Before(l.SettledAt) || paused || l.Interaction != nil {
		return nil, nil
	}
	var completed []string
	changed := false
	for {
		if l.Current == nil {
			if len(l.Future) == 0 || l.Future[0].StartsAt.After(now) {
				break
			}
			f := l.Future[0]
			a := l.Activities[f.ActivityRef]
			if a == nil {
				return nil, fmt.Errorf("life frame has no activity")
			}
			if f.Invalidated || a.Phase == lifeCompleted || a.Phase == lifeCanceled || f.StartProgress > a.Progress {
				l.Future = l.Future[1:]
				changed = true
				continue
			}
			l.Future = l.Future[1:]
			f.Phase = lifeActive
			l.Current = &f
			a.Phase = lifeActive
			if a.StartedAt.IsZero() {
				a.StartedAt = f.StartsAt
			}
			changed = true
		}
		f := l.Current
		if f.Invalidated {
			l.interruptCurrent(now)
			changed = true
			continue
		}
		if f.EndsAt.After(now) {
			break
		}
		a := l.Activities[f.ActivityRef]
		if a == nil {
			return nil, fmt.Errorf("current life frame has no activity")
		}
		a.Progress = f.EndProgress
		f.Phase = lifeCompleted
		if f.CompletesActivity {
			a.Phase = lifeCompleted
			a.Retrospective = a.Retrospective || f.Retrospective
			a.CompletedAt = f.EndsAt

		} else {
			a.Phase = lifePaused
		}
		f.ActivityState = a.Phase
		f.RecordedAt = now
		completed = append(completed, f.ID)
		l.SettledAt = f.EndsAt
		l.appendRecent(*f)
		l.Current = nil
		changed = true
	}
	if changed {
		if err := l.changed(); err != nil {
			return nil, err
		}
		l.pruneActivities()
	}
	return completed, nil
}

func (l *agentLifeState) pruneActivities() {
	keep := map[string]bool{}
	if l.Current != nil {
		keep[l.Current.ActivityRef] = true
	}
	for _, f := range l.Future {
		keep[f.ActivityRef] = true
	}
	for _, f := range l.Recent {
		keep[f.ActivityRef] = true
	}

	for _, intent := range l.Intents {
		if intent.ActivityRef != "" {
			keep[intent.ActivityRef] = true
		}
	}
	for ref, a := range l.Activities {
		if !keep[ref] && (a.Phase == lifeCompleted || a.Phase == lifeCanceled) {
			delete(l.Activities, ref)
		}
	}
	used := map[string]bool{}
	for _, f := range l.frames() {
		for _, ref := range f.MemoryRefs {
			used[ref] = true
		}
	}
	for _, intent := range l.Intents {
		for _, ref := range intent.MemoryRefs {
			used[ref] = true
		}
	}
	for _, a := range l.Activities {
		for _, ref := range a.MemoryRefs {
			used[ref] = true
		}
	}

	if l.Explanation != nil {
		for _, ref := range l.Explanation.MemoryRefs {
			used[ref] = true
		}
	}
	refs := l.MemoryReadSet.Refs[:0]
	for _, ref := range l.MemoryReadSet.Refs {
		if used[ref] {
			refs = append(refs, ref)
		}
	}
	l.MemoryReadSet.Refs = refs
}

// Pausing intentionally leaves the unobserved interval uncovered. Re-enabling
// starts a new interval; it does not manufacture life during explicit disable.
func (l *agentLifeState) pause(now time.Time) error {
	l.Explanation = nil
	if l.Current != nil {
		f := *l.Current
		if now.After(f.StartsAt) {
			if now.Before(f.EndsAt) {
				f.EndsAt = now
			}
			f.Phase = lifeInterrupted
			if a := l.Activities[f.ActivityRef]; a != nil {
				f.EndProgress = a.Progress
			}
			f.CompletesActivity = false
			l.appendRecent(f)
		}
		if a := l.Activities[f.ActivityRef]; a != nil {
			a.Phase = lifePaused
		}
		l.Current = nil
	}
	for _, f := range l.Future {
		if a := l.Activities[f.ActivityRef]; a != nil && a.Phase != lifeCompleted {
			a.Phase = lifePaused
		}
	}
	l.Future = nil
	l.NextCheckAt = time.Time{}
	l.WaitReason = "disabled"
	if now.After(l.SettledAt) {
		l.SettledAt = now
	}
	return l.changed()
}

func (l *agentLifeState) cancelFreeIntents(source string) {
	kept := l.Intents[:0]
	for _, intent := range l.Intents {
		if source != "" && intent.Source != source {
			kept = append(kept, intent)
		}
	}
	l.Intents = kept
}

type lifeFrameProposal struct {
	Description       *lifeSelfDescription `json:"description,omitempty"`
	ActivityRef       string               `json:"activity_ref,omitempty"`
	Title             string               `json:"title"`
	Kind              string               `json:"kind"`
	DurationMinutes   float64              `json:"duration_minutes"`
	EndProgress       int                  `json:"end_progress"`
	CompletesActivity bool                 `json:"completes_activity"`
}

// @nimi-authority: rule.nimi.runtime.agent-life.replacement
// No model-controlled timestamps or provenance assertions enter accepted state.
func (l *agentLifeState) acceptFuture(proposals []lifeFrameProposal, from time.Time, flow float64, memoryRefs []string, chatRead bool) error {
	return l.acceptFrames(proposals, from, flow, memoryRefs, chatRead, nil)
}

func (l *agentLifeState) acceptFrames(proposals []lifeFrameProposal, from time.Time, flow float64, memoryRefs []string, chatRead bool, retrospectiveEnd *time.Time) error {
	next, err := (futureFrameUpdater{snapshot: l}).propose(proposals, from, flow, memoryRefs, chatRead, retrospectiveEnd)
	if err != nil {
		return err
	}
	l.Future = next.Future
	l.Activities = next.Activities
	l.Revision = next.Revision
	l.WaitReason = next.WaitReason
	return nil
}

func (l *agentLifeState) invalidateMemory(refs map[string]bool, all bool) bool {
	invalid := func(items []string) bool {
		for _, ref := range items {
			if all || refs[ref] {
				return true
			}
		}
		return false
	}
	changed := false
	for _, f := range l.frames() {
		if invalid(f.MemoryRefs) {
			if f.Phase != lifeCompleted {
				f.Invalidated = true
				f.Description = nil
			}
			f.Title = "Activity"
			f.MemoryRefs = nil
			changed = true
		}
	}
	if l.Explanation != nil && invalid(l.Explanation.MemoryRefs) {
		l.Explanation = nil
		changed = true
	}
	for _, a := range l.Activities {
		if invalid(a.MemoryRefs) {
			if a.RedactedNameKey == "" {
				a.RedactedNameKey = lifeActivityNameKey(a.Title)
			}
			a.MemoryRefs = nil
			a.Title = "Activity"
			changed = true
		}
	}
	// Activities do not carry executable copies of Recall. Their accepted
	// identity/progress stay; a later inference must obtain fresh eligible input.

	kept := l.Intents[:0]
	for _, intent := range l.Intents {
		if invalid(intent.MemoryRefs) {
			changed = true
			continue
		}
		kept = append(kept, intent)
	}
	l.Intents = kept
	return changed
}
