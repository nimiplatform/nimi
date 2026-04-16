package kernelops

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/identity"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// Engine provides the 6 Git-like operations over kernel state.
type Engine struct {
	backend kernelRepository
	clock   clock.Clock
}

type kernelRepository interface {
	Save(scopeID string, kind storage.ArtifactKind, itemID string, data []byte) error
	Load(scopeID string, kind storage.ArtifactKind, itemID string) ([]byte, error)
	List(scopeID string, kind storage.ArtifactKind) ([]string, error)
}

type kernelStateLoader interface {
	LoadKernelState(scopeID string, kt kernel.KernelType) (*kernel.Kernel, []kernel.Rule, error)
}

// NewEngine creates an Engine backed by the given storage.
func NewEngine(backend kernelRepository, clk clock.Clock) *Engine {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &Engine{backend: backend, clock: clk}
}

// KernelStatus is a summary of a kernel's current state.
type KernelStatus struct {
	KernelID    string              `json:"kernel_id"`
	ScopeID     string              `json:"scope_id"`
	KernelType  kernel.KernelType   `json:"kernel_type"`
	Version     int                 `json:"version"`
	Status      kernel.KernelStatus `json:"status"`
	RuleCount   int                 `json:"rule_count"`
	ActiveCount int                 `json:"active_count"`
}

// Status returns a summary of a kernel's current state.
func (e *Engine) Status(scopeID string, kt kernel.KernelType) (*KernelStatus, error) {
	k, rules, err := e.loadKernel(scopeID, kt)
	if err != nil {
		return nil, fmt.Errorf("status: %w", err)
	}
	if k == nil {
		return nil, nil
	}
	active := 0
	for _, rule := range rules {
		if rule.Lifecycle == kernel.RuleLifecycleActive {
			active++
		}
	}
	return &KernelStatus{
		KernelID:    k.KernelID,
		ScopeID:     k.ScopeID,
		KernelType:  k.KernelType,
		Version:     k.Version,
		Status:      k.Status,
		RuleCount:   len(rules),
		ActiveCount: active,
	}, nil
}

// Diff computes a structured diff between the current kernel state and an
// incoming patch without modifying state.
func (e *Engine) Diff(patch IncomingPatch) (*DiffReport, error) {
	if err := ValidateIncomingPatch(patch); err != nil {
		return nil, fmt.Errorf("diff: %w", err)
	}
	_, rules, err := e.loadKernel(patch.ScopeID, patch.TargetKernel)
	if err != nil {
		return nil, fmt.Errorf("diff: %w", err)
	}
	ruleMap := indexRules(rules)

	diffID, err := identity.NewPrefixed("diff")
	if err != nil {
		return nil, fmt.Errorf("diff: %w", err)
	}

	entries := make([]DiffEntry, 0, len(patch.ProposedChanges))
	for _, proposed := range patch.ProposedChanges {
		entry := DiffEntry{
			RuleID:       proposed.RuleID,
			ChangeKind:   proposed.ChangeKind,
			IncomingRule: copyRulePtr(proposed.NewRule),
		}
		switch proposed.ChangeKind {
		case ChangeKindAdd:
			if proposed.NewRule != nil {
				entry.RuleID = proposed.NewRule.RuleID
			}
			if base, ok := ruleMap[entry.RuleID]; ok {
				entry.BaseRule = copyRule(base)
				entry.HasConflict = true
				entry.TransitionIssues = []string{"rule already exists"}
			}
		case ChangeKindUpdate:
			base, ok := ruleMap[proposed.RuleID]
			if !ok {
				entry.HasConflict = true
				entry.TransitionIssues = []string{"target rule not found"}
				break
			}
			entry.BaseRule = copyRule(base)
			entry.ChangedFields = changedFields(base, *proposed.NewRule)
			entry.TransitionIssues = validateRuleTransition(base, *proposed.NewRule)
			if base.Version != proposed.BaseVersion {
				entry.HasConflict = true
				entry.TransitionIssues = append(entry.TransitionIssues, fmt.Sprintf("base_version mismatch: current=%d patch=%d", base.Version, proposed.BaseVersion))
			}
			if len(entry.TransitionIssues) > 0 {
				entry.HasConflict = true
			}
		case ChangeKindRemove:
			base, ok := ruleMap[proposed.RuleID]
			if !ok {
				entry.HasConflict = true
				entry.TransitionIssues = []string{"target rule not found"}
				break
			}
			entry.BaseRule = copyRule(base)
			if base.Version != proposed.BaseVersion {
				entry.HasConflict = true
				entry.TransitionIssues = append(entry.TransitionIssues, fmt.Sprintf("base_version mismatch: current=%d patch=%d", base.Version, proposed.BaseVersion))
			}
		}
		if len(entry.ChangedFields) == 0 && proposed.ChangeKind == ChangeKindUpdate && proposed.NewRule != nil && entry.BaseRule != nil {
			entry.ChangedFields = []string{"no_field_change"}
		}
		entries = append(entries, entry)
	}

	return &DiffReport{
		DiffID:           DiffID(diffID),
		TargetKernel:     patch.TargetKernel,
		ScopeID:          patch.ScopeID,
		IncomingPatchRef: patch.PatchID,
		Entries:          entries,
		ComputedAt:       e.clock.Now(),
	}, nil
}

