package cognition

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
	"github.com/nimiplatform/nimi/nimi-cognition/working"
)

func validateMemoryRecords(records []memory.Record) ([]memory.Record, error) {
	for _, rec := range records {
		if err := memory.ValidateRecord(rec); err != nil {
			return nil, err
		}
	}
	return records, nil
}

func validateVisibleMemoryRecords(records []memory.Record) ([]memory.Record, error) {
	records, err := validateMemoryRecords(records)
	if err != nil {
		return nil, err
	}
	return visibleMemoryRecords(records), nil
}

func validateKnowledgePages(pages []knowledge.Page) ([]knowledge.Page, error) {
	for _, page := range pages {
		if err := knowledge.ValidatePage(page); err != nil {
			return nil, err
		}
	}
	return pages, nil
}

func validateVisibleKnowledgePages(pages []knowledge.Page) ([]knowledge.Page, error) {
	pages, err := validateKnowledgePages(pages)
	if err != nil {
		return nil, err
	}
	return visibleKnowledgePages(pages), nil
}

func validateSkillBundles(bundles []skill.Bundle) ([]skill.Bundle, error) {
	for _, bundle := range bundles {
		if err := skill.ValidateBundle(bundle); err != nil {
			return nil, err
		}
	}
	return bundles, nil
}

func validateVisibleSkillBundles(bundles []skill.Bundle) ([]skill.Bundle, error) {
	bundles, err := validateSkillBundles(bundles)
	if err != nil {
		return nil, err
	}
	return visibleSkillBundles(bundles), nil
}

func visibleMemoryRecords(records []memory.Record) []memory.Record {
	filtered := make([]memory.Record, 0, len(records))
	for _, rec := range records {
		if rec.Lifecycle == memory.RecordLifecycleRemoved {
			continue
		}
		filtered = append(filtered, rec)
	}
	return filtered
}

func visibleKnowledgePages(pages []knowledge.Page) []knowledge.Page {
	filtered := make([]knowledge.Page, 0, len(pages))
	for _, page := range pages {
		if page.Lifecycle == knowledge.ProjectionLifecycleRemoved {
			continue
		}
		filtered = append(filtered, page)
	}
	return filtered
}

func visibleSkillBundles(bundles []skill.Bundle) []skill.Bundle {
	filtered := make([]skill.Bundle, 0, len(bundles))
	for _, bundle := range bundles {
		if bundle.Status == skill.BundleStatusRemoved {
			continue
		}
		filtered = append(filtered, bundle)
	}
	return filtered
}

func loadValidatedKnowledgePages(store *storage.SQLiteBackend, scopeID string) ([]knowledge.Page, error) {
	pages, err := store.LoadKnowledgePages(scopeID)
	if err != nil {
		return nil, err
	}
	return validateVisibleKnowledgePages(pages)
}

func loadValidatedSkillBundles(store *storage.SQLiteBackend, scopeID string) ([]skill.Bundle, error) {
	bundles, err := store.LoadSkillBundles(scopeID)
	if err != nil {
		return nil, err
	}
	return validateVisibleSkillBundles(bundles)
}

func validateQueryRequired(op string, query string) error {
	if strings.TrimSpace(query) == "" {
		return fmt.Errorf("%s: query is required", op)
	}
	return nil
}

func ensureRefsExist(store *storage.SQLiteBackend, scopeID string, refs []artifactref.Ref) error {
	for _, ref := range refs {
		live, err := referencedArtifactIsLive(store, scopeID, ref.ToKind, ref.ToID)
		if err != nil {
			return err
		}
		if !live {
			return fmt.Errorf("referenced artifact %s/%s does not exist or is removed", ref.ToKind, ref.ToID)
		}
	}
	return nil
}

func referencedArtifactIsLive(store *storage.SQLiteBackend, scopeID string, kind artifactref.Kind, itemID string) (bool, error) {
	var storageKind storage.ArtifactKind
	switch kind {
	case artifactref.KindMemoryRecord:
		storageKind = storage.KindMemory
	case artifactref.KindKnowledgePage:
		storageKind = storage.KindKnowledge
	case artifactref.KindSkillBundle:
		storageKind = storage.KindSkill
	default:
		return false, fmt.Errorf("referenced artifact kind %s is not admitted", kind)
	}
	raw, err := store.Load(scopeID, storageKind, itemID)
	if err != nil {
		return false, err
	}
	if raw == nil {
		return false, nil
	}
	switch kind {
	case artifactref.KindMemoryRecord:
		var rec memory.Record
		if err := json.Unmarshal(raw, &rec); err != nil {
			return false, fmt.Errorf("referenced artifact %s/%s is malformed: %w", kind, itemID, err)
		}
		return rec.Lifecycle != memory.RecordLifecycleRemoved, nil
	case artifactref.KindKnowledgePage:
		var page knowledge.Page
		if err := json.Unmarshal(raw, &page); err != nil {
			return false, fmt.Errorf("referenced artifact %s/%s is malformed: %w", kind, itemID, err)
		}
		return page.Lifecycle != knowledge.ProjectionLifecycleRemoved, nil
	case artifactref.KindSkillBundle:
		var bundle skill.Bundle
		if err := json.Unmarshal(raw, &bundle); err != nil {
			return false, fmt.Errorf("referenced artifact %s/%s is malformed: %w", kind, itemID, err)
		}
		return bundle.Status != skill.BundleStatusRemoved, nil
	default:
		return false, nil
	}
}

