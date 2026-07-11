package protectedlocal

import (
	"errors"
)

type Reason string

const (
	ReasonProtectedLocalTransportUnsupported       Reason = "PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED"
	ReasonDesktopControlTransportRequired          Reason = "DESKTOP_CONTROL_TRANSPORT_REQUIRED"
	ReasonDesktopProcessVerificationUnavailable    Reason = "DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE"
	ReasonDesktopExecutableTrustFailed             Reason = "DESKTOP_EXECUTABLE_TRUST_FAILED"
	ReasonProtectedOriginRoleMismatch              Reason = "PROTECTED_ORIGIN_ROLE_MISMATCH"
	ReasonProtectedLocalLedgerUnavailable          Reason = "PROTECTED_LOCAL_LEDGER_UNAVAILABLE"
	ReasonProtectedLocalLedgerRollbackDetected     Reason = "PROTECTED_LOCAL_LEDGER_ROLLBACK_DETECTED"
	ReasonProtectedLocalBootEpochMismatch          Reason = "PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH"
	ReasonProtectedLocalRuntimePrincipalRequired   Reason = "PROTECTED_LOCAL_RUNTIME_PRINCIPAL_REQUIRED"
	ReasonProtectedLocalCustodyBoundaryUnavailable Reason = "PROTECTED_LOCAL_CUSTODY_BOUNDARY_UNAVAILABLE"
	ReasonRuntimeExecutableTrustRecordInvalid      Reason = "RUNTIME_EXECUTABLE_TRUST_RECORD_INVALID"
)

var ErrAnchorNotFound = errors.New("protected-local anchor not found")

type Failure struct {
	reason     Reason
	retryable  bool
	actionHint string
	cause      error
}

func (e *Failure) Error() string { return string(e.reason) }

func (e *Failure) Unwrap() error { return e.cause }

func (e *Failure) Reason() Reason { return e.reason }

func (e *Failure) Retryable() bool { return e.retryable }

func (e *Failure) ActionHint() string { return e.actionHint }

func IsReason(err error, reason Reason) bool {
	var failure *Failure
	return errors.As(err, &failure) && failure.reason == reason
}

func fail(reason Reason, retryable bool, actionHint string, cause error) error {
	return &Failure{
		reason:     reason,
		retryable:  retryable,
		actionHint: actionHint,
		cause:      cause,
	}
}
