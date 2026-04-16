package cognition

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
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

func validateKnowledgePagesForService(store *storage.SQLiteBackend, pages []knowledge.Page) ([]knowledge.Page, error) {
	for _, page := range pages {
		if err := validateKnowledgePageRelations(page); err != nil {
			return nil, err
		}
		if err := validateKnowledgePageCitations(store, page); err != nil {
			return nil, err
		}
	}
	return pages, nil
}

func validateVisibleKnowledgePagesForService(store *storage.SQLiteBackend, pages []knowledge.Page) ([]knowledge.Page, error) {
	pages, err := validateVisibleKnowledgePages(pages)
	if err != nil {
		return nil, err
	}
	return validateKnowledgePagesForService(store, pages)
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
	return validateVisibleKnowledgePagesForService(store, pages)
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
		live, err := store.IsArtifactRefTargetLive(scopeID, ref.ToKind, ref.ToID)
		if err != nil {
			return err
		}
		if !live {
			return fmt.Errorf("referenced artifact %s/%s does not exist or is removed", ref.ToKind, ref.ToID)
		}
	}
	return nil
}

func validateMemorySaveLifecycle(store *storage.SQLiteBackend, rec memory.Record) error {
	if rec.Lifecycle != memory.RecordLifecycleActive {
		return fmt.Errorf("illegal lifecycle mutation: memory save only admits active records, got %s", rec.Lifecycle)
	}
	existing, err := loadOptionalMemoryRecord(store, rec.ScopeID, rec.RecordID)
	if err != nil {
		return err
	}
	if existing != nil && existing.Lifecycle != memory.RecordLifecycleActive {
		return fmt.Errorf("illegal lifecycle mutation: memory record %s cannot be updated from %s via public save", rec.RecordID, existing.Lifecycle)
	}
	return nil
}

func validateKnowledgeSaveLifecycle(store *storage.SQLiteBackend, page knowledge.Page) error {
	if !knowledgeLifecycleIsWriterOwned(page.Lifecycle) {
		return fmt.Errorf("illegal lifecycle mutation: knowledge save only admits active or stale pages, got %s", page.Lifecycle)
	}
	existing, err := loadOptionalKnowledgePage(store, page.ScopeID, page.PageID)
	if err != nil {
		return err
	}
	if existing != nil && !knowledgeLifecycleIsWriterOwned(existing.Lifecycle) {
		return fmt.Errorf("illegal lifecycle mutation: knowledge page %s cannot be updated from %s via public save", page.PageID, existing.Lifecycle)
	}
	return nil
}

func validateKnowledgePageForWrite(store *storage.SQLiteBackend, page knowledge.Page) error {
	if err := knowledge.ValidatePage(page); err != nil {
		return err
	}
	if err := validateKnowledgeSaveLifecycle(store, page); err != nil {
		return err
	}
	if err := validateKnowledgePageRelations(page); err != nil {
		return err
	}
	if err := validateKnowledgePageCitations(store, page); err != nil {
		return err
	}
	return ensureRefsExist(store, page.ScopeID, page.ArtifactRefs)
}

func validateSkillSaveLifecycle(store *storage.SQLiteBackend, bundle skill.Bundle) error {
	if !skillStatusIsWriterOwned(bundle.Status) {
		return fmt.Errorf("illegal lifecycle mutation: skill save only admits draft or active bundles, got %s", bundle.Status)
	}
	existing, err := loadOptionalSkillBundle(store, bundle.ScopeID, bundle.BundleID)
	if err != nil {
		return err
	}
	if existing != nil && !skillStatusIsWriterOwned(existing.Status) {
		return fmt.Errorf("illegal lifecycle mutation: skill bundle %s cannot be updated from %s via public save", bundle.BundleID, existing.Status)
	}
	return nil
}

func knowledgeLifecycleIsWriterOwned(l knowledge.ProjectionLifecycle) bool {
	return l == knowledge.ProjectionLifecycleActive || l == knowledge.ProjectionLifecycleStale
}

func skillStatusIsWriterOwned(s skill.BundleStatus) bool {
	return s == skill.BundleStatusDraft || s == skill.BundleStatusActive
}

func knowledgePageIsLiveForRelation(page *knowledge.Page) bool {
	if page == nil {
		return false
	}
	return page.Lifecycle == knowledge.ProjectionLifecycleActive || page.Lifecycle == knowledge.ProjectionLifecycleStale
}

