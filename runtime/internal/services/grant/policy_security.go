package grant

import (
	"crypto/subtle"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) ValidateProtectedCapability(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, bool) {
	appID = strings.TrimSpace(appID)
	tokenID = strings.TrimSpace(tokenID)
	capability = strings.TrimSpace(capability)
	if appID == "" || tokenID == "" || secret == "" || capability == "" {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, "provide_access_token_credentials", false
	}

	now := time.Now().UTC()
	s.mu.RLock()
	defer s.mu.RUnlock()

	token, exists := s.tokens[tokenID]
	if !exists || token.AppID != appID {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, "issue_protected_token_for_target_app", false
	}
	if subtle.ConstantTimeCompare([]byte(token.Secret), []byte(secret)) != 1 {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, "use_valid_token_secret", false
	}
	if token.Revoked {
		return runtimev1.ReasonCode_APP_TOKEN_REVOKED, "reauthorize_external_principal", false
	}
	if now.After(token.ExpiresAt) {
		return runtimev1.ReasonCode_APP_TOKEN_EXPIRED, "refresh_authorization", false
	}
	currentPolicyVersion := s.policyIndex[policyKey(token.AppID, token.SubjectUserID, token.ExternalPrincipalID)]
	if currentPolicyVersion != "" && token.PolicyVersion != currentPolicyVersion {
		return runtimev1.ReasonCode_APP_GRANT_INVALID, "refresh_authorization_policy", false
	}
	if !scopesAllowed(token.Scopes, []string{capability}) {
		return runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, "authorize_missing_protected_scope", false
	}
	return runtimev1.ReasonCode_ACTION_EXECUTED, "none", true
}

func (s *Service) revokePolicyChainLocked(policyKeyValue string) {
	ids := s.policyTokens[policyKeyValue]
	for tokenID := range ids {
		s.cascadeRevokeLocked(tokenID)
	}
}

func (s *Service) cascadeRevokeLocked(tokenID string) {
	token, exists := s.tokens[tokenID]
	if !exists || token.Revoked {
		return
	}
	token.Revoked = true
	s.tokens[tokenID] = token
	for childID := range s.parentChildren[tokenID] {
		s.cascadeRevokeLocked(childID)
	}
}

func policyKey(appID string, subjectUserID string, externalID string) string {
	return strings.TrimSpace(appID) + "::" + strings.TrimSpace(subjectUserID) + "::" + strings.TrimSpace(externalID)
}
