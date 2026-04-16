package digest

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/refgraph"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func blockingRemoveBlockers(blockers []routine.Blocker) []routine.Blocker {
	filtered := make([]routine.Blocker, 0, len(blockers))
	for _, blocker := range blockers {
		switch blocker.Kind {
		case routine.BlockerKindStrongRef:
			filtered = append(filtered, blocker)
		case routine.BlockerKindWeakRef, routine.BlockerKindDownstreamLiveDependency:
			if blocker.SourceActive {
				filtered = append(filtered, blocker)
			}
		}
	}
	return filtered
}

func formatRoutineBlockers(blockers []routine.Blocker) string {
	parts := make([]string, 0, len(blockers))
	for _, blocker := range blockers {
		part := string(blocker.Kind)
		if blocker.SourceKind != "" && blocker.SourceID != "" {
			part = fmt.Sprintf("%s:%s/%s", blocker.Kind, blocker.SourceKind, blocker.SourceID)
			if blocker.SourceLifecycle != "" {
				part = fmt.Sprintf("%s(%s)", part, blocker.SourceLifecycle)
			}
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, ", ")
}

func toRoutineBlockers(blockers []refgraph.Blocker) []routine.Blocker {
	out := make([]routine.Blocker, 0, len(blockers))
	for _, blocker := range blockers {
		out = append(out, routine.Blocker{
			Kind:            blocker.Kind,
			Strength:        blocker.Strength,
			SourceKind:      blocker.SourceKind,
			SourceID:        blocker.SourceID,
			SourceLifecycle: blocker.SourceLifecycle,
			SourceActive:    blocker.SourceActive,
			Role:            blocker.Role,
			Message:         blocker.Message,
		})
	}
	return out
}

func (a *storageArtifactAccess) ListMemory(scopeID string) ([]memory.Record, error) {
	return a.store.LoadMemoryRecords(scopeID)
}

func (a *storageArtifactAccess) LoadMemory(scopeID string, recordID memory.RecordID) (*memory.Record, error) {
	raw, err := a.store.Load(scopeID, storage.KindMemory, string(recordID))
	if err != nil || raw == nil {
		return nil, err
	}
	var record memory.Record
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, fmt.Errorf("digest load memory: %w", err)
	}
	return &record, nil
}

func (a *storageArtifactAccess) SaveMemory(record memory.Record) error {
	raw, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("digest save memory: %w", err)
	}
	return a.store.Save(record.ScopeID, storage.KindMemory, string(record.RecordID), raw)
}

func (a *storageArtifactAccess) ArchiveMemory(scopeID string, recordID memory.RecordID, now time.Time) error {
	record, err := a.LoadMemory(scopeID, recordID)
	if err != nil {
		return err
	}
	if record == nil {
		return nil
	}
	record.Lifecycle = memory.RecordLifecycleArchived
	record.UpdatedAt = now
	return a.SaveMemory(*record)
}

func (a *storageArtifactAccess) RemoveMemory(scopeID string, recordID memory.RecordID, now time.Time) error {
	record, err := a.LoadMemory(scopeID, recordID)
	if err != nil {
		return err
	}
	if record == nil {
		return nil
	}
	if record.Lifecycle != memory.RecordLifecycleArchived {
		return fmt.Errorf("digest remove memory: record %s must be archived before remove", recordID)
	}
	blockers, err := a.graph.RemoveBlockers(scopeID, artifactref.KindMemoryRecord, string(recordID))
	if err != nil {
		return err
	}
	blocking := blockingRemoveBlockers(toRoutineBlockers(blockers))
	if len(blocking) > 0 {
		return fmt.Errorf("digest remove memory: record %s is blocked by %s", recordID, formatRoutineBlockers(blocking))
	}
	record.Lifecycle = memory.RecordLifecycleRemoved
	record.UpdatedAt = now
	return a.SaveMemory(*record)
}

