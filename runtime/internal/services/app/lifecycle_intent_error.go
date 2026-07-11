package app

import (
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
)

func protectedLifecycleUnavailable() error {
	retryable := false
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE, grpcerr.ReasonOptions{
		ActionHint: "restart_runtime_service",
		Retryable:  &retryable,
	})
}

func lifecycleTargetMismatch(actionHint string) error {
	retryable := false
	return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, runtimev1.ReasonCode_LIFECYCLE_CHALLENGE_MISMATCH, grpcerr.ReasonOptions{
		ActionHint: actionHint,
		Retryable:  &retryable,
	})
}

func lifecycleIntentRequired() error {
	retryable := false
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_LIFECYCLE_INTENT_REQUIRED, grpcerr.ReasonOptions{
		ActionHint: "prepare_lifecycle_intent",
		Retryable:  &retryable,
	})
}

func lifecycleIntentMismatch(actionHint string) error {
	retryable := false
	return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, runtimev1.ReasonCode_LIFECYCLE_INTENT_MISMATCH, grpcerr.ReasonOptions{
		ActionHint: actionHint,
		Retryable:  &retryable,
	})
}

func protectedLifecycleIntentError(err error) error {
	var failure *protectedlocal.Failure
	if !errors.As(err, &failure) {
		return protectedLifecycleUnavailable()
	}
	reasonValue, ok := runtimev1.ReasonCode_value[string(failure.Reason())]
	if !ok {
		return protectedLifecycleUnavailable()
	}
	retryable := failure.Retryable()
	return grpcerr.WithReasonCodeOptions(protectedLifecycleIntentCode(failure.Reason()), runtimev1.ReasonCode(reasonValue), grpcerr.ReasonOptions{
		ActionHint: failure.ActionHint(),
		Retryable:  &retryable,
	})
}

func protectedLifecycleIntentCode(reason protectedlocal.Reason) codes.Code {
	switch reason {
	case protectedlocal.ReasonDesktopControlTransportRequired,
		protectedlocal.ReasonDesktopExecutableTrustFailed,
		protectedlocal.ReasonProtectedOriginRoleMismatch,
		protectedlocal.ReasonLifecycleChallengeMismatch,
		protectedlocal.ReasonLifecycleChallengeReplay,
		protectedlocal.ReasonLifecycleIntentMismatch,
		protectedlocal.ReasonLifecycleIntentReplay,
		protectedlocal.ReasonProtectedLocalBootEpochMismatch:
		return codes.PermissionDenied
	case protectedlocal.ReasonDesktopProcessVerificationUnavailable:
		return codes.Unauthenticated
	case protectedlocal.ReasonLifecycleChallengeRequired,
		protectedlocal.ReasonLifecycleIntentRequired,
		protectedlocal.ReasonLifecycleIntentExpired,
		protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired:
		return codes.FailedPrecondition
	case protectedlocal.ReasonProtectedLocalLedgerRollbackDetected:
		return codes.Unavailable
	default:
		return codes.Unavailable
	}
}
