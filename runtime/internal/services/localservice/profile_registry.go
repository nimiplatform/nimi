package localservice

import (
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// ProfileRegistry stores registered profile descriptors for identity-based
// lookup (K-SCHED-004). Profiles are registered by the desktop/host at
// bootstrap time and looked up by the scheduler's dependency feasibility
// checker using (modID, profileID).
//
// This is NOT a parallel truth source. It is the runtime-side projection
// of the same manifest profiles the desktop reads. Registration happens
// once via RegisterProfile; the registry does not modify or derive profiles.
type ProfileRegistry struct {
	mu       sync.RWMutex
	profiles map[string]*runtimev1.LocalProfileDescriptor // key = "modID:profileID"
}

// NewProfileRegistry creates an empty profile registry.
func NewProfileRegistry() *ProfileRegistry {
	return &ProfileRegistry{
		profiles: make(map[string]*runtimev1.LocalProfileDescriptor),
	}
}

func profileRegistryKey(modID, profileID string) string {
	return strings.TrimSpace(modID) + ":" + strings.TrimSpace(profileID)
}

// RegisterProfile stores a profile descriptor for later identity-based lookup.
// Called by desktop host during bootstrap or profile apply.
func (r *ProfileRegistry) RegisterProfile(modID string, profileID string, descriptor *runtimev1.LocalProfileDescriptor) {
	if descriptor == nil || strings.TrimSpace(profileID) == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.profiles[profileRegistryKey(modID, profileID)] = descriptor
}

// LookupProfile returns the registered profile descriptor for the given identity.
// Returns nil if not found.
func (r *ProfileRegistry) LookupProfile(modID string, profileID string) *runtimev1.LocalProfileDescriptor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.profiles[profileRegistryKey(modID, profileID)]
}

// GetProfileRegistry returns the profile registry for external access (e.g. scheduling denial checks).
func (s *Service) GetProfileRegistry() *ProfileRegistry {
	return s.profileRegistry
}

// RegisterProfiles batch-registers multiple profiles for a given modID.
func (r *ProfileRegistry) RegisterProfiles(modID string, descriptors []*runtimev1.LocalProfileDescriptor) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, d := range descriptors {
		if d == nil {
			continue
		}
		profileID := strings.TrimSpace(d.GetId())
		if profileID == "" {
			continue
		}
		r.profiles[profileRegistryKey(modID, profileID)] = d
	}
}
