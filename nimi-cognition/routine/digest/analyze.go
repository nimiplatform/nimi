package digest

import (
	"fmt"
	"sort"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func (d *Digest) analyzeAccess(scopeID string, now time.Time, access routine.ArtifactAccess, graph routine.GraphAccess) (AnalysisReport, error) {
	report := AnalysisReport{GeneratedAt: now}
	previousTrigger, previousCandidates, err := previousDigestState(scopeID, access)
	if err != nil {
		return AnalysisReport{}, err
	}
	currentSnapshot := triggerSnapshot{}

	if d.cfg.memoryEnabled() {
		records, err := access.ListMemory(scopeID)
		if err != nil {
			return AnalysisReport{}, fmt.Errorf("digest analyze memory: %w", err)
		}
		currentSnapshot.refGraphChurn += countMemoryRefs(records)
		for _, record := range records {
			if record.Lifecycle == memory.RecordLifecycleRemoved {
				continue
			}
			currentSnapshot.contentVolume++
			summary, err := graph.SupportSummary(scopeID, artifactref.KindMemoryRecord, string(record.RecordID))
			if err != nil {
				return AnalysisReport{}, err
			}
			outgoing, err := graph.OutgoingHealth(scopeID, record.ArtifactRefs)
			if err != nil {
				return AnalysisReport{}, err
			}
			broken := brokenDependencies(outgoing)
			if summary.Score == 0 || len(broken) > 0 {
				currentSnapshot.supportChange++
			}
			if len(broken) > 0 {
				report.Findings = append(report.Findings, Finding{
					Family:       "memory",
					ArtifactKind: string(artifactref.KindMemoryRecord),
					ArtifactID:   string(record.RecordID),
					Kind:         "invalidated_dependency",
					Message:      "memory record depends on unavailable cognition artifacts",
				})
			}
			if summary.Score == 0 {
				report.Findings = append(report.Findings, Finding{
					Family:       "memory",
					ArtifactKind: string(artifactref.KindMemoryRecord),
					ArtifactID:   string(record.RecordID),
					Kind:         "zero_support",
					Message:      "memory record has no incoming support",
				})
			}
			trigger := buildTriggerSummary(currentSnapshot, previousTrigger)
			blockers, err := graph.RemoveBlockers(scopeID, artifactref.KindMemoryRecord, string(record.RecordID))
			if err != nil {
				return AnalysisReport{}, err
			}
			if basis, ok := memoryLowValueBasis(summary, outgoing); shouldArchiveMemory(record, summary, outgoing) && ok {
				report.Candidates = append(report.Candidates, buildCandidate(
					"memory",
					artifactref.KindMemoryRecord,
					string(record.RecordID),
					string(record.Lifecycle),
					"archive",
					memoryArchiveReason(summary, broken),
					summary,
					outgoing,
					blockers,
					trigger,
					basis,
					false,
					record.UpdatedAt,
				))
			}
			if candidate, ok := d.memoryRemoveCandidate(scopeID, record, summary, outgoing, previousCandidates, graph, trigger); ok {
				report.Candidates = append(report.Candidates, candidate)
			}
		}
	}

	if d.cfg.knowledgeEnabled() {
		pages, err := access.ListKnowledge(scopeID)
		if err != nil {
			return AnalysisReport{}, fmt.Errorf("digest analyze knowledge: %w", err)
		}
		currentSnapshot.refGraphChurn += countKnowledgeRefs(pages)
		if counter, ok := access.(knowledgeRelationCounter); ok {
			relCount, err := counter.CountKnowledgeRelations(scopeID)
			if err != nil {
				return AnalysisReport{}, err
			}
			currentSnapshot.refGraphChurn += relCount
		}
		for _, page := range pages {
			if page.Lifecycle == knowledge.ProjectionLifecycleRemoved {
				continue
			}
			currentSnapshot.contentVolume++
			summary, err := graph.SupportSummary(scopeID, artifactref.KindKnowledgePage, string(page.PageID))
			if err != nil {
				return AnalysisReport{}, err
			}
			outgoing, err := graph.OutgoingHealth(scopeID, page.ArtifactRefs)
			if err != nil {
				return AnalysisReport{}, err
			}
			broken := brokenDependencies(outgoing)
			if summary.Score == 0 || len(broken) > 0 {
				currentSnapshot.supportChange++
			}
			if len(broken) > 0 {
				report.Findings = append(report.Findings, Finding{
					Family:       "knowledge",
					ArtifactKind: string(artifactref.KindKnowledgePage),
					ArtifactID:   string(page.PageID),
					Kind:         "broken_dependencies",
					Message:      "knowledge projection references unavailable dependencies",
				})
			}
			if summary.Score == 0 {
				report.Findings = append(report.Findings, Finding{
					Family:       "knowledge",
					ArtifactKind: string(artifactref.KindKnowledgePage),
					ArtifactID:   string(page.PageID),
					Kind:         "zero_support",
					Message:      "knowledge projection has no incoming support",
				})
			}
			trigger := buildTriggerSummary(currentSnapshot, previousTrigger)
			blockers, err := graph.RemoveBlockers(scopeID, artifactref.KindKnowledgePage, string(page.PageID))
			if err != nil {
				return AnalysisReport{}, err
			}
			if basis, ok := knowledgeLowValueBasis(summary, broken); shouldArchiveKnowledge(page, summary, broken) && ok {
				report.Candidates = append(report.Candidates, buildCandidate(
					"knowledge",
					artifactref.KindKnowledgePage,
					string(page.PageID),
					string(page.Lifecycle),
					"archive",
					knowledgeArchiveReason(summary, broken),
					summary,
					outgoing,
					blockers,
					trigger,
					basis,
					false,
					page.UpdatedAt,
				))
			}
			if candidate, ok := d.knowledgeRemoveCandidate(scopeID, page, summary, outgoing, previousCandidates, graph, trigger); ok {
				report.Candidates = append(report.Candidates, candidate)
			}
		}
	}

	if d.cfg.skillEnabled() {
		bundles, err := access.ListSkills(scopeID)
		if err != nil {
			return AnalysisReport{}, fmt.Errorf("digest analyze skill: %w", err)
		}
		currentSnapshot.refGraphChurn += countSkillRefs(bundles)
		for _, bundle := range bundles {
			if bundle.Status == skill.BundleStatusRemoved {
				continue
			}
			currentSnapshot.contentVolume++
			summary, err := graph.SupportSummary(scopeID, artifactref.KindSkillBundle, string(bundle.BundleID))
			if err != nil {
				return AnalysisReport{}, err
			}
			outgoing, err := graph.OutgoingHealth(scopeID, bundle.ArtifactRefs)
			if err != nil {
				return AnalysisReport{}, err
			}
			broken := brokenDependencies(outgoing)
			if len(broken) > 0 || skillLowValue(summary, outgoing, bundle) {
				currentSnapshot.supportChange++
			}
			if len(broken) > 0 {
				report.Findings = append(report.Findings, Finding{
					Family:       "skill",
					ArtifactKind: string(artifactref.KindSkillBundle),
					ArtifactID:   string(bundle.BundleID),
					Kind:         "broken_dependencies",
					Message:      "skill bundle references unavailable dependencies",
				})
			}
			if skillLowValue(summary, outgoing, bundle) {
				report.Findings = append(report.Findings, Finding{
					Family:       "skill",
					ArtifactKind: string(artifactref.KindSkillBundle),
					ArtifactID:   string(bundle.BundleID),
					Kind:         "low_support",
					Message:      "skill bundle has low surviving support",
				})
			}
			trigger := buildTriggerSummary(currentSnapshot, previousTrigger)
			blockers, err := graph.RemoveBlockers(scopeID, artifactref.KindSkillBundle, string(bundle.BundleID))
			if err != nil {
				return AnalysisReport{}, err
			}
			if basis, ok := skillLowValueBasis(summary, outgoing, bundle); shouldArchiveSkill(bundle, summary, broken, outgoing) && ok {
				report.Candidates = append(report.Candidates, buildCandidate(
					"skill",
					artifactref.KindSkillBundle,
					string(bundle.BundleID),
					string(bundle.Status),
					"archive",
					skillArchiveReason(summary, broken, outgoing),
					summary,
					outgoing,
					blockers,
					trigger,
					basis,
					false,
					bundle.UpdatedAt,
				))
			}
			if candidate, ok := d.skillRemoveCandidate(scopeID, bundle, summary, outgoing, previousCandidates, graph, trigger); ok {
				report.Candidates = append(report.Candidates, candidate)
			}
		}
	}

	report.Trigger = buildTriggerSummary(currentSnapshot, previousTrigger)
	sort.SliceStable(report.Candidates, func(i, j int) bool {
		if cleanupOrder(report.Candidates[i].Family) == cleanupOrder(report.Candidates[j].Family) {
			if report.Candidates[i].ProposedAction == report.Candidates[j].ProposedAction {
				if report.Candidates[i].Score == report.Candidates[j].Score {
					if report.Candidates[i].updatedAt.Equal(report.Candidates[j].updatedAt) {
						return report.Candidates[i].ArtifactID < report.Candidates[j].ArtifactID
					}
					return report.Candidates[i].updatedAt.After(report.Candidates[j].updatedAt)
				}
				return report.Candidates[i].Score > report.Candidates[j].Score
			}
			return candidateActionOrder(report.Candidates[i].ProposedAction) < candidateActionOrder(report.Candidates[j].ProposedAction)
		}
		return cleanupOrder(report.Candidates[i].Family) < cleanupOrder(report.Candidates[j].Family)
	})
	return report, nil
}