func (a *storageArtifactAccess) ListKnowledge(scopeID string) ([]knowledge.Page, error) {
	return a.store.LoadKnowledgePages(scopeID)
}

func (a *storageArtifactAccess) LoadKnowledge(scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	raw, err := a.store.Load(scopeID, storage.KindKnowledge, string(pageID))
	if err != nil || raw == nil {
		return nil, err
	}
	var page knowledge.Page
	if err := json.Unmarshal(raw, &page); err != nil {
		return nil, fmt.Errorf("digest load knowledge: %w", err)
	}
	return &page, nil
}

func (a *storageArtifactAccess) SaveKnowledge(page knowledge.Page) error {
	raw, err := json.Marshal(page)
	if err != nil {
		return fmt.Errorf("digest save knowledge: %w", err)
	}
	return a.store.Save(page.ScopeID, storage.KindKnowledge, string(page.PageID), raw)
}

func (a *storageArtifactAccess) ArchiveKnowledge(scopeID string, pageID knowledge.PageID, now time.Time) error {
	page, err := a.LoadKnowledge(scopeID, pageID)
	if err != nil {
		return err
	}
	if page == nil {
		return nil
	}
	page.Lifecycle = knowledge.ProjectionLifecycleArchived
	page.UpdatedAt = now
	return a.SaveKnowledge(*page)
}

func (a *storageArtifactAccess) RemoveKnowledge(scopeID string, pageID knowledge.PageID, now time.Time) error {
	page, err := a.LoadKnowledge(scopeID, pageID)
	if err != nil {
		return err
	}
	if page == nil {
		return nil
	}
	if page.Lifecycle != knowledge.ProjectionLifecycleArchived {
		return fmt.Errorf("digest remove knowledge: page %s must be archived before remove", pageID)
	}
	blockers, err := a.graph.RemoveBlockers(scopeID, artifactref.KindKnowledgePage, string(pageID))
	if err != nil {
		return err
	}
	blocking := blockingRemoveBlockers(toRoutineBlockers(blockers))
	if len(blocking) > 0 {
		return fmt.Errorf("digest remove knowledge: page %s is blocked by %s", pageID, formatRoutineBlockers(blocking))
	}
	page.Lifecycle = knowledge.ProjectionLifecycleRemoved
	page.UpdatedAt = now
	return a.SaveKnowledge(*page)
}

func (a *storageArtifactAccess) ListSkills(scopeID string) ([]skill.Bundle, error) {
	return a.store.LoadSkillBundles(scopeID)
}

func (a *storageArtifactAccess) LoadSkill(scopeID string, bundleID skill.BundleID) (*skill.Bundle, error) {
	raw, err := a.store.Load(scopeID, storage.KindSkill, string(bundleID))
	if err != nil || raw == nil {
		return nil, err
	}
	var bundle skill.Bundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return nil, fmt.Errorf("digest load skill: %w", err)
	}
	return &bundle, nil
}

func (a *storageArtifactAccess) SaveSkill(bundle skill.Bundle) error {
	raw, err := json.Marshal(bundle)
	if err != nil {
		return fmt.Errorf("digest save skill: %w", err)
	}
	return a.store.Save(bundle.ScopeID, storage.KindSkill, string(bundle.BundleID), raw)
}

func (a *storageArtifactAccess) ArchiveSkill(scopeID string, bundleID skill.BundleID, now time.Time) error {
	bundle, err := a.LoadSkill(scopeID, bundleID)
	if err != nil {
		return err
	}
	if bundle == nil {
		return nil
	}
	bundle.Status = skill.BundleStatusArchived
	bundle.UpdatedAt = now
	return a.SaveSkill(*bundle)
}

