package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"sort"
)

func projectAgentLife(l *agentLifeState) *runtimev1.LocalAppAgentLifeProjection {
	if l == nil {
		l = newAgentLifeState()
	}
	project := func(f lifeFrame) *runtimev1.LocalAppAgentLifeFrame {
		a := l.Activities[f.ActivityRef]
		title := f.Title
		phases := map[lifePhase]runtimev1.LocalAppAgentLifePhase{lifePlanned: 1, lifeActive: 2, lifePaused: 3, lifeCompleted: 4, lifeInterrupted: 5, lifeCanceled: 6}
		progress := f.EndProgress
		if (f.Phase == lifeActive || f.Phase == lifePlanned) && a != nil {
			progress = a.Progress
		}
		value := &runtimev1.LocalAppAgentLifeFrame{FrameId: f.ID, ActivityRef: f.ActivityRef, Title: title, Phase: phases[f.Phase], StartsAt: timestamppb.New(f.StartsAt), EndsAt: timestamppb.New(f.EndsAt), Interaction: f.Interaction}
		if !f.Interaction {
			value.Progress = proto.Uint32(uint32(progress))
		}
		if f.EndsAt.IsZero() {
			value.EndsAt = nil
		}
		return value
	}
	result := &runtimev1.LocalAppAgentLifeProjection{Revision: l.Revision, WaitReason: l.WaitReason}
	activityRefs := []string{}
	for ref, a := range l.Activities {
		if a.Phase != lifeCompleted && a.Phase != lifeCanceled {
			activityRefs = append(activityRefs, ref)
		}
	}
	sort.Strings(activityRefs)
	for _, ref := range activityRefs {
		a := l.Activities[ref]
		phase := map[lifePhase]runtimev1.LocalAppAgentLifePhase{lifePlanned: 1, lifeActive: 2, lifePaused: 3}[a.Phase]
		result.Activities = append(result.Activities, &runtimev1.LocalAppAgentLifeActivity{ActivityRef: a.Ref, Title: a.Title, Kind: a.Kind, Phase: phase, Progress: uint32(a.Progress)})
	}
	if i := l.Interaction; i != nil {
		result.Current = project(lifeFrame{ID: i.ID, Title: "Interaction", StartsAt: i.StartedAt, Phase: lifeActive, Interaction: true})
	} else if l.Current != nil {
		result.Current = project(*l.Current)
	}
	for _, f := range l.Recent {
		result.Recent = append(result.Recent, project(f))
	}
	for _, f := range l.Future {
		result.Future = append(result.Future, project(f))
	}
	if !l.NextCheckAt.IsZero() {
		result.NextCheckAt = timestamppb.New(l.NextCheckAt)
	}
	return result
}
