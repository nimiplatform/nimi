package defaultexperience

import (
	"errors"
	"fmt"
)

// ErrNoCompatibleProfile is returned by Recommend when no catalog
// profile satisfies the requested host capability and applicable scope
// (and any optional preference filters).
var ErrNoCompatibleProfile = errors.New("default-experience no compatible profile for host capability and scope")

// RecommendationInput collects the runtime inputs that the recommender
// considers when selecting a Default Experience Profile. HostCapabilityProfileRef
// and Scope are required; the optional fields may be used to express user
// preferences and act as additional filters when set.
type RecommendationInput struct {
	HostCapabilityProfileRef string
	Scope                    ApplicableScope
	// PreferredPrivacy, when non-empty, restricts matches to profiles
	// with this PrivacyPosture.
	PreferredPrivacy PrivacyPosture
	// PreferredCompute, when non-empty, restricts matches to profiles
	// with this ComputePosture.
	PreferredCompute ComputePosture
	// PreferredRouting, when non-empty, restricts matches to profiles
	// with this RoutingPolicy.
	PreferredRouting RoutingPolicy
}

// Recommend selects the Default Experience Profile that matches the
// host capability profile reference and applicable scope. When multiple
// profiles match, the first profile in catalog order is returned. When
// no profile matches, ErrNoCompatibleProfile is returned.
//
// The recommender consults only the canonical catalog rows; it does not
// embed provider, connector, engine, or model identifier strings
// (P-DXP-008). When optional preferences are set on the input, profiles
// that do not satisfy every set preference are excluded.
func Recommend(catalog *Catalog, input RecommendationInput) (*Profile, error) {
	if catalog == nil {
		return nil, fmt.Errorf("default-experience Recommend: %w", ErrCatalogMissingProfile)
	}
	if input.HostCapabilityProfileRef == "" {
		return nil, fmt.Errorf("default-experience Recommend: host_capability_profile_ref is required")
	}
	if input.Scope == "" {
		return nil, fmt.Errorf("default-experience Recommend: applicable_scope is required")
	}
	if !input.Scope.Valid() {
		return nil, fmt.Errorf("default-experience Recommend: %w: %q", ErrProfileUnknownScope, string(input.Scope))
	}
	if input.PreferredPrivacy != "" && !input.PreferredPrivacy.Valid() {
		return nil, fmt.Errorf("default-experience Recommend: %w: %q", ErrProfileUnknownPrivacy, string(input.PreferredPrivacy))
	}
	if input.PreferredCompute != "" && !input.PreferredCompute.Valid() {
		return nil, fmt.Errorf("default-experience Recommend: %w: %q", ErrProfileUnknownCompute, string(input.PreferredCompute))
	}
	if input.PreferredRouting != "" && !input.PreferredRouting.Valid() {
		return nil, fmt.Errorf("default-experience Recommend: %w: %q", ErrProfileUnknownRouting, string(input.PreferredRouting))
	}
	for index := range catalog.Profiles {
		profile := &catalog.Profiles[index]
		if !profileSupportsHostRef(profile, input.HostCapabilityProfileRef) {
			continue
		}
		if !profile.SupportsScope(input.Scope) {
			continue
		}
		if input.PreferredPrivacy != "" && profile.PrivacyPosture != input.PreferredPrivacy {
			continue
		}
		if input.PreferredCompute != "" && profile.ComputePosture != input.PreferredCompute {
			continue
		}
		if input.PreferredRouting != "" && profile.RoutingPolicy != input.PreferredRouting {
			continue
		}
		return profile, nil
	}
	return nil, fmt.Errorf(
		"default-experience Recommend (host=%q, scope=%q): %w",
		input.HostCapabilityProfileRef,
		string(input.Scope),
		ErrNoCompatibleProfile,
	)
}

func profileSupportsHostRef(profile *Profile, hostRef string) bool {
	for _, declared := range profile.HostCapabilityProfileRefs {
		if declared == hostRef {
			return true
		}
	}
	return false
}
