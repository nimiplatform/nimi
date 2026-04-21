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

func (r agentStateRuntime) agentByID(agentID string) (*agentEntry, error) {
	if agentID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	r.svc.mu.RLock()
	entry := cloneAgentEntry(r.svc.agents[agentID])
	r.svc.mu.RUnlock()
	if entry == nil {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	return entry, nil
}

func (r agentStateRuntime) insertAgent(entry *agentEntry, events ...*runtimev1.AgentEvent) error {
	r.svc.mu.Lock()
	previousEntry, hadEntry := r.svc.agents[entry.Agent.GetAgentId()]
	previousEvents := append([]*runtimev1.AgentEvent(nil), r.svc.events...)
	previousSequence := r.svc.sequence
	r.svc.agents[entry.Agent.GetAgentId()] = cloneAgentEntry(entry)
	committedEvents := r.svc.eventStreamRuntime().appendEventsLocked(events...)
	if err := r.saveStateLocked(); err != nil {
		if hadEntry {
			r.svc.agents[entry.Agent.GetAgentId()] = previousEntry
		} else {
			delete(r.svc.agents, entry.Agent.GetAgentId())
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
	r.svc.mu.Lock()
	previousEntry, hadEntry := r.svc.agents[entry.Agent.GetAgentId()]
	previousEvents := append([]*runtimev1.AgentEvent(nil), r.svc.events...)
	previousSequence := r.svc.sequence
	r.svc.agents[entry.Agent.GetAgentId()] = cloneAgentEntry(entry)
	committedEvents := r.svc.eventStreamRuntime().appendEventsLocked(events...)
	if err := r.saveStateLocked(); err != nil {
		if hadEntry {
			r.svc.agents[entry.Agent.GetAgentId()] = previousEntry
		} else {
			delete(r.svc.agents, entry.Agent.GetAgentId())
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

func (r agentStateRuntime) resetImportedState() error {
	if r.svc == nil || r.svc.stateRepo == nil {
		return nil
	}
	return r.svc.stateRepo.resetImportedState()
}

func (r agentStateRuntime) saveStateLockedOrPanicContext(label string) error {
	if err := r.saveStateLocked(); err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	return nil
}
