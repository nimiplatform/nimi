package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// K-AGCORE-146 typed readiness reason codes
// (tables/agent-execution-config.yaml readiness_reason_codes).
const (
	executionReadinessReasonRouteUnhealthy   = "route_unhealthy"
	executionReadinessReasonConnectorMissing = "connector_missing"
	executionReadinessReasonModelMissing     = "model_missing"
	executionReadinessReasonTargetMissing    = "target_missing"
	executionReadinessReasonProbeFailed      = "probe_failed"
)

// localProviderHealthKey is the providerhealth.Tracker key the daemon marks
// for the local engine family (see daemon_audit.go Mark("local", ...)).
const localProviderHealthKey = "local"

// SetProviderHealthTracker wires the runtime provider health tracker into the
// execution readiness prober and subscribes to health change evidence so the
// readiness projection recomputes on every provider health transition
// (K-AGCORE-146). Passing nil detaches the tracker.
func (s *Service) SetProviderHealthTracker(tracker *providerhealth.Tracker) {
	if s == nil || s.isClosed() {
		return
	}
	s.execHealthMu.Lock()
	if s.execHealthCancel != nil {
		s.execHealthCancel()
		s.execHealthCancel = nil
	}
	done := s.execHealthDone
	s.execHealthDone = nil
	s.execHealthMu.Unlock()
	if done != nil {
		<-done
	}

	s.execHealthMu.Lock()
	s.execHealthTracker = tracker
	if tracker == nil {
		s.execHealthMu.Unlock()
		return
	}
	ch, cancel := tracker.Subscribe(subscriberBuffer)
	loopDone := make(chan struct{})
	s.execHealthCancel = cancel
	s.execHealthDone = loopDone
	s.execHealthMu.Unlock()

	go func() {
		defer close(loopDone)
		for range ch {
			if s.isClosed() {
				return
			}
			if err := s.refreshExecutionReadiness(); err != nil && s.logger != nil {
				s.logger.Warn("recompute execution readiness on provider health change failed", "error", err)
			}
		}
	}()

	// Tracker attachment is itself health evidence: recompute immediately so
	// the projection reflects the tracker-backed truth.
	if err := s.refreshExecutionReadiness(); err != nil && s.logger != nil {
		s.logger.Warn("recompute execution readiness on tracker attach failed", "error", err)
	}
}

func (s *Service) providerHealthTracker() *providerhealth.Tracker {
	if s == nil {
		return nil
	}
	s.execHealthMu.Lock()
	defer s.execHealthMu.Unlock()
	return s.execHealthTracker
}

