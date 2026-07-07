package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// K-AGCORE-146 typed readiness reason codes
// (tables/runtime-agent-ai-config.yaml readiness_reason_codes).
const (
	agentAIConfigReadinessReasonRouteUnhealthy              = "route_unhealthy"
	agentAIConfigReadinessReasonConnectorMissing            = "connector_missing"
	agentAIConfigReadinessReasonModelMissing                = "model_missing"
	agentAIConfigReadinessReasonTargetMissing               = "target_missing"
	agentAIConfigReadinessReasonProbeFailed                 = "probe_failed"
	agentAIConfigReadinessReasonEmbeddingProfileUnavailable = "embedding_profile_unavailable"
	agentAIConfigReadinessReasonVoiceReferenceMissing       = "voice_reference_missing"
	agentAIConfigReadinessReasonVoiceWorkflowUnavailable    = "voice_workflow_unavailable"
	agentAIConfigReadinessReasonImageRouteUnavailable       = "image_route_unavailable"
)

// localProviderHealthKey is the providerhealth.Tracker key the daemon marks
// for the local engine family (see daemon_audit.go Mark("local", ...)).
const localProviderHealthKey = "local"

// SetProviderHealthTracker wires the runtime provider health tracker into the
// Runtime Agent AI Config readiness prober and subscribes to health change
// evidence so projections recompute on every provider health transition
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
			if err := s.refreshAllRuntimeAgentAIConfigReadiness(); err != nil && s.logger != nil {
				s.logger.Warn("recompute runtime agent ai config readiness on provider health change failed", "error", err)
			}
		}
	}()

	// Tracker attachment is itself health evidence: recompute immediately so
	// the projection reflects the tracker-backed truth.
	if err := s.refreshAllRuntimeAgentAIConfigReadiness(); err != nil && s.logger != nil {
		s.logger.Warn("recompute runtime agent ai config readiness on tracker attach failed", "error", err)
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

// stopAgentAIConfigReadinessHealthSubscription detaches the provider health
// subscription during service shutdown.
func (s *Service) stopAgentAIConfigReadinessHealthSubscription() {
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

// refreshRuntimeAgentAIConfigReadiness recomputes the per-capability readiness
// projection from one committed config and pushes the new snapshot to matching
// in-process subscribers.
func (s *Service) refreshRuntimeAgentAIConfigReadiness(agentInstanceID string) error {
	trimmedAgentInstanceID := strings.TrimSpace(agentInstanceID)
	if trimmedAgentInstanceID == "" {
		return status.Error(codes.InvalidArgument, "agent_instance_id is required")
	}
	snapshot, err := s.computeRuntimeAgentAIConfigReadiness(trimmedAgentInstanceID)
	if err != nil {
		return err
	}
	s.agentAIConfigReadinessMu.Lock()
	if s.agentAIConfigReadiness == nil {
		s.agentAIConfigReadiness = make(map[string]*runtimev1.RuntimeAgentAIConfigReadinessSnapshot)
	}
	s.agentAIConfigReadiness[trimmedAgentInstanceID] = snapshot
	s.agentAIConfigReadinessMu.Unlock()
	s.broadcastRuntimeAgentAIConfigReadiness(snapshot)
	return nil
}

func (s *Service) refreshAllRuntimeAgentAIConfigReadiness() error {
	if s == nil || s.agentAIConfigRepo == nil {
		return nil
	}
	configs, err := s.agentAIConfigRepo.loadAll()
	if err != nil {
		return err
	}
	for _, config := range configs {
		if config == nil {
			continue
		}
		if err := s.refreshRuntimeAgentAIConfigReadiness(config.GetAgentInstanceId()); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) computeRuntimeAgentAIConfigReadiness(agentInstanceID string) (*runtimev1.RuntimeAgentAIConfigReadinessSnapshot, error) {
	config, exists, err := s.agentAIConfigRepo.load(agentInstanceID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, status.Error(codes.Internal, "runtime agent ai config missing")
	}
	probedAt := timestamppb.New(time.Now().UTC())
	byCapability := make(map[string]*runtimev1.RuntimeAgentAIConfigIntent, len(config.GetIntents()))
	for _, intent := range config.GetIntents() {
		byCapability[strings.TrimSpace(intent.GetCapability())] = intent
	}
	snapshot := &runtimev1.RuntimeAgentAIConfigReadinessSnapshot{
		AgentInstanceId: config.GetAgentInstanceId(),
		ConfigRevision:  config.GetRevision(),
		Capabilities:    make([]*runtimev1.RuntimeAgentAIConfigCapabilityReadiness, 0, len(admittedRuntimeAgentAIConfigCapabilities)),
	}
	for _, capability := range admittedRuntimeAgentAIConfigCapabilities {
		state, reason := s.evaluateRuntimeAgentAIConfigCapabilityReadiness(byCapability[capability])
		snapshot.Capabilities = append(snapshot.Capabilities, &runtimev1.RuntimeAgentAIConfigCapabilityReadiness{
			Capability: capability,
			State:      state,
			ReasonCode: reason,
			ProbedAt:   probedAt,
		})
	}
	return snapshot, nil
}

// evaluateRuntimeAgentAIConfigCapabilityReadiness is the honest v1 probe: a
// missing intent is NOT_CONFIGURED, a structurally incomplete intent is
// UNAVAILABLE with a typed reason, and a structurally complete intent is READY
// unless provider health evidence marks its route unhealthy. It never
// fabricates success for a state it cannot evaluate.
func (s *Service) evaluateRuntimeAgentAIConfigCapabilityReadiness(intent *runtimev1.RuntimeAgentAIConfigIntent) (runtimev1.RuntimeAgentAIConfigReadinessState, string) {
	if intent == nil {
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED, ""
	}
	capability := strings.TrimSpace(intent.GetCapability())
	if strings.TrimSpace(intent.GetModelId()) == "" {
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, agentAIConfigReadinessReasonModelMissing
	}
	if runtimeAgentAIConfigCapabilityRequiresTargetRef(capability) && intent.GetTargetRef().GetTarget() == nil {
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, targetMissingReadinessReason(capability)
	}
	if targetRef := intent.GetTargetRef(); targetRef != nil && targetRef.GetTarget() == nil {
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, targetMissingReadinessReason(capability)
	}
	if isRuntimeAgentAIConfigVoiceWorkflowCapability(capability) && strings.TrimSpace(intent.GetVoiceReferenceRef()) == "" {
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, agentAIConfigReadinessReasonVoiceReferenceMissing
	}
	tracker := s.providerHealthTracker()
	switch intent.GetRoutePolicy() {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		if tracker != nil && tracker.SnapshotOf(localProviderHealthKey).State == providerhealth.StateUnhealthy {
			return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, routeUnavailableReadinessReason(capability)
		}
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY, ""
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		connectorID := firstNonEmpty(intent.GetConnectorId(), intent.GetTargetRef().GetCloud().GetConnectorId())
		if connectorID == "" {
			return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, connectorMissingReadinessReason(capability)
		}
		if provider := strings.TrimSpace(intent.GetTargetRef().GetCloud().GetProvider()); provider != "" && tracker != nil {
			if tracker.SnapshotOf(provider).State == providerhealth.StateUnhealthy ||
				tracker.SnapshotOf("cloud-"+provider).State == providerhealth.StateUnhealthy {
				return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, routeUnavailableReadinessReason(capability)
			}
		}
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY, ""
	default:
		// A committed binding without an evaluable route cannot be probed;
		// commit validation prevents this, so surfacing it as a probe failure
		// keeps the projection honest instead of guessing READY.
		return runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE, probeFailedReadinessReason(capability)
	}
}

func runtimeAgentAIConfigCapabilityRequiresTargetRef(capability string) bool {
	return capability == runtimeAgentAIConfigCapabilityAudioSynthesize
}

func isRuntimeAgentAIConfigVoiceWorkflowCapability(capability string) bool {
	return capability == runtimeAgentAIConfigCapabilityVoiceWorkflowClone ||
		capability == runtimeAgentAIConfigCapabilityVoiceWorkflowDesign
}

func targetMissingReadinessReason(capability string) string {
	if capability == runtimeAgentAIConfigCapabilityTextEmbed {
		return agentAIConfigReadinessReasonEmbeddingProfileUnavailable
	}
	return agentAIConfigReadinessReasonTargetMissing
}

func connectorMissingReadinessReason(capability string) string {
	if isRuntimeAgentAIConfigVoiceWorkflowCapability(capability) {
		return agentAIConfigReadinessReasonVoiceWorkflowUnavailable
	}
	return agentAIConfigReadinessReasonConnectorMissing
}

func routeUnavailableReadinessReason(capability string) string {
	switch {
	case capability == runtimeAgentAIConfigCapabilityImageGenerate:
		return agentAIConfigReadinessReasonImageRouteUnavailable
	case isRuntimeAgentAIConfigVoiceWorkflowCapability(capability):
		return agentAIConfigReadinessReasonVoiceWorkflowUnavailable
	default:
		return agentAIConfigReadinessReasonRouteUnhealthy
	}
}

func probeFailedReadinessReason(capability string) string {
	if isRuntimeAgentAIConfigVoiceWorkflowCapability(capability) {
		return agentAIConfigReadinessReasonVoiceWorkflowUnavailable
	}
	return agentAIConfigReadinessReasonProbeFailed
}

// currentRuntimeAgentAIConfigReadinessSnapshot returns the last computed snapshot,
// computing it on demand when the projection has not been primed yet.
func (s *Service) currentRuntimeAgentAIConfigReadinessSnapshot(agentInstanceID string) (*runtimev1.RuntimeAgentAIConfigReadinessSnapshot, error) {
	trimmedAgentInstanceID := strings.TrimSpace(agentInstanceID)
	if trimmedAgentInstanceID == "" {
		return nil, status.Error(codes.InvalidArgument, "agent_instance_id is required")
	}
	s.agentAIConfigReadinessMu.RLock()
	snapshot := s.agentAIConfigReadiness[trimmedAgentInstanceID]
	s.agentAIConfigReadinessMu.RUnlock()
	if snapshot != nil {
		return cloneAgentAIConfigReadinessSnapshot(snapshot), nil
	}
	if err := s.refreshRuntimeAgentAIConfigReadiness(trimmedAgentInstanceID); err != nil {
		return nil, err
	}
	s.agentAIConfigReadinessMu.RLock()
	snapshot = s.agentAIConfigReadiness[trimmedAgentInstanceID]
	s.agentAIConfigReadinessMu.RUnlock()
	return cloneAgentAIConfigReadinessSnapshot(snapshot), nil
}

type runtimeAgentAIConfigReadinessSubscriber struct {
	agentInstanceID string
	ch              chan *runtimev1.RuntimeAgentAIConfigReadinessSnapshot
}

// addRuntimeAgentAIConfigReadinessSubscriber registers an in-process snapshot channel
// and returns its id plus a removal func (SubscribeRuntimeAgentAIConfigReadiness
// stream registration).
func (s *Service) addRuntimeAgentAIConfigReadinessSubscriber(agentInstanceID string) (uint64, chan *runtimev1.RuntimeAgentAIConfigReadinessSnapshot) {
	s.execSubMu.Lock()
	defer s.execSubMu.Unlock()
	s.execNextSubID++
	id := s.execNextSubID
	ch := make(chan *runtimev1.RuntimeAgentAIConfigReadinessSnapshot, subscriberBuffer)
	if s.execSubs == nil {
		s.execSubs = make(map[uint64]runtimeAgentAIConfigReadinessSubscriber)
	}
	s.execSubs[id] = runtimeAgentAIConfigReadinessSubscriber{
		agentInstanceID: strings.TrimSpace(agentInstanceID),
		ch:              ch,
	}
	return id, ch
}

func (s *Service) removeRuntimeAgentAIConfigReadinessSubscriber(id uint64) {
	s.execSubMu.Lock()
	delete(s.execSubs, id)
	s.execSubMu.Unlock()
	// The channel is intentionally not closed: broadcast snapshots the target
	// list outside the lock, so closing here could race an in-flight send. The
	// stream loop terminates on context cancellation and the orphaned buffered
	// channel is garbage collected.
}

// broadcastRuntimeAgentAIConfigReadiness pushes the snapshot to all subscribers using
// the drop-oldest-then-retry pattern shared with the agent event stream:
// slow consumers see the newest snapshot, never a blocked runtime.
func (s *Service) broadcastRuntimeAgentAIConfigReadiness(snapshot *runtimev1.RuntimeAgentAIConfigReadinessSnapshot) {
	if snapshot == nil {
		return
	}
	agentInstanceID := strings.TrimSpace(snapshot.GetAgentInstanceId())
	s.execSubMu.Lock()
	targets := make([]chan *runtimev1.RuntimeAgentAIConfigReadinessSnapshot, 0, len(s.execSubs))
	for _, sub := range s.execSubs {
		if sub.agentInstanceID == agentInstanceID {
			targets = append(targets, sub.ch)
		}
	}
	s.execSubMu.Unlock()
	for _, ch := range targets {
		cloned := cloneAgentAIConfigReadinessSnapshot(snapshot)
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

func cloneAgentAIConfigReadinessSnapshot(snapshot *runtimev1.RuntimeAgentAIConfigReadinessSnapshot) *runtimev1.RuntimeAgentAIConfigReadinessSnapshot {
	if snapshot == nil {
		return nil
	}
	return proto.Clone(snapshot).(*runtimev1.RuntimeAgentAIConfigReadinessSnapshot)
}