// Merge attempts an automatic merge. Conflicts are surfaced at field and
// state-axis granularity.
func (e *Engine) Merge(patch IncomingPatch) (*ResolvedPatch, *ConflictReport, error) {
	diff, err := e.Diff(patch)
	if err != nil {
		return nil, nil, fmt.Errorf("merge: %w", err)
	}

	var conflicts []Conflict
	var resolved []ResolvedChange
	for _, entry := range diff.Entries {
		if entry.HasConflict {
			conflicts = append(conflicts, Conflict{
				RuleID:           entry.RuleID,
				ConflictReason:   inferConflictReason(entry),
				Fields:           append([]string(nil), entry.ChangedFields...),
				BaseSnapshot:     copyRulePtr(entry.BaseRule),
				CurrentSnapshot:  copyRulePtr(entry.BaseRule),
				IncomingSnapshot: copyRulePtr(entry.IncomingRule),
			})
			continue
		}
		change := ResolvedChange{
			RuleID:         entry.RuleID,
			ChangeKind:     entry.ChangeKind,
			ResolutionKind: ResolutionKindAcceptPatch,
			FinalRule:      copyRulePtr(entry.IncomingRule),
		}
		if entry.BaseRule != nil {
			change.BaseVersion = entry.BaseRule.Version
		}
		resolved = append(resolved, change)
	}

	if len(conflicts) > 0 {
		conflictID, err := identity.NewPrefixed("conflict")
		if err != nil {
			return nil, nil, fmt.Errorf("merge: %w", err)
		}
		return nil, &ConflictReport{
			ConflictID:       ConflictID(conflictID),
			TargetKernel:     patch.TargetKernel,
			ScopeID:          patch.ScopeID,
			IncomingPatchRef: patch.PatchID,
			Conflicts:        conflicts,
			DetectedAt:       e.clock.Now(),
		}, nil
	}

	rpID, err := identity.NewPrefixed("rp")
	if err != nil {
		return nil, nil, fmt.Errorf("merge: %w", err)
	}
	return &ResolvedPatch{
		ResolvedPatchID: ResolvedPatchID(rpID),
		TargetKernel:    patch.TargetKernel,
		ScopeID:         patch.ScopeID,
		ResolvedChanges: resolved,
		ResolvedBy:      "auto",
		ResolvedAt:      e.clock.Now(),
	}, nil, nil
}

// Resolve validates a resolved patch against the current kernel state without
// persisting it.
func (e *Engine) Resolve(rp ResolvedPatch) error {
	if err := ValidateResolvedPatch(rp); err != nil {
		return err
	}
	_, rules, err := e.loadKernel(rp.ScopeID, rp.TargetKernel)
	if err != nil {
		return fmt.Errorf("resolve: %w", err)
	}
	ruleMap := indexRules(rules)
	return validateResolvedChanges(ruleMap, rp.ResolvedChanges)
}