// stopExecutionReadinessHealthSubscription detaches the provider health
// subscription during service shutdown.
func (s *Service) stopExecutionReadinessHealthSubscription() {
	if s == nil {
		return
	}
	s.execHealthMu.Lock()
	cancel := s.execHealthCancel
	done := s.execHealthDone
	s.execHealthCancel = nil
	s.execHealthDone = nil
	s.execHealthMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

// refreshExecutionReadiness recomputes the per-capability readiness
// projection from the committed config and pushes the new snapshot to every
// in-process subscriber.
func (s *Service) refreshExecutionReadiness() error {
	snapshot, err := s.computeExecutionReadiness()
	if err != nil {
		return err
	}
	s.execReadinessMu.Lock()
	s.execReadiness = snapshot
	s.execReadinessMu.Unlock()
	s.broadcastExecutionReadiness(snapshot)
	return nil
}

func (s *Service) computeExecutionReadiness() (*runtimev1.AgentExecutionReadinessSnapshot, error) {
	config, err := s.committedExecutionConfig()
	if err != nil {
		return nil, err
	}
	probedAt := timestamppb.New(time.Now().UTC())
	byCapability := make(map[string]*runtimev1.RuntimeAgentExecutionCapabilityBinding, len(config.GetBindings()))
	for _, binding := range config.GetBindings() {
		byCapability[strings.TrimSpace(binding.GetCapability())] = binding
	}
	snapshot := &runtimev1.AgentExecutionReadinessSnapshot{
		ConfigRevision: config.GetRevision(),
		Capabilities:   make([]*runtimev1.RuntimeAgentExecutionCapabilityReadiness, 0, len(admittedExecutionCapabilities)),
	}
	for _, capability := range admittedExecutionCapabilities {
		state, reason := s.evaluateExecutionCapabilityReadiness(byCapability[capability])
		snapshot.Capabilities = append(snapshot.Capabilities, &runtimev1.RuntimeAgentExecutionCapabilityReadiness{
			Capability: capability,
			State:      state,
			ReasonCode: reason,
			ProbedAt:   probedAt,
		})
	}
	return snapshot, nil
}

// evaluateExecutionCapabilityReadiness is the honest v1 probe: a missing
// binding is NOT_CONFIGURED, a structurally incomplete binding is UNAVAILABLE
// with a typed reason, and a structurally complete binding is READY unless
// provider health evidence marks its route unhealthy. It never fabricates
// success for a state it cannot evaluate.
func (s *Service) evaluateExecutionCapabilityReadiness(binding *runtimev1.RuntimeAgentExecutionCapabilityBinding) (runtimev1.AgentExecutionReadinessState, string) {
	if binding == nil {
		return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_NOT_CONFIGURED, ""
	}
	if strings.TrimSpace(binding.GetModelId()) == "" {
		return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE, executionReadinessReasonModelMissing
	}
	if targetRef := binding.GetTargetRef(); targetRef != nil && targetRef.GetTarget() == nil {
		return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE, executionReadinessReasonTargetMissing
	}
	tracker := s.providerHealthTracker()
	switch binding.GetRoutePolicy() {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		if tracker != nil && tracker.SnapshotOf(localProviderHealthKey).State == providerhealth.StateUnhealthy {
			return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE, executionReadinessReasonRouteUnhealthy
		}
		return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY, ""
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		connectorID := firstNonEmpty(binding.GetConnectorId(), binding.GetTargetRef().GetCloud().GetConnectorId())
		if connectorID == "" {
			return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE, executionReadinessReasonConnectorMissing
		}
		if provider := strings.TrimSpace(binding.GetTargetRef().GetCloud().GetProvider()); provider != "" && tracker != nil {
			if tracker.SnapshotOf(provider).State == providerhealth.StateUnhealthy ||
				tracker.SnapshotOf("cloud-"+provider).State == providerhealth.StateUnhealthy {
				return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE, executionReadinessReasonRouteUnhealthy
			}
		}
		return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY, ""
	default:
		// A committed binding without an evaluable route cannot be probed;
		// commit validation prevents this, so surfacing it as a probe failure
		// keeps the projection honest instead of guessing READY.
		return runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE, executionReadinessReasonProbeFailed
	}
}

// currentExecutionReadinessSnapshot returns the last computed snapshot,
// computing it on demand when the projection has not been primed yet.
func (s *Service) currentExecutionReadinessSnapshot() (*runtimev1.AgentExecutionReadinessSnapshot, error) {
	s.execReadinessMu.RLock()
	snapshot := s.execReadiness
	s.execReadinessMu.RUnlock()
	if snapshot != nil {
		return cloneExecutionReadinessSnapshot(snapshot), nil
	}
	if err := s.refreshExecutionReadiness(); err != nil {
		return nil, err
	}
	s.execReadinessMu.RLock()
	snapshot = s.execReadiness
	s.execReadinessMu.RUnlock()
	return cloneExecutionReadinessSnapshot(snapshot), nil
}

// addExecutionReadinessSubscriber registers an in-process snapshot channel
// and returns its id plus a removal func (SubscribeAgentExecutionReadiness
// stream registration).
func (s *Service) addExecutionReadinessSubscriber() (uint64, chan *runtimev1.AgentExecutionReadinessSnapshot) {
	s.execSubMu.Lock()
	defer s.execSubMu.Unlock()
	s.execNextSubID++
	id := s.execNextSubID
	ch := make(chan *runtimev1.AgentExecutionReadinessSnapshot, subscriberBuffer)
	if s.execSubs == nil {
		s.execSubs = make(map[uint64]chan *runtimev1.AgentExecutionReadinessSnapshot)
	}
	s.execSubs[id] = ch
	return id, ch
}

func (s *Service) removeExecutionReadinessSubscriber(id uint64) {
	s.execSubMu.Lock()
	delete(s.execSubs, id)
	s.execSubMu.Unlock()
	// The channel is intentionally not closed: broadcastExecutionReadiness
	// snapshots the target list outside the lock, so closing here could race
	// an in-flight send. The stream loop terminates on context cancellation
	// and the orphaned buffered channel is garbage collected.
}

// broadcastExecutionReadiness pushes the snapshot to all subscribers using
// the drop-oldest-then-retry pattern shared with the agent event stream:
// slow consumers see the newest snapshot, never a blocked runtime.
func (s *Service) broadcastExecutionReadiness(snapshot *runtimev1.AgentExecutionReadinessSnapshot) {
	if snapshot == nil {
		return
	}
	s.execSubMu.Lock()
	targets := make([]chan *runtimev1.AgentExecutionReadinessSnapshot, 0, len(s.execSubs))
	for _, ch := range s.execSubs {
		targets = append(targets, ch)
	}
	s.execSubMu.Unlock()
	for _, ch := range targets {
		cloned := cloneExecutionReadinessSnapshot(snapshot)
		select {
		case ch <- cloned:
			continue
		default:
		}
		select {
		case <-ch:
		default:
		}
		select {
		case ch <- cloned:
		default:
		}
	}
}

func cloneExecutionReadinessSnapshot(snapshot *runtimev1.AgentExecutionReadinessSnapshot) *runtimev1.AgentExecutionReadinessSnapshot {
	if snapshot == nil {
		return nil
	}
	return proto.Clone(snapshot).(*runtimev1.AgentExecutionReadinessSnapshot)
}
