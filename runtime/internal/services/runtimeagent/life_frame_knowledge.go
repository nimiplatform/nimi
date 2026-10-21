package runtimeagent

import (
	"encoding/json"
	"time"
)

// @nimi-authority: rule.nimi.runtime.agent-life.catch-up
// Current knowledge may narrow an unknown past interval, never backdate a
// newly learned fact. The source/Memory owners already supply these times.
func constrainLifePastKnowledge(input *lifeFrameExecutionInput) error {
	if input.ContactOnly || input.Context == nil {
		return nil
	}
	from := maxTime(input.Entry.Life.SettledAt, input.Source.KnownAt)
	if len(input.Transcript) > 0 {
		if input.TranscriptKnownAt.IsZero() {
			from = input.Now
		} else {
			from = maxTime(from, input.TranscriptKnownAt)
		}
	}
	for _, m := range input.Memory {
		if m.KnownAt.IsZero() {
			from = input.Now
			break
		}
		from = maxTime(from, m.KnownAt)
	}
	from = minTime(from, input.Now)
	input.PastFrom = from
	var core map[string]json.RawMessage
	if err := json.Unmarshal([]byte(input.Context.Core), &core); err != nil {
		return err
	}
	if _, exists := core["past_window"]; !exists {
		return nil
	}
	minutes := input.Now.Sub(from).Minutes() * input.Source.LifeFlowRatio
	if minutes < 1 {
		delete(core, "past_window")
	} else {
		raw, err := json.Marshal(struct {
			Start        time.Time `json:"start"`
			End          time.Time `json:"end"`
			WorldMinutes float64   `json:"world_minutes"`
		}{from, input.Now, minutes})
		if err != nil {
			return err
		}
		core["past_window"] = raw
	}
	raw, err := json.Marshal(core)
	if err == nil {
		copy := *input.Context
		copy.Core = string(raw)
		input.Context = &copy
	}
	return err
}

// A recovered schedule is not evidence that its missed segments occurred.
// Keep future intervals with satisfied predecessors; do not settle offline work.
func (l *agentLifeState) recoverAt(now time.Time) error {
	before := cloneAgentLifeState(l)
	for _, f := range l.Future {
		if f.StartsAt.Before(now) {
			// A missed arrangement cannot return through retrospective planning.
			// Omit this uncertain offline interval instead of settling it twice.
			l.SettledAt = maxTime(l.SettledAt, now)
			break
		}
	}
	if i := l.Interaction; i != nil {
		if err := l.finishInteraction(i.LastActivityAt); err != nil {
			return err
		}
		l.SettledAt = maxTime(l.SettledAt, now)
	}
	if f := l.Current; f != nil {
		// Only the start is known after an unobserved shutdown. Preserve the
		// established activity/progress and seal this uncertain interval.
		l.interruptCurrent(f.StartsAt)
		l.SettledAt = maxTime(l.SettledAt, now)
		l.NextCheckAt = now
	}
	l.reviewFuture(now)
	if lifeStateEqual(before, l) {
		return nil
	}
	return l.changed()
}
