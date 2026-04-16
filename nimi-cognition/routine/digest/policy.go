package digest

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func previousDigestState(scopeID string, access routine.ArtifactAccess) (TriggerSummary, []storage.DigestCandidate, error) {
	runIDs, err := access.ListDigestRunIDs(scopeID)
	if err != nil {
		return TriggerSummary{}, nil, err
	}
	if len(runIDs) == 0 {
		return TriggerSummary{}, nil, nil
	}
	raw, err := access.LoadDigestRun(scopeID, runIDs[0])
	if err != nil {
		return TriggerSummary{}, nil, err
	}
	var report Report
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &report); err != nil {
			return TriggerSummary{}, nil, fmt.Errorf("digest previous run: decode: %w", err)
		}
	}
	candidates, err := access.LoadDigestCandidates(scopeID, runIDs[0])
	if err != nil {
		return TriggerSummary{}, nil, err
	}
	return report.Analysis.Trigger, candidates, nil
}

func buildTriggerSummary(current triggerSnapshot, previous TriggerSummary) TriggerSummary {
	return TriggerSummary{
		ContentVolume: TriggerMetric{Current: current.contentVolume, Previous: previous.ContentVolume.Current, Delta: current.contentVolume - previous.ContentVolume.Current},
		SupportChange: TriggerMetric{Current: current.supportChange, Previous: previous.SupportChange.Current, Delta: current.supportChange - previous.SupportChange.Current},
		RefGraphChurn: TriggerMetric{Current: current.refGraphChurn, Previous: previous.RefGraphChurn.Current, Delta: current.refGraphChurn - previous.RefGraphChurn.Current},
	}
}

func brokenDependencies(health routine.DependencyHealth) []routine.DependencyEdge {
	var broken []routine.DependencyEdge
	for _, dep := range health.Dependencies {
		if dep.Status == routine.DependencyStatusBrokenTarget {
			broken = append(broken, dep)
		}
	}
	return broken
}

func shouldArchiveMemory(record memory.Record, summary memory.SupportSummary, outgoing routine.DependencyHealth) bool {
	if record.Lifecycle != memory.RecordLifecycleActive {
		return false
	}
	return summary.Score == 0 || outgoing.Broken > 0
}

func shouldArchiveKnowledge(page knowledge.Page, summary memory.SupportSummary, broken []routine.DependencyEdge) bool {
	if page.Lifecycle != knowledge.ProjectionLifecycleActive && page.Lifecycle != knowledge.ProjectionLifecycleStale {
		return false
	}
	return len(broken) > 0 || summary.Score == 0
}

func shouldArchiveSkill(bundle skill.Bundle, summary memory.SupportSummary, broken []routine.DependencyEdge, outgoing routine.DependencyHealth) bool {
	if bundle.Status != skill.BundleStatusActive && bundle.Status != skill.BundleStatusDraft {
		return false
	}
	return len(broken) > 0 || skillLowValue(summary, outgoing, bundle)
}

func skillLowValue(summary memory.SupportSummary, outgoing routine.DependencyHealth, bundle skill.Bundle) bool {
	if len(bundle.ArtifactRefs) == 0 {
		return false
	}
	return summary.Score == 0 && outgoing.Broken == 0 && outgoing.StrongLive+outgoing.WeakLive == 0
}

func memoryArchiveReason(summary memory.SupportSummary, broken []routine.DependencyEdge) string {
	if len(broken) > 0 {
		return "record has invalidated dependencies"
	}
	if summary.Score == 0 {
		return "record has no live incoming support"
	}
	return "record no longer satisfies archive policy"
}

func knowledgeArchiveReason(summary memory.SupportSummary, broken []routine.DependencyEdge) string {
	if len(broken) > 0 {
		return "projection has broken dependencies"
	}
	if summary.Score == 0 {
		return "projection has zero incoming support"
	}
	return "projection no longer satisfies archive policy"
}

func skillArchiveReason(summary memory.SupportSummary, broken []routine.DependencyEdge, outgoing routine.DependencyHealth) string {
	if len(broken) > 0 {
		return "bundle has broken dependencies"
	}
	if summary.Score == 0 {
		return "bundle has confirmed low support"
	}
	return "bundle no longer satisfies archive policy"
}

func memoryLowValueBasis(summary memory.SupportSummary, outgoing routine.DependencyHealth) (string, bool) {
	if outgoing.Broken > 0 {
		return lowValueBasisInvalidatedDependency, true
	}
	if summary.Score == 0 {
		return lowValueBasisZeroSupport, true
	}
	return "", false
}

