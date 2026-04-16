package digest

import (
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func (d *Digest) applyAccess(scopeID string, analysis AnalysisReport, now time.Time, access routine.ArtifactAccess, graph routine.GraphAccess) ([]AppliedTransition, []BlockedTransition, error) {
	_, previousCandidates, err := previousDigestState(scopeID, access)
	if err != nil {
		return nil, nil, err
	}
	var applied []AppliedTransition
	var blocked []BlockedTransition

	for _, candidate := range analysis.Candidates {
		switch candidate.Family {
		case "knowledge":
			page, err := access.LoadKnowledge(scopeID, knowledge.PageID(candidate.ArtifactID))
			if err != nil {
				return nil, nil, err
			}
			if page == nil {
				continue
			}
			summary, err := graph.SupportSummary(scopeID, artifactref.KindKnowledgePage, candidate.ArtifactID)
			if err != nil {
				return nil, nil, err
			}
			outgoing, err := graph.OutgoingHealth(scopeID, page.ArtifactRefs)
			if err != nil {
				return nil, nil, err
			}
			broken := brokenDependencies(outgoing)
			switch candidate.ProposedAction {
			case "archive":
				if !shouldArchiveKnowledge(*page, summary, broken) {
					blocked = append(blocked, blockedTransition(candidate, "archive", "knowledge no longer meets archive conditions", nil))
					continue
				}
				from := string(page.Lifecycle)
				if err := access.ArchiveKnowledge(scopeID, page.PageID, now); err != nil {
					return nil, nil, err
				}
				applied = append(applied, AppliedTransition{
					Family:       "knowledge",
					ArtifactKind: string(artifactref.KindKnowledgePage),
					ArtifactID:   candidate.ArtifactID,
					FromState:    from,
					ToState:      string(knowledge.ProjectionLifecycleArchived),
					Reason:       candidate.Reason,
					Detail:       candidate.Detail,
				})
			case "remove":
				gating, blockedBy, blockers, err := removeGate(scopeID, candidate, string(page.Lifecycle), previousCandidates, graph)
				if err != nil {
					return nil, nil, err
				}
				if len(blockers) > 0 {
					detail := candidate.Detail
					detail.Blockers = blockers
					detail.PriorArchiveRequired = hasArchiveFirst(blockers)
					detail.LaterPassConfirmed = gating.laterPassConfirmed
					blocked = append(blocked, BlockedTransition{
						Family:       "knowledge",
						ArtifactKind: string(artifactref.KindKnowledgePage),
						ArtifactID:   candidate.ArtifactID,
						Action:       "remove",
						Reason:       "knowledge removal is blocked",
						BlockedBy:    blockedBy,
						Detail:       detail,
					})
					continue
				}
				if err := access.RemoveKnowledge(scopeID, page.PageID, now); err != nil {
					return nil, nil, err
				}
				detail := candidate.Detail
				detail.LaterPassConfirmed = gating.laterPassConfirmed
				applied = append(applied, AppliedTransition{
					Family:       "knowledge",
					ArtifactKind: string(artifactref.KindKnowledgePage),
					ArtifactID:   candidate.ArtifactID,
					FromState:    string(page.Lifecycle),
					ToState:      string(knowledge.ProjectionLifecycleRemoved),
					Reason:       candidate.Reason,
					Detail:       detail,
				})
			}
		case "skill":
			bundle, err := access.LoadSkill(scopeID, skill.BundleID(candidate.ArtifactID))
			if err != nil {
				return nil, nil, err
			}
			if bundle == nil {
				continue
			}
			summary, err := graph.SupportSummary(scopeID, artifactref.KindSkillBundle, candidate.ArtifactID)
			if err != nil {
				return nil, nil, err
			}
			outgoing, err := graph.OutgoingHealth(scopeID, bundle.ArtifactRefs)
			if err != nil {
				return nil, nil, err
			}
			broken := brokenDependencies(outgoing)
			switch candidate.ProposedAction {
			case "archive":
				if !shouldArchiveSkill(*bundle, summary, broken, outgoing) {
					blocked = append(blocked, blockedTransition(candidate, "archive", "skill no longer meets archive conditions", nil))
					continue
				}
				from := string(bundle.Status)
				if err := access.ArchiveSkill(scopeID, bundle.BundleID, now); err != nil {
					return nil, nil, err
				}
				applied = append(applied, AppliedTransition{
					Family:       "skill",
					ArtifactKind: string(artifactref.KindSkillBundle),
					ArtifactID:   candidate.ArtifactID,
					FromState:    from,
					ToState:      string(skill.BundleStatusArchived),
					Reason:       candidate.Reason,
					Detail:       candidate.Detail,
				})
			case "remove":
				gating, blockedBy, blockers, err := removeGate(scopeID, candidate, string(bundle.Status), previousCandidates, graph)
				if err != nil {
					return nil, nil, err
				}
				if len(blockers) > 0 {
					detail := candidate.Detail
					detail.Blockers = blockers
					detail.PriorArchiveRequired = hasArchiveFirst(blockers)
					detail.LaterPassConfirmed = gating.laterPassConfirmed
					blocked = append(blocked, BlockedTransition{
						Family:       "skill",
						ArtifactKind: string(artifactref.KindSkillBundle),
						ArtifactID:   candidate.ArtifactID,
						Action:       "remove",
						Reason:       "skill removal is blocked",
						BlockedBy:    blockedBy,
						Detail:       detail,
					})
					continue
				}
				if err := access.RemoveSkill(scopeID, bundle.BundleID, now); err != nil {
					return nil, nil, err
				}
				detail := candidate.Detail
				detail.LaterPassConfirmed = gating.laterPassConfirmed
				applied = append(applied, AppliedTransition{
					Family:       "skill",
					ArtifactKind: string(artifactref.KindSkillBundle),
					ArtifactID:   candidate.ArtifactID,
					FromState:    string(bundle.Status),
					ToState:      string(skill.BundleStatusRemoved),
					Reason:       candidate.Reason,
					Detail:       detail,
				})
			}
		case "memory":
			record, err := access.LoadMemory(scopeID, memory.RecordID(candidate.ArtifactID))
			if err != nil {
				return nil, nil, err
			}
			if record == nil {
				continue
			}
			summary, err := graph.SupportSummary(scopeID, artifactref.KindMemoryRecord, candidate.ArtifactID)
			if err != nil {
				return nil, nil, err
			}
			outgoing, err := graph.OutgoingHealth(scopeID, record.ArtifactRefs)
			if err != nil {
				return nil, nil, err
			}
			switch candidate.ProposedAction {
			case "archive":
				if !shouldArchiveMemory(*record, summary, outgoing) {
					blocked = append(blocked, blockedTransition(candidate, "archive", "memory no longer meets archive conditions", nil))
					continue
				}
				from := string(record.Lifecycle)
				if err := access.ArchiveMemory(scopeID, record.RecordID, now); err != nil {
					return nil, nil, err
				}
				applied = append(applied, AppliedTransition{
					Family:       "memory",
					ArtifactKind: string(artifactref.KindMemoryRecord),
					ArtifactID:   candidate.ArtifactID,
					FromState:    from,
					ToState:      string(memory.RecordLifecycleArchived),
					Reason:       candidate.Reason,
					Detail:       candidate.Detail,
				})
			case "remove":
				gating, blockedBy, blockers, err := removeGate(scopeID, candidate, string(record.Lifecycle), previousCandidates, graph)
				if err != nil {
					return nil, nil, err
				}
				citationBlockedBy, err := knowledgeCitationBlockedBy(access, scopeID, knowledge.CitationTargetKindMemoryRecord, candidate.ArtifactID)
				if err != nil {
					return nil, nil, err
				}
				if len(blockers) > 0 || len(citationBlockedBy) > 0 {
					detail := candidate.Detail
					detail.Blockers = blockers
					detail.PriorArchiveRequired = hasArchiveFirst(blockers)
					detail.LaterPassConfirmed = gating.laterPassConfirmed
					blockedBy = append(blockedBy, citationBlockedBy...)
					blocked = append(blocked, BlockedTransition{
						Family:       "memory",
						ArtifactKind: string(artifactref.KindMemoryRecord),
						ArtifactID:   candidate.ArtifactID,
						Action:       "remove",
						Reason:       "memory removal is blocked",
						BlockedBy:    blockedBy,
						Detail:       detail,
					})
					continue
				}
				if err := access.RemoveMemory(scopeID, record.RecordID, now); err != nil {
					return nil, nil, err
				}
				detail := candidate.Detail
				detail.LaterPassConfirmed = gating.laterPassConfirmed
				applied = append(applied, AppliedTransition{
					Family:       "memory",
					ArtifactKind: string(artifactref.KindMemoryRecord),
					ArtifactID:   candidate.ArtifactID,
					FromState:    string(record.Lifecycle),
					ToState:      string(memory.RecordLifecycleRemoved),
					Reason:       candidate.Reason,
					Detail:       detail,
				})
			}
		}
	}
	return applied, blocked, nil
}
