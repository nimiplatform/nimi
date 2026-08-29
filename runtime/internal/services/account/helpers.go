package account

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"github.com/oklog/ulid/v2"
)

const workspaceMembershipProjectionMaxAge = 15 * time.Minute

func validateProductionCaller(caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	switch caller.GetMode() {
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL:
		if strings.TrimSpace(caller.GetAppId()) == "" || strings.TrimSpace(caller.GetAppInstanceId()) == "" {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_AVATAR_NATIVE_HOST:
		if strings.TrimSpace(caller.GetAppId()) != bundledavatar.AppID ||
			strings.TrimSpace(caller.GetAppInstanceId()) != bundledavatar.AppInstanceID ||
			strings.TrimSpace(caller.GetDeviceId()) != bundledavatar.DeviceID {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
		}
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
	default:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
}

func (s *Service) validateRuntimeAdmittedCaller(ctx context.Context, caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	reason, ok := validateProductionCaller(caller)
	if !ok {
		return reason, false
	}
	switch caller.GetMode() {
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL:
		if reason, ok := s.validateDesktopAccountHost(ctx, caller); !ok {
			return reason, false
		}
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_AVATAR_NATIVE_HOST:
		if !envelope.HasValidatedProtectedCapability(ctx, bundledavatar.AppID, "account.session.read") &&
			!envelope.HasValidatedProtectedCapability(ctx, bundledavatar.AppID, "account.realm.read") {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH, false
		}
	default:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func (s *Service) validateProtectedDesktopAccountStatusCaller(ctx context.Context, caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	if caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL {
		return s.validateRuntimeAdmittedCaller(ctx, caller)
	}
	reason, ok := validateProductionCaller(caller)
	if !ok {
		return reason, false
	}
	return s.validateDesktopAccountHost(ctx, caller)
}

func (s *Service) validateRuntimeAccountControlCaller(ctx context.Context, caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	reason, ok := validateProductionCaller(caller)
	if !ok {
		return reason, false
	}
	if caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	if reason, ok := s.validateDesktopAccountHost(ctx, caller); !ok {
		return reason, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func normalizeMaterial(material AccountMaterial) AccountMaterial {
	material.AccountID = strings.TrimSpace(material.AccountID)
	material.DisplayName = strings.TrimSpace(material.DisplayName)
	material.CurrentUserHandle = strings.TrimSpace(material.CurrentUserHandle)
	if material.CurrentUserAvatarURL != nil {
		avatarURL := strings.TrimSpace(*material.CurrentUserAvatarURL)
		if avatarURL == "" {
			material.CurrentUserAvatarURL = nil
		} else {
			material.CurrentUserAvatarURL = &avatarURL
		}
	}
	material.RealmEnvironmentID = strings.TrimSpace(material.RealmEnvironmentID)
	material.RealmOrigin = strings.TrimRight(strings.TrimSpace(material.RealmOrigin), "/")
	material.WorkspaceMemberships = normalizeWorkspaceMemberships(material.WorkspaceMemberships)
	material.AccessToken = strings.TrimSpace(material.AccessToken)
	material.RefreshToken = strings.TrimSpace(material.RefreshToken)
	if material.AccessTokenExpires.IsZero() {
		material.AccessTokenExpires = time.Now().UTC().Add(5 * time.Minute)
	}
	material.RefreshTokenHashes = copyRefreshHashes(material.RefreshTokenHashes)
	if material.pendingRealmDeletion != nil {
		pending := *material.pendingRealmDeletion
		material.pendingRealmDeletion = &pending
	}
	return material
}

func projectionFromMaterial(material AccountMaterial) *runtimev1.AccountProjection {
	return &runtimev1.AccountProjection{
		AccountId:            material.AccountID,
		DisplayName:          material.DisplayName,
		RealmEnvironmentId:   material.RealmEnvironmentID,
		WorkspaceMemberships: cloneWorkspaceMemberships(material.WorkspaceMemberships),
	}
}

func cloneProjection(in *runtimev1.AccountProjection) *runtimev1.AccountProjection {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountProjection{
		AccountId:            in.GetAccountId(),
		DisplayName:          in.GetDisplayName(),
		RealmEnvironmentId:   in.GetRealmEnvironmentId(),
		WorkspaceMemberships: cloneWorkspaceMemberships(in.GetWorkspaceMemberships()),
	}
}

func normalizeWorkspaceMemberships(in []*runtimev1.WorkspaceMembershipProjection) []*runtimev1.WorkspaceMembershipProjection {
	out := make([]*runtimev1.WorkspaceMembershipProjection, 0, len(in))
	for _, membership := range in {
		cloned := cloneWorkspaceMembership(membership)
		if cloned == nil {
			continue
		}
		cloned.WorkspaceId = strings.TrimSpace(cloned.GetWorkspaceId())
		cloned.RealmEnvironmentId = strings.TrimSpace(cloned.GetRealmEnvironmentId())
		if cloned.GetMembershipState() == runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_UNSPECIFIED {
			cloned.MembershipState = runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_UNKNOWN
		}
		if cloned.GetWorkspaceId() == "" {
			continue
		}
		out = append(out, cloned)
	}
	return out
}

func cloneWorkspaceMemberships(in []*runtimev1.WorkspaceMembershipProjection) []*runtimev1.WorkspaceMembershipProjection {
	if len(in) == 0 {
		return nil
	}
	out := make([]*runtimev1.WorkspaceMembershipProjection, 0, len(in))
	for _, membership := range in {
		if cloned := cloneWorkspaceMembership(membership); cloned != nil {
			out = append(out, cloned)
		}
	}
	return out
}

func cloneWorkspaceMembership(in *runtimev1.WorkspaceMembershipProjection) *runtimev1.WorkspaceMembershipProjection {
	if in == nil {
		return nil
	}
	metadata := make(map[string]string, len(in.GetDisplayMetadata()))
	for key, value := range in.GetDisplayMetadata() {
		if workspaceDisplayMetadataAllowed(key) {
			metadata[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return &runtimev1.WorkspaceMembershipProjection{
		WorkspaceId:        in.GetWorkspaceId(),
		MembershipState:    in.GetMembershipState(),
		RealmEnvironmentId: in.GetRealmEnvironmentId(),
		ObservedAt:         in.GetObservedAt(),
		DisplayMetadata:    metadata,
	}
}

func workspaceDisplayMetadataAllowed(key string) bool {
	switch strings.ToLower(strings.NewReplacer("-", "_", " ", "_").Replace(strings.TrimSpace(key))) {
	case "name", "display_name", "displayname", "slug", "icon", "icon_url", "iconurl", "color":
		return true
	default:
		return false
	}
}

func cloneEvent(in *runtimev1.AccountSessionEvent) *runtimev1.AccountSessionEvent {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountSessionEvent{
		EventId:         in.GetEventId(),
		Sequence:        in.GetSequence(),
		EmittedAt:       in.GetEmittedAt(),
		EventType:       in.GetEventType(),
		ReplayTruncated: in.GetReplayTruncated(),
		DeliveryKind:    in.GetDeliveryKind(),
		Snapshot:        cloneAccountSessionSnapshot(in.GetSnapshot()),
	}
}

func cloneAccountSessionSnapshot(in *runtimev1.AccountSessionSnapshot) *runtimev1.AccountSessionSnapshot {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountSessionSnapshot{
		Sequence:          in.GetSequence(),
		State:             in.GetState(),
		ReasonCode:        in.GetReasonCode(),
		AccountReasonCode: in.GetAccountReasonCode(),
		AccountProjection: cloneProjection(in.GetAccountProjection()),
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
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_AUTH_INVALID,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_DELETED,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS:
		return runtimev1.ReasonCode_AUTH_TOKEN_INVALID
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED:
		return runtimev1.ReasonCode_REALM_UNAVAILABLE
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_NOT_FOUND:
		return runtimev1.ReasonCode_REALM_NOT_FOUND
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONFLICT:
		return runtimev1.ReasonCode_REALM_CONFLICT
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_RATE_LIMITED:
		return runtimev1.ReasonCode_REALM_RATE_LIMITED
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_REJECTED:
		return runtimev1.ReasonCode_REALM_REQUEST_REJECTED
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID:
		return runtimev1.ReasonCode_REALM_CONTRACT_INVALID
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_FAILED:
		return runtimev1.ReasonCode_REALM_OPERATION_FAILED
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_FORBIDDEN:
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED
	default:
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED
	}
}
