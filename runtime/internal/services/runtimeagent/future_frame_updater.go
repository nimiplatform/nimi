package runtimeagent

import (
	"fmt"
	"github.com/oklog/ulid/v2"
	"math"
	"strings"
	"time"
)

// @nimi-authority: rule.nimi.runtime.agent-life.replacement
// @nimi-authority: rule.nimi.runtime.memory-world.r021
// Proposes a detached future/intent update. No loop, past or current write,
// persistence, task execution or caller authority lives in this module.
type futureFrameUpdater struct{ snapshot *agentLifeState }

func (u futureFrameUpdater) propose(proposals []lifeFrameProposal, from time.Time, flow float64, memoryRefs []string, chatRead bool, retrospectiveEnd *time.Time) (*agentLifeState, error) {
	l := u.snapshot
	retrospective := retrospectiveEnd != nil
	if len(proposals) == 0 || len(proposals) > lifeFutureLimit || flow <= 0 || math.IsNaN(flow) || math.IsInf(flow, 0) {
		return nil, fmt.Errorf("invalid life proposal bounds")
	}
	next := cloneAgentLifeState(l)
	if from.Before(next.SettledAt) {
		return nil, fmt.Errorf("life proposal rewrites settled time")
	}
	if next.Current != nil && from.Before(next.Current.EndsAt) {
		return nil, fmt.Errorf("life proposal overlaps current frame")
	}
	if !retrospective && len(next.Future)+len(proposals) > lifeFutureLimit {
		return nil, fmt.Errorf("too many tentative life frames")
	}
	reserved := next.Future
	next.Future = nil
	reservedActivities := map[string]bool{}
	for _, f := range reserved {
		reservedActivities[f.ActivityRef] = true
	}
	start := from
	plannedProgress := map[string]int{}
	plannedComplete := map[string]bool{}
	for ref, a := range next.Activities {
		plannedProgress[ref] = a.Progress
	}
	for _, p := range proposals {
		p.Description = normalizeLifeSelfDescription(p.Description)
		if err := validateLifeSelfDescription(p.Description); err != nil {
			p.Description = nil
		}
		if strings.TrimSpace(p.Title) == "" || len([]rune(p.Title)) > 160 || (p.Kind != "routine" && p.Kind != "project") || !retrospective && (p.DurationMinutes < 1 || p.DurationMinutes > 1440 || math.IsNaN(p.DurationMinutes) || math.IsInf(p.DurationMinutes, 0)) || p.EndProgress < 0 || p.EndProgress > 100 || p.CompletesActivity && p.EndProgress != 100 {
			return nil, fmt.Errorf("invalid life frame")
		}
		a := next.Activities[p.ActivityRef]
		if p.Description != nil && p.Description.Result != "completed" && p.Description.Result != "key_result" {
			p.Description = nil
		}
		if err := next.validatePlanningActivity(p, a); err != nil {
			return nil, err
		}
		if reservedActivities[p.ActivityRef] {
			return nil, fmt.Errorf("life proposal cannot bring forward an accepted future activity")
		}
		if p.ActivityRef != "" && a == nil {
			return nil, fmt.Errorf("unknown life activity")
		}
		if a == nil {
			ref := "activity_" + ulid.Make().String()
			a = &lifeActivity{Ref: ref, Title: strings.TrimSpace(p.Title), Kind: p.Kind, Phase: lifePlanned}

			next.Activities[ref] = a
		} else if a.Phase == lifeCompleted || a.Phase == lifeCanceled || plannedComplete[a.Ref] || p.EndProgress < plannedProgress[a.Ref] {
			return nil, fmt.Errorf("life activity %s cannot continue: phase=%s planned_complete=%t progress=%d proposed=%d", a.Ref, a.Phase, plannedComplete[a.Ref], plannedProgress[a.Ref], p.EndProgress)
		}
		var end time.Time
		if retrospective {
			end = *retrospectiveEnd
			if end.Sub(start) < time.Second {
				return nil, fmt.Errorf("retrospective frame is too short")
			}
		} else {
			duration := float64(time.Minute) * p.DurationMinutes / flow
			if duration < float64(time.Second) || duration > float64(30*24*time.Hour) {
				return nil, fmt.Errorf("life frame real duration outside supported bounds")
			}
			end = start.Add(time.Duration(duration))
		}
		next.Future = append(next.Future, lifeFrame{Description: p.Description, ID: "frame_" + ulid.Make().String(), ActivityRef: a.Ref, Title: strings.TrimSpace(p.Title), MemoryRefs: append([]string(nil), memoryRefs...), StartsAt: start, EndsAt: end, Phase: lifePlanned, StartProgress: plannedProgress[a.Ref], EndProgress: p.EndProgress, CompletesActivity: p.CompletesActivity, Retrospective: retrospective})
		plannedProgress[a.Ref] = p.EndProgress
		plannedComplete[a.Ref] = p.CompletesActivity
		start = end
	}
	if len(reserved) > 0 && start.After(reserved[0].StartsAt) {
		return nil, fmt.Errorf("life proposal overlaps an accepted future arrangement")
	}
	for _, f := range reserved {
		if plannedComplete[f.ActivityRef] || f.EndProgress < plannedProgress[f.ActivityRef] {
			return nil, fmt.Errorf("life proposal conflicts with accepted future progress")
		}
		plannedProgress[f.ActivityRef] = f.EndProgress
		plannedComplete[f.ActivityRef] = f.CompletesActivity
	}
	next.Future = append(next.Future, reserved...)
	if !retrospective {
		if err := next.validateActivityCapacity(); err != nil {
			return nil, err
		}
	}
	if err := next.changed(); err != nil {
		return nil, err
	}
	next.WaitReason = ""
	return next, nil
}