// Commit applies a resolved patch and persists the updated state + commit record.
func (e *Engine) Commit(rp ResolvedPatch) (*CommitRecord, error) {
	if err := e.Resolve(rp); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	k, rules, err := e.loadKernel(rp.ScopeID, rp.TargetKernel)
	if err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	if k == nil {
		return nil, fmt.Errorf("commit: kernel not found for scope %s type %s", rp.ScopeID, rp.TargetKernel)
	}

	beforeRules := cloneRules(rules)
	prevVersion := k.Version
	ruleMap := indexRules(rules)

	affected := make([]kernel.RuleID, 0, len(rp.ResolvedChanges))
	for _, change := range rp.ResolvedChanges {
		affected = append(affected, change.RuleID)
		switch change.ChangeKind {
		case ChangeKindAdd, ChangeKindUpdate:
			ruleMap[change.FinalRule.RuleID] = *change.FinalRule
		case ChangeKindRemove:
			delete(ruleMap, change.RuleID)
		}
	}

	newRules := sortedRules(ruleMap)
	newRefs := make([]kernel.RuleID, 0, len(newRules))
	for _, rule := range newRules {
		newRefs = append(newRefs, rule.RuleID)
	}
	k.Version++
	k.RuleRefs = newRefs
	k.UpdatedAt = e.clock.Now()
	if err := validateKernelState(*k, newRules); err != nil {
		return nil, fmt.Errorf("commit: validate kernel state: %w", err)
	}
	if err := validateSupersessionTargets(newRules); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	if err := validateArtifactRefTargets(e.backend, rp.ScopeID, newRules); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	if err := e.saveKernel(rp.ScopeID, rp.TargetKernel, k, newRules); err != nil {
		return nil, fmt.Errorf("commit: save kernel: %w", err)
	}

	commitID, err := identity.NewPrefixed("commit")
	if err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	record := &CommitRecord{
		CommitID:         CommitID(commitID),
		ScopeID:          rp.ScopeID,
		KernelID:         k.KernelID,
		KernelType:       rp.TargetKernel,
		AffectedRuleIDs:  affected,
		ResolvedPatchRef: rp.ResolvedPatchID,
		Summary:          rp.Rationale,
		PreviousVersion:  prevVersion,
		NewVersion:       k.Version,
		BeforeSnapshot:   beforeRules,
		AfterSnapshot:    cloneRules(newRules),
		CreatedBy:        rp.ResolvedBy,
		CreatedAt:        e.clock.Now(),
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("commit: marshal commit: %w", err)
	}
	if err := e.backend.Save(rp.ScopeID, storage.KindCommit, string(record.CommitID), raw); err != nil {
		return nil, fmt.Errorf("commit: save commit: %w", err)
	}
	return record, nil
}

// Log returns commit history for the requested kernel.
func (e *Engine) Log(scopeID string, kt kernel.KernelType) ([]CommitRecord, error) {
	ids, err := e.backend.List(scopeID, storage.KindCommit)
	if err != nil {
		return nil, fmt.Errorf("log: %w", err)
	}
	var records []CommitRecord
	for _, id := range ids {
		raw, err := e.backend.Load(scopeID, storage.KindCommit, id)
		if err != nil {
			return nil, fmt.Errorf("log: load %s: %w", id, err)
		}
		if raw == nil {
			continue
		}
		var record CommitRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, fmt.Errorf("log: unmarshal %s: %w", id, err)
		}
		if record.KernelType == kt {
			records = append(records, record)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].CreatedAt.After(records[j].CreatedAt)
	})
	return records, nil
}

type kernelData struct {
	Kernel kernel.Kernel `json:"kernel"`
	Rules  []kernel.Rule `json:"rules"`
}

func (e *Engine) loadKernel(scopeID string, kt kernel.KernelType) (*kernel.Kernel, []kernel.Rule, error) {
	if loader, ok := e.backend.(kernelStateLoader); ok {
		return loader.LoadKernelState(scopeID, kt)
	}
	raw, err := e.backend.Load(scopeID, storage.KindKernel, string(kt))
	if err != nil || raw == nil {
		return nil, nil, err
	}
	var payload kernelData
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, nil, fmt.Errorf("unmarshal kernel: %w", err)
	}
	return &payload.Kernel, payload.Rules, nil
}

