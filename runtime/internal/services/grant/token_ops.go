package grant

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

func (s *Service) ValidateAppAccessToken(ctx context.Context, req *runtimev1.ValidateAppAccessTokenRequest) (*runtimev1.ValidateAppAccessTokenResponse, error) {
	tokenID := strings.TrimSpace(req.GetTokenId())
	appID := strings.TrimSpace(req.GetAppId())
	if tokenID == "" || appID == "" {
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.ValidateAppAccessTokenResponse{
			Valid:      false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set_app_id_and_token_id",
		}, nil
	}

	now := time.Now().UTC()
	s.mu.RLock()
	token, exists := s.tokens[tokenID]

	if !exists || token.AppID != appID {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, "", runtimev1.ReasonCode_APP_GRANT_INVALID)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, ActionHint: "reauthorize_external_principal"}, nil
	}
	if token.Revoked {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_TOKEN_REVOKED)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_TOKEN_REVOKED, ActionHint: "reauthorize_external_principal"}, nil
	}
	if now.After(token.ExpiresAt) {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_TOKEN_EXPIRED)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_TOKEN_EXPIRED, ActionHint: "refresh_authorization"}, nil
	}
	currentPolicyVersion := s.policyIndex[policyKey(token.AppID, token.SubjectUserID, token.ExternalPrincipalID)]
	if currentPolicyVersion != "" && token.PolicyVersion != currentPolicyVersion {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_GRANT_INVALID)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, ActionHint: "refresh_authorization_policy"}, nil
	}
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	if subjectUserID != "" && subjectUserID != token.SubjectUserID {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, subjectUserID, runtimev1.ReasonCode_APP_GRANT_INVALID)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, ActionHint: "set_matching_subject_user_id"}, nil
	}
	if !s.catalog.IsPublished(token.IssuedScopeCatalog) {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED, ActionHint: "use_published_scope_catalog_version"}, nil
	}
	activeScopes := activeScopesForCatalog(token.IssuedScopeCatalog, token.Scopes, s.catalog.HasRevokedScope)
	if hasRealmScope(req.GetRequestedScopes()) {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, ActionHint: "route_realm_scopes_via_realm_domain"}, nil
	}
	if hasInvalidScopePrefix(req.GetRequestedScopes()) {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, ActionHint: "request_allowed_scopes_only"}, nil
	}
	if !scopesAllowed(activeScopes, req.GetRequestedScopes()) {
		s.mu.RUnlock()
		if scopesAllowed(token.Scopes, req.GetRequestedScopes()) {
			s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_SCOPE_REVOKED)
			return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_REVOKED, ActionHint: "reauthorize_with_active_scopes"}, nil
		}
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, ActionHint: "request_allowed_scopes_only"}, nil
	}
	if !selectorsWithin(token.ResourceSelectors, req.GetResourceSelectors()) {
		s.mu.RUnlock()
		s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_APP_RESOURCE_OUT_OF_SCOPE)
		return &runtimev1.ValidateAppAccessTokenResponse{Valid: false, ReasonCode: runtimev1.ReasonCode_APP_RESOURCE_OUT_OF_SCOPE, ActionHint: "request_resources_within_selector"}, nil
	}
	s.mu.RUnlock()

	s.emitAudit(ctx, "ValidateAppAccessToken", appID, token.SubjectUserID, runtimev1.ReasonCode_ACTION_EXECUTED)
	return &runtimev1.ValidateAppAccessTokenResponse{
		Valid:                     true,
		ReasonCode:                runtimev1.ReasonCode_ACTION_EXECUTED,
		EffectiveScopes:           activeScopes,
		PolicyVersion:             token.PolicyVersion,
		IssuedScopeCatalogVersion: token.IssuedScopeCatalog,
		ActionHint:                "none",
	}, nil
}

