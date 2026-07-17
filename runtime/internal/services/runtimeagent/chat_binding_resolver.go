package runtimeagent

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type publicChatBindingResolverService interface {
	ResolvePublicChatTextBinding(context.Context, runtimev1.RoutePolicy, string) (runtimev1.RoutePolicy, string, error)
	ResolvePublicChatTextContextMetadata(context.Context, runtimev1.RoutePolicy, string, *runtimev1.RuntimeDurableTargetRef) (uint64, string, string, string, *runtimev1.RuntimeDurableTargetRef, error)
}

type PublicChatBindingResolutionRequest struct {
	Capability      string
	BindingAlias    string
	ModelID         string
	RouteHint       runtimev1.RoutePolicy
	ConnectorID     string
	SubjectUserID   string
	SystemPrompt    string
	Messages        []*runtimev1.ChatMessage
	MaxOutputTokens int32
	TargetRef       *runtimev1.RuntimeDurableTargetRef
}

type PublicChatBindingResolution struct {
	BindingAlias        string
	ModelID             string
	RoutePolicy         runtimev1.RoutePolicy
	ConnectorID         string
	TargetRef           *runtimev1.RuntimeDurableTargetRef
	ContextWindowTokens uint64
	CatalogRevision     string
	ModelRevision       string
	ProviderID          string
	RouteDigest         string
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
	contextWindow, catalogRevision, modelRevision, providerID, resolvedTargetRef, err := r.ai.ResolvePublicChatTextContextMetadata(
		ctx,
		routeDecision,
		modelResolved,
		clonePublicChatTargetRef(req.TargetRef),
	)
	if err != nil {
		return PublicChatBindingResolution{}, err
	}
	resolution := PublicChatBindingResolution{
		BindingAlias:        strings.TrimSpace(req.BindingAlias),
		ModelID:             strings.TrimSpace(modelResolved),
		RoutePolicy:         routeDecision,
		ConnectorID:         strings.TrimSpace(req.ConnectorID),
		TargetRef:           clonePublicChatTargetRef(resolvedTargetRef),
		ContextWindowTokens: contextWindow,
		CatalogRevision:     strings.TrimSpace(catalogRevision),
		ModelRevision:       strings.TrimSpace(modelRevision),
		ProviderID:          strings.TrimSpace(providerID),
	}
	resolution.RouteDigest = publicChatResolvedRouteDigest(resolution, resolution.TargetRef)
	if resolution.TargetRef == nil || resolution.TargetRef.GetTarget() == nil || resolution.ContextWindowTokens == 0 || resolution.CatalogRevision == "" || resolution.ModelRevision == "" || resolution.ProviderID == "" || resolution.RouteDigest == "" {
		return PublicChatBindingResolution{}, status.Error(codes.FailedPrecondition, "runtime public chat catalog context metadata incomplete")
	}
	return resolution, nil
}

func publicChatResolvedRouteDigest(resolution PublicChatBindingResolution, targetRef *runtimev1.RuntimeDurableTargetRef) string {
	targetBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(targetRef)
	if err != nil {
		return ""
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte("nimi.runtime.agent-context-route/v1\x00"))
	for _, value := range []string{
		strconv.Itoa(int(resolution.RoutePolicy)),
		strings.TrimSpace(resolution.BindingAlias),
		strings.TrimSpace(resolution.ProviderID),
		strings.TrimSpace(resolution.ModelID),
		strings.TrimSpace(resolution.ModelRevision),
		strings.TrimSpace(resolution.ConnectorID),
		strings.TrimSpace(resolution.CatalogRevision),
		strconv.FormatUint(resolution.ContextWindowTokens, 10),
		string(targetBytes),
	} {
		_, _ = hash.Write([]byte(value))
		_, _ = hash.Write([]byte{0})
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
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
		BindingAlias: runtimeAgentAIConfigIntentBindingAlias(intent),
		ModelID:      strings.TrimSpace(intent.GetModelId()),
		RoutePolicy:  intent.GetRoutePolicy(),
		ConnectorID:  strings.TrimSpace(intent.GetConnectorId()),
		TargetRef:    clonePublicChatTargetRef(intent.GetTargetRef()),
	}
}

