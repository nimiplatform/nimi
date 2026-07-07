package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type publicChatBindingResolverService interface {
	ResolvePublicChatTextBinding(context.Context, runtimev1.RoutePolicy, string) (runtimev1.RoutePolicy, string, error)
}

type PublicChatBindingResolutionRequest struct {
	Capability      string
	ModelID         string
	RouteHint       runtimev1.RoutePolicy
	ConnectorID     string
	SubjectUserID   string
	SystemPrompt    string
	Messages        []*runtimev1.ChatMessage
	MaxOutputTokens int32
}

type PublicChatBindingResolution struct {
	ModelID     string
	RoutePolicy runtimev1.RoutePolicy
	ConnectorID string
}

type PublicChatBindingResolver interface {
	ResolvePublicChatBinding(context.Context, PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error)
}

type rejectingPublicChatBindingResolver struct{}

type aiBackedPublicChatBindingResolver struct {
	ai publicChatBindingResolverService
}

func (rejectingPublicChatBindingResolver) ResolvePublicChatBinding(context.Context, PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
	return PublicChatBindingResolution{}, fmt.Errorf("runtime public chat binding resolver unavailable or not admitted")
}

func NewAIBackedPublicChatBindingResolver(ai publicChatBindingResolverService) PublicChatBindingResolver {
	if ai == nil {
		return rejectingPublicChatBindingResolver{}
	}
	return &aiBackedPublicChatBindingResolver{ai: ai}
}

func (r *aiBackedPublicChatBindingResolver) ResolvePublicChatBinding(ctx context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
	if r == nil || r.ai == nil {
		return PublicChatBindingResolution{}, fmt.Errorf("runtime public chat binding resolver unavailable or not admitted")
	}
	routeDecision, modelResolved, err := r.ai.ResolvePublicChatTextBinding(ctx, req.RouteHint, req.ModelID)
	if err != nil {
		return PublicChatBindingResolution{}, err
	}
	return PublicChatBindingResolution{
		ModelID:     strings.TrimSpace(modelResolved),
		RoutePolicy: routeDecision,
		ConnectorID: strings.TrimSpace(req.ConnectorID),
	}, nil
}

func (s *Service) SetPublicChatBindingResolver(resolver PublicChatBindingResolver) {
	if s == nil || s.isClosed() {
		return
	}
	s.setPublicChatBindingResolver(resolver)
}

func (s *Service) HasPublicChatBindingResolver() bool {
	if s == nil || s.isClosed() {
		return false
	}
	_, rejecting := s.currentPublicChatBindingResolver().(rejectingPublicChatBindingResolver)
	return !rejecting
}

// errPublicChatRequestExecutionBindingsNotAdmitted is the K-AGCORE-147 hard
// cut: request-carried execution_bindings are rejected on the public chat
// turn ingress; the committed Runtime Agent AI Config is the only
// binding truth.
var errPublicChatRequestExecutionBindingsNotAdmitted = status.Error(
	codes.InvalidArgument,
	"public chat execution_bindings are not admitted; Runtime Agent AI Config is authoritative (K-AGCORE-147)",
)

// validateRuntimePrivateExecutorBinding fails closed when a runtime-private
// executor request lacks the committed Runtime Agent AI Config text.generate intent
// (K-AGCORE-147); a silent fallback to a hardcoded model constant is not
// admitted as execution binding truth.
func validateRuntimePrivateExecutorBinding(label string, binding publicChatExecutionBinding) error {
	if strings.TrimSpace(binding.ModelID) == "" || binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return fmt.Errorf("%s executor requires the committed Runtime Agent AI Config text.generate intent (K-AGCORE-147)", label)
	}
	return nil
}

// runtimeAgentAIConfigIntentToPublicChatBinding converts a committed config
// intent into the runtime-private execution binding shape.
func runtimeAgentAIConfigIntentToPublicChatBinding(intent *runtimev1.RuntimeAgentAIConfigIntent) publicChatExecutionBinding {
	if intent == nil {
		return publicChatExecutionBinding{}
	}
	return publicChatExecutionBinding{
		ModelID:     strings.TrimSpace(intent.GetModelId()),
		RoutePolicy: intent.GetRoutePolicy(),
		ConnectorID: strings.TrimSpace(intent.GetConnectorId()),
		TargetRef:   clonePublicChatTargetRef(intent.GetTargetRef()),
	}
}

