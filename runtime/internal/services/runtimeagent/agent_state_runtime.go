package runtimeagent

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type agentStateRuntime struct {
	svc *Service
}

func (s *Service) agentStateRuntime() agentStateRuntime {
	return agentStateRuntime{svc: s}
}

func (r agentStateRuntime) agentByID(localAgentRef string) (*agentEntry, error) {
	if localAgentRef == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	r.svc.mu.RLock()
	entry := cloneAgentEntry(r.svc.agents[localAgentRef])
	r.svc.mu.RUnlock()
	if entry == nil {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	return entry, nil
}

func (r agentStateRuntime) insertAgent(entry *agentEntry, events ...*runtimev1.AgentEvent) error {
	localAgentRef, err := localAgentRefForEntry(entry)
	if err != nil {
		return err
	}
	r.svc.mu.Lock()
	previousEntry, hadEntry := r.svc.agents[localAgentRef]
	previousEvents := append([]*runtimev1.AgentEvent(nil), r.svc.events...)
	previousSequence := r.svc.sequence
	r.svc.agents[localAgentRef] = cloneAgentEntry(entry)
	committedEvents := r.svc.eventStreamRuntime().appendEventsLocked(events...)
	if err := r.saveStateLocked(); err != nil {
		if hadEntry {
			r.svc.agents[localAgentRef] = previousEntry
		} else {
			delete(r.svc.agents, localAgentRef)
		}
		r.svc.events = previousEvents
		r.svc.sequence = previousSequence
		r.svc.mu.Unlock()
		return err
	}
	targetsByEvent := r.svc.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	r.svc.mu.Unlock()
	r.svc.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
}

func (r agentStateRuntime) updateAgent(entry *agentEntry, events ...*runtimev1.AgentEvent) error {
	localAgentRef, err := localAgentRefForEntry(entry)
	if err != nil {
		return err
	}
	r.svc.mu.Lock()
	previousEntry, hadEntry := r.svc.agents[localAgentRef]
	previousEvents := append([]*runtimev1.AgentEvent(nil), r.svc.events...)
	previousSequence := r.svc.sequence
	r.svc.agents[localAgentRef] = cloneAgentEntry(entry)
	committedEvents := r.svc.eventStreamRuntime().appendEventsLocked(events...)
	if err := r.saveStateLocked(); err != nil {
		if hadEntry {
			r.svc.agents[localAgentRef] = previousEntry
		} else {
			delete(r.svc.agents, localAgentRef)
		}
		r.svc.events = previousEvents
		r.svc.sequence = previousSequence
		r.svc.mu.Unlock()
		return err
	}
	targetsByEvent := r.svc.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	r.svc.mu.Unlock()
	r.svc.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
}

// deleteAgent hard-removes the LocalAgent projection for localAgentRef from
// in-memory state and persistence per K-AGCORE-141. Because `persistSnapshot`
// rewrites `runtime_local_agent` / `runtime_local_agent_state_projection` /
// `runtime_local_agent_hook` / `runtime_local_agent_event_log` from in-memory
// state, deleting the `agents` entry already excludes the row, state
// projection, and hooks for that ref. The agent event log is also a deletion
// target, so deleteAgent additionally drops every event bound to localAgentRef
// from `s.events` — leaving them would re-persist event-log rows for an absent
// ref. The supplied txHook purges the agent-scoped projection tables the
// snapshot does NOT rewrite (`runtime_local_agent_behavioral_posture`,
// `runtime_local_agent_review_run`, `runtime_local_agent_review_followup`).
//
// liveEvents are the cancellation/lifecycle events surfaced for the deletion.
// They are broadcast to live subscribers as observability of the in-flight
// teardown but are NOT persisted: the deleted agent's event log is removed, so
// nothing new is written for it. On persistence failure the in-memory agent
// set, event log, and sequence are rolled back so a failed delete fails closed
// with no partial state.
func (r agentStateRuntime) deleteAgent(localAgentRef string, txHook runtimeAgentStateTxHook, liveEvents ...*runtimev1.AgentEvent) error {
	if localAgentRef == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	r.svc.mu.Lock()
	previousEntry, hadEntry := r.svc.agents[localAgentRef]
	previousEvents := append([]*runtimev1.AgentEvent(nil), r.svc.events...)
	previousSequence := r.svc.sequence
	delete(r.svc.agents, localAgentRef)
	retained := r.svc.events[:0]
	for _, event := range previousEvents {
		if event.GetLocalAgentRef() == localAgentRef {
			continue
		}
		retained = append(retained, event)
	}
	r.svc.events = retained
	if err := r.svc.stateRepo.saveStateLockedWithTxHook(r.svc, txHook); err != nil {
		if hadEntry {
			r.svc.agents[localAgentRef] = previousEntry
		}
		r.svc.events = previousEvents
		r.svc.sequence = previousSequence
		r.svc.mu.Unlock()
		return err
	}
	targetsByEvent := r.svc.eventStreamRuntime().matchingSubscribersLocked(liveEvents)
	r.svc.mu.Unlock()
	r.svc.eventStreamRuntime().broadcast(liveEvents, targetsByEvent)
	return nil
}

func (r agentStateRuntime) loadState() error {
	if r.svc == nil || r.svc.stateRepo == nil {
		return nil
	}
	if err := r.svc.stateRepo.loadState(r.svc); err != nil {
		return err
	}
	if r.svc.chatStateRepo == nil {
		return nil
	}
	return r.svc.chatStateRepo.loadPublicChatSurfaceStateFromDB(r.svc)
}

func (r agentStateRuntime) saveStateLocked() error {
	if r.svc == nil || r.svc.stateRepo == nil {
		return nil
	}
	return r.svc.stateRepo.saveStateLocked(r.svc)
}

func (r agentStateRuntime) metaValue(key string) (string, error) {
	if r.svc == nil || r.svc.stateRepo == nil {
		return "", nil
	}
	return r.svc.stateRepo.runtimeAgentMetaValue(key)
}

func (r agentStateRuntime) markInitialized(sequence uint64) error {
	if r.svc == nil || r.svc.stateRepo == nil {
		return nil
	}
	return r.svc.stateRepo.markRuntimeAgentStateInitialized(sequence)
}

func (r agentStateRuntime) saveStateLockedOrPanicContext(label string) error {
	if err := r.saveStateLocked(); err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	return nil
}
