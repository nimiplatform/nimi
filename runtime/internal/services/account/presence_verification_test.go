package account

import (
	"context"
	"reflect"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type staticPresenceVerifier struct {
	result        PresenceVerification
	err           error
	seen          PresenceVerificationRequest
	calls         int
	launcherBound bool
}

func (s *staticPresenceVerifier) RequestPresenceVerification(ctx context.Context, request PresenceVerificationRequest) (PresenceVerification, error) {
	s.calls++
	s.seen = request
	s.launcherBound = presenceBrowserLauncherFromContext(ctx) != nil
	if s.err != nil {
		return PresenceVerification{}, s.err
	}
	return s.result, nil
}

func TestRequestPresenceVerificationFailsClosedWhenRuntimeIsInert(t *testing.T) {
	svc := New(nil)

	resp, err := svc.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
		Caller:     firstPartyCaller(),
		Purpose:    "shijing.profile.reveal",
		TtlSeconds: 120,
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if resp.GetAccepted() || !resp.GetProductionInert() {
		t.Fatalf("response = %+v, want inert rejection", resp)
	}
	if resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED {
		t.Fatalf("account reason = %v, want inert not activated", resp.GetAccountReasonCode())
	}
}

func TestRequestPresenceVerificationFailsClosedWithoutAuthenticatedAccount(t *testing.T) {
	svc := newHarnessService(t, nil)

	resp, err := svc.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
		Caller:     firstPartyCaller(),
		Purpose:    "shijing.profile.reveal",
		TtlSeconds: 120,
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if resp.GetAccepted() {
		t.Fatalf("accepted without authenticated account: %+v", resp)
	}
	if resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE {
		t.Fatalf("account reason = %v, want account unavailable", resp.GetAccountReasonCode())
	}
}

func TestRequestPresenceVerificationFailsClosedWithoutProvider(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)

	resp, err := svc.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
		Caller:     firstPartyCaller(),
		Purpose:    "shijing.profile.reveal",
		TtlSeconds: 120,
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if resp.GetAccepted() {
		t.Fatalf("accepted without a local presence provider: %+v", resp)
	}
	if resp.GetState() != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_UNAVAILABLE {
		t.Fatalf("state = %v, want unavailable", resp.GetState())
	}
	if resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PRESENCE_VERIFICATION_UNAVAILABLE {
		t.Fatalf("account reason = %v, want presence verification unavailable", resp.GetAccountReasonCode())
	}
}

func TestRequestPresenceVerificationRejectsMissingTTL(t *testing.T) {
	provider := &staticPresenceVerifier{
		result: PresenceVerification{
			State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
			Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
			VerifiedUntil: time.Now().UTC().Add(time.Minute),
		},
	}
	svc := newHarnessService(t, nil, WithPresenceVerifier(provider))
	completeLogin(t, svc)

	resp, err := svc.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
		Caller:  firstPartyCaller(),
		Purpose: "shijing.profile.reveal",
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if resp.GetAccepted() || resp.GetState() != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED {
		t.Fatalf("response = %+v, want rejected", resp)
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("reason = %v, want protocol invalid", resp.GetReasonCode())
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls = %d, want 0 for malformed ttl", provider.calls)
	}
}