// committedTextGenerateExecutionBinding loads the committed Runtime Agent AI
// Config and returns its required text.generate intent plus the config
// revision. A missing intent after seed is a typed fail-closed rejection (K-AGCORE-147);
// there is no silent fallback to another route or bundled constant.
func (s *Service) committedTextGenerateExecutionBinding(agentInstanceID string) (publicChatExecutionBinding, uint64, error) {
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(agentInstanceID)
	if err != nil {
		return publicChatExecutionBinding{}, 0, err
	}
	for _, intent := range config.GetIntents() {
		if strings.TrimSpace(intent.GetCapability()) == runtimeAgentAIConfigCapabilityTextGenerate {
			resolved := runtimeAgentAIConfigIntentToPublicChatBinding(intent)
			if resolved.ModelID == "" || resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
				return publicChatExecutionBinding{}, 0, status.Error(codes.FailedPrecondition, "Runtime Agent AI Config text.generate intent is structurally invalid (K-AGCORE-147)")
			}
			return resolved, config.GetRevision(), nil
		}
	}
	return publicChatExecutionBinding{}, 0, status.Error(codes.FailedPrecondition, "Runtime Agent AI Config is missing the required text.generate intent (K-AGCORE-147)")
}

// resolveExecutionBindingsFromConfig binds a public chat turn to the
// committed Runtime Agent AI Config at admission time (K-AGCORE-147). The
// text.generate intent is refined through the runtime binding resolver
// (model alias resolution, e.g. local/default); optional action intents are
// carried from the committed config as-is.
func (s *Service) resolveExecutionBindingsFromConfig(
	ctx context.Context,
	agentInstanceID string,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatExecutionBindings, uint64, error) {
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(agentInstanceID)
	if err != nil {
		return nil, 0, err
	}
	var textBinding *runtimev1.RuntimeAgentAIConfigIntent
	var imageBinding *runtimev1.RuntimeAgentAIConfigIntent
	var audioBinding *runtimev1.RuntimeAgentAIConfigIntent
	for _, binding := range config.GetIntents() {
		switch strings.TrimSpace(binding.GetCapability()) {
		case runtimeAgentAIConfigCapabilityTextGenerate:
			textBinding = binding
		case runtimeAgentAIConfigCapabilityImageGenerate:
			imageBinding = binding
		case runtimeAgentAIConfigCapabilityAudioSynthesize:
			audioBinding = binding
		}
	}
	if textBinding == nil || strings.TrimSpace(textBinding.GetModelId()) == "" {
		return nil, 0, status.Error(codes.FailedPrecondition, "Runtime Agent AI Config is missing the required text.generate intent (K-AGCORE-147)")
	}
	if s == nil || !s.HasPublicChatBindingResolver() {
		return nil, 0, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver unavailable")
	}
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		Capability:      runtimeAgentAIConfigCapabilityTextGenerate,
		ModelID:         strings.TrimSpace(textBinding.GetModelId()),
		RouteHint:       textBinding.GetRoutePolicy(),
		ConnectorID:     strings.TrimSpace(textBinding.GetConnectorId()),
		SubjectUserID:   strings.TrimSpace(subjectUserID),
		SystemPrompt:    strings.TrimSpace(req.SystemPrompt),
		Messages:        toProtoPublicChatMessages(req.Messages),
		MaxOutputTokens: req.MaxOutputTokens,
	})
	if err != nil {
		return nil, 0, err
	}
	if strings.TrimSpace(resolved.ModelID) == "" {
		return nil, 0, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned empty model")
	}
	if resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return nil, 0, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned unspecified route")
	}
	out := publicChatExecutionBindings{
		runtimeAgentAIConfigCapabilityTextGenerate: {
			ModelID:     strings.TrimSpace(resolved.ModelID),
			RoutePolicy: resolved.RoutePolicy,
			ConnectorID: strings.TrimSpace(resolved.ConnectorID),
			TargetRef:   clonePublicChatTargetRef(textBinding.GetTargetRef()),
		},
	}
	if imageBinding != nil {
		out[runtimeAgentAIConfigCapabilityImageGenerate] = runtimeAgentAIConfigIntentToPublicChatBinding(imageBinding)
	}
	if audioBinding != nil {
		out[runtimeAgentAIConfigCapabilityAudioSynthesize] = runtimeAgentAIConfigIntentToPublicChatBinding(audioBinding)
	}
	return out, config.GetRevision(), nil
}

func (s *Service) committedOptionalExecutionBinding(agentInstanceID string, capability string) (publicChatExecutionBinding, bool, error) {
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(agentInstanceID)
	if err != nil {
		return publicChatExecutionBinding{}, false, err
	}
	trimmedCapability := strings.TrimSpace(capability)
	if trimmedCapability == "" {
		return publicChatExecutionBinding{}, false, nil
	}
	for _, binding := range config.GetIntents() {
		if strings.TrimSpace(binding.GetCapability()) != trimmedCapability {
			continue
		}
		resolved := runtimeAgentAIConfigIntentToPublicChatBinding(binding)
		if strings.TrimSpace(resolved.ModelID) == "" ||
			resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED ||
			resolved.TargetRef == nil ||
			resolved.TargetRef.GetTarget() == nil {
			return publicChatExecutionBinding{}, true, status.Errorf(codes.FailedPrecondition, "Runtime Agent AI Config %s intent is structurally invalid", trimmedCapability)
		}
		return resolved, true, nil
	}
	return publicChatExecutionBinding{}, false, nil
}

