package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
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

func (s *Service) resolvePublicChatBinding(
	ctx context.Context,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatExecutionBindings, bool, error) {
	if len(req.ExecutionBindings) == 0 {
		return nil, false, nil
	}
	if _, ok := req.ExecutionBindings["text.generate"]; !ok {
		return nil, true, status.Error(codes.InvalidArgument, "public chat execution_bindings.text.generate is required")
	}
	out := make(publicChatExecutionBindings, len(req.ExecutionBindings))
	for capability, payload := range req.ExecutionBindings {
		normalizedCapability := strings.TrimSpace(capability)
		if normalizedCapability == "" {
			return nil, true, status.Error(codes.InvalidArgument, "public chat execution_bindings capability is required")
		}
		switch normalizedCapability {
		case "text.generate":
			binding, err := s.resolvePublicChatTextBinding(ctx, subjectUserID, req, payload)
			if err != nil {
				return nil, true, err
			}
			out[normalizedCapability] = binding
		case "image.generate":
			binding, err := parsePublicChatExplicitCapabilityBinding(payload, "public chat execution_bindings.image.generate")
			if err != nil {
				return nil, true, err
			}
			out[normalizedCapability] = binding
		default:
			return nil, true, status.Errorf(codes.InvalidArgument, "public chat execution_bindings.%s is not admitted", normalizedCapability)
		}
	}
	return out, true, nil
}

func (s *Service) resolvePublicChatTextBinding(
	ctx context.Context,
	subjectUserID string,
	req publicChatTurnRequestPayload,
	payload publicChatExecutionBindingPayload,
) (publicChatExecutionBinding, error) {
	modelID := strings.TrimSpace(payload.ModelID)
	if modelID == "" {
		return publicChatExecutionBinding{}, status.Error(codes.InvalidArgument, "public chat execution_bindings.text.generate.model_id is required")
	}
	routeHint, err := parseOptionalPublicChatRoutePolicy(payload.Route)
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	if s == nil || !s.HasPublicChatBindingResolver() {
		return publicChatExecutionBinding{}, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver unavailable")
	}
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		Capability:      "text.generate",
		ModelID:         modelID,
		RouteHint:       routeHint,
		ConnectorID:     strings.TrimSpace(payload.ConnectorID),
		SubjectUserID:   strings.TrimSpace(subjectUserID),
		SystemPrompt:    strings.TrimSpace(req.SystemPrompt),
		Messages:        toProtoPublicChatMessages(req.Messages),
		MaxOutputTokens: req.MaxOutputTokens,
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
	}, nil
}

func parsePublicChatExplicitCapabilityBinding(payload publicChatExecutionBindingPayload, label string) (publicChatExecutionBinding, error) {
	modelID := strings.TrimSpace(payload.ModelID)
	if modelID == "" {
		return publicChatExecutionBinding{}, status.Errorf(codes.InvalidArgument, "%s.model_id is required", label)
	}
	routePolicy, err := parseOptionalPublicChatRoutePolicy(payload.Route)
	if err != nil {
		return publicChatExecutionBinding{}, err
	}
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return publicChatExecutionBinding{}, status.Errorf(codes.InvalidArgument, "%s.route is required", label)
	}
	return publicChatExecutionBinding{
		ModelID:     modelID,
		RoutePolicy: routePolicy,
		ConnectorID: strings.TrimSpace(payload.ConnectorID),
	}, nil
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
		out[trimmedCapability] = binding
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
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		Capability:      "text.generate",
		ModelID:         texttarget.InternalDefaultLocalTextModelAlias,
		RouteHint:       runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED,
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
	}, nil
}