func knowledgeLowValueBasis(summary memory.SupportSummary, broken []routine.DependencyEdge) (string, bool) {
	if len(broken) > 0 {
		return lowValueBasisBrokenDependencies, true
	}
	if summary.Score == 0 {
		return lowValueBasisZeroSupport, true
	}
	return "", false
}

func skillLowValueBasis(summary memory.SupportSummary, outgoing routine.DependencyHealth, bundle skill.Bundle) (string, bool) {
	if outgoing.Broken > 0 {
		return lowValueBasisBrokenDependencies, true
	}
	if skillLowValue(summary, outgoing, bundle) {
		return lowValueBasisLowSupport, true
	}
	return "", false
}

func blockerProfile(blockers []routine.Blocker) string {
	hasStrong := false
	hasActiveWeak := false
	hasWeak := false
	for _, blocker := range blockers {
		switch blocker.Kind {
		case routine.BlockerKindStrongRef:
			hasStrong = true
		case routine.BlockerKindWeakRef:
			hasWeak = true
			if blocker.SourceActive {
				hasActiveWeak = true
			}
		case routine.BlockerKindDownstreamLiveDependency:
			hasActiveWeak = true
		}
	}
	switch {
	case hasStrong:
		return "strong_ref"
	case hasActiveWeak:
		return "active_weak_ref"
	case hasWeak:
		return "weak_ref"
	default:
		return "none"
	}
}

func candidateScore(family string, basis string, summary memory.SupportSummary, outgoing routine.DependencyHealth, blockers []routine.Blocker, laterPassConfirmed bool) float64 {
	score := 0.0
	switch basis {
	case lowValueBasisBrokenDependencies:
		score += 10
	case lowValueBasisInvalidatedDependency:
		score += 9
	case lowValueBasisZeroSupport:
		score += 8
	case lowValueBasisLowSupport:
		score += 5
	}
	score += float64(len(brokenDependencies(outgoing)) * 3)
	if summary.Score == 0 {
		score += 3
	} else {
		score += positiveDelta(2 - summary.Score)
	}
	for _, blocker := range blockers {
		switch blocker.Kind {
		case routine.BlockerKindStrongRef:
			score -= 4
		case routine.BlockerKindWeakRef:
			if blocker.SourceActive {
				score -= 2
			} else {
				score -= 0.5
			}
		case routine.BlockerKindDownstreamLiveDependency:
			score -= 2
		}
	}
	if laterPassConfirmed {
		score += 2
	}
	switch family {
	case "knowledge":
		score += 1.5
	case "skill":
		score += 0.5
	}
	return score
}

func positiveDelta(v float64) float64 {
	if v > 0 {
		return v
	}
	return 0
}

func buildCandidate(family string, artifactKind artifactref.Kind, artifactID string, lifecycle string, action string, reason string, summary memory.SupportSummary, outgoing routine.DependencyHealth, blockers []routine.Blocker, trigger TriggerSummary, basis string, laterPassConfirmed bool, updatedAt time.Time) Candidate {
	groupKey := fmt.Sprintf("%s:%s:%s", family, basis, blockerProfile(blockers))
	score := candidateScore(family, basis, summary, outgoing, blockers, laterPassConfirmed)
	detail := Detail{
		TriggerBasis:         trigger,
		Support:              summary,
		DependencyHealth:     outgoing,
		BrokenDependencies:   brokenDependencies(outgoing),
		Blockers:             blockers,
		LowValueBasis:        basis,
		GroupKey:             groupKey,
		Score:                score,
		PriorArchiveRequired: action == "remove" && !laterPassConfirmed,
		LaterPassConfirmed:   laterPassConfirmed,
	}
	return Candidate{
		Family:           family,
		ArtifactKind:     string(artifactKind),
		ArtifactID:       artifactID,
		CurrentLifecycle: lifecycle,
		ProposedAction:   action,
		Reason:           reason,
		SupportScore:     summary.Score,
		StrongRefs:       summary.Strong,
		WeakRefs:         summary.Weak,
		LowValueBasis:    basis,
		GroupKey:         groupKey,
		Score:            score,
		Detail:           detail,
		updatedAt:        updatedAt,
	}
}

