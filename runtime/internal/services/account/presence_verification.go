package account

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const maxPresenceVerificationTTL = 5 * time.Minute

func (s *Service) RequestPresenceVerification(ctx context.Context, req *runtimev1.RequestPresenceVerificationRequest) (*runtimev1.RequestPresenceVerificationResponse, error) {
	purpose := strings.TrimSpace(req.GetPurpose())
	if !s.isActivated() {
		return &runtimev1.RequestPresenceVerificationResponse{
			Accepted:          false,
			State:             runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_UNAVAILABLE,
			Purpose:           purpose,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED,
			ProductionInert:   true,
		}, nil
	}
	if purpose == "" {
		return &runtimev1.RequestPresenceVerificationResponse{
			Accepted:          false,
			State:             runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
			ReasonCode:        runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED,
		}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.RequestPresenceVerificationResponse{
			Accepted:          false,
			State:             runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
			Purpose:           purpose,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: reason,
		}, nil
	}

	now := s.now().UTC()
	ttl, ttlOK := presenceVerificationTTL(req.GetTtlSeconds())
	if !ttlOK {
		return &runtimev1.RequestPresenceVerificationResponse{
			Accepted:          false,
			State:             runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
			Purpose:           purpose,
			ReasonCode:        runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED,
		}, nil
	}
	s.mu.RLock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		s.accountMaterialExpiredLocked() ||
		strings.TrimSpace(s.material.AccountID) == "" {
		s.mu.RUnlock()
		return presenceVerificationUnavailableResponse(purpose, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE), nil
	}
	accountContext := presenceVerificationAccountContext(s.material)
	projection := cloneProjection(s.projection)
	s.mu.RUnlock()
	if projection == nil {
		return presenceVerificationUnavailableResponse(purpose, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE), nil
	}

	verifier := s.presenceVerifier
	if verifier == nil {
		return presenceVerificationUnavailableResponse(purpose, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PRESENCE_VERIFICATION_UNAVAILABLE), nil
	}
	result, err := verifier.RequestPresenceVerification(ctx, PresenceVerificationRequest{
		Caller:       cloneAccountCaller(req.GetCaller()),
		Account:      accountContext,
		Purpose:      purpose,
		RequestedTTL: ttl,
		Now:          now,
	})
	if err != nil {
		if errors.Is(err, ErrPresenceVerificationUnavailable) {
			return presenceVerificationUnavailableResponse(purpose, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PRESENCE_VERIFICATION_UNAVAILABLE), nil
		}
		return presenceVerificationUnavailableResponse(purpose, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PRESENCE_VERIFICATION_UNAVAILABLE), nil
	}
	if result.State != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED ||
		result.Method == runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_UNSPECIFIED {
		state := runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED
		if result.State == runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_UNAVAILABLE {
			state = runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_UNAVAILABLE
		}
		return &runtimev1.RequestPresenceVerificationResponse{
			Accepted:          false,
			State:             state,
			Method:            result.Method,
			Purpose:           purpose,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PRESENCE_VERIFICATION_UNAVAILABLE,
		}, nil
	}
	verifiedUntil := result.VerifiedUntil.UTC()
	if verifiedUntil.IsZero() || !verifiedUntil.After(now) {
		return &runtimev1.RequestPresenceVerificationResponse{
			Accepted:          false,
			State:             runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
			Method:            result.Method,
			Purpose:           purpose,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PRESENCE_VERIFICATION_UNAVAILABLE,
		}, nil
	}
	maxUntil := now.Add(ttl)
	if verifiedUntil.After(maxUntil) {
		verifiedUntil = maxUntil
	}
	return &runtimev1.RequestPresenceVerificationResponse{
		Accepted:          true,
		State:             runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
		Method:            result.Method,
		VerifiedUntil:     timestamppb.New(verifiedUntil),
		AccountProjection: projection,
		Purpose:           purpose,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func presenceVerificationTTL(seconds int32) (time.Duration, bool) {
	ttl := time.Duration(seconds) * time.Second
	if ttl <= 0 {
		return 0, false
	}
	if ttl > maxPresenceVerificationTTL {
		return maxPresenceVerificationTTL, true
	}
	return ttl, true
}

func presenceVerificationUnavailableResponse(purpose string, reason runtimev1.AccountReasonCode) *runtimev1.RequestPresenceVerificationResponse {
	return &runtimev1.RequestPresenceVerificationResponse{
		Accepted:          false,
		State:             runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_UNAVAILABLE,
		Purpose:           purpose,
		ReasonCode:        commonReason(reason),
		AccountReasonCode: reason,
	}
}

func cloneAccountCaller(in *runtimev1.AccountCaller) *runtimev1.AccountCaller {
	if in == nil {
		return nil
	}
	return &runtimev1.AccountCaller{
		AppId:         strings.TrimSpace(in.GetAppId()),
		AppInstanceId: strings.TrimSpace(in.GetAppInstanceId()),
		DeviceId:      strings.TrimSpace(in.GetDeviceId()),
		Mode:          in.GetMode(),
		Scopes:        append([]string(nil), in.GetScopes()...),
	}
}

func presenceVerificationAccountContext(in AccountMaterial) PresenceVerificationAccountContext {
	return PresenceVerificationAccountContext{
		AccountID:            strings.TrimSpace(in.AccountID),
		DisplayName:          strings.TrimSpace(in.DisplayName),
		RealmEnvironmentID:   strings.TrimSpace(in.RealmEnvironmentID),
		WorkspaceMemberships: cloneWorkspaceMemberships(in.WorkspaceMemberships),
	}
}