func sortRelations(relations []knowledge.Relation) {
	sort.SliceStable(relations, func(i, j int) bool {
		if relations[i].UpdatedAt.Equal(relations[j].UpdatedAt) {
			if relations[i].FromPageID == relations[j].FromPageID {
				if relations[i].ToPageID == relations[j].ToPageID {
					return relations[i].RelationType < relations[j].RelationType
				}
				return relations[i].ToPageID < relations[j].ToPageID
			}
			return relations[i].FromPageID < relations[j].FromPageID
		}
		return relations[i].UpdatedAt.After(relations[j].UpdatedAt)
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *workingStore) save(state working.State) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.states[state.ScopeID] = cloneWorkingState(state)
}

func (s *workingStore) load(scopeID string) (working.State, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	state, ok := s.states[scopeID]
	if !ok {
		return working.State{}, false
	}
	return cloneWorkingState(state), true
}

func (s *workingStore) clear(scopeID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.states, scopeID)
}

func (s *workingStore) clearAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.states = map[string]working.State{}
}

func cloneWorkingState(in working.State) working.State {
	out := in
	if in.ActiveTurn != nil {
		turn := *in.ActiveTurn
		out.ActiveTurn = &turn
	}
	out.PlanningSlots = append([]working.PlanningSlot(nil), in.PlanningSlots...)
	out.ToolScaffolds = append([]working.ToolScaffold(nil), in.ToolScaffolds...)
	if in.Scratch != nil {
		out.Scratch = append([]byte(nil), in.Scratch...)
	}
	for i := range out.PlanningSlots {
		if in.PlanningSlots[i].Content != nil {
			out.PlanningSlots[i].Content = append([]byte(nil), in.PlanningSlots[i].Content...)
		}
	}
	for i := range out.ToolScaffolds {
		if in.ToolScaffolds[i].Parameters != nil {
			out.ToolScaffolds[i].Parameters = append([]byte(nil), in.ToolScaffolds[i].Parameters...)
		}
	}
	return out
}

func sortArtifactRefs(refs []artifactref.Ref) {
	sort.SliceStable(refs, func(i, j int) bool {
		if refs[i].Strength == refs[j].Strength {
			if refs[i].UpdatedAt.Equal(refs[j].UpdatedAt) {
				if refs[i].FromKind == refs[j].FromKind {
					return refs[i].FromID < refs[j].FromID
				}
				return refs[i].FromKind < refs[j].FromKind
			}
			return refs[i].UpdatedAt.After(refs[j].UpdatedAt)
		}
		return refs[i].Strength == artifactref.StrengthStrong
	})
}

func sortMemoryViews(views []memory.View) {
	sort.SliceStable(views, func(i, j int) bool {
		leftInvalidated := len(views[i].InvalidationReasons) > 0
		rightInvalidated := len(views[j].InvalidationReasons) > 0
		if leftInvalidated != rightInvalidated {
			return !leftInvalidated
		}
		if views[i].Support.Score == views[j].Support.Score {
			return views[i].Record.UpdatedAt.After(views[j].Record.UpdatedAt)
		}
		return views[i].Support.Score > views[j].Support.Score
	})
}

func sortStrings(values []string) {
	sort.Strings(values)
}

func (a *routineArtifactAccess) ListMemory(scopeID string) ([]memory.Record, error) {
	return a.memorySvc.List(scopeID)
}

func (a *routineArtifactAccess) LoadMemory(scopeID string, recordID memory.RecordID) (*memory.Record, error) {
	return a.memorySvc.Load(scopeID, recordID)
}

func (a *routineArtifactAccess) SaveMemory(record memory.Record) error {
	return a.memorySvc.Save(record)
}

func (a *routineArtifactAccess) ArchiveMemory(scopeID string, recordID memory.RecordID, now time.Time) error {
	return a.memorySvc.archive(scopeID, recordID, now)
}

