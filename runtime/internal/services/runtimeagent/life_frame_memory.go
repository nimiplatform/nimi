package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
	"time"
)

// @nimi-authority: rule.nimi.runtime.memory-world.r021
func independentLifeFrameFact(l *agentLifeState, f lifeFrame, now time.Time) *runtimev1.CognitionMemoryActivityTerminal {
	d := f.Description
	if f.Phase != lifeCompleted || f.Invalidated || d == nil || validateLifeSelfDescription(d) != nil || f.StartsAt.IsZero() || f.EndsAt.Before(f.StartsAt) || f.EndsAt.After(now) {
		return nil
	}
	a := l.Activities[f.ActivityRef]
	if a == nil {
		return nil
	}
	change := runtimev1.CognitionMemoryActivityChange_COGNITION_MEMORY_ACTIVITY_CHANGE_ROUTINE
	if a.Kind == "project" && f.CompletesActivity {
		change = runtimev1.CognitionMemoryActivityChange_COGNITION_MEMORY_ACTIVITY_CHANGE_PROJECT_COMPLETED
	} else if d.Result == "key_result" {
		change = runtimev1.CognitionMemoryActivityChange_COGNITION_MEMORY_ACTIVITY_CHANGE_KEY_RESULT
	}
	return &runtimev1.CognitionMemoryActivityTerminal{Activity: &runtimev1.CognitionMemorySourceRef{Kind: "life_activity", Value: f.ActivityRef}, ChangeRef: &runtimev1.CognitionMemorySourceRef{Kind: "life_change", Value: f.ID}, ActivityKind: "life_frame", ActivityState: string(f.ActivityState), SelfAction: d.Action, SelfObject: d.Object, BoundedOutcome: d.Outcome, OccurredStart: timestamppb.New(f.StartsAt), OccurredEnd: timestamppb.New(f.EndsAt), Retrospective: f.Retrospective, Change: change}
}

func (s *Service) lifeActivityMemoryTxHook(entry *agentEntry, changes []string, now time.Time) (runtimeAgentStateTxHook, error) {
	facts := []*runtimev1.CognitionMemoryActivityTerminal{}
	for _, id := range changes {
		for _, frame := range entry.Life.Recent {
			if frame.ID == id {
				if fact := independentLifeFrameFact(entry.Life, frame, now); fact != nil {
					facts = append(facts, fact)
				}
				break
			}
		}
	}
	return s.lifeExperienceMemoryTxHook(entry, facts, now)
}

func (s *Service) lifeExperienceMemoryTxHook(entry *agentEntry, facts []*runtimev1.CognitionMemoryActivityTerminal, now time.Time) (runtimeAgentStateTxHook, error) {
	if s.cognitionMemoryStore == nil || len(facts) == 0 {
		return nil, nil
	}
	binding, err := s.cognitionMemoryStore.BindingForAgent(context.Background(), entry.Agent.GetLocalAgentRef())
	if err != nil {
		return nil, err
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return nil, nil
	}
	envelopes := []*runtimev1.CognitionMemoryCommittedEventEnvelope{}
	for _, fact := range facts {
		key := fact.GetChangeRef().GetValue()
		envelopes = append(envelopes, &runtimev1.CognitionMemoryCommittedEventEnvelope{Event: &runtimev1.CognitionMemoryEventRef{Value: "cmevt_life_" + key}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: "cmop_life_" + key}, Subjects: []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}}, Sources: []*runtimev1.CognitionMemorySourceRef{fact.Activity, fact.ChangeRef}, CommittedAt: timestamppb.New(now), Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_ActivityTerminal{ActivityTerminal: fact}})
	}
	return func(tx *sql.Tx) error {
		for _, envelope := range envelopes {
			if _, err := s.cognitionMemoryStore.EnqueueCommittedEventTx(tx, entry.Agent.GetLocalAgentRef(), envelope); err != nil {
				return fmt.Errorf("deliver life experience: %w", err)
			}
		}
		return nil
	}, nil
}

func (s *Service) selfIntentionMemoryTxHook(entry *agentEntry, p *selfIntentionProposal, result *selfIntentionResult, turnID string, now time.Time) (runtimeAgentStateTxHook, error) {
	if p == nil || p.Description == nil || !result.Accepted || (p.Action != "change" && p.Action != "abandon") {
		return nil, nil
	}
	d := p.Description
	if p.Action == "abandon" && d.Result != "abandoned" || p.Action == "change" && d.Result != "direction_changed" {
		return nil, nil
	}
	state := "active"
	if p.Action == "abandon" {
		state = "abandoned"
	}
	return s.lifeExperienceMemoryTxHook(entry, []*runtimev1.CognitionMemoryActivityTerminal{{Activity: &runtimev1.CognitionMemorySourceRef{Kind: "life_activity", Value: result.ActivityRef}, ChangeRef: &runtimev1.CognitionMemorySourceRef{Kind: "life_change", Value: turnID}, ActivityKind: "life_frame", ActivityState: state, SelfAction: d.Action, SelfObject: d.Object, BoundedOutcome: d.Outcome, OccurredStart: timestamppb.New(now), OccurredEnd: timestamppb.New(now), Change: runtimev1.CognitionMemoryActivityChange_COGNITION_MEMORY_ACTIVITY_CHANGE_DIRECTION_CHANGED}}, now)
}
