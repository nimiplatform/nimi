// Package refgraph provides repository-backed integrity queries for internal
// artifact references.
package refgraph

import (
	"encoding/json"
	"fmt"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

// Service answers reference-integrity and cleanup-eligibility questions against
// the persisted repository state.
type Service struct {
	store *storage.SQLiteBackend
}

// OutgoingSummary captures the health of an artifact's owned dependencies.
type OutgoingSummary struct {
	StrongLive int
	WeakLive   int
	Broken     int
}

// DependencyHealth captures explainable dependency-edge state.
type DependencyHealth struct {
	StrongLive   int
	WeakLive     int
	Broken       int
	Dependencies []routine.DependencyEdge
}

// Blocker captures one remove blocker together with source lifecycle context.
type Blocker struct {
	Kind            routine.BlockerKind
	Strength        artifactref.Strength
	SourceKind      artifactref.Kind
	SourceID        string
	SourceLifecycle string
	SourceActive    bool
	Role            string
	Message         string
}

// Eligibility describes cleanup decisions for an artifact.
type Eligibility struct {
	ArchiveAllowed bool
	RemoveAllowed  bool
	BlockedBy      []string
	Support        memory.SupportSummary
}

type artifactState struct {
	exists    bool
	live      bool
	active    bool
	lifecycle string
}

// New creates a repository-backed refgraph service.
func New(store *storage.SQLiteBackend) *Service {
	return &Service{store: store}
}

// IncomingRefs returns all refs pointing to the target artifact.
func (s *Service) IncomingRefs(scopeID string, toKind artifactref.Kind, toID string) ([]artifactref.Ref, error) {
	if s == nil || s.store == nil {
		return nil, fmt.Errorf("refgraph: store is required")
	}
	return s.store.IncomingRefs(scopeID, toKind, toID)
}

// OutgoingRefs returns all refs owned by the source artifact.
func (s *Service) OutgoingRefs(scopeID string, fromKind artifactref.Kind, fromID string) ([]artifactref.Ref, error) {
	if s == nil || s.store == nil {
		return nil, fmt.Errorf("refgraph: store is required")
	}
	return s.store.OutgoingRefs(scopeID, fromKind, fromID)
}

// SupportSummary returns weighted incoming support.
func (s *Service) SupportSummary(scopeID string, toKind artifactref.Kind, toID string) (memory.SupportSummary, error) {
	if s == nil || s.store == nil {
		return memory.SupportSummary{}, fmt.Errorf("refgraph: store is required")
	}
	refs, err := s.IncomingRefs(scopeID, toKind, toID)
	if err != nil {
		return memory.SupportSummary{}, err
	}
	var summary memory.SupportSummary
	for _, ref := range refs {
		state, err := s.artifactState(scopeID, ref.FromKind, ref.FromID)
		if err != nil {
			return memory.SupportSummary{}, err
		}
		if !state.live {
			continue
		}
		switch ref.Strength {
		case artifactref.StrengthStrong:
			summary.Strong++
			summary.Score += 1.0
		case artifactref.StrengthWeak:
			summary.Weak++
			summary.Score += 0.35
		}
	}
	return summary, nil
}

// LiveIncomingRefs returns incoming refs whose sources are still live.
func (s *Service) LiveIncomingRefs(scopeID string, toKind artifactref.Kind, toID string) ([]artifactref.Ref, error) {
	refs, err := s.IncomingRefs(scopeID, toKind, toID)
	if err != nil {
		return nil, err
	}
	var live []artifactref.Ref
	for _, ref := range refs {
		state, err := s.artifactState(scopeID, ref.FromKind, ref.FromID)
		if err != nil {
			return nil, err
		}
		if state.live {
			live = append(live, ref)
		}
	}
	return live, nil
}

// BrokenTargets returns the subset of refs whose targets are missing or removed.
func (s *Service) BrokenTargets(scopeID string, refs []artifactref.Ref) ([]artifactref.Ref, error) {
	if s == nil || s.store == nil {
		return nil, fmt.Errorf("refgraph: store is required")
	}
	var broken []artifactref.Ref
	for _, ref := range refs {
		state, err := s.artifactState(scopeID, ref.ToKind, ref.ToID)
		if err != nil {
			return nil, err
		}
		if !state.live {
			broken = append(broken, ref)
		}
	}
	return broken, nil
}

// InvalidationReasons describes broken or inactive outgoing dependencies.
func (s *Service) InvalidationReasons(scopeID string, refs []artifactref.Ref) ([]string, error) {
	health, err := s.OutgoingHealth(scopeID, refs)
	if err != nil {
		return nil, err
	}
	reasons := make([]string, 0, health.Broken)
	for _, dep := range health.Dependencies {
		if dep.Status != routine.DependencyStatusBrokenTarget {
			continue
		}
		reasons = append(reasons, dep.Message)
	}
	return reasons, nil
}

// OutgoingHealth summarizes owned dependency state with explainability.
func (s *Service) OutgoingHealth(scopeID string, refs []artifactref.Ref) (DependencyHealth, error) {
	if s == nil || s.store == nil {
		return DependencyHealth{}, fmt.Errorf("refgraph: store is required")
	}
	var health DependencyHealth
	for _, ref := range refs {
		state, err := s.artifactState(scopeID, ref.ToKind, ref.ToID)
		if err != nil {
			return DependencyHealth{}, err
		}
		edge := routine.DependencyEdge{
			ToKind:   ref.ToKind,
			ToID:     ref.ToID,
			Strength: ref.Strength,
			Role:     ref.Role,
		}
		if !state.live {
			health.Broken++
			edge.Status = routine.DependencyStatusBrokenTarget
			edge.Message = fmt.Sprintf("%s/%s unavailable", ref.ToKind, ref.ToID)
			health.Dependencies = append(health.Dependencies, edge)
			continue
		}
		edge.Status = routine.DependencyStatusLive
		switch ref.Strength {
		case artifactref.StrengthStrong:
			health.StrongLive++
		case artifactref.StrengthWeak:
			health.WeakLive++
		}
		health.Dependencies = append(health.Dependencies, edge)
	}
	return health, nil
}

// OutgoingSupport keeps the legacy count-only summary for callers not yet
// upgraded to structured dependency health.
func (s *Service) OutgoingSupport(scopeID string, refs []artifactref.Ref) (OutgoingSummary, error) {
	health, err := s.OutgoingHealth(scopeID, refs)
	if err != nil {
		return OutgoingSummary{}, err
	}
	return OutgoingSummary{
		StrongLive: health.StrongLive,
		WeakLive:   health.WeakLive,
		Broken:     health.Broken,
	}, nil
}

// RemoveBlockers returns structured live inbound blockers for one artifact.
func (s *Service) RemoveBlockers(scopeID string, toKind artifactref.Kind, toID string) ([]Blocker, error) {
	refs, err := s.IncomingRefs(scopeID, toKind, toID)
	if err != nil {
		return nil, err
	}
	blockers := make([]Blocker, 0, len(refs))
	for _, ref := range refs {
		state, err := s.artifactState(scopeID, ref.FromKind, ref.FromID)
		if err != nil {
			return nil, err
		}
		if !state.live {
			continue
		}
		kind := routine.BlockerKindWeakRef
		if ref.Strength == artifactref.StrengthStrong {
			kind = routine.BlockerKindStrongRef
		}
		blockers = append(blockers, Blocker{
			Kind:            kind,
			Strength:        ref.Strength,
			SourceKind:      ref.FromKind,
			SourceID:        ref.FromID,
			SourceLifecycle: state.lifecycle,
			SourceActive:    state.active,
			Role:            ref.Role,
			Message:         fmt.Sprintf("%s:%s/%s", kind, ref.FromKind, ref.FromID),
		})
	}
	return blockers, nil
}

func (s *Service) artifactState(scopeID string, kind artifactref.Kind, id string) (artifactState, error) {
	var storageKind storage.ArtifactKind
	switch kind {
	case artifactref.KindKernelRule:
		rule, err := s.store.LoadKernelRuleByID(scopeID, id)
		if err != nil {
			return artifactState{}, err
		}
		if rule == nil {
			return artifactState{}, nil
		}
		return artifactState{
			exists:    true,
			live:      rule.Lifecycle == kernel.RuleLifecycleActive,
			active:    rule.Lifecycle == kernel.RuleLifecycleActive,
			lifecycle: string(rule.Lifecycle),
		}, nil
	case artifactref.KindMemoryRecord:
		storageKind = storage.KindMemory
	case artifactref.KindKnowledgePage:
		storageKind = storage.KindKnowledge
	case artifactref.KindSkillBundle:
		storageKind = storage.KindSkill
	default:
		return artifactState{}, fmt.Errorf("refgraph: unsupported target kind %q", kind)
	}
	raw, err := s.store.Load(scopeID, storageKind, id)
	if err != nil {
		return artifactState{}, err
	}
	if raw == nil {
		return artifactState{}, nil
	}
	switch kind {
	case artifactref.KindMemoryRecord:
		var rec memory.Record
		if err := json.Unmarshal(raw, &rec); err != nil {
			return artifactState{}, fmt.Errorf("refgraph: decode memory_record %s: %w", id, err)
		}
		return artifactState{
			exists:    true,
			live:      rec.Lifecycle != memory.RecordLifecycleRemoved,
			active:    rec.Lifecycle == memory.RecordLifecycleActive,
			lifecycle: string(rec.Lifecycle),
		}, nil
	case artifactref.KindKnowledgePage:
		var page knowledge.Page
		if err := json.Unmarshal(raw, &page); err != nil {
			return artifactState{}, fmt.Errorf("refgraph: decode knowledge_page %s: %w", id, err)
		}
		return artifactState{
			exists:    true,
			live:      page.Lifecycle != knowledge.ProjectionLifecycleRemoved,
			active:    page.Lifecycle == knowledge.ProjectionLifecycleActive || page.Lifecycle == knowledge.ProjectionLifecycleStale,
			lifecycle: string(page.Lifecycle),
		}, nil
	case artifactref.KindSkillBundle:
		var bundle skill.Bundle
		if err := json.Unmarshal(raw, &bundle); err != nil {
			return artifactState{}, fmt.Errorf("refgraph: decode skill_bundle %s: %w", id, err)
		}
		return artifactState{
			exists:    true,
			live:      bundle.Status != skill.BundleStatusRemoved,
			active:    bundle.Status == skill.BundleStatusActive || bundle.Status == skill.BundleStatusDraft,
			lifecycle: string(bundle.Status),
		}, nil
	default:
		return artifactState{exists: true, live: true, active: true}, nil
	}
}
