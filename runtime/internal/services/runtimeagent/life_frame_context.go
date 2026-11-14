package runtimeagent

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

type agentTurnLifeContextInput struct {
	Revision                    uint64
	Planning                    bool
	MemoryReadSet               cognitionmemory.MemoryReadSet
	CoreMemoryReadSet           cognitionmemory.MemoryReadSet
	CoreConversationRead        *lifeConversationRead
	ExplanationConversationRead *lifeConversationRead
	Core                        string
	Explanation                 string
	RecallQuery                 string
	Utopia                      *lifeUtopia
	PreviousUtopia              *lifeUtopiaPlanningConditions
}

func subsetMemoryReadSet(source cognitionmemory.MemoryReadSet, refs []string) cognitionmemory.MemoryReadSet {
	out := source
	out.Refs = append([]string(nil), refs...)
	return out
}

// @nimi-authority: rule.nimi.runtime.agent-life.context
// The durable timeline is larger than the input: keep unfinished work and
// accepted future segments, a few recent key frames, and self-intentions.
// Delivery instructions stay with their owner and are not planning prompts.
func projectLifeContext(l *agentLifeState, planning, omitSupplemental bool, selection *lifeConversationRead, now time.Time) *agentTurnLifeContextInput {
	if l == nil {
		return nil
	}
	type activity struct {
		Ref      string    `json:"activity_ref,omitempty"`
		Title    string    `json:"title"`
		Kind     string    `json:"kind"`
		Phase    lifePhase `json:"phase"`
		Progress int       `json:"progress"`
	}
	type frame struct {
		Ref         string     `json:"activity_ref,omitempty"`
		Title       string     `json:"step"`
		Start       time.Time  `json:"start"`
		End         *time.Time `json:"end,omitempty"`
		Interaction bool       `json:"interaction,omitempty"`
		Phase       lifePhase  `json:"phase"`
	}

	type window struct {
		Start   time.Time  `json:"start"`
		End     *time.Time `json:"end,omitempty"`
		Minutes float64    `json:"real_minutes,omitempty"`
	}
	core := struct {
		Now                 time.Time  `json:"real_now"`
		SettledAt           time.Time  `json:"settled_at,omitempty"`
		Current             *frame     `json:"current"`
		Future              []frame    `json:"tentative_future,omitempty"`
		Recent              []frame    `json:"recent,omitempty"`
		Activities          []activity `json:"activities,omitempty"`
		PastWindow          *window    `json:"past_window,omitempty"`
		FutureWindow        *window    `json:"future_window,omitempty"`
		FutureSlots         *int       `json:"future_slots,omitempty"`
		ActiveActivitySlots *int       `json:"active_activity_slots,omitempty"`
	}{Now: now}
	result := &agentTurnLifeContextInput{Planning: planning, Revision: l.Revision}
	refs := []string{}
	reservedActivities := map[string]bool{}
	for _, f := range l.Future {
		reservedActivities[f.ActivityRef] = true
	}
	seen := map[string]bool{}
	add := func(ref string) {
		if !seen[ref] {
			seen[ref] = true
			refs = append(refs, ref)
		}
	}
	includeSource := func(memoryRefs []string, conversationRead *lifeConversationRead) bool {
		if !sourceConversationAllowed(conversationRead, selection) || omitSupplemental && len(memoryRefs) > 0 {
			return false
		}
		read, err := unionMemoryReadSet(result.CoreMemoryReadSet, subsetMemoryReadSet(l.MemoryReadSet, memoryRefs))
		if err != nil {
			return false
		}
		conversation, err := combineConversationReads(result.CoreConversationRead, projectConversationRead(conversationRead, selection))
		if err != nil {
			return false
		}
		result.CoreMemoryReadSet = read
		result.CoreConversationRead = conversation
		return true
	}
	project := func(f lifeFrame) frame {
		if f.SharedRef != "" {
			end := f.EndsAt
			return frame{Title: "Shared Utopia activity", Start: f.StartsAt, End: &end, Phase: f.Phase}
		}
		ref := f.ActivityRef
		if a := l.Activities[ref]; planning && a != nil && (a.Phase == lifeCompleted || a.Phase == lifeCanceled || reservedActivities[ref]) {
			// Historical descriptions remain useful; terminal or user-paused
			// identities are not planning handles for the model to continue.
			ref = ""
		} else {
			add(ref)
		}
		title := f.Title
		if !includeSource(f.MemoryRefs, f.ConversationRead) {
			title = "Activity"
		}
		var end *time.Time
		if !f.EndsAt.IsZero() {
			end = &f.EndsAt
		}
		return frame{Ref: ref, Title: title, Start: f.StartsAt, End: end, Phase: f.Phase, Interaction: f.Interaction}
	}
	if i := l.Interaction; i != nil {
		f := project(lifeFrame{ID: i.ID, Title: "Interaction", StartsAt: i.StartedAt, Phase: lifeActive, Interaction: true})
		core.Current = &f
	} else if l.Current != nil {
		f := project(*l.Current)
		core.Current = &f
	}
	if planning {
		core.SettledAt = l.SettledAt
		pastMinutes := now.Sub(l.SettledAt).Minutes()
		if pastMinutes >= 1 && !l.SettledAt.IsZero() && l.Current == nil && l.Interaction == nil {
			core.PastWindow = &window{Start: l.SettledAt, End: &now, Minutes: pastMinutes}
		}
		core.FutureWindow = &window{Start: now}
		if len(l.Future) > 0 {
			end := l.Future[0].StartsAt
			core.FutureWindow.End = &end
			core.FutureWindow.Minutes = end.Sub(now).Minutes()
		}
		slots := min(3, lifeFutureLimit-len(l.Future))
		core.FutureSlots = &slots
		activeSlots := lifeUnfinishedLimit - l.unfinishedActivityCount()
		core.ActiveActivitySlots = &activeSlots
		for _, f := range l.Future {
			core.Future = append(core.Future, project(f))
		}
		unfinished := []string{}
		for ref, a := range l.Activities {
			if a.Phase != lifeCompleted && a.Phase != lifeCanceled && !strings.HasPrefix(ref, "shared_") {
				unfinished = append(unfinished, ref)
			}
		}
		sort.Strings(unfinished)
		for _, ref := range unfinished {
			add(ref)
		}
		for _, f := range l.Recent[max(0, len(l.Recent)-3):] {
			core.Recent = append(core.Recent, project(f))
		}
	} else {
		for ref, a := range l.Activities {
			if a.Phase != lifeCompleted && a.Phase != lifeCanceled && !strings.HasPrefix(ref, "shared_") {
				add(ref)
			}
		}
		sort.Strings(refs)
		for i := len(l.Recent) - 1; i >= 0 && len(core.Recent) < 3; i-- {
			if !l.Recent[i].Interaction {
				core.Recent = append(core.Recent, project(l.Recent[i]))
			}
		}
		for _, f := range l.Future[:min(3, len(l.Future))] {
			core.Future = append(core.Future, project(f))
		}
	}
	var titles []string
	for _, ref := range refs {
		a := l.Activities[ref]
		if a == nil {
			continue
		}
		title := a.Title
		titles = append(titles, title)
		activityRef := a.Ref
		core.Activities = append(core.Activities, activity{activityRef, title, a.Kind, a.Phase, a.Progress})
	}
	if e := l.Explanation; e != nil && !omitSupplemental && sourceConversationAllowed(e.ConversationRead, selection) {
		read := subsetMemoryReadSet(l.MemoryReadSet, e.MemoryRefs)
		if _, err := unionMemoryReadSet(result.CoreMemoryReadSet, read); err == nil {
			result.Explanation = e.Text
			result.MemoryReadSet = read
			result.ExplanationConversationRead = projectConversationRead(e.ConversationRead, selection)
		}
	}
	raw, _ := json.Marshal(core)
	result.Core = string(raw)
	result.RecallQuery = strings.Join(titles, " ")
	return result
}

