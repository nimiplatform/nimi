package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	runtimeAgentAIConfigCapabilityTextGenerate        = "text.generate"
	runtimeAgentAIConfigCapabilityTextEmbed           = "text.embed"
	runtimeAgentAIConfigCapabilityImageGenerate       = "image.generate"
	runtimeAgentAIConfigCapabilityAudioSynthesize     = "audio.synthesize"
	runtimeAgentAIConfigCapabilityAudioTranscribe     = "audio.transcribe"
	runtimeAgentAIConfigCapabilityVoiceWorkflowClone  = "voice_workflow.voice_clone"
	runtimeAgentAIConfigCapabilityVoiceWorkflowDesign = "voice_workflow.voice_design"

	runtimeAgentAIConfigSeedAppID               = "runtime"
	runtimeAgentAIConfigDefaultEmbeddingModelID = "local/default-embedding"

	runtimeAgentAIConfigChangedEventType = "runtime.agent.ai_config.changed"
	runtimeAgentAIConfigSeededEventType  = "runtime.agent.ai_config.seeded"
)

var admittedRuntimeAgentAIConfigCapabilities = []string{
	runtimeAgentAIConfigCapabilityTextGenerate,
	runtimeAgentAIConfigCapabilityTextEmbed,
	runtimeAgentAIConfigCapabilityImageGenerate,
	runtimeAgentAIConfigCapabilityAudioSynthesize,
	runtimeAgentAIConfigCapabilityAudioTranscribe,
	runtimeAgentAIConfigCapabilityVoiceWorkflowClone,
	runtimeAgentAIConfigCapabilityVoiceWorkflowDesign,
}

var requiredRuntimeAgentAIConfigCapabilities = map[string]struct{}{
	runtimeAgentAIConfigCapabilityTextGenerate: {},
	runtimeAgentAIConfigCapabilityTextEmbed:    {},
}

func isAdmittedRuntimeAgentAIConfigCapability(capability string) bool {
	for _, admitted := range admittedRuntimeAgentAIConfigCapabilities {
		if capability == admitted {
			return true
		}
	}
	return false
}

func (s *Service) ensureRuntimeAgentAIConfigForIdentity(identity localAgentIdentity) (*runtimev1.RuntimeAgentAIConfig, error) {
	if err := s.validateRuntimeAgentAIConfigIdentity(identity); err != nil {
		return nil, err
	}
	return s.seedRuntimeAgentAIConfigIfMissing(identity.LocalAgentRef)
}

func (s *Service) committedRuntimeAgentAIConfigForContext(ctx *runtimev1.AgentRequestContext) (*runtimev1.RuntimeAgentAIConfig, error) {
	identity, err := localAgentIdentityFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.validateRuntimeAgentAIConfigIdentity(identity); err != nil {
		return nil, err
	}
	return s.committedRuntimeAgentAIConfigByAgentInstanceID(identity.LocalAgentRef)
}

func (s *Service) validateRuntimeAgentAIConfigIdentity(identity localAgentIdentity) error {
	entry, err := s.agentByID(identity.LocalAgentRef)
	if err != nil {
		return err
	}
	return validateLocalAgentRecordIdentity(entry.Agent, identity)
}

func (s *Service) committedRuntimeAgentAIConfigByAgentInstanceID(agentInstanceID string) (*runtimev1.RuntimeAgentAIConfig, error) {
	trimmedAgentInstanceID := strings.TrimSpace(agentInstanceID)
	if trimmedAgentInstanceID == "" {
		return nil, status.Error(codes.InvalidArgument, "agent_instance_id is required")
	}
	if s == nil || s.agentAIConfigRepo == nil {
		return nil, status.Error(codes.Internal, "runtime agent ai config store unavailable")
	}
	config, exists, err := s.agentAIConfigRepo.load(trimmedAgentInstanceID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "runtime agent ai config could not be loaded"},
		)
	}
	if !exists {
		return nil, status.Error(codes.Internal, "runtime agent ai config missing for initialized local agent")
	}
	return cloneRuntimeAgentAIConfig(config), nil
}