func (e *Engine) saveKernel(scopeID string, kt kernel.KernelType, k *kernel.Kernel, rules []kernel.Rule) error {
	raw, err := json.Marshal(kernelData{Kernel: *k, Rules: rules})
	if err != nil {
		return fmt.Errorf("marshal kernel: %w", err)
	}
	return e.backend.Save(scopeID, storage.KindKernel, string(kt), raw)
}

func validateResolvedChanges(current map[kernel.RuleID]kernel.Rule, changes []ResolvedChange) error {
	for _, change := range changes {
		base, exists := current[change.RuleID]
		switch change.ChangeKind {
		case ChangeKindAdd:
			if exists {
				return fmt.Errorf("rule %s already exists", change.RuleID)
			}
			if change.FinalRule == nil {
				return fmt.Errorf("add %s missing final rule", change.RuleID)
			}
		case ChangeKindUpdate:
			if !exists {
				return fmt.Errorf("rule %s not found", change.RuleID)
			}
			if change.BaseVersion != base.Version {
				return fmt.Errorf("rule %s base_version mismatch: current=%d resolved=%d", change.RuleID, base.Version, change.BaseVersion)
			}
			if issues := validateRuleTransition(base, *change.FinalRule); len(issues) > 0 {
				return fmt.Errorf("rule %s invalid transition: %v", change.RuleID, issues)
			}
		case ChangeKindRemove:
			if !exists {
				return fmt.Errorf("rule %s not found", change.RuleID)
			}
			if change.BaseVersion != base.Version {
				return fmt.Errorf("rule %s base_version mismatch: current=%d resolved=%d", change.RuleID, base.Version, change.BaseVersion)
			}
		}
	}
	return nil
}

func validateRuleTransition(base kernel.Rule, next kernel.Rule) []string {
	var issues []string
	if base.RuleID != next.RuleID {
		issues = append(issues, "rule_id is immutable")
	}
	if base.Kind != next.Kind {
		issues = append(issues, "rule_kind is immutable")
	}
	if next.Version <= base.Version {
		issues = append(issues, "version must advance")
	}
	if next.AnchorBinding == kernel.AnchorBindingLocalOnly && next.Alignment != "" {
		issues = append(issues, "local_only rules cannot carry alignment_state")
	}
	if next.Alignment == kernel.AlignmentLocalOverride && next.AnchorBinding != kernel.AnchorBindingAnchored {
		issues = append(issues, "local_override requires anchored rule")
	}
	if next.Lifecycle == kernel.RuleLifecycleSuperseded && next.SupersededBy == "" {
		issues = append(issues, "superseded rules require superseded_by")
	}
	if next.Lifecycle != kernel.RuleLifecycleSuperseded && next.SupersededBy != "" {
		issues = append(issues, "superseded_by is only allowed for superseded lifecycle")
	}
	if base.AnchorBinding == kernel.AnchorBindingLocalOnly && next.AnchorBinding == kernel.AnchorBindingAnchored && next.Alignment == "" {
		issues = append(issues, "anchoring a local rule requires alignment_state")
	}
	return issues
}

func validateSupersessionTargets(rules []kernel.Rule) error {
	ruleMap := indexRules(rules)
	for _, rule := range rules {
		if rule.Lifecycle != kernel.RuleLifecycleSuperseded {
			continue
		}
		if rule.SupersededBy == "" {
			return fmt.Errorf("rule %s is superseded without superseded_by", rule.RuleID)
		}
		if rule.SupersededBy == rule.RuleID {
			return fmt.Errorf("rule %s cannot supersede itself", rule.RuleID)
		}
		if _, ok := ruleMap[rule.SupersededBy]; !ok {
			return fmt.Errorf("rule %s superseded_by %s does not exist", rule.RuleID, rule.SupersededBy)
		}
	}
	return nil
}