func TestRequestPresenceVerificationFailsClosedForProviderNegativeResults(t *testing.T) {
	now := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name      string
		result    PresenceVerification
		wantState runtimev1.PresenceVerificationState
	}{
		{
			name: "rejected",
			result: PresenceVerification{
				State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
				Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
				VerifiedUntil: now.Add(time.Minute),
			},
			wantState: runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
		},
		{
			name: "unavailable",
			result: PresenceVerification{
				State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_UNAVAILABLE,
				Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
				VerifiedUntil: now.Add(time.Minute),
			},
			wantState: runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_UNAVAILABLE,
		},
		{
			name: "unspecified method",
			result: PresenceVerification{
				State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
				Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_UNSPECIFIED,
				VerifiedUntil: now.Add(time.Minute),
			},
			wantState: runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
		},
		{
			name: "expired verification",
			result: PresenceVerification{
				State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
				Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
				VerifiedUntil: now.Add(-time.Second),
			},
			wantState: runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := &staticPresenceVerifier{result: tc.result}
			material := testMaterial("acct-1", "access-1", "refresh-1")
			material.AccessTokenExpires = now.Add(5 * time.Minute)
			svc := newHarnessService(
				t,
				nil,
				WithClock(func() time.Time { return now }),
				WithLoginExchanger(staticExchanger{material: material}),
				WithPresenceVerifier(provider),
			)
			completeLogin(t, svc)

			resp, err := svc.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
				Caller:     firstPartyCaller(),
				Purpose:    "shijing.profile.reveal",
				TtlSeconds: 120,
			})
			if err != nil {
				t.Fatalf("RequestPresenceVerification: %v", err)
			}
			if resp.GetAccepted() || resp.GetState() != tc.wantState {
				t.Fatalf("response = %+v, want state %v and accepted=false", resp, tc.wantState)
			}
			if resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PRESENCE_VERIFICATION_UNAVAILABLE {
				t.Fatalf("account reason = %v, want presence unavailable", resp.GetAccountReasonCode())
			}
		})
	}
}

func TestRequestPresenceVerificationDoesNotCallProviderForExpiredAccountMaterial(t *testing.T) {
	now := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC)
	provider := &staticPresenceVerifier{
		result: PresenceVerification{
			State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
			Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
			VerifiedUntil: now.Add(time.Minute),
		},
	}
	material := testMaterial("acct-1", "access-1", "refresh-1")
	material.AccessTokenExpires = now.Add(-time.Second)
	svc := newHarnessService(
		t,
		nil,
		WithClock(func() time.Time { return now }),
		WithLoginExchanger(staticExchanger{material: material}),
		WithPresenceVerifier(provider),
	)
	completeLogin(t, svc)

	resp, err := svc.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
		Caller:     firstPartyCaller(),
		Purpose:    "shijing.profile.reveal",
		TtlSeconds: 120,
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE {
		t.Fatalf("response = %+v, want account unavailable", resp)
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls = %d, want 0 for expired account material", provider.calls)
	}
}

func TestRequestPresenceVerificationUsesProviderForFreshPresence(t *testing.T) {
	now := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC)
	provider := &staticPresenceVerifier{
		result: PresenceVerification{
			State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
			Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
			VerifiedUntil: now.Add(10 * time.Minute),
		},
	}
	material := testMaterial("acct-1", "access-1", "refresh-1")
	material.AccessTokenExpires = now.Add(5 * time.Minute)
	svc := newHarnessService(
		t,
		nil,
		WithClock(func() time.Time { return now }),
		WithLoginExchanger(staticExchanger{material: material}),
		WithPresenceVerifier(provider),
	)
	completeLogin(t, svc)

	resp, err := svc.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
		Caller:     firstPartyCaller(),
		Purpose:    "shijing.profile.reveal",
		TtlSeconds: 120,
	})
	if err != nil {
		t.Fatalf("RequestPresenceVerification: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("presence verification rejected: %+v", resp)
	}
	if resp.GetState() != runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED {
		t.Fatalf("state = %v, want verified", resp.GetState())
	}
	if resp.GetMethod() != runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL {
		t.Fatalf("method = %v, want OS credential", resp.GetMethod())
	}
	if got, want := resp.GetVerifiedUntil().AsTime(), now.Add(120*time.Second); !got.Equal(want) {
		t.Fatalf("verified until = %s, want clamped %s", got, want)
	}
	if resp.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("account projection = %+v, want acct-1", resp.GetAccountProjection())
	}
	if provider.seen.Purpose != "shijing.profile.reveal" || provider.seen.RequestedTTL != 120*time.Second {
		t.Fatalf("provider request = %+v", provider.seen)
	}
	if provider.seen.Account.AccountID != "acct-1" {
		t.Fatalf("provider account = %+v, want acct-1", provider.seen.Account)
	}
	accountType := reflect.TypeOf(provider.seen.Account)
	for _, field := range []string{"AccessToken", "RefreshToken", "RefreshTokenHashes"} {
		if _, ok := accountType.FieldByName(field); ok {
			t.Fatalf("presence verifier account context exposes secret field %s", field)
		}
	}
}
