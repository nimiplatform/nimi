package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type publicChatBindingResolverService interface {
	ResolvePublicChatTextBinding(context.Context, runtimev1.RoutePolicy, string) (runtimev1.RoutePolicy, string, error)
	ResolvePublicChatTextContextMetadataLease(context.Context, runtimev1.RoutePolicy, string, *runtimeidentity.Target) (uint64, string, string, string, *runtimeidentity.Target, func(), error)
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
	TargetRef       *runtimeidentity.Target
}

type PublicChatBindingResolution struct {
	BindingAlias        string
	ModelID             string
	RoutePolicy         runtimev1.RoutePolicy
	ConnectorID         string
	TargetRef           *runtimeidentity.Target
	ContextWindowTokens uint64
	CatalogRevision     string
	ModelRevision       string
	ProviderID          string
	RouteDigest         string
	Release             func()
}

type PublicChatBindingResolver interface {
	ResolvePublicChatBinding(context.Context, PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error)
}

type rejectingPublicChatBindingResolver struct{}

type machineExecutionBindingResolver interface {
	ResolveMachineExecutionBindings(context.Context, string, []string) (publicChatExecutionBindings, error)
}

type machineExecutionBindingResolverFunc func(context.Context, string, []string) (publicChatExecutionBindings, error)

func (f machineExecutionBindingResolverFunc) ResolveMachineExecutionBindings(ctx context.Context, accountNamespace string, capabilityContracts []string) (publicChatExecutionBindings, error) {
	return f(ctx, accountNamespace, capabilityContracts)
}

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
	routeDecision := req.RouteHint
	modelResolved := strings.TrimSpace(req.ModelID)
	if req.TargetRef == nil || req.TargetRef.GetTarget() == nil {
		var err error
		routeDecision, modelResolved, err = r.ai.ResolvePublicChatTextBinding(ctx, req.RouteHint, req.ModelID)
		if err != nil {
			return PublicChatBindingResolution{}, publicChatDiagnosticError(
				err,
				"runtime_agent_public_chat_route_resolution",
			)
		}
	}
	contextWindow, catalogRevision, modelRevision, providerID, resolvedTargetRef, release, err := r.ai.ResolvePublicChatTextContextMetadataLease(
		ctx,
		routeDecision,
		modelResolved,
		clonePublicChatTargetRef(req.TargetRef),
	)
	if err != nil {
		return PublicChatBindingResolution{}, publicChatDiagnosticError(
			err,
			"runtime_agent_public_chat_context_metadata",
		)
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
		Release:             release,
	}
	resolution.RouteDigest = publicChatResolvedRouteDigest(resolution, resolution.TargetRef)
	targetRequired := resolution.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	if targetRequired && (resolution.TargetRef == nil || resolution.TargetRef.GetTarget() == nil) ||
		resolution.ContextWindowTokens == 0 || resolution.CatalogRevision == "" || resolution.ModelRevision == "" || resolution.ProviderID == "" || resolution.RouteDigest == "" {
		if resolution.Release != nil {
			resolution.Release()
		}
		return PublicChatBindingResolution{}, publicChatDiagnosticError(
			status.Error(codes.FailedPrecondition, "runtime public chat catalog context metadata incomplete"),
			"runtime_agent_public_chat_context_metadata_incomplete",
		)
	}
	return resolution, nil
}

func publicChatResolvedRouteDigest(resolution PublicChatBindingResolution, targetRef *runtimeidentity.Target) string {
	targetBytes, err := json.Marshal(targetRef)
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

// errPublicChatRequestExecutionBindingsNotAdmitted rejects request-carried
// execution truth. Shared AIConfig is portable consumer intent and cannot be
// treated as an exact model or machine binding.
var errPublicChatRequestExecutionBindingsNotAdmitted = status.Error(
	codes.InvalidArgument,
	"public chat execution_bindings are not admitted; Runtime resolves execution bindings independently",
)

func unresolvedSharedAIConfigExecutionBindingError() error {
	return status.Error(codes.FailedPrecondition, "shared LocalAgent AIConfig does not contain an exact machine execution binding")
}

// validateRuntimePrivateExecutorBinding fails closed when the machine
// configuration owner has not supplied an exact executable binding.
func validateRuntimePrivateExecutorBinding(label string, binding publicChatExecutionBinding) error {
	if strings.TrimSpace(binding.ModelID) == "" || binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return fmt.Errorf("%s executor requires an exact machine execution binding", label)
	}
	return nil
}