func runtimeAgentAIConfigIntentBindingAlias(intent *runtimev1.RuntimeAgentAIConfigIntent) string {
	if intent == nil || intent.GetTargetRef() != nil {
		return ""
	}
	return strings.TrimSpace(intent.GetModelId())
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
		BindingAlias:    runtimeAgentAIConfigIntentBindingAlias(textBinding),
		ModelID:         strings.TrimSpace(textBinding.GetModelId()),
		RouteHint:       textBinding.GetRoutePolicy(),
		ConnectorID:     strings.TrimSpace(textBinding.GetConnectorId()),
		SubjectUserID:   strings.TrimSpace(subjectUserID),
		SystemPrompt:    strings.TrimSpace(req.SystemPrompt),
		Messages:        toProtoPublicChatMessages(req.Messages),
		MaxOutputTokens: req.MaxOutputTokens,
		TargetRef:       clonePublicChatTargetRef(textBinding.GetTargetRef()),
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
	resolvedTargetRef := firstPublicChatTargetRef(resolved.TargetRef, textBinding.GetTargetRef())
	if resolvedTargetRef == nil || resolvedTargetRef.GetTarget() == nil || resolved.ContextWindowTokens == 0 || strings.TrimSpace(resolved.CatalogRevision) == "" || strings.TrimSpace(resolved.ModelRevision) == "" || strings.TrimSpace(resolved.ProviderID) == "" || !validSHA256Hex(strings.TrimSpace(resolved.RouteDigest)) {
		return nil, 0, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned incomplete catalog context metadata")
	}
	out := publicChatExecutionBindings{
		runtimeAgentAIConfigCapabilityTextGenerate: {
			BindingAlias:        firstNonEmpty(strings.TrimSpace(resolved.BindingAlias), runtimeAgentAIConfigIntentBindingAlias(textBinding)),
			ModelID:             strings.TrimSpace(resolved.ModelID),
			RoutePolicy:         resolved.RoutePolicy,
			ConnectorID:         strings.TrimSpace(resolved.ConnectorID),
			TargetRef:           clonePublicChatTargetRef(resolvedTargetRef),
			ContextWindowTokens: resolved.ContextWindowTokens,
			CatalogRevision:     strings.TrimSpace(resolved.CatalogRevision),
			ModelRevision:       strings.TrimSpace(resolved.ModelRevision),
			ProviderID:          strings.TrimSpace(resolved.ProviderID),
			RouteDigest:         strings.TrimSpace(resolved.RouteDigest),
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
			BindingAlias:        strings.TrimSpace(binding.BindingAlias),
			ModelID:             strings.TrimSpace(binding.ModelID),
			RoutePolicy:         binding.RoutePolicy,
			ConnectorID:         strings.TrimSpace(binding.ConnectorID),
			TargetRef:           clonePublicChatTargetRef(binding.TargetRef),
			ContextWindowTokens: binding.ContextWindowTokens,
			CatalogRevision:     strings.TrimSpace(binding.CatalogRevision),
			ModelRevision:       strings.TrimSpace(binding.ModelRevision),
			ProviderID:          strings.TrimSpace(binding.ProviderID),
			RouteDigest:         strings.TrimSpace(binding.RouteDigest),
		}
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
		BindingAlias:    configBinding.BindingAlias,
		ModelID:         configBinding.ModelID,
		RouteHint:       configBinding.RoutePolicy,
		ConnectorID:     configBinding.ConnectorID,
		SubjectUserID:   strings.TrimSpace(subjectUserID),
		SystemPrompt:    strings.TrimSpace(systemPrompt),
		Messages:        cloneChatMessages(messages),
		MaxOutputTokens: maxOutputTokens,
		TargetRef:       clonePublicChatTargetRef(configBinding.TargetRef),
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
	resolvedTargetRef := firstPublicChatTargetRef(resolved.TargetRef, configBinding.TargetRef)
	if resolvedTargetRef == nil || resolvedTargetRef.GetTarget() == nil || resolved.ContextWindowTokens == 0 || strings.TrimSpace(resolved.CatalogRevision) == "" || strings.TrimSpace(resolved.ModelRevision) == "" || strings.TrimSpace(resolved.ProviderID) == "" || !validSHA256Hex(strings.TrimSpace(resolved.RouteDigest)) {
		return publicChatExecutionBinding{}, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned incomplete catalog context metadata")
	}
	return publicChatExecutionBinding{
		BindingAlias:        firstNonEmpty(strings.TrimSpace(resolved.BindingAlias), configBinding.BindingAlias),
		ModelID:             strings.TrimSpace(resolved.ModelID),
		RoutePolicy:         resolved.RoutePolicy,
		ConnectorID:         strings.TrimSpace(resolved.ConnectorID),
		TargetRef:           clonePublicChatTargetRef(resolvedTargetRef),
		ContextWindowTokens: resolved.ContextWindowTokens,
		CatalogRevision:     strings.TrimSpace(resolved.CatalogRevision),
		ModelRevision:       strings.TrimSpace(resolved.ModelRevision),
		ProviderID:          strings.TrimSpace(resolved.ProviderID),
		RouteDigest:         strings.TrimSpace(resolved.RouteDigest),
	}, nil
}

func firstPublicChatTargetRef(values ...*runtimev1.RuntimeDurableTargetRef) *runtimev1.RuntimeDurableTargetRef {
	for _, value := range values {
		if value != nil && value.GetTarget() != nil {
			return value
		}
	}
	return nil
}
