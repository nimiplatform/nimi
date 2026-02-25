package grant

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
	"sort"
	"strings"
	"time"
)

func (s *Service) ValidateAppAccessToken(_ context.Context, req *runtimev1.ValidateAppAccessTokenRequest) (*runtimev1.ValidateAppAccessTokenResponse, error) {
	tokenID := strings.TrimSpace(req.GetTokenId())
	appID := strings.TrimSpace(req.GetAppId())
	if tokenID == "" || appID == "" {
		return &runtimev1.ValidateAppAccessTokenResponse{
			Valid:      false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set_app_id_and_token_id",
		}, nil
	}

	s.mu.RLock()
	token, exists := s.tokens[tokenID]
	currentPolicyVersion := s.policyIndex[policyKey(token.AppID, token.SubjectUserID, token.ExternalPrincipalID)]
	s.mu.RUnlock()

	if !exists || token.AppID != appID {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, ActionHint: "reauthorize_external_principal"}, nil
	}
	if token.Revoked {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_TOKEN_REVOKED, ActionHint: "reauthorize_external_principal"}, nil
	}
	if time.Now().UTC().After(token.ExpiresAt) {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_TOKEN_EXPIRED, ActionHint: "refresh_authorization"}, nil
	}
	if currentPolicyVersion != "" && token.PolicyVersion != currentPolicyVersion {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, ActionHint: "refresh_authorization_policy"}, nil
	}
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	if subjectUserID != "" && subjectUserID != token.SubjectUserID {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, ActionHint: "set_matching_subject_user_id"}, nil
	}
	if !s.catalog.IsPublished(token.IssuedScopeCatalog) {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED, ActionHint: "use_published_scope_catalog_version"}, nil
	}
	if s.catalog.HasRevokedScope(token.IssuedScopeCatalog, token.Scopes) {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_REVOKED, ActionHint: "reauthorize_with_active_scopes"}, nil
	}
	if hasRealmScope(req.GetRequestedScopes()) {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, ActionHint: "route_realm_scopes_via_realm_domain"}, nil
	}
	if !scopesAllowed(token.Scopes, req.GetRequestedScopes()) {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, ActionHint: "request_allowed_scopes_only"}, nil
	}
	if !selectorsWithin(token.ResourceSelectors, req.GetResourceSelectors()) {
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_RESOURCE_OUT_OF_SCOPE, ActionHint: "request_resources_within_selector"}, nil
	}

	return &runtimev1.ValidateAppAccessTokenResponse{
		Valid:                     true,
		ReasonCode:                runtimev1.ReasonCode_ACTION_EXECUTED,
		EffectiveScopes:           append([]string(nil), token.Scopes...),
		PolicyVersion:             token.PolicyVersion,
		IssuedScopeCatalogVersion: token.IssuedScopeCatalog,
		ActionHint:                "none",
	}, nil
}