func (a *routineArtifactAccess) RemoveMemory(scopeID string, recordID memory.RecordID, now time.Time) error {
	return a.memorySvc.remove(scopeID, recordID, now)
}

func (a *routineArtifactAccess) ListKnowledge(scopeID string) ([]knowledge.Page, error) {
	return a.knowledge.List(scopeID)
}

func (a *routineArtifactAccess) LoadKnowledge(scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	return a.knowledge.Load(scopeID, pageID)
}

func (a *routineArtifactAccess) SaveKnowledge(page knowledge.Page) error {
	return a.knowledge.Save(page)
}

func (a *routineArtifactAccess) ArchiveKnowledge(scopeID string, pageID knowledge.PageID, now time.Time) error {
	return a.knowledge.archive(scopeID, pageID, now)
}

func (a *routineArtifactAccess) RemoveKnowledge(scopeID string, pageID knowledge.PageID, now time.Time) error {
	return a.knowledge.remove(scopeID, pageID, now)
}

func (a *routineArtifactAccess) ListSkills(scopeID string) ([]skill.Bundle, error) {
	return a.skill.List(scopeID)
}

func (a *routineArtifactAccess) LoadSkill(scopeID string, bundleID skill.BundleID) (*skill.Bundle, error) {
	return a.skill.Load(scopeID, bundleID)
}

func (a *routineArtifactAccess) SaveSkill(bundle skill.Bundle) error {
	return a.skill.Save(bundle)
}

func (a *routineArtifactAccess) ArchiveSkill(scopeID string, bundleID skill.BundleID, now time.Time) error {
	return a.skill.archive(scopeID, bundleID, now)
}

func (a *routineArtifactAccess) RemoveSkill(scopeID string, bundleID skill.BundleID, now time.Time) error {
	return a.skill.remove(scopeID, bundleID, now)
}

func (a *routineArtifactAccess) SaveDigestRun(scopeID string, runID string, report any, candidates []storage.DigestCandidate, createdAt time.Time) error {
	if a == nil || a.store == nil {
		return fmt.Errorf("routine context: digest persistence store is required")
	}
	return a.store.SaveDigestRun(scopeID, runID, report, candidates, createdAt)
}

func (a *routineArtifactAccess) LoadDigestRun(scopeID string, runID string) ([]byte, error) {
	if a == nil || a.store == nil {
		return nil, fmt.Errorf("routine context: digest persistence store is required")
	}
	return a.store.LoadDigestRun(scopeID, runID)
}

func (a *routineArtifactAccess) ListDigestRunIDs(scopeID string) ([]string, error) {
	if a == nil || a.store == nil {
		return nil, fmt.Errorf("routine context: digest persistence store is required")
	}
	return a.store.ListDigestRunIDs(scopeID)
}

func (a *routineArtifactAccess) LoadDigestCandidates(scopeID string, runID string) ([]storage.DigestCandidate, error) {
	if a == nil || a.store == nil {
		return nil, fmt.Errorf("routine context: digest persistence store is required")
	}
	return a.store.LoadDigestCandidates(scopeID, runID)
}

func (a *routineArtifactAccess) CountKnowledgeRelations(scopeID string) (int, error) {
	if a == nil || a.store == nil {
		return 0, fmt.Errorf("routine context: digest persistence store is required")
	}
	return a.store.CountKnowledgeRelations(scopeID)
}

func (a *routineGraphAccess) SupportSummary(scopeID string, toKind artifactref.Kind, toID string) (memory.SupportSummary, error) {
	return a.refgraph.SupportSummary(scopeID, toKind, toID)
}

func (a *routineGraphAccess) BrokenTargets(scopeID string, refs []artifactref.Ref) ([]artifactref.Ref, error) {
	return a.refgraph.BrokenTargets(scopeID, refs)
}

func (a *routineGraphAccess) OutgoingSupport(scopeID string, refs []artifactref.Ref) (routine.OutgoingSummary, error) {
	summary, err := a.refgraph.OutgoingSupport(scopeID, refs)
	if err != nil {
		return routine.OutgoingSummary{}, err
	}
	return routine.OutgoingSummary{StrongLive: summary.StrongLive, WeakLive: summary.WeakLive, Broken: summary.Broken}, nil
}

func (a *routineGraphAccess) OutgoingHealth(scopeID string, refs []artifactref.Ref) (routine.DependencyHealth, error) {
	health, err := a.refgraph.OutgoingHealth(scopeID, refs)
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

func (a *routineGraphAccess) RemoveBlockers(scopeID string, toKind artifactref.Kind, toID string) ([]routine.Blocker, error) {
	blockers, err := a.refgraph.RemoveBlockers(scopeID, toKind, toID)
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