// deriveImageActionAvailability computes the K-AGCORE-148 tri-state for the
// image action from committed config presence plus the current readiness
// projection. `not_configured` (no committed binding) and `unavailable`
// (committed binding whose route is currently not usable) are distinct
// truths and are never collapsed.
func (s *Service) deriveImageActionAvailability(agentInstanceID string, configRevision uint64, hasImageBinding bool) publicChatImageActionAvailability {
	if !hasImageBinding {
		return publicChatImageActionNotConfigured
	}
	snapshot, err := s.currentRuntimeAgentAIConfigReadinessSnapshot(agentInstanceID)
	if err != nil {
		// Readiness cannot be evaluated: the committed binding exists but
		// its route state is unknown; fail toward unavailable, never toward
		// a fabricated available.
		return publicChatImageActionUnavailable
	}
	if snapshot.GetConfigRevision() != configRevision {
		if err := s.refreshRuntimeAgentAIConfigReadiness(agentInstanceID); err != nil {
			return publicChatImageActionUnavailable
		}
		snapshot, err = s.currentRuntimeAgentAIConfigReadinessSnapshot(agentInstanceID)
		if err != nil {
			return publicChatImageActionUnavailable
		}
	}
	for _, capability := range snapshot.GetCapabilities() {
		if capability.GetCapability() != runtimeAgentAIConfigCapabilityImageGenerate {
			continue
		}
		switch capability.GetState() {
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE:
			return publicChatImageActionUnavailable
		case runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED:
			return publicChatImageActionNotConfigured
		default:
			return publicChatImageActionAvailable
		}
	}
	return publicChatImageActionUnavailable
}

func clonePublicChatExecutionBindings(input publicChatExecutionBindings) publicChatExecutionBindings {
	if len(input) == 0 {
		return nil
	}
	out := make(publicChatExecutionBindings, len(input))
	for capability, binding := range input {
		trimmedCapability := strings.TrimSpace(capability)
		if trimmedCapability == "" {
			continue
		}
		out[trimmedCapability] = publicChatExecutionBinding{
			ModelID:     strings.TrimSpace(binding.ModelID),
			RoutePolicy: binding.RoutePolicy,
			ConnectorID: strings.TrimSpace(binding.ConnectorID),
			TargetRef:   clonePublicChatTargetRef(binding.TargetRef),
		}
	}
	return out
}

func clonePublicChatExecutionParams(input map[string]map[string]any) map[string]map[string]any {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]map[string]any, len(input))
	for capability, params := range input {
		trimmedCapability := strings.TrimSpace(capability)
		if trimmedCapability == "" || params == nil {
			continue
		}
		cloned := make(map[string]any, len(params))
		for key, value := range params {
			cloned[key] = value
		}
		out[trimmedCapability] = cloned
	}
	return out
}

// resolveRuntimeDefaultPublicChatBinding resolves the runtime-owned default
// public chat text binding from the committed Runtime Agent AI Config
// text.generate intent (K-AGCORE-147); runtime-private hardcoded model constants are not
// admitted as execution binding truth.
func (s *Service) resolveRuntimeDefaultPublicChatBinding(
	ctx context.Context,
	agentInstanceID string,
	subjectUserID string,
	systemPrompt string,
	messages []*runtimev1.ChatMessage,
	maxOutputTokens int32,
) (publicChatExecutionBinding, error) {
	if s == nil || !s.HasPublicChatBindingResolver() {
		return publicChatExecutionBinding{}, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver unavailable")
	}
	configBinding, _, err := s.committedTextGenerateExecutionBinding(agentInstanceID)
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		Capability:      runtimeAgentAIConfigCapabilityTextGenerate,
		ModelID:         configBinding.ModelID,
		RouteHint:       configBinding.RoutePolicy,
		ConnectorID:     configBinding.ConnectorID,
		SubjectUserID:   strings.TrimSpace(subjectUserID),
		SystemPrompt:    strings.TrimSpace(systemPrompt),
		Messages:        cloneChatMessages(messages),
		MaxOutputTokens: maxOutputTokens,
	})
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	if strings.TrimSpace(resolved.ModelID) == "" {
		return publicChatExecutionBinding{}, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned empty model")
	}
	if resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return publicChatExecutionBinding{}, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned unspecified route")
	}
	return publicChatExecutionBinding{
		ModelID:     strings.TrimSpace(resolved.ModelID),
		RoutePolicy: resolved.RoutePolicy,
		ConnectorID: strings.TrimSpace(resolved.ConnectorID),
		TargetRef:   clonePublicChatTargetRef(configBinding.TargetRef),
	}, nil
}