func (s *Service) seedRuntimeAgentAIConfigIfMissing(agentInstanceID string) (*runtimev1.RuntimeAgentAIConfig, error) {
	trimmedAgentInstanceID := strings.TrimSpace(agentInstanceID)
	if trimmedAgentInstanceID == "" {
		return nil, status.Error(codes.InvalidArgument, "agent_instance_id is required")
	}
	if s == nil || s.agentAIConfigRepo == nil {
		return nil, status.Error(codes.Internal, "runtime agent ai config store unavailable")
	}
	s.agentAIConfigMu.Lock()
	config, seeded, err := s.loadOrSeedRuntimeAgentAIConfigLocked(trimmedAgentInstanceID)
	s.agentAIConfigMu.Unlock()
	if err != nil {
		return nil, err
	}
	if seeded {
		if err := s.refreshRuntimeAgentAIConfigReadiness(trimmedAgentInstanceID); err != nil && s.logger != nil {
			s.logger.Warn("recompute runtime agent ai config readiness after seed failed", "agent_instance_id", trimmedAgentInstanceID, "error", err)
		}
	}
	return cloneRuntimeAgentAIConfig(config), nil
}

func (s *Service) loadOrSeedRuntimeAgentAIConfigLocked(agentInstanceID string) (*runtimev1.RuntimeAgentAIConfig, bool, error) {
	config, exists, err := s.agentAIConfigRepo.load(agentInstanceID)
	if err != nil {
		return nil, false, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "runtime agent ai config could not be loaded"},
		)
	}
	if exists {
		return config, false, nil
	}
	seed := seedRuntimeAgentAIConfig(agentInstanceID)
	if err := s.agentAIConfigRepo.commitSeed(seed); err != nil {
		if errors.Is(err, errAgentAIConfigAlreadySeeded) {
			config, exists, err := s.agentAIConfigRepo.load(agentInstanceID)
			if err != nil {
				return nil, false, grpcerr.WrapWithReasonCode(
					codes.Internal,
					runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
					err,
					grpcerr.ReasonOptions{Message: "runtime agent ai config could not be reloaded"},
				)
			}
			if !exists {
				return nil, false, status.Error(codes.Internal, "runtime agent ai config seed race left no committed row")
			}
			return config, false, nil
		}
		return nil, false, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "runtime agent ai config could not be initialized"},
		)
	}
	s.recordRuntimeAgentAIConfigAudit(seed, runtimeAgentAIConfigSeededEventType)
	if s.logger != nil {
		s.logger.Info(
			"seeded runtime agent ai config",
			"agent_instance_id", seed.GetAgentInstanceId(),
			"revision", seed.GetRevision(),
			"text_generate_model", texttarget.InternalDefaultLocalTextModelAlias,
			"text_embed_model", runtimeAgentAIConfigDefaultEmbeddingModelID,
		)
	}
	return seed, true, nil
}