func (s *Service) setMachineExecutionBindingResolver(resolver machineExecutionBindingResolver) {
	if s == nil || s.isClosed() {
		return
	}
	s.machineExecutionBindingMu.Lock()
	s.machineExecutionBindingResolver = resolver
	s.machineExecutionBindingMu.Unlock()
}

func (s *Service) machineExecutionBindings(ctx context.Context, accountNamespace string) (publicChatExecutionBindings, error) {
	bindings, err := s.machineExecutionBindingsForCapabilities(ctx, accountNamespace)
	if err != nil {
		return nil, err
	}
	if len(bindings) == 0 {
		return nil, unresolvedSharedAIConfigExecutionBindingError()
	}
	return bindings, nil
}

func (s *Service) machineExecutionBindingsForCapabilities(
	ctx context.Context,
	accountNamespace string,
	capabilityContracts ...string,
) (publicChatExecutionBindings, error) {
	if s == nil || s.isClosed() || strings.TrimSpace(accountNamespace) == "" {
		return nil, unresolvedSharedAIConfigExecutionBindingError()
	}
	s.machineExecutionBindingMu.RLock()
	resolver := s.machineExecutionBindingResolver
	s.machineExecutionBindingMu.RUnlock()
	if resolver == nil {
		return nil, unresolvedSharedAIConfigExecutionBindingError()
	}
	bindings, err := resolver.ResolveMachineExecutionBindings(ctx, accountNamespace, append([]string(nil), capabilityContracts...))
	if err != nil {
		return nil, err
	}
	return clonePublicChatExecutionBindings(bindings), nil
}

func (s *Service) machineExecutionBindingsForAgent(ctx context.Context, agentInstanceID string, capabilityContracts ...string) (publicChatExecutionBindings, string, error) {
	entry, err := s.agentByID(strings.TrimSpace(agentInstanceID))
	if err != nil || entry == nil || entry.Agent == nil {
		return nil, "", unresolvedSharedAIConfigExecutionBindingError()
	}
	accountNamespace := strings.TrimSpace(entry.Agent.GetOwnerUserId())
	bindings, err := s.machineExecutionBindingsForCapabilities(ctx, accountNamespace, capabilityContracts...)
	return bindings, accountNamespace, err
}

func (s *Service) committedTextGenerateExecutionBinding(agentInstanceID string) (publicChatExecutionBinding, uint64, error) {
	bindings, _, err := s.machineExecutionBindingsForAgent(context.Background(), agentInstanceID, runtimeAgentAIConfigCapabilityTextGenerate)
	if err != nil {
		return publicChatExecutionBinding{}, 0, err
	}
	binding, ok := bindings[runtimeAgentAIConfigCapabilityTextGenerate]
	if !ok || validateRuntimePrivateExecutorBinding("text.generate", binding) != nil {
		return publicChatExecutionBinding{}, 0, unresolvedSharedAIConfigExecutionBindingError()
	}
	return binding, 0, nil
}