func appendAgentTurnLifeContext(items map[agentTurnContextLaneID][]agentTurnContextItem, input *agentTurnLifeContextInput) error {
	if input == nil {
		return nil
	}
	var utopia string
	if input.Utopia != nil {
		raw, err := json.Marshal(struct {
			Current  *lifeUtopia                   `json:"current"`
			Previous *lifeUtopiaPlanningConditions `json:"previous_if_changed,omitempty"`
		}{input.Utopia, input.PreviousUtopia})
		if err != nil {
			return fmt.Errorf("encode life Utopia: %w", err)
		}
		utopia = string(raw)
	}
	for _, part := range []struct {
		id, heading, text string
		required          bool
	}{
		{"state", "Accepted simulated life state; future frames are tentative, and no external effects are implied", input.Core, true},
		{"utopia", "Current Utopia conditions and any change since the last accepted personal plan", utopia, true},
		{"explanation", "Optional life explanation from currently eligible sources; advisory context, not control authority.", input.Explanation, false},
	} {
		if part.text == "" {
			continue
		}
		content := agentTurnContextTypedContent(part.heading, agentTurnContextTextField{Name: part.id, Values: []string{part.text}})
		ref, err := newAgentTurnContextRuntimeRef("lifeContext", part.id, "v1", content)
		if err != nil {
			return err
		}
		truncation := agentTurnContextTruncationNone
		if !part.required {
			truncation = agentTurnContextTruncationSummary
		}
		item, err := newAgentTurnContextItem(agentTurnContextLaneLifeContext, "life."+part.id, "runtime.life."+part.id, ref, agentTurnContextAuthorityRuntimeRelation, agentTurnContextTrustRuntimeScoped, 900, 0, part.required, truncation, []agentTurnContextSegment{{Role: "system", Content: content}}, nil)
		if err != nil {
			return err
		}
		items[agentTurnContextLaneLifeContext] = append(items[agentTurnContextLaneLifeContext], item)
	}
	return nil
}
