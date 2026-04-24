package cognition

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/promptfmt"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/refgraph"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
	"github.com/nimiplatform/nimi/nimi-cognition/working"
)

func (s *SkillService) Save(bundle skill.Bundle) error {
	if err := skill.ValidateBundle(bundle); err != nil {
		return fmt.Errorf("skill save: %w", err)
	}
	if err := validateSkillSaveLifecycle(s.store, bundle); err != nil {
		return fmt.Errorf("skill save: %w", err)
	}
	if err := ensureRefsExist(s.store, bundle.ScopeID, bundle.ArtifactRefs); err != nil {
		return fmt.Errorf("skill save: %w", err)
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		return fmt.Errorf("skill save: marshal: %w", err)
	}
	return s.store.Save(bundle.ScopeID, storage.KindSkill, string(bundle.BundleID), raw)
}

func (s *SkillService) Load(scopeID string, bundleID skill.BundleID) (*skill.Bundle, error) {
	bundle, err := s.loadOptional(scopeID, bundleID)
	if err != nil {
		return nil, err
	}
	if bundle == nil {
		return nil, fmt.Errorf("skill load: bundle %s does not exist in scope %s", bundleID, scopeID)
	}
	return bundle, nil
}

func (s *SkillService) List(scopeID string) ([]skill.Bundle, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	bundles, err := s.store.LoadSkillBundles(scopeID)
	if err != nil {
		return nil, err
	}
	return validateVisibleSkillBundles(bundles)
}

func (s *SkillService) Search(scopeID string, query string, limit int) ([]skill.Bundle, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateQueryRequired("skill search", query); err != nil {
		return nil, err
	}
	bundles, err := s.store.SearchSkill(scopeID, query, limit)
	if err != nil {
		return nil, err
	}
	return validateVisibleSkillBundles(bundles)
}

func (s *SkillService) Delete(scopeID string, bundleID skill.BundleID) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if strings.TrimSpace(string(bundleID)) == "" {
		return errors.New("skill delete: bundle_id is required")
	}
	if bundle, err := s.loadOptional(scopeID, bundleID); err != nil {
		return err
	} else if bundle == nil {
		return fmt.Errorf("skill delete: bundle %s does not exist in scope %s", bundleID, scopeID)
	}
	blockers, err := s.refgraph.RemoveBlockers(scopeID, artifactref.KindSkillBundle, string(bundleID))
	if err != nil {
		return err
	}
	blocking := blockingDeleteBlockers(blockers)
	if len(blocking) > 0 {
		return fmt.Errorf("skill delete: bundle %s is blocked by %s", bundleID, formatDeleteBlockers(blocking))
	}
	return s.store.Delete(scopeID, storage.KindSkill, string(bundleID))
}

func (s *SkillService) History(scopeID string, bundleID skill.BundleID) ([]skill.HistoryEntry, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(bundleID)) == "" {
		return nil, errors.New("skill history: bundle_id is required")
	}
	history, err := s.store.LoadSkillHistory(scopeID, string(bundleID))
	if err != nil {
		return nil, err
	}
	if len(history) == 0 {
		bundle, err := s.loadOptional(scopeID, bundleID)
		if err != nil {
			return nil, err
		}
		if bundle == nil {
			return nil, fmt.Errorf("skill history: bundle %s does not exist in scope %s", bundleID, scopeID)
		}
	}
	return history, nil
}

func (s *SkillService) ListIDs(scopeID string) ([]string, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	bundles, err := s.List(scopeID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(bundles))
	for _, bundle := range bundles {
		ids = append(ids, string(bundle.BundleID))
	}
	return ids, nil
}

func (s *SkillService) loadOptional(scopeID string, bundleID skill.BundleID) (*skill.Bundle, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(bundleID)) == "" {
		return nil, errors.New("skill load: bundle_id is required")
	}
	bundle, err := loadOptionalSkillBundle(s.store, scopeID, bundleID)
	if err != nil {
		return nil, err
	}
	if bundle == nil {
		return nil, nil
	}
	return bundle, nil
}

func (s *SkillService) archive(scopeID string, bundleID skill.BundleID, now time.Time) error {
	bundle, err := s.Load(scopeID, bundleID)
	if err != nil {
		return err
	}
	if bundle.Status != skill.BundleStatusActive && bundle.Status != skill.BundleStatusDraft {
		return fmt.Errorf("skill archive: bundle %s cannot transition from %s", bundleID, bundle.Status)
	}
	bundle.Status = skill.BundleStatusArchived
	bundle.UpdatedAt = now
	return s.persistBundle(*bundle)
}

func (s *SkillService) remove(scopeID string, bundleID skill.BundleID, now time.Time) error {
	bundle, err := s.Load(scopeID, bundleID)
	if err != nil {
		return err
	}
	if bundle.Status != skill.BundleStatusArchived {
		return fmt.Errorf("skill remove: bundle %s must be archived before remove", bundleID)
	}
	blockers, err := s.refgraph.RemoveBlockers(scopeID, artifactref.KindSkillBundle, string(bundleID))
	if err != nil {
		return err
	}
	blocking := blockingDeleteBlockers(blockers)
	if len(blocking) > 0 {
		return fmt.Errorf("skill remove: bundle %s is blocked by %s", bundleID, formatDeleteBlockers(blocking))
	}
	bundle.Status = skill.BundleStatusRemoved
	bundle.UpdatedAt = now
	return s.persistBundle(*bundle)
}

