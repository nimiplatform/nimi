// Package defaultexperience implements the Runtime-internal typed
// service that aggregates default-experience catalog, recommendation,
// host capability matching, materialization readiness, and cold-start
// projection into a single constructor-injected boundary.
//
// Authority: .nimi/spec/runtime/kernel/local-environment-materializers-contract.md
// and the closed Default Experience Profile + cold-start contracts.
//
// Per Runtime AGENTS.md: constructor injection, no global mutable state,
// fmt.Errorf("op: %w", err), no log.Println. Per P-DXP-008: no provider,
// connector, engine, or model identifier string constants embedded in
// the service; all such values come from canonical catalogs.
package defaultexperience

import (
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/coldstart"
	dx "github.com/nimiplatform/nimi/runtime/internal/defaultexperience"
	"github.com/nimiplatform/nimi/runtime/internal/hostcapability"
)

// Service exposes the typed default-experience surfaces consumed by
// Runtime daemon entry points and (later) gRPC handlers.
type Service struct {
	profileCatalog *dx.Catalog
	hostCatalog    *hostcapability.Catalog
}

// NewService constructs a Service with the required typed dependencies.
// All dependencies are required; nil values return ErrInvalidDependency.
func NewService(profileCatalog *dx.Catalog, hostCatalog *hostcapability.Catalog) (*Service, error) {
	if profileCatalog == nil {
		return nil, fmt.Errorf("defaultexperience.NewService: %w: profileCatalog", ErrInvalidDependency)
	}
	if hostCatalog == nil {
		return nil, fmt.Errorf("defaultexperience.NewService: %w: hostCatalog", ErrInvalidDependency)
	}
	return &Service{profileCatalog: profileCatalog, hostCatalog: hostCatalog}, nil
}

// RecommendForCurrentHost combines the current platform-tuple host
// resolution with profile recommendation for the given scope and
// optional preferences. Returns the recommended profile or a wrapped
// error from the underlying matcher / recommender.
func (s *Service) RecommendForCurrentHost(scope dx.ApplicableScope, preferences dx.RecommendationInput) (*dx.Profile, error) {
	if s == nil {
		return nil, fmt.Errorf("defaultexperience.RecommendForCurrentHost: %w", ErrInvalidDependency)
	}
	hostProfile, err := hostcapability.MatchCurrentProfile(s.hostCatalog)
	if err != nil {
		return nil, fmt.Errorf("defaultexperience.RecommendForCurrentHost: %w", err)
	}
	input := preferences
	input.HostCapabilityProfileRef = hostProfile.ProfileID
	input.Scope = scope
	return dx.Recommend(s.profileCatalog, input)
}

// HostProfile returns the host capability profile that matches the
// current runtime platform-tuple. Returns ErrNoMatchingHostProfile when
// no catalog row matches the runtime platform.
func (s *Service) HostProfile() (*hostcapability.Profile, error) {
	if s == nil {
		return nil, fmt.Errorf("defaultexperience.HostProfile: %w", ErrInvalidDependency)
	}
	return hostcapability.MatchCurrentProfile(s.hostCatalog)
}

// ProjectColdStart aggregates the given upstream readiness inputs into
// the canonical cold-start projection. Returns an error when any
// upstream state is non-canonical.
func (s *Service) ProjectColdStart(inputs coldstart.UpstreamInputs) (coldstart.Projection, error) {
	return coldstart.Aggregate(inputs)
}

// ProfileCatalog returns the typed Default Experience Profile catalog
// for direct read access by other Runtime-internal services. It does
// not return a mutable handle; callers must not mutate.
func (s *Service) ProfileCatalog() *dx.Catalog {
	if s == nil {
		return nil
	}
	return s.profileCatalog
}

// HostCatalog returns the typed host capability profile catalog.
func (s *Service) HostCatalog() *hostcapability.Catalog {
	if s == nil {
		return nil
	}
	return s.hostCatalog
}

// Sentinel errors.
var (
	ErrInvalidDependency = errors.New("defaultexperience.Service invalid dependency")
)