func validateKnowledgePageCitations(store *storage.SQLiteBackend, page knowledge.Page) error {
	for i, citation := range page.Citations {
		switch citation.TargetKind {
		case knowledge.CitationTargetKindKernelRule:
			rule, err := store.LoadKernelRuleByID(page.ScopeID, citation.TargetID)
			if err != nil {
				return fmt.Errorf("page %s citations[%d]: %w", page.PageID, i, err)
			}
			if rule == nil {
				return fmt.Errorf("page %s citations[%d]: kernel rule %s does not exist in scope %s", page.PageID, i, citation.TargetID, page.ScopeID)
			}
			if rule.Lifecycle != kernel.RuleLifecycleActive {
				return fmt.Errorf("page %s citations[%d]: kernel rule %s is not active in scope %s", page.PageID, i, citation.TargetID, page.ScopeID)
			}
		case knowledge.CitationTargetKindMemoryRecord:
			live, err := store.IsArtifactRefTargetLive(page.ScopeID, artifactref.KindMemoryRecord, citation.TargetID)
			if err != nil {
				return fmt.Errorf("page %s citations[%d]: %w", page.PageID, i, err)
			}
			if !live {
				return fmt.Errorf("page %s citations[%d]: memory record %s does not exist or is removed in scope %s", page.PageID, i, citation.TargetID, page.ScopeID)
			}
		default:
			return fmt.Errorf("page %s citations[%d]: invalid citation target_kind %q", page.PageID, i, citation.TargetKind)
		}
	}
	return nil
}

func loadOptionalMemoryRecord(store *storage.SQLiteBackend, scopeID string, recordID memory.RecordID) (*memory.Record, error) {
	raw, err := store.Load(scopeID, storage.KindMemory, string(recordID))
	if err != nil || raw == nil {
		return nil, err
	}
	var rec memory.Record
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, fmt.Errorf("memory load: %w", err)
	}
	if err := memory.ValidateRecord(rec); err != nil {
		return nil, fmt.Errorf("memory load: %w", err)
	}
	return &rec, nil
}

func loadOptionalKnowledgePage(store *storage.SQLiteBackend, scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	raw, err := store.Load(scopeID, storage.KindKnowledge, string(pageID))
	if err != nil || raw == nil {
		return nil, err
	}
	var page knowledge.Page
	if err := json.Unmarshal(raw, &page); err != nil {
		return nil, fmt.Errorf("knowledge load: %w", err)
	}
	if err := knowledge.ValidatePage(page); err != nil {
		return nil, fmt.Errorf("knowledge load: %w", err)
	}
	if err := validateKnowledgePageRelations(page); err != nil {
		return nil, fmt.Errorf("knowledge load: %w", err)
	}
	if err := validateKnowledgePageCitations(store, page); err != nil {
		return nil, fmt.Errorf("knowledge load: %w", err)
	}
	return &page, nil
}

func loadOptionalSkillBundle(store *storage.SQLiteBackend, scopeID string, bundleID skill.BundleID) (*skill.Bundle, error) {
	raw, err := store.Load(scopeID, storage.KindSkill, string(bundleID))
	if err != nil || raw == nil {
		return nil, err
	}
	var bundle skill.Bundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return nil, fmt.Errorf("skill load: %w", err)
	}
	if err := skill.ValidateBundle(bundle); err != nil {
		return nil, fmt.Errorf("skill load: %w", err)
	}
	return &bundle, nil
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

func knowledgeCitationBlockerParts(store *storage.SQLiteBackend, scopeID string, targetKind string, targetID string) ([]string, error) {
	sources, err := store.ListKnowledgeCitationSources(scopeID, targetKind, targetID)
	if err != nil {
		return nil, err
	}
	parts := make([]string, 0, len(sources))
	for _, source := range sources {
		parts = append(parts, fmt.Sprintf("knowledge_citation:knowledge_page/%s(%s)", source.PageID, source.Lifecycle))
	}
	return parts, nil
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

func (a *routineArtifactAccess) KnowledgeCitationBlockedBy(scopeID string, targetKind string, targetID string) ([]string, error) {
	if a == nil || a.store == nil {
		return nil, fmt.Errorf("routine context: digest persistence store is required")
	}
	return knowledgeCitationBlockerParts(a.store, scopeID, targetKind, targetID)
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
