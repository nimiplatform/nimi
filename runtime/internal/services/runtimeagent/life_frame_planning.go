package runtimeagent

import (
	"fmt"
	"math"
	"time"
)

func (l *agentLifeState) validateActivityCapacity() error {
	active := 0
	for _, a := range l.Activities {
		if a.Phase != lifeCompleted && a.Phase != lifeCanceled {
			active++
		}
	}
	if active > lifeUnfinishedLimit {
		return fmt.Errorf("finish or abandon an intention before adding another")
	}
	return nil
}

func (l *agentLifeState) canPlanAt(now time.Time, flow float64) bool {
	if l.Interaction != nil || l.Current != nil || now.Before(l.SettledAt) || l.NextCheckAt.After(now) || len(l.Future) >= lifeFutureLimit {
		return false
	}
	return len(l.Future) == 0 || l.Future[0].StartsAt.Sub(now).Seconds()*flow >= 60
}

type lifePastProposal struct {
	Description       *lifeSelfDescription `json:"description,omitempty"`
	ActivityRef       string               `json:"activity_ref,omitempty"`
	Title             string               `json:"title"`
	Kind              string               `json:"kind"`
	EndProgress       int                  `json:"end_progress"`
	CompletesActivity bool                 `json:"completes_activity"`
	StartFraction     float64              `json:"start_fraction"`
	EndFraction       float64              `json:"end_fraction"`
}

// @nimi-authority: rule.nimi.runtime.agent-life.catch-up
// Sparse key frames describe the whole assigned gap. Unrepresented time is
// omitted ordinary life, not a backlog for subsequent inference.
func (l *agentLifeState) acceptPast(proposals []lifePastProposal, until time.Time, flow float64, memoryRefs []string, chatRead bool) ([]string, error) {
	if len(proposals) > 3 || l.Current != nil || until.Before(l.SettledAt) || len(l.Future) > 0 && l.Future[0].StartsAt.Before(until) {
		return nil, fmt.Errorf("life catch-up has no uncovered interval")
	}
	from := l.SettledAt
	if !until.After(from) {
		if len(proposals) > 0 {
			return nil, fmt.Errorf("life catch-up has no uncovered interval")
		}
		return nil, nil
	}
	next := cloneAgentLifeState(l)
	var completed []string
	for _, p := range proposals {
		if math.IsNaN(p.StartFraction) || math.IsInf(p.StartFraction, 0) || math.IsNaN(p.EndFraction) || math.IsInf(p.EndFraction, 0) || p.StartFraction < 0 || p.EndFraction > 1 || p.EndFraction <= p.StartFraction {
			return nil, fmt.Errorf("invalid retrospective position")
		}
		start := from.Add(time.Duration(float64(until.Sub(from)) * p.StartFraction))
		end := from.Add(time.Duration(float64(until.Sub(from)) * p.EndFraction))
		if p.EndFraction == 1 || end.After(until) {
			end = until
		}
		proposal := lifeFrameProposal{Description: p.Description, ActivityRef: p.ActivityRef, Title: p.Title, Kind: p.Kind, EndProgress: p.EndProgress, CompletesActivity: p.CompletesActivity}
		if err := next.acceptFrames([]lifeFrameProposal{proposal}, start, flow, memoryRefs, chatRead, &end); err != nil {
			return nil, err
		}
		done, err := next.advance(end, false)
		if err != nil {
			return nil, err
		}
		completed = append(completed, done...)
	}
	if err := next.validateActivityCapacity(); err != nil {
		return nil, err
	}
	next.SettledAt = until
	if err := next.changed(); err != nil {
		return nil, err
	}
	*l = *next
	return completed, nil
}