func seedRuntimeAgentAIConfig(agentInstanceID string) *runtimev1.RuntimeAgentAIConfig {
	return &runtimev1.RuntimeAgentAIConfig{
		AgentInstanceId: strings.TrimSpace(agentInstanceID),
		Revision:        1,
		Intents: []*runtimev1.RuntimeAgentAIConfigIntent{
			{
				Capability:  runtimeAgentAIConfigCapabilityTextGenerate,
				ModelId:     texttarget.InternalDefaultLocalTextModelAlias,
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			{
				Capability:  runtimeAgentAIConfigCapabilityTextEmbed,
				ModelId:     runtimeAgentAIConfigDefaultEmbeddingModelID,
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
		UpdatedAt:      timestamppb.New(time.Now().UTC()),
		UpdatedByAppId: runtimeAgentAIConfigSeedAppID,
	}
}

func (s *Service) seedRuntimeAgentAIConfigsForLoadedAgents() error {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	agentInstanceIDs := make([]string, 0, len(s.agents))
	for localAgentRef := range s.agents {
		agentInstanceIDs = append(agentInstanceIDs, localAgentRef)
	}
	s.mu.RUnlock()
	for _, agentInstanceID := range agentInstanceIDs {
		if _, err := s.seedRuntimeAgentAIConfigIfMissing(agentInstanceID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) upsertRuntimeAgentAIConfig(ctx *runtimev1.AgentRequestContext, expectedRevision uint64, intents []*runtimev1.RuntimeAgentAIConfigIntent) (*runtimev1.RuntimeAgentAIConfig, error) {
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	identity, err := localAgentIdentityFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.validateRuntimeAgentAIConfigIdentity(identity); err != nil {
		return nil, err
	}
	trimmedAppID := strings.TrimSpace(ctx.GetAppId())
	if trimmedAppID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required for runtime agent ai config mutation")
	}
	materialized, err := s.materializeBoundVoiceSynthesisTarget(identity, intents)
	if err != nil {
		return nil, err
	}
	normalized, err := normalizeRuntimeAgentAIConfigIntents(materialized)
	if err != nil {
		return nil, err
	}

	s.agentAIConfigMu.Lock()
	current, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(identity.LocalAgentRef)
	if err != nil {
		s.agentAIConfigMu.Unlock()
		return nil, err
	}
	if current.GetRevision() != expectedRevision {
		s.agentAIConfigMu.Unlock()
		return nil, runtimeAgentAIConfigRevisionConflictError(expectedRevision, current.GetRevision())
	}
	next := &runtimev1.RuntimeAgentAIConfig{
		AgentInstanceId: identity.LocalAgentRef,
		Revision:        expectedRevision + 1,
		Intents:         normalized,
		UpdatedAt:       timestamppb.New(time.Now().UTC()),
		UpdatedByAppId:  trimmedAppID,
	}
	if err := s.agentAIConfigRepo.commitMutation(identity.LocalAgentRef, expectedRevision, next); err != nil {
		s.agentAIConfigMu.Unlock()
		if errors.Is(err, errAgentAIConfigRevisionConflict) {
			return nil, runtimeAgentAIConfigRevisionConflictError(expectedRevision, current.GetRevision())
		}
		if errors.Is(err, errAgentAIConfigMissing) {
			return nil, status.Error(codes.Internal, "runtime agent ai config missing after seed (K-AGCORE-150)")
		}
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "runtime agent ai config could not be committed"},
		)
	}
	s.agentAIConfigMu.Unlock()

	s.recordRuntimeAgentAIConfigAudit(next, runtimeAgentAIConfigChangedEventType)
	if err := s.refreshRuntimeAgentAIConfigReadiness(identity.LocalAgentRef); err != nil && s.logger != nil {
		s.logger.Warn("recompute runtime agent ai config readiness after mutation failed", "agent_instance_id", identity.LocalAgentRef, "error", err)
	}
	return cloneRuntimeAgentAIConfig(next), nil
}

func (s *Service) materializeBoundVoiceSynthesisTarget(
	identity localAgentIdentity,
	intents []*runtimev1.RuntimeAgentAIConfigIntent,
) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	hasSynthesisIntent := false
	for _, intent := range intents {
		if strings.TrimSpace(intent.GetCapability()) == runtimeAgentAIConfigCapabilityAudioSynthesize {
			hasSynthesisIntent = true
			break
		}
	}
	if !hasSynthesisIntent {
		return intents, nil
	}
	entry, err := s.agentByID(identity.LocalAgentRef)
	if err != nil {
		return nil, err
	}
	const voiceAssetPrefix = "voice_asset_id:"
	defaultVoiceReference := strings.TrimSpace(entry.Agent.GetPresentationProfile().GetDefaultVoiceReference())
	if !strings.HasPrefix(defaultVoiceReference, voiceAssetPrefix) {
		return intents, nil
	}
	voiceAssetID := strings.TrimSpace(strings.TrimPrefix(defaultVoiceReference, voiceAssetPrefix))
	asset, err := resolveRuntimeAgentBoundVoiceAsset(
		context.Background(),
		s.currentVoiceAssetResolver(),
		identity.OwnerUserID,
		voiceAssetID,
	)
	if err != nil {
		return nil, err
	}
	targetRef := asset.GetVoiceAssetTargetRef()
	cloud := targetRef.GetCloud()
	if cloud == nil {
		return nil, runtimeAgentVoiceTargetModelMismatchError()
	}
	targetProvider := strings.TrimSpace(cloud.GetProvider())
	targetModel := strings.TrimSpace(cloud.GetProviderModelId())
	targetConnectorID := strings.TrimSpace(cloud.GetConnectorId())
	out := make([]*runtimev1.RuntimeAgentAIConfigIntent, len(intents))
	for index, intent := range intents {
		out[index] = intent
		if strings.TrimSpace(intent.GetCapability()) != runtimeAgentAIConfigCapabilityAudioSynthesize {
			continue
		}
		provider := strings.TrimSpace(intent.GetProvider())
		connectorID := strings.TrimSpace(intent.GetConnectorId())
		if intent.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD ||
			strings.TrimSpace(intent.GetModelId()) != targetModel ||
			(provider != "" && provider != targetProvider) ||
			(connectorID != "" && connectorID != targetConnectorID) ||
			(intent.GetTargetRef() != nil && !proto.Equal(intent.GetTargetRef(), targetRef)) {
			return nil, runtimeAgentVoiceTargetModelMismatchError()
		}
		materialized := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		materialized.Provider = targetProvider
		materialized.ConnectorId = targetConnectorID
		materialized.TargetRef = proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef)
		out[index] = materialized
	}
	return out, nil
}

