package runtimeagent

import (
	"context"
	"net/http"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// sourceMaterializationV2Admission binds the transport state machine to the
// dedicated Realm packet-v2 verifier and strict typed normalizer. It retains
// no accepted packet state: Begin and Commit each perform a fresh JWKS-backed
// proof check, so key removal/revocation takes effect immediately.
type sourceMaterializationV2Admission struct {
	verifier *SourceMaterializationAdmissionVerifier
}

// NewSourceMaterializationV2Admission constructs the only production packet
// admission path. The returned value is intentionally exposed only through
// the narrow transport interface; callers cannot bypass strict normalization
// or substitute a bearer-JWT verifier.
func NewSourceMaterializationV2Admission(expectedIssuer, jwksURL string, client *http.Client) (sourceMaterializationAdmission, error) {
	verifier, err := NewSourceMaterializationAdmissionVerifier(expectedIssuer, jwksURL, client)
	if err != nil {
		return nil, err
	}
	return &sourceMaterializationV2Admission{verifier: verifier}, nil
}

func (a *sourceMaterializationV2Admission) VerifySourceMaterializationBegin(
	ctx context.Context,
	control *runtimev1.SourceMaterializationBeginControl,
	binding sourceMaterializationChallengeBindingV2,
	now time.Time,
) error {
	_, err := verifySourceMaterializationBeginControlV2(ctx, control, sourceMaterializationExpectations(binding), now, a.verifier)
	return err
}

func (a *sourceMaterializationV2Admission) AdmitSourceMaterializationCommit(
	ctx context.Context,
	control *runtimev1.SourceMaterializationBeginControl,
	binding sourceMaterializationChallengeBindingV2,
	components map[string][]byte,
	now time.Time,
) (localAgentSourceSnapshotCandidateV1, error) {
	verified, err := verifySourceMaterializationBeginControlV2(ctx, control, sourceMaterializationExpectations(binding), now, a.verifier)
	if err != nil {
		return localAgentSourceSnapshotCandidateV1{}, err
	}
	normalized, err := verifyAndNormalizeSourceMaterializationV2(verified, components)
	if err != nil {
		return localAgentSourceSnapshotCandidateV1{}, err
	}
	return localAgentSourceSnapshotCandidateV1{
		Normalized:                   *normalized,
		CompilerCompatibilityVersion: localAgentSourceCompilerCompatibilityV1,
	}, nil
}

func sourceMaterializationExpectations(binding sourceMaterializationChallengeBindingV2) sourceMaterializationBeginExpectationsV2 {
	return sourceMaterializationBeginExpectationsV2{
		MaterializerAccountID:   binding.MaterializerAccountID,
		ChallengeID:             binding.ChallengeID,
		IntendedRuntimeAudience: binding.IntendedRuntimeAudience,
		ChallengeDigest:         binding.ChallengeDigest,
		SourceRef:               binding.SourceRef,
		Limits:                  binding.Limits,
		ExpiresAt:               binding.ExpiresAt,
	}
}