func (d *Digest) memoryRemoveCandidate(scopeID string, record memory.Record, summary memory.SupportSummary, outgoing routine.DependencyHealth, previous []storage.DigestCandidate, graph routine.GraphAccess, trigger TriggerSummary) (Candidate, bool) {
	if record.Lifecycle != memory.RecordLifecycleArchived {
		return Candidate{}, false
	}
	basis, ok := memoryLowValueBasis(summary, outgoing)
	if !ok {
		return Candidate{}, false
	}
	blockers, _ := graph.RemoveBlockers(scopeID, artifactref.KindMemoryRecord, string(record.RecordID))
	laterPassConfirmed := hasPriorDigestConfirmation(previous, "memory", string(artifactref.KindMemoryRecord), string(record.RecordID), "remove", basis)
	return buildCandidate("memory", artifactref.KindMemoryRecord, string(record.RecordID), string(record.Lifecycle), "remove", "record remains archived and low-value on a later digest pass", summary, outgoing, blockers, trigger, basis, laterPassConfirmed, record.UpdatedAt), true
}

func (d *Digest) knowledgeRemoveCandidate(scopeID string, page knowledge.Page, summary memory.SupportSummary, outgoing routine.DependencyHealth, previous []storage.DigestCandidate, graph routine.GraphAccess, trigger TriggerSummary) (Candidate, bool) {
	if page.Lifecycle != knowledge.ProjectionLifecycleArchived {
		return Candidate{}, false
	}
	basis, ok := knowledgeLowValueBasis(summary, brokenDependencies(outgoing))
	if !ok {
		return Candidate{}, false
	}
	blockers, _ := graph.RemoveBlockers(scopeID, artifactref.KindKnowledgePage, string(page.PageID))
	laterPassConfirmed := hasPriorDigestConfirmation(previous, "knowledge", string(artifactref.KindKnowledgePage), string(page.PageID), "remove", basis)
	return buildCandidate("knowledge", artifactref.KindKnowledgePage, string(page.PageID), string(page.Lifecycle), "remove", "projection remains archived and low-value on a later digest pass", summary, outgoing, blockers, trigger, basis, laterPassConfirmed, page.UpdatedAt), true
}

func (d *Digest) skillRemoveCandidate(scopeID string, bundle skill.Bundle, summary memory.SupportSummary, outgoing routine.DependencyHealth, previous []storage.DigestCandidate, graph routine.GraphAccess, trigger TriggerSummary) (Candidate, bool) {
	if bundle.Status != skill.BundleStatusArchived {
		return Candidate{}, false
	}
	basis, ok := skillLowValueBasis(summary, outgoing, bundle)
	if !ok {
		return Candidate{}, false
	}
	blockers, _ := graph.RemoveBlockers(scopeID, artifactref.KindSkillBundle, string(bundle.BundleID))
	laterPassConfirmed := hasPriorDigestConfirmation(previous, "skill", string(artifactref.KindSkillBundle), string(bundle.BundleID), "remove", basis)
	return buildCandidate("skill", artifactref.KindSkillBundle, string(bundle.BundleID), string(bundle.Status), "remove", "bundle remains archived and low-value on a later digest pass", summary, outgoing, blockers, trigger, basis, laterPassConfirmed, bundle.UpdatedAt), true
}

type removeGating struct {
	laterPassConfirmed bool
}

func removeGate(scopeID string, candidate Candidate, lifecycle string, previous []storage.DigestCandidate, graph routine.GraphAccess) (removeGating, []string, []routine.Blocker, error) {
	var blockers []routine.Blocker
	if lifecycle != "archived" {
		blockers = append(blockers, routine.Blocker{Kind: routine.BlockerKindArchiveFirst, Message: "remove requires archived lifecycle before cleanup"})
	}
	laterPassConfirmed := hasPriorDigestConfirmation(previous, candidate.Family, candidate.ArtifactKind, candidate.ArtifactID, candidate.ProposedAction, candidate.LowValueBasis)
	if !laterPassConfirmed {
		blockers = append(blockers, routine.Blocker{Kind: routine.BlockerKindArchiveFirst, Message: "remove requires the same low-value basis on a later digest pass"})
	}
	incoming, err := graph.RemoveBlockers(scopeID, artifactref.Kind(candidate.ArtifactKind), candidate.ArtifactID)
	if err != nil {
		return removeGating{}, nil, nil, err
	}
	for _, blocker := range incoming {
		switch blocker.Kind {
		case routine.BlockerKindStrongRef:
			blockers = append(blockers, blocker)
		case routine.BlockerKindWeakRef:
			if blocker.SourceActive {
				blocker.Kind = routine.BlockerKindDownstreamLiveDependency
				if blocker.Message == "" {
					blocker.Message = "active downstream weak dependency still references artifact"
				}
				blockers = append(blockers, blocker)
			}
		}
	}
	blockedBy := make([]string, 0, len(blockers))
	for _, blocker := range blockers {
		blockedBy = append(blockedBy, blockerKindString(blocker))
	}
	return removeGating{laterPassConfirmed: laterPassConfirmed}, blockedBy, blockers, nil
}

