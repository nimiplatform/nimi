package account

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func validateProductionCaller(caller *runtimev1.AccountCaller, tokenRequest bool) (runtimev1.AccountReasonCode, bool) {
	switch caller.GetMode() {
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
		runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL:
		if strings.TrimSpace(caller.GetAppId()) == "" || strings.TrimSpace(caller.GetAppInstanceId()) == "" {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_AVATAR_BINDING_ONLY, false
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_MOD:
		if tokenRequest {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_MOD_TOKEN_FORBIDDEN, false
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	default:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
}

func (s *Service) validateRuntimeAdmittedCaller(caller *runtimev1.AccountCaller, tokenRequest bool) (runtimev1.AccountReasonCode, bool) {
	reason, ok := validateProductionCaller(caller, tokenRequest)
	if !ok {
		return reason, false
	}
	if caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP &&
		caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if s.registry == nil || !s.registry.AdmitLocalFirstPartyInstance(caller.GetAppId(), caller.GetAppInstanceId()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func validateBindingCallerRelation(caller *runtimev1.AccountCaller, relation *runtimev1.ScopedAppBindingRelation) (runtimev1.AccountReasonCode, bool) {
	if caller == nil || relation == nil {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if strings.TrimSpace(caller.GetAppId()) != strings.TrimSpace(relation.GetRuntimeAppId()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if strings.TrimSpace(caller.GetAppInstanceId()) != strings.TrimSpace(relation.GetAppInstanceId()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if relation.GetPurpose() == runtimev1.ScopedAppBindingPurpose_SCOPED_APP_BINDING_PURPOSE_AVATAR_INTERACTION_CONSUME {
		if strings.TrimSpace(relation.GetAvatarInstanceId()) == "" ||
			strings.TrimSpace(relation.GetConversationAnchorId()) == "" ||
			strings.TrimSpace(relation.GetWindowId()) == "" {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
		}
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func bindingRevocationReasonForAccountState(state runtimev1.AccountSessionState) runtimev1.AccountReasonCode {
	switch state {
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE
	default:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE
	}
}

func normalizeMaterial(material AccountMaterial) AccountMaterial {
	material.AccountID = strings.TrimSpace(material.AccountID)
	material.DisplayName = strings.TrimSpace(material.DisplayName)
	material.RealmEnvironmentID = strings.TrimSpace(material.RealmEnvironmentID)
	material.AccessToken = strings.TrimSpace(material.AccessToken)
	material.RefreshToken = strings.TrimSpace(material.RefreshToken)
	if material.AccessTokenExpires.IsZero() {
		material.AccessTokenExpires = time.Now().UTC().Add(5 * time.Minute)
	}
	material.RefreshTokenHashes = copyRefreshHashes(material.RefreshTokenHashes)
	return material
}

func projectionFromMaterial(material AccountMaterial) *runtimev1.AccountProjection {
	return &runtimev1.AccountProjection{
		AccountId:          material.AccountID,
		DisplayName:        material.DisplayName,
		RealmEnvironmentId: material.RealmEnvironmentID,
	}
}

func cloneProjection(in *runtimev1.AccountProjection) *runtimev1.AccountProjection {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountProjection{
		AccountId:          in.GetAccountId(),
		DisplayName:        in.GetDisplayName(),
		RealmEnvironmentId: in.GetRealmEnvironmentId(),
	}
}

func cloneRelation(in *runtimev1.ScopedAppBindingRelation) *runtimev1.ScopedAppBindingRelation {
	if in == nil {
		return nil
	}
	return &runtimev1.ScopedAppBindingRelation{
		BindingId:            in.GetBindingId(),
		RuntimeAppId:         in.GetRuntimeAppId(),
		AppInstanceId:        in.GetAppInstanceId(),
		WindowId:             in.GetWindowId(),
		AvatarInstanceId:     in.GetAvatarInstanceId(),
		AgentId:              in.GetAgentId(),
		ConversationAnchorId: in.GetConversationAnchorId(),
		WorldId:              in.GetWorldId(),
		Purpose:              in.GetPurpose(),
		Scopes:               append([]string(nil), in.GetScopes()...),
		IssuedAt:             in.GetIssuedAt(),
		ExpiresAt:            in.GetExpiresAt(),
		State:                in.GetState(),
		ReasonCode:           in.GetReasonCode(),
	}
}

func cloneEvent(in *runtimev1.AccountSessionEvent) *runtimev1.AccountSessionEvent {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountSessionEvent{
		EventId:           in.GetEventId(),
		Sequence:          in.GetSequence(),
		EmittedAt:         in.GetEmittedAt(),
		EventType:         in.GetEventType(),
		State:             in.GetState(),
		ReasonCode:        in.GetReasonCode(),
		AccountReasonCode: in.GetAccountReasonCode(),
		AccountProjection: cloneProjection(in.GetAccountProjection()),
		BindingId:         in.GetBindingId(),
		BindingRelation:   cloneRelation(in.GetBindingRelation()),
		ReplayTruncated:   in.GetReplayTruncated(),
	}
}

func copyRefreshHashes(in map[string]bool) map[string]bool {
	out := make(map[string]bool)
	for key, value := range in {
		out[key] = value
	}
	return out
}

func refreshHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return ulid.Make().String()
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func commonReason(reason runtimev1.AccountReasonCode) runtimev1.ReasonCode {
	switch reason {
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED:
		return runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_CONSUMED,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE:
		return runtimev1.ReasonCode_AUTH_TOKEN_INVALID
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY:
		return runtimev1.ReasonCode_APP_GRANT_INVALID
	default:
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED
	}
}

func relationReplay(expected *runtimev1.ScopedAppBindingRelation, actual *runtimev1.ScopedAppBindingRelation) bool {
	if expected == nil || actual == nil {
		return true
	}
	return strings.TrimSpace(expected.GetRuntimeAppId()) != strings.TrimSpace(actual.GetRuntimeAppId()) ||
		strings.TrimSpace(expected.GetAppInstanceId()) != strings.TrimSpace(actual.GetAppInstanceId()) ||
		strings.TrimSpace(expected.GetWindowId()) != strings.TrimSpace(actual.GetWindowId()) ||
		strings.TrimSpace(expected.GetAvatarInstanceId()) != strings.TrimSpace(actual.GetAvatarInstanceId()) ||
		strings.TrimSpace(expected.GetAgentId()) != strings.TrimSpace(actual.GetAgentId()) ||
		strings.TrimSpace(expected.GetConversationAnchorId()) != strings.TrimSpace(actual.GetConversationAnchorId()) ||
		strings.TrimSpace(expected.GetWorldId()) != strings.TrimSpace(actual.GetWorldId())
}

func scopeIncluded(scopes []string, required string) bool {
	for _, scope := range scopes {
		if strings.TrimSpace(scope) == required {
			return true
		}
	}
	return false
}
