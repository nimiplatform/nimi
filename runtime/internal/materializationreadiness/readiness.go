package materializationreadiness

import "fmt"

// NewReady constructs a ready Readiness. Per the canonical contract,
// reporting State=ready requires Reason=ready and forbids any blocker
// detail; callers must not invoke this for partial or in-progress
// activations.
func NewReady() Readiness {
	return Readiness{State: StateReady, Reason: ReasonReady}
}

// NewInProgress constructs an in-progress Readiness. The reason must be
// a canonical enum value (typically `setup_in_progress`). Returns an
// error when the reason is unknown.
func NewInProgress(reason ReasonCode, detail string, dependencyRefs []string) (Readiness, error) {
	if !reason.Valid() {
		return Readiness{}, fmt.Errorf("NewInProgress: %w: %q", ErrUnknownReasonCode, string(reason))
	}
	if reason == ReasonReady {
		return Readiness{}, fmt.Errorf("NewInProgress: reason cannot be %q for non-ready state", string(reason))
	}
	return Readiness{
		State:          StateSetupInProgress,
		Reason:         reason,
		Detail:         detail,
		DependencyRefs: append([]string(nil), dependencyRefs...),
	}, nil
}

// NewBlocked constructs a blocked Readiness mapping to
// state=setup_required. The reason must be a canonical enum value such
// as `engine_package_missing` or `python_runtime_missing`.
func NewBlocked(reason ReasonCode, detail string, dependencyRefs []string) (Readiness, error) {
	if !reason.Valid() {
		return Readiness{}, fmt.Errorf("NewBlocked: %w: %q", ErrUnknownReasonCode, string(reason))
	}
	if reason == ReasonReady {
		return Readiness{}, fmt.Errorf("NewBlocked: reason cannot be %q for non-ready state", string(reason))
	}
	return Readiness{
		State:          StateSetupRequired,
		Reason:         reason,
		Detail:         detail,
		DependencyRefs: append([]string(nil), dependencyRefs...),
	}, nil
}

// NewFailed constructs a failed Readiness. Reason must be a canonical
// enum value; typically `failed`, `repair_required`, or `cancelled`.
func NewFailed(reason ReasonCode, detail string, dependencyRefs []string) (Readiness, error) {
	if !reason.Valid() {
		return Readiness{}, fmt.Errorf("NewFailed: %w: %q", ErrUnknownReasonCode, string(reason))
	}
	if reason == ReasonReady {
		return Readiness{}, fmt.Errorf("NewFailed: reason cannot be %q for non-ready state", string(reason))
	}
	return Readiness{
		State:          StateFailed,
		Reason:         reason,
		Detail:         detail,
		DependencyRefs: append([]string(nil), dependencyRefs...),
	}, nil
}

// NewUnsupported constructs an unsupported Readiness. Reason must be a
// host-capability-projection reason code (vulkan_runtime_unavailable,
// metal_runtime_unavailable, unsupported).
func NewUnsupported(reason ReasonCode, detail string) (Readiness, error) {
	if !reason.Valid() {
		return Readiness{}, fmt.Errorf("NewUnsupported: %w: %q", ErrUnknownReasonCode, string(reason))
	}
	if reason == ReasonReady {
		return Readiness{}, fmt.Errorf("NewUnsupported: reason cannot be %q for non-ready state", string(reason))
	}
	return Readiness{
		State:  StateUnsupported,
		Reason: reason,
		Detail: detail,
	}, nil
}

// NewRepairRequired constructs a repair-required Readiness. Reason must
// be a canonical enum value.
func NewRepairRequired(reason ReasonCode, detail string, dependencyRefs []string) (Readiness, error) {
	if !reason.Valid() {
		return Readiness{}, fmt.Errorf("NewRepairRequired: %w: %q", ErrUnknownReasonCode, string(reason))
	}
	if reason == ReasonReady {
		return Readiness{}, fmt.Errorf("NewRepairRequired: reason cannot be %q for non-ready state", string(reason))
	}
	return Readiness{
		State:          StateRepairRequired,
		Reason:         reason,
		Detail:         detail,
		DependencyRefs: append([]string(nil), dependencyRefs...),
	}, nil
}

// NewCancelled constructs a cancelled Readiness. Reason must be a
// canonical enum value (typically `cancelled`).
func NewCancelled(reason ReasonCode, detail string) (Readiness, error) {
	if !reason.Valid() {
		return Readiness{}, fmt.Errorf("NewCancelled: %w: %q", ErrUnknownReasonCode, string(reason))
	}
	if reason == ReasonReady {
		return Readiness{}, fmt.Errorf("NewCancelled: reason cannot be %q for non-ready state", string(reason))
	}
	return Readiness{State: StateCancelled, Reason: reason, Detail: detail}, nil
}

// ValidateProjection asserts the cross-field invariants required by the
// activation-gate contract. It returns an error when a Readiness was
// hand-constructed in a way that violates the no-false-readiness rule
// (active-ready projected from non-ready state, missing reason code,
// unknown reason code, unknown activation state).
func ValidateProjection(r Readiness) error {
	if !r.State.Valid() {
		return fmt.Errorf("ValidateProjection: %w: %q", ErrUnknownActivationState, string(r.State))
	}
	if !r.Reason.Valid() {
		return fmt.Errorf("ValidateProjection: %w: %q", ErrUnknownReasonCode, string(r.Reason))
	}
	if r.State == StateReady && r.Reason != ReasonReady {
		return fmt.Errorf("ValidateProjection: %w", ErrActiveReadyRequiresReasonReady)
	}
	if r.State != StateReady && r.Reason == ReasonReady {
		return fmt.Errorf("ValidateProjection: %w", ErrNonReadyMustNotProjectActive)
	}
	if r.State != StateReady && r.Reason == "" {
		return fmt.Errorf("ValidateProjection: %w", ErrNonReadyRequiresExplicitReason)
	}
	return nil
}
