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
) (publicChatExecutionBinding, bool, error) {
	if req.ExecutionBinding == nil {
		return publicChatExecutionBinding{}, false, nil
	}
	modelID := strings.TrimSpace(req.ExecutionBinding.ModelID)
	if modelID == "" {
		return publicChatExecutionBinding{}, true, status.Error(codes.InvalidArgument, "public chat execution_binding.model_id is required")
	}
	routeHint, err := parseOptionalPublicChatRoutePolicy(req.ExecutionBinding.Route)
	if err != nil {
		return publicChatExecutionBinding{}, true, err
	}
	if s == nil || !s.HasPublicChatBindingResolver() {
		return publicChatExecutionBinding{}, true, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver unavailable")
	}
	resolved, err := s.currentPublicChatBindingResolver().ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		ModelID:         modelID,
		RouteHint:       routeHint,
		ConnectorID:     strings.TrimSpace(req.ExecutionBinding.ConnectorID),
		SubjectUserID:   strings.TrimSpace(subjectUserID),
		SystemPrompt:    strings.TrimSpace(req.SystemPrompt),
		Messages:        toProtoPublicChatMessages(req.Messages),
		MaxOutputTokens: req.MaxOutputTokens,
	})
	if err != nil {
		return publicChatExecutionBinding{}, true, err
	}
	if strings.TrimSpace(resolved.ModelID) == "" {
		return publicChatExecutionBinding{}, true, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned empty model")
	}
	if resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return publicChatExecutionBinding{}, true, status.Error(codes.FailedPrecondition, "runtime public chat binding resolver returned unspecified route")
	}
	return publicChatExecutionBinding{
		ModelID:     strings.TrimSpace(resolved.ModelID),
		RoutePolicy: resolved.RoutePolicy,
		ConnectorID: strings.TrimSpace(resolved.ConnectorID),
	}, true, nil
}
