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
// turn ingress; the committed runtime agent execution config is the only
// binding truth.
var errPublicChatRequestExecutionBindingsNotAdmitted = status.Error(
	codes.InvalidArgument,
	"public chat execution_bindings are not admitted; runtime agent execution config is authoritative (K-AGCORE-147)",
)

// validateRuntimePrivateExecutorBinding fails closed when a runtime-private
// executor request lacks the committed config text.generate binding
// (K-AGCORE-147); a silent fallback to a hardcoded model constant is not
// admitted as execution binding truth.
func validateRuntimePrivateExecutorBinding(label string, binding publicChatExecutionBinding) error {
	if strings.TrimSpace(binding.ModelID) == "" || binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return fmt.Errorf("%s executor requires the committed execution config text.generate binding (K-AGCORE-147)", label)
	}
	return nil
}

// executionBindingFromConfigProto converts a committed config capability
// binding into the runtime-private execution binding shape.
func executionBindingFromConfigProto(binding *runtimev1.RuntimeAgentExecutionCapabilityBinding) publicChatExecutionBinding {
	if binding == nil {
		return publicChatExecutionBinding{}
	}
	return publicChatExecutionBinding{
		ModelID:     strings.TrimSpace(binding.GetModelId()),
		RoutePolicy: binding.GetRoutePolicy(),
		ConnectorID: strings.TrimSpace(binding.GetConnectorId()),
		TargetRef:   clonePublicChatTargetRef(binding.GetTargetRef()),
	}
}

// committedTextGenerateExecutionBinding loads the committed config and
// returns its required text.generate binding plus the config revision. A
// missing binding after seed is a typed fail-closed rejection (K-AGCORE-147);
// there is no silent fallback to another route or bundled constant.
func (s *Service) committedTextGenerateExecutionBinding() (publicChatExecutionBinding, uint64, error) {
	config, err := s.committedExecutionConfig()
	if err != nil {
		return publicChatExecutionBinding{}, 0, err
	}
	for _, binding := range config.GetBindings() {
		if strings.TrimSpace(binding.GetCapability()) == executionCapabilityTextGenerate {
			resolved := executionBindingFromConfigProto(binding)
			if resolved.ModelID == "" || resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
				return publicChatExecutionBinding{}, 0, status.Error(codes.FailedPrecondition, "runtime agent execution config text.generate binding is structurally invalid (K-AGCORE-147)")
			}
			return resolved, config.GetRevision(), nil
		}
	}
	return publicChatExecutionBinding{}, 0, status.Error(codes.FailedPrecondition, "runtime agent execution config is missing the required text.generate binding (K-AGCORE-147)")
}

// resolveExecutionBindingsFromConfig binds a public chat turn to the
// committed execution config at admission time (K-AGCORE-147). The
// text.generate binding is refined through the runtime binding resolver
// (model alias resolution, e.g. local/default); the image.generate binding is
// carried from the committed config as-is.
func (s *Service) resolveExecutionBindingsFromConfig(
	ctx context.Context,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatExecutionBindings, uint64, error) {
	config, err := s.committedExecutionConfig()
	if err != nil {
		return nil, 0, err
	}
	var textBinding *runtimev1.RuntimeAgentExecutionCapabilityBinding
	var imageBinding *runtimev1.RuntimeAgentExecutionCapabilityBinding
	var audioBinding *runtimev1.RuntimeAgentExecutionCapabilityBinding
	for _, binding := range config.GetBindings() {
		switch strings.TrimSpace(binding.GetCapability()) {
		case executionCapabilityTextGenerate:
			textBinding = binding
		case executionCapabilityImageGenerate:
			imageBinding = binding
		case executionCapabilityAudioSynthesize:
			audioBinding = binding
		}
	}
	if textBinding == nil || strings.TrimSpace(textBinding.GetModelId()) == "" {
		return nil, 0, status.Error(codes.FailedPrecondition, "runtime agent execution config is missing the required text.generate binding (K-AGCORE-147)")
	}
	if s == nil || !s.HasPublicChatBindingResolver() {
		return nil, 0, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver unavailable")
	}
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		Capability:      executionCapabilityTextGenerate,
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
		executionCapabilityTextGenerate: {
			ModelID:     strings.TrimSpace(resolved.ModelID),
			RoutePolicy: resolved.RoutePolicy,
			ConnectorID: strings.TrimSpace(resolved.ConnectorID),
			TargetRef:   clonePublicChatTargetRef(textBinding.GetTargetRef()),
		},
	}
	if imageBinding != nil {
		out[executionCapabilityImageGenerate] = executionBindingFromConfigProto(imageBinding)
	}
	if audioBinding != nil {
		out[executionCapabilityAudioSynthesize] = executionBindingFromConfigProto(audioBinding)
	}
	return out, config.GetRevision(), nil
}

func (s *Service) committedOptionalExecutionBinding(capability string) (publicChatExecutionBinding, bool, error) {
	config, err := s.committedExecutionConfig()
	if err != nil {
		return publicChatExecutionBinding{}, false, err
	}
	trimmedCapability := strings.TrimSpace(capability)
	if trimmedCapability == "" {
		return publicChatExecutionBinding{}, false, nil
	}
	for _, binding := range config.GetBindings() {
		if strings.TrimSpace(binding.GetCapability()) != trimmedCapability {
			continue
		}
		resolved := executionBindingFromConfigProto(binding)
		if strings.TrimSpace(resolved.ModelID) == "" ||
			resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED ||
			resolved.TargetRef == nil ||
			resolved.TargetRef.GetTarget() == nil {
			return publicChatExecutionBinding{}, true, status.Errorf(codes.FailedPrecondition, "runtime agent execution config %s binding is structurally invalid", trimmedCapability)
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
func (s *Service) deriveImageActionAvailability(configRevision uint64, hasImageBinding bool) publicChatImageActionAvailability {
	if !hasImageBinding {
		return publicChatImageActionNotConfigured
	}
	snapshot, err := s.currentExecutionReadinessSnapshot()
	if err != nil {
		// Readiness cannot be evaluated: the committed binding exists but
		// its route state is unknown; fail toward unavailable, never toward
		// a fabricated available.
		return publicChatImageActionUnavailable
	}
	if snapshot.GetConfigRevision() != configRevision {
		if err := s.refreshExecutionReadiness(); err != nil {
			return publicChatImageActionUnavailable
		}
		snapshot, err = s.currentExecutionReadinessSnapshot()
		if err != nil {
			return publicChatImageActionUnavailable
		}
	}
	for _, capability := range snapshot.GetCapabilities() {
		if capability.GetCapability() != executionCapabilityImageGenerate {
			continue
		}
		switch capability.GetState() {
		case runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE:
			return publicChatImageActionUnavailable
		case runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_NOT_CONFIGURED:
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
// public chat text binding from the committed execution config text.generate
// binding (K-AGCORE-147); runtime-private hardcoded model constants are not
// admitted as execution binding truth.
func (s *Service) resolveRuntimeDefaultPublicChatBinding(
	ctx context.Context,
	subjectUserID string,
	systemPrompt string,
	messages []*runtimev1.ChatMessage,
	maxOutputTokens int32,
) (publicChatExecutionBinding, error) {
	if s == nil || !s.HasPublicChatBindingResolver() {
		return publicChatExecutionBinding{}, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver unavailable")
	}
	configBinding, _, err := s.committedTextGenerateExecutionBinding()
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		Capability:      executionCapabilityTextGenerate,
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
