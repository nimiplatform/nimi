package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) SetRuntimeAccountProjectionProvider(provider runtimeAccountProjectionProvider) {
	s.runtimeAccountProjection = provider
}

func isBundledAvatarCapability(ctx context.Context, capability string) bool {
	principal, ok := protectedprincipal.FromContext(ctx)
	return ok && principal.AppID == bundledavatar.AppID && principal.Capability == capability
}

func bundledAvatarPrincipal(ctx context.Context) (protectedprincipal.Principal, error) {
	principal, ok := protectedprincipal.FromContext(ctx)
	if !ok || principal.AppID != bundledavatar.AppID {
		return protectedprincipal.Principal{}, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return principal, nil
}

// authorizeBundledAvatarIdentity is the single Runtime Agent domain policy
// adapter for checking a renderer-selected local Agent against the canonical
// protected principal established by the transport interceptor.
func (s *Service) authorizeBundledAvatarIdentity(
	ctx context.Context,
	requestContext *runtimev1.AgentRequestContext,
	identity localAgentIdentity,
	capability string,
) error {
	if !isBundledAvatarCapability(ctx, capability) {
		return nil
	}
	principal, err := bundledAvatarPrincipal(ctx)
	if err != nil {
		return err
	}
	if requestContext == nil || strings.TrimSpace(requestContext.GetAppId()) != principal.AppID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if requestContext.GetScopedBinding() != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if !principal.Owns(identity.OwnerUserID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if subjectUserID := strings.TrimSpace(requestContext.GetSubjectUserId()); subjectUserID != "" && !principal.Owns(subjectUserID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

func (s *Service) revalidateBundledAvatarIdentity(ctx context.Context, identity localAgentIdentity) error {
	principal, err := bundledAvatarPrincipal(ctx)
	if err != nil {
		return err
	}
	if !principal.Owns(identity.OwnerUserID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

func validateBundledAvatarAgentSelector(selector *runtimev1.AgentRequestContext) error {
	if selector == nil {
		return nil
	}
	if appID := strings.TrimSpace(selector.GetAppId()); appID != "" && appID != bundledavatar.AppID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if strings.TrimSpace(selector.GetSubjectUserId()) != "" ||
		strings.TrimSpace(selector.GetOwnerUserId()) != "" ||
		strings.TrimSpace(selector.GetRuntimeSourceRef()) != "" ||
		strings.TrimSpace(selector.GetLocalAgentRef()) != "" || selector.GetScopedBinding() != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func (s *Service) getBundledAvatarAgent(ctx context.Context, req *runtimev1.GetAgentRequest) (*runtimev1.GetAgentResponse, error) {
	if req == nil || strings.TrimSpace(req.GetAgentId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateBundledAvatarAgentSelector(req.GetContext()); err != nil {
		return nil, err
	}
	principal, err := bundledAvatarPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	if !principal.Owns(entry.Agent.GetOwnerUserId()) {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	agent := cloneAgentRecord(entry.Agent)
	if err := validatePersistedAgentPresentationProfile(agent); err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentResponse{Agent: agent}, nil
}

// AuthorizeProtectedGeneratedVoiceArtifact validates the Runtime Agent-owned
// artifact selector against the canonical protected principal.
func (s *Service) AuthorizeProtectedGeneratedVoiceArtifact(ctx context.Context, record runtimeartifact.ArtifactRecord) bool {
	if !isBundledAvatarCapability(ctx, "runtime.artifact.read") || record.GeneratedVoice == nil {
		return false
	}
	principal, err := bundledAvatarPrincipal(ctx)
	if err != nil {
		return false
	}
	agentID := strings.TrimSpace(record.GeneratedVoice.AgentID)
	if agentID == "" {
		return false
	}
	entry, err := s.agentByID(agentID)
	return err == nil && principal.Owns(entry.Agent.GetOwnerUserId())
}