func runtimeAgentVoiceTargetModelMismatchError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
}

func runtimeAgentAIConfigRevisionConflictError(expected uint64, committed uint64) error {
	return grpcerr.WithReasonCodeOptions(
		codes.Aborted,
		runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT,
		grpcerr.ReasonOptions{Metadata: map[string]string{
			"expected_revision":  fmt.Sprintf("%d", expected),
			"committed_revision": fmt.Sprintf("%d", committed),
		}},
	)
}

func normalizeRuntimeAgentAIConfigIntents(intents []*runtimev1.RuntimeAgentAIConfigIntent) ([]*runtimev1.RuntimeAgentAIConfigIntent, error) {
	if len(intents) == 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime agent ai config requires text.generate and text.embed intents")
	}
	seen := make(map[string]struct{}, len(intents))
	out := make([]*runtimev1.RuntimeAgentAIConfigIntent, 0, len(intents))
	for _, intent := range intents {
		if intent == nil {
			return nil, status.Error(codes.InvalidArgument, "runtime agent ai config intent must not be empty")
		}
		capability := strings.TrimSpace(intent.GetCapability())
		if capability == "" {
			return nil, status.Error(codes.InvalidArgument, "runtime agent ai config intent capability is required")
		}
		if !isAdmittedRuntimeAgentAIConfigCapability(capability) {
			return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config capability %q is not admitted", capability)
		}
		if _, dup := seen[capability]; dup {
			return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config capability %q bound more than once", capability)
		}
		seen[capability] = struct{}{}
		modelID := strings.TrimSpace(intent.GetModelId())
		if modelID == "" {
			return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q requires model_id", capability)
		}
		routePolicy := intent.GetRoutePolicy()
		if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
			return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q requires an explicit route_policy", capability)
		}
		targetRef := intent.GetTargetRef()
		if runtimeAgentAIConfigCapabilityRequiresTargetRef(capability) &&
			(targetRef == nil || targetRef.GetTarget() == nil) {
			return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q requires target_ref", capability)
		}
		if targetRef != nil {
			if err := runtimeidentity.ValidateDurableTargetRef(targetRef); err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q has invalid target_ref: %v", capability, err)
			}
			switch target := targetRef.GetTarget().(type) {
			case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
				if routePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
					return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q has a local_runtime target_ref but route_policy is not local", capability)
				}
				_ = target
			case *runtimev1.RuntimeDurableTargetRef_Cloud:
				if routePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
					return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q has a cloud target_ref but route_policy is not cloud", capability)
				}
			default:
				return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q target_ref must set exactly one of local_runtime or cloud", capability)
			}
		}
		cloned := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		cloned.Capability = capability
		cloned.ModelId = modelID
		cloned.ConnectorId = strings.TrimSpace(intent.GetConnectorId())
		cloned.VoiceReferenceRef = strings.TrimSpace(intent.GetVoiceReferenceRef())
		cloned.ImagePolicyRef = strings.TrimSpace(intent.GetImagePolicyRef())
		cloned.Provider = strings.TrimSpace(intent.GetProvider())
		if cloud := cloned.GetTargetRef().GetCloud(); cloud != nil {
			targetProvider := strings.TrimSpace(cloud.GetProvider())
			if cloned.Provider != "" && targetProvider != "" && cloned.Provider != targetProvider {
				return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config intent for %q has mismatched provider route intent", capability)
			}
			if cloned.Provider == "" {
				cloned.Provider = targetProvider
			}
		}
		out = append(out, cloned)
	}
	for required := range requiredRuntimeAgentAIConfigCapabilities {
		if _, ok := seen[required]; !ok {
			return nil, status.Errorf(codes.InvalidArgument, "runtime agent ai config must retain the required %s intent", required)
		}
	}
	return out, nil
}

