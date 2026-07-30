package apppermission

import (
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

// Posture is the closed app-facing permission posture from P-PERM-003a.
type Posture string

const (
	PosturePrompt      Posture = "prompt"
	PosturePending     Posture = "pending"
	PostureGranted     Posture = "granted"
	PostureDenied      Posture = "denied"
	PostureRevoked     Posture = "revoked"
	PostureUnavailable Posture = "unavailable"
)

type PostureReason string

const (
	PostureReasonPrompt           PostureReason = "prompt"
	PostureReasonPending          PostureReason = "pending"
	PostureReasonGranted          PostureReason = "granted"
	PostureReasonOwnerDenied      PostureReason = "owner_denied"
	PostureReasonBindingInvalid   PostureReason = "binding_invalid"
	PostureReasonGrantExpired     PostureReason = "grant_expired"
	PostureReasonGrantRevoked     PostureReason = "grant_revoked"
	PostureReasonPermissionClosed PostureReason = "permission_unavailable"
)

type PostureEvaluation struct {
	Posture Posture
	Reason  PostureReason
	Usable  bool
}

// EvaluatePosture projects owner truth into the closed public posture set. A
// missing decision is prompt only when all current bindings and catalog facts
// are present; every mismatch fails closed and revocation remains distinct.
func EvaluatePosture(now time.Time, admitted bool, manifestAllowed bool, expected localappkernel.PermissionGrantKey, grant *localappkernel.PermissionGrant) PostureEvaluation {
	if !admitted || !manifestAllowed {
		return PostureEvaluation{Posture: PostureUnavailable, Reason: PostureReasonPermissionClosed}
	}
	if now.IsZero() || now.Location() != time.UTC || !completeGrantKey(expected) {
		return PostureEvaluation{Posture: PostureDenied, Reason: PostureReasonBindingInvalid}
	}
	if grant == nil {
		return PostureEvaluation{Posture: PosturePrompt, Reason: PostureReasonPrompt}
	}
	if grant.Key != expected || grant.Revision == 0 {
		return PostureEvaluation{Posture: PostureDenied, Reason: PostureReasonBindingInvalid}
	}
	if grant.ExpiresAt != nil {
		if grant.ExpiresAt.IsZero() || grant.ExpiresAt.Location() != time.UTC {
			return PostureEvaluation{Posture: PostureDenied, Reason: PostureReasonBindingInvalid}
		}
		if !now.Before(*grant.ExpiresAt) {
			return PostureEvaluation{Posture: PostureDenied, Reason: PostureReasonGrantExpired}
		}
	}
	switch grant.State {
	case localappkernel.PermissionGrantStatePending:
		return PostureEvaluation{Posture: PosturePending, Reason: PostureReasonPending}
	case localappkernel.PermissionGrantStateGranted:
		return PostureEvaluation{Posture: PostureGranted, Reason: PostureReasonGranted, Usable: true}
	case localappkernel.PermissionGrantStateDenied:
		return PostureEvaluation{Posture: PostureDenied, Reason: PostureReasonOwnerDenied}
	case localappkernel.PermissionGrantStateExpired:
		return PostureEvaluation{Posture: PostureDenied, Reason: PostureReasonGrantExpired}
	case localappkernel.PermissionGrantStateRevoked:
		return PostureEvaluation{Posture: PostureRevoked, Reason: PostureReasonGrantRevoked}
	default:
		return PostureEvaluation{Posture: PostureDenied, Reason: PostureReasonBindingInvalid}
	}
}

func completeGrantKey(key localappkernel.PermissionGrantKey) bool {
	for _, value := range []string{key.LocalOSUserAnchor, key.AccountID, key.LocalAppPrincipalID, key.PermissionID, key.OwnerSelectorDigest} {
		if value == "" || value != strings.TrimSpace(value) {
			return false
		}
	}
	return true
}