func (s *Service) resolveExecutionBindingsFromConfig(
	ctx context.Context,
	agentInstanceID string,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatExecutionBindings, uint64, func(), error) {
	bindings, accountNamespace, err := s.machineExecutionBindingsForAgent(
		ctx,
		agentInstanceID,
		runtimeAgentAIConfigCapabilityTextGenerate,
		runtimeAgentAIConfigCapabilityImageGenerate,
	)
	if err != nil {
		return nil, 0, nil, err
	}
	if strings.TrimSpace(subjectUserID) != accountNamespace {
		return nil, 0, nil, unresolvedSharedAIConfigExecutionBindingError()
	}
	textBinding, ok := bindings[runtimeAgentAIConfigCapabilityTextGenerate]
	if !ok || validateRuntimePrivateExecutorBinding("text.generate", textBinding) != nil || !s.HasPublicChatBindingResolver() {
		return nil, 0, nil, unresolvedSharedAIConfigExecutionBindingError()
	}
	resolutionCtx := withPublicChatExecutionIntent(ctx, textBinding, runtimeAgentAIConfigCapabilityTextGenerate)
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(resolutionCtx, PublicChatBindingResolutionRequest{
		Capability:      runtimeAgentAIConfigCapabilityTextGenerate,
		BindingAlias:    textBinding.BindingAlias,
		ModelID:         textBinding.ModelID,
		RouteHint:       textBinding.RoutePolicy,
		ConnectorID:     textBinding.ConnectorID,
		SubjectUserID:   accountNamespace,
		SystemPrompt:    strings.TrimSpace(req.SystemPrompt),
		Messages:        toProtoPublicChatMessages(req.Messages),
		MaxOutputTokens: req.MaxOutputTokens,
		TargetRef:       clonePublicChatTargetRef(textBinding.TargetRef),
	})
	if err != nil {
		return nil, 0, nil, err
	}
	release := resolved.Release
	fail := func(err error) (publicChatExecutionBindings, uint64, func(), error) {
		if release != nil {
			release()
		}
		return nil, 0, nil, err
	}
	resolvedTargetRef := firstPublicChatTargetRef(resolved.TargetRef, textBinding.TargetRef)
	if textBinding.LocalAIConfigIntent {
		if resolved.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			return fail(status.Error(codes.FailedPrecondition, "LocalAgent Local intent resolved to a non-Local route"))
		}
		resolvedTargetRef = nil
	}
	if textBinding.ExecutionIntent.IsAIConfigCloud() &&
		(resolved.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD ||
			strings.TrimSpace(resolved.ModelID) != textBinding.ExecutionIntent.ModelID() ||
			!runtimeidentity.Equal(resolvedTargetRef, textBinding.TargetRef)) {
		return fail(status.Error(codes.FailedPrecondition, "Cloud AIConfig intent changed during catalog context resolution"))
	}
	targetMissing := resolvedTargetRef == nil || resolvedTargetRef.GetTarget() == nil
	if strings.TrimSpace(resolved.ModelID) == "" || resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED ||
		(!textBinding.LocalAIConfigIntent && targetMissing) || resolved.ContextWindowTokens == 0 ||
		strings.TrimSpace(resolved.CatalogRevision) == "" || strings.TrimSpace(resolved.ModelRevision) == "" ||
		strings.TrimSpace(resolved.ProviderID) == "" || !validSHA256Hex(strings.TrimSpace(resolved.RouteDigest)) {
		return fail(status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned incomplete catalog context metadata"))
	}
	out := clonePublicChatExecutionBindings(bindings)
	out[runtimeAgentAIConfigCapabilityTextGenerate] = publicChatExecutionBinding{
		BindingAlias:        firstNonEmpty(strings.TrimSpace(resolved.BindingAlias), textBinding.BindingAlias),
		ModelID:             strings.TrimSpace(resolved.ModelID),
		RoutePolicy:         resolved.RoutePolicy,
		ConnectorID:         strings.TrimSpace(resolved.ConnectorID),
		TargetRef:           clonePublicChatTargetRef(resolvedTargetRef),
		ExecutionIntent:     executionintent.Clone(textBinding.ExecutionIntent),
		LocalExecution:      localexecution.CloneSelectedLocalExecution(textBinding.LocalExecution),
		SelectedParams:      clonePublicChatSelectedParams(textBinding.SelectedParams),
		CapabilityContract:  textBinding.CapabilityContract,
		RequiredFeatures:    append([]string(nil), textBinding.RequiredFeatures...),
		LocalAIConfigIntent: textBinding.LocalAIConfigIntent,
		ContextWindowTokens: resolved.ContextWindowTokens,
		CatalogRevision:     strings.TrimSpace(resolved.CatalogRevision),
		ModelRevision:       strings.TrimSpace(resolved.ModelRevision),
		ProviderID:          strings.TrimSpace(resolved.ProviderID),
		RouteDigest:         strings.TrimSpace(resolved.RouteDigest),
	}
	return out, 0, release, nil
}

