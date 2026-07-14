package account

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

// VerifyRuntimePresence is an internal owner bridge for protected Runtime
// operations. It returns only an opaque evidence reference and expiry; neither
// value is a credential and the method is not registered as an RPC.
func (s *Service) VerifyRuntimePresence(ctx context.Context, purpose string) (string, time.Time, error) {
	normalizedPurpose := strings.TrimSpace(purpose)
	if s == nil || normalizedPurpose == "" || normalizedPurpose != purpose || !s.isActivated() {
		return "", time.Time{}, ErrPresenceVerificationUnavailable
	}
	s.mu.RLock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || s.projection == nil {
		s.mu.RUnlock()
		return "", time.Time{}, ErrNoStoredAccount
	}
	account := presenceVerificationAccountContext(s.material)
	s.mu.RUnlock()
	result, err := s.presenceVerifier.RequestPresenceVerification(ctx, PresenceVerificationRequest{
		Account: account, Purpose: normalizedPurpose, RequestedTTL: maxPresenceVerificationTTL, Now: s.now().UTC(),
	})
	if err != nil || result.State != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED ||
		result.Method == runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_UNSPECIFIED ||
		!result.VerifiedUntil.After(s.now().UTC()) {
		return "", time.Time{}, ErrPresenceVerificationUnavailable
	}
	return fmt.Sprintf("presence:v1:%s", ulid.Make().String()), result.VerifiedUntil.UTC(), nil
}
