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
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
		runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL:
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
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP:
		if s.registry == nil || !s.registry.AdmitLocalFirstPartyInstance(caller.GetAppId(), caller.GetAppInstanceId()) {
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
		}
		if reason, ok := s.validateLocalCallerAppSession(ctx, caller); !ok {
			return reason, false
		}
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

func (s *Service) validateWorkspaceBindingCaller(caller *runtimev1.AccountCaller) (runtimev1.AccountReasonCode, bool) {
	if caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP ||
		s.registry == nil || !s.registry.AdmitLocalFirstPartyInstance(caller.GetAppId(), caller.GetAppInstanceId()) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	deviceID := strings.TrimSpace(caller.GetDeviceId())
	if deviceID == "" {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	record, ok := s.registry.Get(caller.GetAppId())
	if !ok {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	instance, ok := record.Instances[strings.TrimSpace(caller.GetAppInstanceId())]
	if !ok || strings.TrimSpace(instance.DeviceID) == "" || strings.TrimSpace(instance.DeviceID) != deviceID {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func (s *Service) deriveWorkspaceBindingResolverCaller(caller *runtimev1.AccountCaller) (*runtimev1.AccountCaller, bool) {
	if caller.GetMode() != runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP ||
		s.registry == nil || !s.registry.AdmitLocalFirstPartyInstance(caller.GetAppId(), caller.GetAppInstanceId()) {
		return nil, false
	}
	record, ok := s.registry.Get(caller.GetAppId())
	if !ok {
		return nil, false
	}
	instance, ok := record.Instances[strings.TrimSpace(caller.GetAppInstanceId())]
	if !ok {
		return nil, false
	}
	registeredDeviceID := strings.TrimSpace(instance.DeviceID)
	if registeredDeviceID == "" {
		return nil, false
	}
	if callerDeviceID := strings.TrimSpace(caller.GetDeviceId()); callerDeviceID != "" && callerDeviceID != registeredDeviceID {
		return nil, false
	}
	return &runtimev1.AccountCaller{
		AppId:         strings.TrimSpace(caller.GetAppId()),
		AppInstanceId: strings.TrimSpace(caller.GetAppInstanceId()),
		DeviceId:      registeredDeviceID,
		Mode:          caller.GetMode(),
	}, true
}

func normalizeMaterial(material AccountMaterial) AccountMaterial {
	material.AccountID = strings.TrimSpace(material.AccountID)
	material.DisplayName = strings.TrimSpace(material.DisplayName)
	material.RealmEnvironmentID = strings.TrimSpace(material.RealmEnvironmentID)
	material.WorkspaceMemberships = normalizeWorkspaceMemberships(material.WorkspaceMemberships)
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

func cloneWorkspaceRelation(in *runtimev1.WorkspaceBindingRelation) *runtimev1.WorkspaceBindingRelation {
	if in == nil {
		return nil
	}
	return &runtimev1.WorkspaceBindingRelation{
		BindingId:          in.GetBindingId(),
		RuntimeAppId:       in.GetRuntimeAppId(),
		AppInstanceId:      in.GetAppInstanceId(),
		DeviceId:           in.GetDeviceId(),
		AccountId:          in.GetAccountId(),
		RealmEnvironmentId: in.GetRealmEnvironmentId(),
		WorkspaceId:        in.GetWorkspaceId(),
		Purpose:            in.GetPurpose(),
		Scopes:             append([]string(nil), in.GetScopes()...),
		IssuedAt:           in.GetIssuedAt(),
		ExpiresAt:          in.GetExpiresAt(),
		State:              in.GetState(),
		ReasonCode:         in.GetReasonCode(),
	}
}

func cloneWorkspaceAttachment(in *runtimev1.WorkspaceBindingAttachment) *runtimev1.WorkspaceBindingAttachment {
	if in == nil {
		return nil
	}
	return &runtimev1.WorkspaceBindingAttachment{
		BindingId:          in.GetBindingId(),
		BindingHandle:      in.GetBindingHandle(),
		RuntimeAppId:       in.GetRuntimeAppId(),
		AppInstanceId:      in.GetAppInstanceId(),
		WorkspaceId:        in.GetWorkspaceId(),
		RealmEnvironmentId: in.GetRealmEnvironmentId(),
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
		BindingId:       in.GetBindingId(),
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
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY:
		return runtimev1.ReasonCode_APP_GRANT_INVALID
	default:
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED
	}
}

func workspaceBindingAccountReason(reason runtimev1.ReasonCode) runtimev1.AccountReasonCode {
	switch reason {
	case runtimev1.ReasonCode_ACTION_EXECUTED:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED
	case runtimev1.ReasonCode_WORKSPACE_BINDING_NOT_FOUND:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND
	case runtimev1.ReasonCode_WORKSPACE_BINDING_REPLAY:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY
	case runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE
	case runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH,
		runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED
	default:
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE
	}
}

func workspaceScopeAdmitted(scope string) bool {
	switch strings.TrimSpace(scope) {
	case "runtime.knowledge.read", "runtime.knowledge.write", "runtime.knowledge.admin":
		return true
	default:
		return false
	}
}

func workspaceScopesValid(scopes []string) bool {
	if len(scopes) == 0 {
		return false
	}
	seen := make(map[string]bool)
	for _, scope := range scopes {
		trimmed := strings.TrimSpace(scope)
		if !workspaceScopeAdmitted(trimmed) || seen[trimmed] {
			return false
		}
		seen[trimmed] = true
	}
	return true
}

func normalizeWorkspaceScopes(scopes []string) []string {
	out := make([]string, 0, len(scopes))
	seen := make(map[string]bool)
	for _, scope := range scopes {
		trimmed := strings.TrimSpace(scope)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		out = append(out, trimmed)
	}
	return out
}

func workspaceScopeCovers(granted []string, required string) bool {
	required = strings.TrimSpace(required)
	if required == "" {
		return false
	}
	for _, scope := range granted {
		switch strings.TrimSpace(scope) {
		case required:
			return true
		case "runtime.knowledge.admin":
			if required == "runtime.knowledge.write" || required == "runtime.knowledge.read" {
				return true
			}
		case "runtime.knowledge.write":
			if required == "runtime.knowledge.read" {
				return true
			}
		}
	}
	return false
}

func workspaceScopesCover(granted []string, required []string) bool {
	if len(required) == 0 {
		return false
	}
	for _, scope := range required {
		if !workspaceScopeCovers(granted, scope) {
			return false
		}
	}
	return true
}