func (s *Service) committedOptionalExecutionBinding(agentInstanceID string, capability string) (publicChatExecutionBinding, bool, error) {
	trimmedCapability := strings.TrimSpace(capability)
	if trimmedCapability == "" {
		return publicChatExecutionBinding{}, false, nil
	}
	bindings, _, err := s.machineExecutionBindingsForAgent(context.Background(), agentInstanceID, trimmedCapability)
	if err != nil {
		return publicChatExecutionBinding{}, false, err
	}
	binding, ok := bindings[trimmedCapability]
	if !ok {
		return publicChatExecutionBinding{}, false, nil
	}
	if validateCommittedOptionalExecutionBinding(trimmedCapability, binding) != nil {
		return publicChatExecutionBinding{}, true, unresolvedSharedAIConfigExecutionBindingError()
	}
	return binding, true, nil
}

// validateCommittedOptionalExecutionBinding keeps Local and Cloud route
// identity disjoint. A Local binding is the selected Runtime-private execution
// snapshot and never gains a durable TargetRef. Cloud remains bound to its
// exact connector/model target.
func validateCommittedOptionalExecutionBinding(capability string, binding publicChatExecutionBinding) error {
	capability = strings.TrimSpace(capability)
	if capability == "" || validateRuntimePrivateExecutorBinding(capability, binding) != nil {
		return unresolvedSharedAIConfigExecutionBindingError()
	}
	intent := executionintent.Clone(binding.ExecutionIntent)
	switch binding.RoutePolicy {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		if binding.TargetRef != nil || !binding.LocalAIConfigIntent || binding.LocalExecution == nil ||
			!intent.IsLocal() || intent.CapabilityContract != capability ||
			!validSelectedLocalExecutionProjection(binding.LocalExecution, capability) {
			return unresolvedSharedAIConfigExecutionBindingError()
		}
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		cloud := binding.TargetRef.GetCloud()
		if cloud == nil || !binding.TargetRef.Valid() || strings.TrimSpace(binding.ConnectorID) != strings.TrimSpace(cloud.GetConnectorId()) ||
			!intent.IsAIConfigCloud() || intent.CapabilityContract != capability ||
			intent.ModelID() != strings.TrimSpace(cloud.GetProviderModelId()) {
			return unresolvedSharedAIConfigExecutionBindingError()
		}
	default:
		return unresolvedSharedAIConfigExecutionBindingError()
	}
	return nil
}

func (s *Service) deriveImageActionAvailability(agentInstanceID string, configRevision uint64, binding publicChatExecutionBinding, hasImageBinding bool) publicChatImageActionAvailability {
	_ = s
	_ = agentInstanceID
	_ = configRevision
	if !hasImageBinding {
		return publicChatImageActionNotConfigured
	}
	if binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL &&
		(binding.LocalExecution == nil || !localexecution.SupportsRequiredFeatures(
			binding.RequiredFeatures,
			binding.LocalExecution.SupportedFeatures,
		)) {
		return publicChatImageActionUnavailable
	}
	return publicChatImageActionAvailable
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
			ExecutionIntent:     executionintent.Clone(binding.ExecutionIntent),
			LocalExecution:      localexecution.CloneSelectedLocalExecution(binding.LocalExecution),
			SelectedParams:      clonePublicChatSelectedParams(binding.SelectedParams),
			CapabilityContract:  strings.TrimSpace(binding.CapabilityContract),
			RequiredFeatures:    append([]string(nil), binding.RequiredFeatures...),
			LocalAIConfigIntent: binding.LocalAIConfigIntent,
			ContextWindowTokens: binding.ContextWindowTokens,
			CatalogRevision:     strings.TrimSpace(binding.CatalogRevision),
			ModelRevision:       strings.TrimSpace(binding.ModelRevision),
			ProviderID:          strings.TrimSpace(binding.ProviderID),
			RouteDigest:         strings.TrimSpace(binding.RouteDigest),
		}
	}
	return out
}