func (a *storageArtifactAccess) RemoveSkill(scopeID string, bundleID skill.BundleID, now time.Time) error {
	bundle, err := a.LoadSkill(scopeID, bundleID)
	if err != nil {
		return err
	}
	if bundle == nil {
		return nil
	}
	if bundle.Status != skill.BundleStatusArchived {
		return fmt.Errorf("digest remove skill: bundle %s must be archived before remove", bundleID)
	}
	blockers, err := a.graph.RemoveBlockers(scopeID, artifactref.KindSkillBundle, string(bundleID))
	if err != nil {
		return err
	}
	blocking := blockingRemoveBlockers(toRoutineBlockers(blockers))
	if len(blocking) > 0 {
		return fmt.Errorf("digest remove skill: bundle %s is blocked by %s", bundleID, formatRoutineBlockers(blocking))
	}
	bundle.Status = skill.BundleStatusRemoved
	bundle.UpdatedAt = now
	return a.SaveSkill(*bundle)
}

func (a *storageArtifactAccess) SaveDigestRun(scopeID string, runID string, report any, candidates []storage.DigestCandidate, createdAt time.Time) error {
	return a.store.SaveDigestRun(scopeID, runID, report, candidates, createdAt)
}

func (a *storageArtifactAccess) LoadDigestRun(scopeID string, runID string) ([]byte, error) {
	return a.store.LoadDigestRun(scopeID, runID)
}

func (a *storageArtifactAccess) ListDigestRunIDs(scopeID string) ([]string, error) {
	return a.store.ListDigestRunIDs(scopeID)
}

func (a *storageArtifactAccess) LoadDigestCandidates(scopeID string, runID string) ([]storage.DigestCandidate, error) {
	return a.store.LoadDigestCandidates(scopeID, runID)
}

func (a *storageArtifactAccess) CountKnowledgeRelations(scopeID string) (int, error) {
	return a.store.CountKnowledgeRelations(scopeID)
}

func (g *storageGraphAccess) SupportSummary(scopeID string, toKind artifactref.Kind, toID string) (memory.SupportSummary, error) {
	return g.graph.SupportSummary(scopeID, toKind, toID)
}

func (g *storageGraphAccess) BrokenTargets(scopeID string, refs []artifactref.Ref) ([]artifactref.Ref, error) {
	return g.graph.BrokenTargets(scopeID, refs)
}

func (g *storageGraphAccess) OutgoingHealth(scopeID string, refs []artifactref.Ref) (routine.DependencyHealth, error) {
	health, err := g.graph.OutgoingHealth(scopeID, refs)
	if err != nil {
		return routine.DependencyHealth{}, err
	}
	return routine.DependencyHealth{
		StrongLive:   health.StrongLive,
		WeakLive:     health.WeakLive,
		Broken:       health.Broken,
		Dependencies: append([]routine.DependencyEdge(nil), health.Dependencies...),
	}, nil
}

func (g *storageGraphAccess) RemoveBlockers(scopeID string, toKind artifactref.Kind, toID string) ([]routine.Blocker, error) {
	blockers, err := g.graph.RemoveBlockers(scopeID, toKind, toID)
	if err != nil {
		return nil, err
	}
	out := make([]routine.Blocker, 0, len(blockers))
	for _, blocker := range blockers {
		out = append(out, routine.Blocker{
			Kind:            blocker.Kind,
			Strength:        blocker.Strength,
			SourceKind:      blocker.SourceKind,
			SourceID:        blocker.SourceID,
			SourceLifecycle: blocker.SourceLifecycle,
			SourceActive:    blocker.SourceActive,
			Role:            blocker.Role,
			Message:         blocker.Message,
		})
	}
	return out, nil
}

func (g *storageGraphAccess) OutgoingSupport(scopeID string, refs []artifactref.Ref) (routine.OutgoingSummary, error) {
	summary, err := g.graph.OutgoingSupport(scopeID, refs)
	if err != nil {
		return routine.OutgoingSummary{}, err
	}
	return routine.OutgoingSummary{StrongLive: summary.StrongLive, WeakLive: summary.WeakLive, Broken: summary.Broken}, nil
}