func (s *SkillService) persistBundle(bundle skill.Bundle) error {
	if err := skill.ValidateBundle(bundle); err != nil {
		return fmt.Errorf("skill persist: %w", err)
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		return fmt.Errorf("skill persist: %w", err)
	}
	return s.store.Save(bundle.ScopeID, storage.KindSkill, string(bundle.BundleID), raw)
}

func (s *WorkingService) Save(state working.State) error {
	if err := working.ValidateState(state); err != nil {
		return fmt.Errorf("working save: %w", err)
	}
	s.store.save(state)
	return nil
}

func (s *WorkingService) Load(scopeID string) (*working.State, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	state, ok := s.store.load(scopeID)
	if !ok {
		return nil, nil
	}
	return &state, nil
}

func (s *WorkingService) Clear(scopeID string) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	s.store.clear(scopeID)
	return nil
}

func (s *PromptService) FormatCore(scopeID string) (string, error) {
	rules, err := loadScopeRulesStrict(s.store, scopeID)
	if err != nil {
		return "", err
	}
	return promptfmt.FormatCoreContext(rules), nil
}

func (s *PromptService) FormatAdvisory(scopeID string) (string, error) {
	if err := validateScopeID(scopeID); err != nil {
		return "", err
	}
	views, err := decorateMemoryViews(s.store, s.refgraph, scopeID)
	if err != nil {
		return "", err
	}
	pages, err := loadValidatedKnowledgePages(s.store, scopeID)
	if err != nil {
		return "", err
	}
	bundles, err := loadValidatedSkillBundles(s.store, scopeID)
	if err != nil {
		return "", err
	}
	return promptfmt.FormatAdvisoryContext(views, pages, bundles), nil
}

func (s *PromptService) FormatAll(scopeID string) (string, error) {
	rules, err := loadScopeRulesStrict(s.store, scopeID)
	if err != nil {
		return "", err
	}
	views, err := decorateMemoryViews(s.store, s.refgraph, scopeID)
	if err != nil {
		return "", err
	}
	pages, err := loadValidatedKnowledgePages(s.store, scopeID)
	if err != nil {
		return "", err
	}
	bundles, err := loadValidatedSkillBundles(s.store, scopeID)
	if err != nil {
		return "", err
	}
	return promptfmt.FormatAll(rules, views, pages, bundles), nil
}

func decorateMemoryViews(store *storage.SQLiteBackend, graph *refgraph.Service, scopeID string) ([]memory.View, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	records, err := store.LoadMemoryRecords(scopeID)
	if err != nil {
		return nil, err
	}
	records, err = validateMemoryRecords(records)
	if err != nil {
		return nil, err
	}
	records = visibleMemoryRecords(records)
	views := make([]memory.View, 0, len(records))
	for _, rec := range records {
		summary, err := graph.SupportSummary(scopeID, artifactref.KindMemoryRecord, string(rec.RecordID))
		if err != nil {
			return nil, err
		}
		lineage, err := graph.LiveIncomingRefs(scopeID, artifactref.KindMemoryRecord, string(rec.RecordID))
		if err != nil {
			return nil, err
		}
		invalidation, err := graph.InvalidationReasons(scopeID, rec.ArtifactRefs)
		if err != nil {
			return nil, err
		}
		sortArtifactRefs(lineage)
		sort.Strings(invalidation)
		views = append(views, memory.View{
			Record:              rec,
			Support:             summary,
			Lineage:             lineage,
			InvalidationReasons: invalidation,
			CleanupSignals:      cleanupSignals(rec, summary, invalidation),
		})
	}
	sortMemoryViews(views)
	return views, nil
}

func loadScopeRules(store *storage.SQLiteBackend, scopeID string) ([]kernel.Rule, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	var rules []kernel.Rule
	for _, kind := range []kernel.KernelType{kernel.KernelTypeAgentModel, kernel.KernelTypeWorldModel} {
		_, loaded, err := store.LoadKernelState(scopeID, kind)
		if err != nil {
			return nil, err
		}
		rules = append(rules, loaded...)
	}
	return rules, nil
}

func loadScopeRulesStrict(store *storage.SQLiteBackend, scopeID string) ([]kernel.Rule, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	var rules []kernel.Rule
	for _, kind := range []kernel.KernelType{kernel.KernelTypeAgentModel, kernel.KernelTypeWorldModel} {
		loadedKernel, loadedRules, err := store.LoadKernelState(scopeID, kind)
		if err != nil {
			return nil, err
		}
		if loadedKernel == nil {
			return nil, fmt.Errorf("prompt load rules: missing %s kernel for scope %s", kind, scopeID)
		}
		rules = append(rules, loadedRules...)
	}
	return rules, nil
}