func clonePublicChatSelectedParams(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	cloned, ok := proto.Clone(input).(*structpb.Struct)
	if !ok {
		return nil
	}
	return cloned
}

func (s *Service) resolveRuntimeDefaultPublicChatBinding(
	ctx context.Context,
	agentInstanceID string,
	subjectUserID string,
	systemPrompt string,
	messages []*runtimev1.ChatMessage,
	maxOutputTokens int32,
) (publicChatExecutionBinding, error) {
	if s == nil || !s.HasPublicChatBindingResolver() {
		return publicChatExecutionBinding{}, unresolvedSharedAIConfigExecutionBindingError()
	}
	binding, _, err := s.committedTextGenerateExecutionBinding(agentInstanceID)
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	resolutionCtx := withPublicChatExecutionIntent(ctx, binding, runtimeAgentAIConfigCapabilityTextGenerate)
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(resolutionCtx, PublicChatBindingResolutionRequest{
		Capability: runtimeAgentAIConfigCapabilityTextGenerate, BindingAlias: binding.BindingAlias,
		ModelID: binding.ModelID, RouteHint: binding.RoutePolicy, ConnectorID: binding.ConnectorID,
		SubjectUserID: strings.TrimSpace(subjectUserID), SystemPrompt: strings.TrimSpace(systemPrompt),
		Messages: cloneChatMessages(messages), MaxOutputTokens: maxOutputTokens, TargetRef: clonePublicChatTargetRef(binding.TargetRef),
	})
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	if resolved.Release != nil {
		defer resolved.Release()
	}
	resolvedTargetRef := firstPublicChatTargetRef(resolved.TargetRef, binding.TargetRef)
	if binding.LocalAIConfigIntent {
		if resolved.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			return publicChatExecutionBinding{}, unresolvedSharedAIConfigExecutionBindingError()
		}
		resolvedTargetRef = nil
	}
	targetMissing := resolvedTargetRef == nil || resolvedTargetRef.GetTarget() == nil
	if strings.TrimSpace(resolved.ModelID) == "" || resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED ||
		(!binding.LocalAIConfigIntent && targetMissing) || resolved.ContextWindowTokens == 0 ||
		strings.TrimSpace(resolved.CatalogRevision) == "" || strings.TrimSpace(resolved.ModelRevision) == "" ||
		strings.TrimSpace(resolved.ProviderID) == "" || !validSHA256Hex(strings.TrimSpace(resolved.RouteDigest)) {
		return publicChatExecutionBinding{}, unresolvedSharedAIConfigExecutionBindingError()
	}
	return publicChatExecutionBinding{
		BindingAlias: firstNonEmpty(strings.TrimSpace(resolved.BindingAlias), binding.BindingAlias),
		ModelID:      strings.TrimSpace(resolved.ModelID), RoutePolicy: resolved.RoutePolicy,
		ConnectorID: strings.TrimSpace(resolved.ConnectorID), TargetRef: clonePublicChatTargetRef(resolvedTargetRef),
		ExecutionIntent: executionintent.Clone(binding.ExecutionIntent), LocalExecution: localexecution.CloneSelectedLocalExecution(binding.LocalExecution),
		SelectedParams: clonePublicChatSelectedParams(binding.SelectedParams), CapabilityContract: binding.CapabilityContract,
		RequiredFeatures: append([]string(nil), binding.RequiredFeatures...), LocalAIConfigIntent: binding.LocalAIConfigIntent,
		ContextWindowTokens: resolved.ContextWindowTokens,
		CatalogRevision:     strings.TrimSpace(resolved.CatalogRevision), ModelRevision: strings.TrimSpace(resolved.ModelRevision),
		ProviderID: strings.TrimSpace(resolved.ProviderID), RouteDigest: strings.TrimSpace(resolved.RouteDigest),
	}, nil
}

func firstPublicChatTargetRef(values ...*runtimeidentity.Target) *runtimeidentity.Target {
	for _, value := range values {
		if value != nil && value.GetTarget() != nil {
			return value
		}
	}
	return nil
}
