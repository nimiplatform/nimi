package runtimeagent

import (
	"encoding/json"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"math"
	"time"
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
