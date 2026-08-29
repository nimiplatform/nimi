package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
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

func protectedAccountProductPrincipal(ctx context.Context, avatarCapability string) (protectedprincipal.Principal, bool, error) {
	principal, attached := protectedprincipal.AttachedToContext(ctx)
	if !attached {
		return protectedprincipal.Principal{}, false, nil
	}
	if !principal.Valid() {
		return protectedprincipal.Principal{}, true, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if principal.IsDesktopAccountProduct() {
		return principal, true, nil
	}
	if principal.ProfileID == bundledavatar.ProfileID && principal.AppID == bundledavatar.AppID && principal.Capability == avatarCapability {
		return principal, true, nil
	}
	return protectedprincipal.Principal{}, true, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
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
	principal, protected, err := protectedAccountProductPrincipal(ctx, capability)
	if err != nil || !protected {
		return err
	}
	if requestContext == nil || strings.TrimSpace(requestContext.GetAppId()) != principal.AppID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if !principal.Owns(identity.OwnerUserID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if subjectUserID := strings.TrimSpace(requestContext.GetSubjectUserId()); subjectUserID != "" && !principal.Owns(subjectUserID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

// authorizeCurrentAccountLocalAgent binds an ordinary authenticated caller or
// a protected first-party principal to the current Runtime-owned LocalAgent.
// The request body is only a selector: it must match the authenticated account
// and cannot act as a portable delegation credential.
func (s *Service) authorizeCurrentAccountLocalAgent(
	ctx context.Context,
	requestContext *runtimev1.AgentRequestContext,
	identity localAgentIdentity,
	capability string,
) error {
	if err := s.authorizeBundledAvatarIdentity(ctx, requestContext, identity, capability); err != nil {
		return err
	}
	_, protected, err := protectedAccountProductPrincipal(ctx, capability)
	if err != nil || protected {
		return err
	}
	authenticated := authn.IdentityFromContext(ctx)
	if authenticated == nil || strings.TrimSpace(authenticated.SubjectUserID) == "" {
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	if requestContext == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	subjectUserID := strings.TrimSpace(authenticated.SubjectUserID)
	if selectorSubject := strings.TrimSpace(requestContext.GetSubjectUserId()); selectorSubject != "" && selectorSubject != subjectUserID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if selectorOwner := strings.TrimSpace(requestContext.GetOwnerUserId()); selectorOwner != "" && selectorOwner != subjectUserID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if identity.OwnerUserID != subjectUserID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

func (s *Service) revalidateBundledAvatarIdentity(ctx context.Context, identity localAgentIdentity) error {
	return s.revalidateProtectedAccountIdentity(ctx, identity)
}

func (s *Service) revalidateProtectedAccountIdentity(ctx context.Context, identity localAgentIdentity) error {
	principal, protected, err := protectedAccountProductPrincipal(ctx, "runtime.agent.read")
	if err != nil || !protected {
		return err
	}
	if !principal.Owns(identity.OwnerUserID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

func (s *Service) authorizeProtectedAccountAgent(
	ctx context.Context,
	selector *runtimev1.AgentRequestContext,
	agentID string,
	capability string,
) (bool, error) {
	principal, protected, err := protectedAccountProductPrincipal(ctx, capability)
	if err != nil || !protected {
		return protected, err
	}
	if selector == nil {
		return true, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateProtectedAccountAgentSelector(selector, principal); err != nil {
		return true, err
	}
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return true, err
	}
	if !principal.Owns(entry.Agent.GetOwnerUserId()) {
		return true, status.Error(codes.NotFound, "agent not found")
	}
	*selector = runtimev1.AgentRequestContext{
		AppId:            principal.AppID,
		SubjectUserId:    principal.AccountID,
		OwnerUserId:      entry.Agent.GetOwnerUserId(),
		RuntimeSourceRef: entry.Agent.GetRuntimeSourceRef(),
		LocalAgentRef:    entry.Agent.GetLocalAgentRef(),
	}
	return true, nil
}

func validateProtectedAccountAgentSelector(selector *runtimev1.AgentRequestContext, principal protectedprincipal.Principal) error {
	if selector == nil {
		return nil
	}
	if appID := strings.TrimSpace(selector.GetAppId()); appID != "" && appID != principal.AppID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if strings.TrimSpace(selector.GetSubjectUserId()) != "" ||
		strings.TrimSpace(selector.GetOwnerUserId()) != "" ||
		strings.TrimSpace(selector.GetRuntimeSourceRef()) != "" ||
		strings.TrimSpace(selector.GetLocalAgentRef()) != "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func (s *Service) getProtectedAccountAgent(ctx context.Context, req *runtimev1.GetAgentRequest) (*runtimev1.GetAgentResponse, error) {
	if req == nil || strings.TrimSpace(req.GetAgentId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	principal, protected, err := protectedAccountProductPrincipal(ctx, "runtime.agent.read")
	if err != nil || !protected {
		return nil, err
	}
	if err := validateProtectedAccountAgentSelector(req.GetContext(), principal); err != nil {
		return nil, err
	}
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	if !principal.Owns(entry.Agent.GetOwnerUserId()) {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	agent := cloneLocalAgentRecord(entry.Agent)
	if err := validatePersistedAgentPresentationProfile(agent); err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentResponse{Agent: agent}, nil
}

// AuthorizeProtectedGeneratedVoiceArtifact validates the Runtime Agent-owned
// artifact selector against the canonical protected principal.
func (s *Service) AuthorizeProtectedGeneratedVoiceCleanup(ctx context.Context, selector runtimeartifact.GeneratedVoiceArtifactSelector) bool {
	principal, protected, err := protectedAccountProductPrincipal(ctx, "runtime.artifact.read")
	if err != nil || !protected {
		return false
	}
	agentID := strings.TrimSpace(selector.AgentID)
	anchorID := strings.TrimSpace(selector.ConversationAnchorID)
	if agentID != "" {
		entry, lookupErr := s.agentByID(agentID)
		if lookupErr != nil || !principal.Owns(entry.Agent.GetOwnerUserId()) {
			return false
		}
	}
	if anchorID != "" {
		s.chatSurfaceMu.Lock()
		anchor := s.chatAnchors[anchorID]
		valid := anchor != nil && principal.Owns(anchor.OwnerUserID) &&
			(agentID == "" || anchor.LocalAgentRef == agentID)
		s.chatSurfaceMu.Unlock()
		if !valid {
			return false
		}
	}
	return agentID != "" || anchorID != ""
}

func (s *Service) AuthorizeProtectedGeneratedVoiceArtifact(ctx context.Context, record runtimeartifact.ArtifactRecord) bool {
	if record.GeneratedVoice == nil {
		return false
	}
	principal, protected, err := protectedAccountProductPrincipal(ctx, "runtime.artifact.read")
	if err != nil || !protected {
		return false
	}
	agentID := strings.TrimSpace(record.GeneratedVoice.AgentID)
	if agentID == "" {
		return false
	}
	entry, err := s.agentByID(agentID)
	return err == nil && principal.Owns(entry.Agent.GetOwnerUserId())
}