func hasPriorDigestConfirmation(previous []storage.DigestCandidate, family string, artifactKind string, artifactID string, action string, basis string) bool {
	for _, candidate := range previous {
		if candidate.Family != family || candidate.ArtifactKind != artifactKind || candidate.ArtifactID != artifactID || candidate.Action != action {
			continue
		}
		if storedLowValueBasis(candidate) == basis {
			return true
		}
	}
	return false
}

func storedLowValueBasis(candidate storage.DigestCandidate) string {
	var payload struct {
		LowValueBasis string `json:"low_value_basis"`
		Detail        struct {
			LowValueBasis string `json:"low_value_basis"`
		} `json:"detail"`
	}
	if err := json.Unmarshal(candidate.Detail, &payload); err != nil {
		return ""
	}
	if payload.LowValueBasis != "" {
		return payload.LowValueBasis
	}
	return payload.Detail.LowValueBasis
}

func hasArchiveFirst(blockers []routine.Blocker) bool {
	for _, blocker := range blockers {
		if blocker.Kind == routine.BlockerKindArchiveFirst {
			return true
		}
	}
	return false
}

func blockerKindString(blocker routine.Blocker) string {
	switch blocker.Kind {
	case routine.BlockerKindStrongRef, routine.BlockerKindWeakRef, routine.BlockerKindDownstreamLiveDependency:
		return fmt.Sprintf("%s:%s/%s", blocker.Kind, blocker.SourceKind, blocker.SourceID)
	default:
		return string(blocker.Kind)
	}
}

func blockedTransition(candidate Candidate, action string, reason string, blockers []routine.Blocker) BlockedTransition {
	blockedBy := make([]string, 0, len(blockers))
	for _, blocker := range blockers {
		blockedBy = append(blockedBy, blockerKindString(blocker))
	}
	detail := candidate.Detail
	if len(blockers) > 0 {
		detail.Blockers = blockers
	}
	return BlockedTransition{
		Family:       candidate.Family,
		ArtifactKind: candidate.ArtifactKind,
		ArtifactID:   candidate.ArtifactID,
		Action:       action,
		Reason:       reason,
		BlockedBy:    blockedBy,
		Detail:       detail,
	}
}

func countMemoryRefs(records []memory.Record) int {
	total := 0
	for _, record := range records {
		total += len(record.ArtifactRefs)
	}
	return total
}

func countKnowledgeRefs(pages []knowledge.Page) int {
	total := 0
	for _, page := range pages {
		total += len(page.ArtifactRefs)
	}
	return total
}

func countSkillRefs(bundles []skill.Bundle) int {
	total := 0
	for _, bundle := range bundles {
		total += len(bundle.ArtifactRefs)
	}
	return total
}

func cleanupOrder(family string) int {
	switch family {
	case "knowledge":
		return 0
	case "skill":
		return 1
	case "memory":
		return 2
	default:
		return 99
	}
}

func candidateActionOrder(action string) int {
	switch action {
	case "archive":
		return 0
	case "remove":
		return 1
	default:
		return 99
	}
}

func digestCandidates(report *Report) []storage.DigestCandidate {
	var candidates []storage.DigestCandidate
	for _, item := range report.Analysis.Candidates {
		detail, _ := json.Marshal(item)
		candidates = append(candidates, storage.DigestCandidate{RunID: report.RunID, Family: item.Family, ArtifactKind: item.ArtifactKind, ArtifactID: item.ArtifactID, Action: item.ProposedAction, Status: "candidate", Reason: item.Reason, Detail: detail, CreatedAt: report.StartedAt, UpdatedAt: report.CompletedAt})
	}
	for _, item := range report.Applied {
		detail, _ := json.Marshal(item)
		candidates = append(candidates, storage.DigestCandidate{RunID: report.RunID, Family: item.Family, ArtifactKind: item.ArtifactKind, ArtifactID: item.ArtifactID, Action: item.ToState, Status: "applied", Reason: item.Reason, Detail: detail, CreatedAt: report.StartedAt, UpdatedAt: report.CompletedAt})
	}
	for _, item := range report.Blocked {
		detail, _ := json.Marshal(item)
		candidates = append(candidates, storage.DigestCandidate{RunID: report.RunID, Family: item.Family, ArtifactKind: item.ArtifactKind, ArtifactID: item.ArtifactID, Action: item.Action, Status: "blocked", Reason: item.Reason, Detail: detail, CreatedAt: report.StartedAt, UpdatedAt: report.CompletedAt})
	}
	return candidates
}