func (s *Service) RevokeAppAccessToken(_ context.Context, req *runtimev1.RevokeAppAccessTokenRequest) (*runtimev1.Ack, error) {
	tokenID := strings.TrimSpace(req.GetTokenId())
	if tokenID == "" {
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set token_id"}, nil
	}

	s.mu.Lock()
	_, exists := s.tokens[tokenID]
	if exists {
		s.cascadeRevokeLocked(tokenID)
	}
	s.mu.Unlock()

	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) IssueDelegatedAccessToken(_ context.Context, req *runtimev1.IssueDelegatedAccessTokenRequest) (*runtimev1.IssueDelegatedAccessTokenResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	parentID := strings.TrimSpace(req.GetParentTokenId())
	if appID == "" || parentID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	parent, exists := s.tokens[parentID]
	if !exists || parent.AppID != appID {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	if parent.Revoked {
		return nil, status.Error(codes.PermissionDenied, runtimev1.ReasonCode_APP_TOKEN_REVOKED.String())
	}
	if time.Now().UTC().After(parent.ExpiresAt) {
		return nil, status.Error(codes.PermissionDenied, runtimev1.ReasonCode_APP_TOKEN_EXPIRED.String())
	}
	if !parent.CanDelegate {
		return nil, status.Error(codes.PermissionDenied, runtimev1.ReasonCode_APP_DELEGATION_FORBIDDEN.String())
	}

	childDepth := parent.DelegationDepth + 1
	if parent.MaxDelegationDepth > 0 && childDepth > parent.MaxDelegationDepth {
		return nil, status.Error(codes.PermissionDenied, runtimev1.ReasonCode_APP_DELEGATION_DEPTH_EXCEEDED.String())
	}

	scopes := req.GetScopes()
	if len(scopes) == 0 {
		scopes = append([]string(nil), parent.Scopes...)
	}
	if !scopesAllowed(parent.Scopes, scopes) {
		return nil, status.Error(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN.String())
	}
	if hasRealmScope(scopes) {
		return nil, status.Error(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN.String())
	}
	if validation := s.catalog.ValidateScopes(parent.IssuedScopeCatalog, scopes); validation != runtimev1.ReasonCode_ACTION_EXECUTED {
		return nil, status.Error(codes.PermissionDenied, validation.String())
	}

	selectors := cloneSelectors(req.GetResourceSelectors())
	if selectors == nil {
		selectors = cloneSelectors(parent.ResourceSelectors)
	}
	if !selectorsWithin(parent.ResourceSelectors, selectors) {
		return nil, status.Error(codes.PermissionDenied, runtimev1.ReasonCode_APP_RESOURCE_OUT_OF_SCOPE.String())
	}

	now := time.Now().UTC()
	expiresAt := now.Add(resolveTTL(req.GetTtlSeconds(), 1800))
	if expiresAt.After(parent.ExpiresAt) {
		expiresAt = parent.ExpiresAt
	}

	tokenID := ulid.Make().String()
	secret := ulid.Make().String()
	childCanDelegate := parent.CanDelegate && parent.MaxDelegationDepth > 1 && childDepth < parent.MaxDelegationDepth
	child := tokenRecord{
		TokenID:             tokenID,
		AppID:               parent.AppID,
		SubjectUserID:       parent.SubjectUserID,
		ExternalPrincipalID: parent.ExternalPrincipalID,
		PolicyVersion:       parent.PolicyVersion,
		IssuedScopeCatalog:  parent.IssuedScopeCatalog,
		Scopes:              append([]string(nil), scopes...),
		ResourceSelectors:   selectors,
		CanDelegate:         childCanDelegate,
		MaxDelegationDepth:  parent.MaxDelegationDepth,
		DelegationDepth:     childDepth,
		ParentTokenID:       parent.TokenID,
		ConsentRef:          cloneConsent(parent.ConsentRef),
		IssuedAt:            now,
		ExpiresAt:           expiresAt,
		Secret:              secret,
		Revoked:             false,
	}

	s.tokens[tokenID] = child
	key := policyKey(parent.AppID, parent.SubjectUserID, parent.ExternalPrincipalID)
	if s.policyTokens[key] == nil {
		s.policyTokens[key] = make(map[string]bool)
	}
	s.policyTokens[key][tokenID] = true

	return &runtimev1.IssueDelegatedAccessTokenResponse{
		TokenId:         tokenID,
		ParentTokenId:   parent.TokenID,
		EffectiveScopes: append([]string(nil), child.Scopes...),
		ExpiresAt:       timestamppb.New(child.ExpiresAt),
		Secret:          child.Secret,
	}, nil
}

func (s *Service) ListTokenChain(_ context.Context, req *runtimev1.ListTokenChainRequest) (*runtimev1.ListTokenChainResponse, error) {
	root := strings.TrimSpace(req.GetRootTokenId())
	if root == "" {
		return &runtimev1.ListTokenChainResponse{Nodes: []*runtimev1.TokenChainNode{}}, nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	queue := []string{root}
	visited := map[string]bool{}
	nodes := make([]*runtimev1.TokenChainNode, 0)

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if visited[current] {
			continue
		}
		visited[current] = true

		token, exists := s.tokens[current]
		if !exists {
			continue
		}

		nodes = append(nodes, &runtimev1.TokenChainNode{
			TokenId:                   token.TokenID,
			ParentTokenId:             token.ParentTokenID,
			ExternalPrincipalId:       token.ExternalPrincipalID,
			PolicyVersion:             token.PolicyVersion,
			IssuedScopeCatalogVersion: token.IssuedScopeCatalog,
			IssuedAt:                  timestamppb.New(token.IssuedAt),
			ExpiresAt:                 timestamppb.New(token.ExpiresAt),
		})

		for childID, child := range s.tokens {
			if child.ParentTokenID == token.TokenID {
				queue = append(queue, childID)
			}
		}
	}

	sort.Slice(nodes, func(i, j int) bool {
		left := nodes[i].GetIssuedAt().AsTime()
		right := nodes[j].GetIssuedAt().AsTime()
		if left.Equal(right) {
			return nodes[i].GetTokenId() < nodes[j].GetTokenId()
		}
		return left.Before(right)
	})

	return &runtimev1.ListTokenChainResponse{Nodes: nodes}, nil
}

// ValidateProtectedCapability validates metadata-delivered token credentials for protected runtime actions.