func cloneRuntimeAgentAIConfig(config *runtimev1.RuntimeAgentAIConfig) *runtimev1.RuntimeAgentAIConfig {
	if config == nil {
		return nil
	}
	return proto.Clone(config).(*runtimev1.RuntimeAgentAIConfig)
}

func (s *Service) recordRuntimeAgentAIConfigAudit(config *runtimev1.RuntimeAgentAIConfig, operation string) {
	if s == nil || config == nil {
		return
	}
	capabilities := make([]any, 0, len(config.GetIntents()))
	for _, intent := range config.GetIntents() {
		capabilities = append(capabilities, intent.GetCapability())
	}
	payload, err := structpb.NewStruct(map[string]any{
		"agent_instance_id": config.GetAgentInstanceId(),
		"revision":          config.GetRevision(),
		"updated_by_app_id": config.GetUpdatedByAppId(),
		"capabilities":      capabilities,
		"recorded_at":       timestampString(config.GetUpdatedAt()),
	})
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("build runtime agent ai config audit payload failed", "error", err)
		}
		return
	}
	record := &runtimev1.AuditEventRecord{
		AuditId:     fmt.Sprintf("runtime-agent-ai-config-%s-rev-%d", config.GetAgentInstanceId(), config.GetRevision()),
		AppId:       "runtime",
		Domain:      "runtime.agent",
		Operation:   operation,
		ReasonCode:  runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:     fmt.Sprintf("runtime-agent-ai-config-%s-rev-%d", config.GetAgentInstanceId(), config.GetRevision()),
		Timestamp:   config.GetUpdatedAt(),
		Payload:     payload,
		CallerId:    "runtime.agent.service",
		SurfaceId:   "runtime.agent.ai_config",
		Capability:  "runtime.agent.ai_config.write",
		PrincipalId: config.GetUpdatedByAppId(),
	}
	s.execAuditMu.Lock()
	store := s.auditStore
	if store == nil {
		s.execPendingAIConfigAudits = append(s.execPendingAIConfigAudits, record)
		s.execAuditMu.Unlock()
		if s.logger != nil {
			s.logger.Info("runtime agent ai config audit recorded without audit store", "operation", operation, "revision", config.GetRevision())
		}
		return
	}
	s.execAuditMu.Unlock()
	store.AppendEvent(record)
}

func (s *Service) flushPendingAgentAIConfigAudit() {
	if s == nil {
		return
	}
	s.execAuditMu.Lock()
	records := append([]*runtimev1.AuditEventRecord(nil), s.execPendingAIConfigAudits...)
	store := s.auditStore
	if len(records) == 0 || store == nil {
		s.execAuditMu.Unlock()
		return
	}
	s.execPendingAIConfigAudits = nil
	s.execAuditMu.Unlock()
	for _, record := range records {
		store.AppendEvent(record)
	}
}
