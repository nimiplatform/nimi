package grant

import (
	"context"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func (s *Service) AuthorizeExternalPrincipal(ctx context.Context, req *runtimev1.AuthorizeExternalPrincipalRequest) (*runtimev1.AuthorizeExternalPrincipalResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	externalID := strings.TrimSpace(req.GetExternalPrincipalId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	if appID == "" || externalID == "" || subjectUserID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	if strings.TrimSpace(req.GetConsentId()) == "" || strings.TrimSpace(req.GetConsentVersion()) == "" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_CONSENT_MISSING)
	}
	if req.GetDecisionAt() == nil || req.GetDecisionAt().AsTime().IsZero() {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_CONSENT_INVALID)
	}

	record, exists := s.registry.Get(appID)
	if !exists {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_NOT_REGISTERED)
	}

	policyMode := req.GetPolicyMode()
	switch policyMode {
	case runtimev1.PolicyMode_POLICY_MODE_PRESET:
		if req.GetPreset() == runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_UNSPECIFIED {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_GRANT_INVALID)
		}
		if len(normalizeScopes(req.GetScopes())) > 0 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_GRANT_INVALID)
		}
	case runtimev1.PolicyMode_POLICY_MODE_CUSTOM:
		if len(normalizeScopes(req.GetScopes())) == 0 || req.GetResourceSelectors() == nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_GRANT_INVALID)
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_GRANT_INVALID)
	}

	effectiveScopes := resolveScopes(req)
	if len(effectiveScopes) == 0 {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if hasInvalidScopePrefix(effectiveScopes) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if hasRealmScope(effectiveScopes) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}

	if reasonCode, actionHint, ok := appregistry.ValidateDomainAndScopes(record.Manifest, req.GetDomain(), effectiveScopes); !ok {
		return nil, grpcerr.WithReasonCodeOptions(codes.PermissionDenied, reasonCode, grpcerr.ReasonOptions{
			ActionHint: actionHint,
		})
	}

	scopeCatalogVersion := strings.TrimSpace(req.GetScopeCatalogVersion())
	if scopeCatalogVersion == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED)
	}
	scopeValidation := s.catalog.ValidateScopes(scopeCatalogVersion, effectiveScopes)
	if scopeValidation != runtimev1.ReasonCode_ACTION_EXECUTED {
		return nil, grpcerr.WithReasonCodeOptions(codes.PermissionDenied, scopeValidation, grpcerr.ReasonOptions{
			ActionHint: scopeValidationActionHint(scopeValidation),
		})
	}

	issuedAt := time.Now().UTC()
	ttl, err := resolveTTL(req.GetTtlSeconds(), 3600, s.ttlMinSeconds, s.ttlMaxSeconds)
	if err != nil {
		return nil, err
	}
	expiresAt := issuedAt.Add(ttl)
	tokenID := ulid.Make().String()
	secret, err := generateTokenSecret()
	if err != nil {
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL.String())
	}

	policyVersion := strings.TrimSpace(req.GetPolicyVersion())
	if policyVersion == "" {
		policyVersion = "v1"
	}

	canDelegate := req.GetCanDelegate()
	maxDepth := req.GetMaxDelegationDepth()
	if req.GetPolicyMode() == runtimev1.PolicyMode_POLICY_MODE_PRESET && req.GetPreset() == runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_DELEGATE {
		canDelegate = true
		if maxDepth <= 0 {
			maxDepth = 1
		}
	}
	// K-GRANT-005: cap delegation depth against configured maximum.
	if maxDepth <= 0 {
		maxDepth = s.maxDelegationDepth
	} else if maxDepth > s.maxDelegationDepth {
		maxDepth = s.maxDelegationDepth
	}
	if !canDelegate {
		maxDepth = 0
	}

	policyKey := policyKey(appID, subjectUserID, externalID)

	s.mu.Lock()
	if currentPolicyVersion, ok := s.policyIndex[policyKey]; ok && currentPolicyVersion != policyVersion {
		s.revokePolicyChainLocked(policyKey)
	}
	s.policyIndex[policyKey] = policyVersion

	recordToken := tokenRecord{
		TokenID:             tokenID,
		AppID:               appID,
		SubjectUserID:       subjectUserID,
		ExternalPrincipalID: externalID,
		PolicyVersion:       policyVersion,
		IssuedScopeCatalog:  scopeCatalogVersion,
		Scopes:              append([]string(nil), effectiveScopes...),
		ResourceSelectors:   cloneSelectors(req.GetResourceSelectors()),
		CanDelegate:         canDelegate,
		MaxDelegationDepth:  maxDepth,
		DelegationDepth:     0,
		ParentTokenID:       "",
		ConsentRef: &runtimev1.ConsentRef{
			SubjectUserId:  subjectUserID,
			ConsentId:      strings.TrimSpace(req.GetConsentId()),
			ConsentVersion: strings.TrimSpace(req.GetConsentVersion()),
		},
		IssuedAt:  issuedAt,
		ExpiresAt: expiresAt,
		Secret:    secret,
		Revoked:   false,
	}
	s.tokens[tokenID] = recordToken
	if s.policyTokens[policyKey] == nil {
		s.policyTokens[policyKey] = make(map[string]bool)
	}
	s.policyTokens[policyKey][tokenID] = true
	s.mu.Unlock()

	s.emitAudit(ctx, "AuthorizeExternalPrincipal", appID, subjectUserID, runtimev1.ReasonCode_ACTION_EXECUTED)
	s.logger.Info("token authorized", "token_id", tokenID, "app_id", appID, "external_principal_id", externalID)

	return &runtimev1.AuthorizeExternalPrincipalResponse{
		TokenId:                   tokenID,
		AppId:                     appID,
		SubjectUserId:             subjectUserID,
		ExternalPrincipalId:       externalID,
		EffectiveScopes:           append([]string(nil), recordToken.Scopes...),
		ResourceSelectors:         cloneSelectors(recordToken.ResourceSelectors),
		ConsentRef:                cloneConsent(recordToken.ConsentRef),
		PolicyVersion:             recordToken.PolicyVersion,
		IssuedScopeCatalogVersion: recordToken.IssuedScopeCatalog,
		CanDelegate:               recordToken.CanDelegate,
		ExpiresAt:                 timestamppb.New(recordToken.ExpiresAt),
		Secret:                    recordToken.Secret,
	}, nil
}