func (s *Service) RevokeAppAccessToken(ctx context.Context, req *runtimev1.RevokeAppAccessTokenRequest) (*runtimev1.Ack, error) {
	tokenID := strings.TrimSpace(req.GetTokenId())
	if tokenID == "" {
		s.emitAudit(ctx, "RevokeAppAccessToken", "", "", runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set token_id"}, nil
	}

	s.mu.Lock()
	token, exists := s.tokens[tokenID]
	if exists {
		s.cascadeRevokeLocked(tokenID)
	}
	s.mu.Unlock()

	s.emitAudit(ctx, "RevokeAppAccessToken", token.AppID, token.SubjectUserID, runtimev1.ReasonCode_ACTION_EXECUTED)
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) IssueDelegatedAccessToken(ctx context.Context, req *runtimev1.IssueDelegatedAccessTokenRequest) (*runtimev1.IssueDelegatedAccessTokenResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	parentID := strings.TrimSpace(req.GetParentTokenId())
	if appID == "" || parentID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	parent, exists := s.tokens[parentID]
	if !exists || parent.AppID != appID {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID)
	}
	if parent.Revoked {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_TOKEN_REVOKED)
	}
	if time.Now().UTC().After(parent.ExpiresAt) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_TOKEN_EXPIRED)
	}
	if !parent.CanDelegate {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_DELEGATION_FORBIDDEN)
	}

	childDepth := parent.DelegationDepth + 1
	if parent.MaxDelegationDepth > 0 && childDepth > parent.MaxDelegationDepth {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_DELEGATION_DEPTH_EXCEEDED)
	}

	scopes := req.GetScopes()
	if len(scopes) == 0 {
		scopes = append([]string(nil), parent.Scopes...)
	}
	if hasInvalidScopePrefix(scopes) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if !scopesAllowed(parent.Scopes, scopes) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if hasRealmScope(scopes) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if validation := s.catalog.ValidateScopes(parent.IssuedScopeCatalog, scopes); validation != runtimev1.ReasonCode_ACTION_EXECUTED {
		return nil, grpcerr.WithReasonCodeOptions(codes.PermissionDenied, validation, grpcerr.ReasonOptions{
			ActionHint: scopeValidationActionHint(validation),
		})
	}

	selectors := cloneSelectors(req.GetResourceSelectors())
	if selectors == nil {
		selectors = cloneSelectors(parent.ResourceSelectors)
	}
	if !selectorsWithin(parent.ResourceSelectors, selectors) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_RESOURCE_OUT_OF_SCOPE)
	}

	now := time.Now().UTC()
	delegateTTL, err := resolveTTL(req.GetTtlSeconds(), 1800, s.ttlMinSeconds, s.ttlMaxSeconds)
	if err != nil {
		return nil, err
	}
	expiresAt := now.Add(delegateTTL)
	if expiresAt.After(parent.ExpiresAt) {
		expiresAt = parent.ExpiresAt
	}

	tokenID := ulid.Make().String()
	secret, err := newTokenSecret()
	if err != nil {
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AUTH_TOKEN_INVALID.String())
	}
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

	s.emitAudit(ctx, "IssueDelegatedAccessToken", parent.AppID, parent.SubjectUserID, runtimev1.ReasonCode_ACTION_EXECUTED)
	return &runtimev1.IssueDelegatedAccessTokenResponse{
		TokenId:         tokenID,
		ParentTokenId:   parent.TokenID,
		EffectiveScopes: append([]string(nil), child.Scopes...),
		ExpiresAt:       timestamppb.New(child.ExpiresAt),
		Secret:          child.Secret,
	}, nil
}

func (s *Service) ListTokenChain(ctx context.Context, req *runtimev1.ListTokenChainRequest) (*runtimev1.ListTokenChainResponse, error) {
	root := strings.TrimSpace(req.GetRootTokenId())
	if root == "" {
		s.emitAudit(ctx, "ListTokenChain", "", "", runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_REQUIRED)
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_REQUIRED)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, exists := s.tokens[root]; !exists {
		s.emitAudit(ctx, "ListTokenChain", "", "", runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND)
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND)
	}

	appID := strings.TrimSpace(req.GetAppId())
	if appID != "" {
		rootToken := s.tokens[root]
		if rootToken.AppID != appID {
			s.emitAudit(ctx, "ListTokenChain", appID, "", runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND)
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND)
		}
	}

	includeRevoked := req.GetIncludeRevoked()
	filterDigest := pagination.FilterDigest(appID, root, strconv.FormatBool(includeRevoked))
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		s.emitAudit(ctx, "ListTokenChain", appID, "", runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
		return nil, err
	}

	queue := []string{root}
	visited := map[string]bool{}
	entries := make([]*runtimev1.TokenChainEntry, 0)

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

		if appID != "" && token.AppID != appID {
			continue
		}
		if !includeRevoked && token.Revoked {
			continue
		}

		principalID := token.ExternalPrincipalID
		principalType := "external_principal"
		if principalID == "" {
			principalID = token.SubjectUserID
			principalType = "subject_user"
		}

		entries = append(entries, &runtimev1.TokenChainEntry{
			TokenId:                   token.TokenID,
			ParentTokenId:             token.ParentTokenID,
			PrincipalId:               principalID,
			PrincipalType:             principalType,
			EffectiveScopes:           append([]string(nil), token.Scopes...),
			IssuedAt:                  timestamppb.New(token.IssuedAt),
			ExpiresAt:                 timestamppb.New(token.ExpiresAt),
			Revoked:                   token.Revoked,
			DelegationDepth:           token.DelegationDepth,
			PolicyVersion:             token.PolicyVersion,
			IssuedScopeCatalogVersion: token.IssuedScopeCatalog,
		})

		for childID, child := range s.tokens {
			if child.ParentTokenID == token.TokenID {
				queue = append(queue, childID)
			}
		}
	}

	// Sort by issued_at DESC (K-GRANT-012).
	sort.Slice(entries, func(i, j int) bool {
		left := entries[i].GetIssuedAt().AsTime()
		right := entries[j].GetIssuedAt().AsTime()
		if left.Equal(right) {
			return entries[i].GetTokenId() > entries[j].GetTokenId()
		}
		return left.After(right)
	})

	startIdx := 0
	if cursor != "" {
		if idx, convErr := strconv.Atoi(cursor); convErr == nil && idx >= 0 && idx <= len(entries) {
			startIdx = idx
		} else {
			s.emitAudit(ctx, "ListTokenChain", appID, "", runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
		}
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	} else if pageSize > 200 {
		pageSize = 200
	}
	endIdx := startIdx + pageSize
	if endIdx > len(entries) {
		endIdx = len(entries)
	}

	page := entries[startIdx:endIdx]
	hasMore := endIdx < len(entries)
	nextToken := ""
	if hasMore {
		nextToken = pagination.Encode(strconv.Itoa(endIdx), filterDigest)
	}

	s.emitAudit(ctx, "ListTokenChain", "", "", runtimev1.ReasonCode_ACTION_EXECUTED)
	return &runtimev1.ListTokenChainResponse{
		Entries:       page,
		NextPageToken: nextToken,
		HasMore:       hasMore,
	}, nil
}

// ValidateProtectedCapability validates metadata-delivered token credentials for protected runtime actions.
