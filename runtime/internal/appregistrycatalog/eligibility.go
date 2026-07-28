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
	EligibilityReasonAvatarMasterGateBlocked  EligibilityReason = "avatar-master-gate-blocked"
	EligibilityReasonAppKindNotAdmitted       EligibilityReason = "app-kind-not-admitted"
	EligibilityReasonNotOrdinaryVisible       EligibilityReason = "app-not-ordinary-visible"
	EligibilityReasonReleaseDescriptorMissing EligibilityReason = "app-release-descriptor-missing"
	EligibilityReasonStoragePolicyMissing     EligibilityReason = "app-storage-policy-missing"
)

var (
	ErrEligibilityAppIDRequired = errors.New("eligibility checker: appID is required")
)

// CheckCallerEligibility evaluates whether the given app_id is eligible
// for Runtime caller registration. Only hidden/internal admitted first-party
// rows may register from this retained catalog. Ordinary-visible rows remain
// deferred and cannot become runnable from registry presence.
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
				Eligible: true,
				Reason:   string(EligibilityReasonOK),
			}, nil
		}
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAppDeferred),
		}, nil
	case AdmissionStatusGatedByAvatarMasterGate:
		return CallerEligibility{
			Eligible: false,
			Reason:   string(EligibilityReasonAvatarMasterGateBlocked),
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
