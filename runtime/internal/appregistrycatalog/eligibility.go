package appregistrycatalog

import (
	"errors"
	"fmt"
)

// CallerEligibility captures the typed eligibility decision for a
// registered Nimi App caller. The Reason field carries the canonical
// reason code when Eligible == false.
type CallerEligibility struct {
	Eligible bool
	Reason   string
}

// EligibilityReason enumerates the canonical reason codes the
// eligibility checker may return. Consumers must not invent custom
// reason strings.
type EligibilityReason string

const (
	EligibilityReasonOK                       EligibilityReason = "ok"
	EligibilityReasonAppNotRegistered         EligibilityReason = "app-not-registered"
	EligibilityReasonAppRetired               EligibilityReason = "app-retired"
	EligibilityReasonAppDeferred              EligibilityReason = "app-deferred"
	EligibilityReasonAppPendingWave4          EligibilityReason = "app-pending-wave-4"
	EligibilityReasonAvatarMasterGateBlocked  EligibilityReason = "avatar-master-gate-blocked"
	EligibilityReasonAppKindNotAdmitted       EligibilityReason = "app-kind-not-admitted"
	EligibilityReasonNotOrdinaryVisible       EligibilityReason = "app-not-ordinary-visible"
	EligibilityReasonReleaseDescriptorMissing EligibilityReason = "app-release-descriptor-missing"
	EligibilityReasonStoragePolicyMissing     EligibilityReason = "app-storage-policy-missing"
	EligibilityReasonInstallRequired          EligibilityReason = "app-install-required"
)

var (
	ErrEligibilityAppIDRequired = errors.New("eligibility checker: appID is required")
)

// CheckCallerEligibility evaluates whether the given app_id is eligible
// for caller registration + launch. Registry admission alone is not
// executable readiness: admitted ordinary-visible rows still fail closed
// with app-install-required until descriptor-backed install verification
// is available; gated_by_avatar_master_gate, pending_wave_4, deferred, and
// retired rows all fail closed.
func (r *Registry) CheckCallerEligibility(appID string) (CallerEligibility, error) {
	if appID == "" {
		return CallerEligibility{}, fmt.Errorf("appregistrycatalog CheckCallerEligibility: %w", ErrEligibilityAppIDRequired)
	}
	if r == nil {
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAppNotRegistered),
		}, nil
	}
	app, err := r.FindByID(appID)
	if err != nil {
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAppNotRegistered),
		}, nil
	}
	if !app.PackageKind.Valid() {
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAppKindNotAdmitted),
		}, nil
	}
	if app.ReleaseDescriptorRef == "" {
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonReleaseDescriptorMissing),
		}, nil
	}
	if app.InstallStoragePolicyRef == "" {
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonStoragePolicyMissing),
		}, nil
	}
	switch app.AdmissionStatus {
	case AdmissionStatusAdmitted:
		if app.OrdinaryVisibility != OrdinaryVisibilityOrdinaryVisible {
			return CallerEligibility{
				Eligible: false,
				Reason:   string(EligibilityReasonNotOrdinaryVisible),
			}, nil
		}
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonInstallRequired),
		}, nil
	case AdmissionStatusGatedByAvatarMasterGate:
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAvatarMasterGateBlocked),
		}, nil
	case AdmissionStatusPendingWave4:
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAppPendingWave4),
		}, nil
	case AdmissionStatusDeferred:
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAppDeferred),
		}, nil
	case AdmissionStatusRetired:
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAppRetired),
		}, nil
	}
	return CallerEligibility{
		Eligible: false,
		Reason:   string(EligibilityReasonAppNotRegistered),
	}, nil
}