func validateArtifactRefTargets(backend kernelRepository, scopeID string, rules []kernel.Rule) error {
	for _, rule := range rules {
		for _, ref := range rule.ArtifactRefs {
			if ref.FromKind != artifactref.KindKernelRule || ref.FromID != string(rule.RuleID) {
				return fmt.Errorf("rule %s owns mismatched artifact_ref", rule.RuleID)
			}
			var kind storage.ArtifactKind
			switch ref.ToKind {
			case artifactref.KindMemoryRecord:
				kind = storage.KindMemory
			case artifactref.KindKnowledgePage:
				kind = storage.KindKnowledge
			case artifactref.KindSkillBundle:
				kind = storage.KindSkill
			default:
				continue
			}
			raw, err := backend.Load(scopeID, kind, ref.ToID)
			if err != nil {
				return err
			}
			if raw == nil {
				return fmt.Errorf("rule %s references missing %s %s", rule.RuleID, ref.ToKind, ref.ToID)
			}
		}
	}
	return nil
}

func indexRules(rules []kernel.Rule) map[kernel.RuleID]kernel.Rule {
	index := make(map[kernel.RuleID]kernel.Rule, len(rules))
	for _, rule := range rules {
		index[rule.RuleID] = rule
	}
	return index
}

func copyRule(rule kernel.Rule) *kernel.Rule {
	copied := rule
	return &copied
}

func copyRulePtr(rule *kernel.Rule) *kernel.Rule {
	if rule == nil {
		return nil
	}
	copied := *rule
	return &copied
}

func cloneRules(rules []kernel.Rule) []kernel.Rule {
	out := make([]kernel.Rule, len(rules))
	copy(out, rules)
	return out
}

func sortedRules(ruleMap map[kernel.RuleID]kernel.Rule) []kernel.Rule {
	rules := make([]kernel.Rule, 0, len(ruleMap))
	for _, rule := range ruleMap {
		rules = append(rules, rule)
	}
	sort.Slice(rules, func(i, j int) bool {
		return rules[i].RuleID < rules[j].RuleID
	})
	return rules
}

func inferConflictReason(entry DiffEntry) string {
	if len(entry.TransitionIssues) > 0 {
		return entry.TransitionIssues[0]
	}
	switch entry.ChangeKind {
	case ChangeKindAdd:
		return "rule already exists"
	case ChangeKindUpdate, ChangeKindRemove:
		return "local state has diverged from patch base"
	default:
		return "unknown conflict"
	}
}

func changedFields(base kernel.Rule, next kernel.Rule) []string {
	var fields []string
	if base.Statement != next.Statement {
		fields = append(fields, "statement")
	}
	if !reflect.DeepEqual(base.Value, next.Value) {
		fields = append(fields, "value")
	}
	if !reflect.DeepEqual(base.SourceRefs, next.SourceRefs) {
		fields = append(fields, "source_refs")
	}
	if !reflect.DeepEqual(base.ArtifactRefs, next.ArtifactRefs) {
		fields = append(fields, "artifact_refs")
	}
	if base.AnchorBinding != next.AnchorBinding {
		fields = append(fields, "anchor_binding")
	}
	if base.Alignment != next.Alignment {
		fields = append(fields, "alignment_state")
	}
	if base.Lifecycle != next.Lifecycle {
		fields = append(fields, "rule_lifecycle_state")
	}
	if base.SupersededBy != next.SupersededBy {
		fields = append(fields, "superseded_by")
	}
	if base.Version != next.Version {
		fields = append(fields, "version")
	}
	return fields
}

func validateKernelState(k kernel.Kernel, rules []kernel.Rule) error {
	switch k.KernelType {
	case kernel.KernelTypeAgentModel:
		return kernel.ValidateAgentModelKernel(kernel.AgentModelKernel{Kernel: k, Rules: rules})
	case kernel.KernelTypeWorldModel:
		return kernel.ValidateWorldModelKernel(kernel.WorldModelKernel{Kernel: k, Rules: rules})
	default:
		return kernel.ValidateKernel(k)
	}
}
