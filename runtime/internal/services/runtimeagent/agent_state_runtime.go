package runtimeagent

import (
	"fmt"
	"math"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	if err := validatePersistedAgentPresentationProfile(entry.Agent); err != nil {
		return nil, err
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
	if !hadEntry {
		r.svc.mu.Unlock()
		return status.Error(codes.NotFound, "agent not found")
	}
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

func (r agentStateRuntime) snapshotAgentPresentationProfile(
	identity localAgentIdentity,
	expectedRevision uint64,
) (*runtimev1.AgentPresentationProfile, error) {
	r.svc.mu.RLock()
	defer r.svc.mu.RUnlock()

	current := r.svc.agents[identity.LocalAgentRef]
	if current == nil {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	if err := validateLocalAgentRecordIdentity(current.Agent, identity); err != nil {
		return nil, err
	}
	if err := validatePersistedAgentPresentationProfile(current.Agent); err != nil {
		return nil, err
	}
	currentRevision := current.Agent.GetPresentationProfileRevision()
	if currentRevision != expectedRevision {
		return nil, grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT)
	}
	if currentRevision == math.MaxUint64 {
		return nil, status.Error(codes.FailedPrecondition, "agent presentation revision exhausted")
	}
	if current.Agent.GetPresentationProfile() != nil {
		return proto.Clone(current.Agent.GetPresentationProfile()).(*runtimev1.AgentPresentationProfile), nil
	}
	return nil, nil
}

func (r agentStateRuntime) commitAgentPresentationProfile(
	identity localAgentIdentity,
	expectedRevision uint64,
	nextProfile *runtimev1.AgentPresentationProfile,
) (*runtimev1.AgentPresentationProfile, uint64, error) {
	r.svc.mu.Lock()
	defer r.svc.mu.Unlock()

	current := r.svc.agents[identity.LocalAgentRef]
	if current == nil {
		return nil, 0, status.Error(codes.NotFound, "agent not found")
	}
	if err := validateLocalAgentRecordIdentity(current.Agent, identity); err != nil {
		return nil, 0, err
	}
	if err := validatePersistedAgentPresentationProfile(current.Agent); err != nil {
		return nil, 0, err
	}
	currentRevision := current.Agent.GetPresentationProfileRevision()
	if currentRevision != expectedRevision {
		return nil, 0, grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT)
	}
	if currentRevision == math.MaxUint64 {
		return nil, 0, status.Error(codes.FailedPrecondition, "agent presentation revision exhausted")
	}
	committedRevision := currentRevision + 1
	if nextProfile != nil {
		nextProfile = proto.Clone(nextProfile).(*runtimev1.AgentPresentationProfile)
		nextProfile.Revision = committedRevision
	}

	next := cloneAgentEntry(current)
	next.Agent.PresentationProfile = nextProfile
	next.Agent.PresentationProfileRevision = committedRevision
	next.Agent.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := validatePersistedAgentPresentationProfile(next.Agent); err != nil {
		return nil, 0, err
	}
	r.svc.agents[identity.LocalAgentRef] = next
	if err := r.saveStateLocked(); err != nil {
		r.svc.agents[identity.LocalAgentRef] = current
		return nil, 0, err
	}

	if nextProfile == nil {
		return nil, committedRevision, nil
	}
	return proto.Clone(nextProfile).(*runtimev1.AgentPresentationProfile), committedRevision, nil
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
