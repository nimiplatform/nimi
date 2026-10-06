package runtimeagent

import (
	"context"
	"math"
	"strings"
	"unicode/utf8"

	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
)

const publicChatSourceCognitionCandidateLimit = 12
const publicChatSourceCognitionSelectedLimit = 8
const publicChatSourceCognitionMinimumScore = 0.20
const publicChatSourceCognitionQueryMaxBytes = 4096
const publicChatSourceCognitionCurrentSignalMaxBytes = 1400
const publicChatSourceCognitionSummarySignalMaxBytes = 768
const publicChatSourceCognitionRecentSignalMaxBytes = 640
const publicChatSourceCognitionPostureSignalMaxBytes = 512
const publicChatSourceCognitionRelationshipSignalMaxBytes = 384
const publicChatSourceCognitionTypedStateSignalMaxBytes = 192

func (r publicChatRuntime) retrievePublicChatSourceCognition(
	ctx context.Context,
	session publicChatAnchorState,
	source localAgentTurnSourceViewV1,
	current agentTurnCurrentUserInput,
	transcript []agentTurnTranscriptPairInput,
	conversationSummary *agentTurnConversationSummaryInput,
	relationships []agentTurnRelationshipInput,
	actions publicChatAvailableActions,
) agentTurnCognitionInput {
	return r.retrieveLocalAgentSourceCognition(ctx, session.OwnerUserID, session.LocalAgentRef, source, current, transcript, conversationSummary, relationships, actions)
}

func (r publicChatRuntime) retrieveLocalAgentSourceCognition(ctx context.Context, ownerUserID, localAgentRef string, source localAgentTurnSourceViewV1, current agentTurnCurrentUserInput, transcript []agentTurnTranscriptPairInput, conversationSummary *agentTurnConversationSummaryInput, relationships []agentTurnRelationshipInput, actions publicChatAvailableActions) agentTurnCognitionInput {
	if r.svc == nil || r.svc.sourceCognitionBridge == nil {
		return agentTurnCognitionInput{AdapterStatus: "unavailable", SelectionStatus: "unavailable"}
	}
	if err := validateLocalAgentTurnSourceViewV1(source); err != nil {
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure", ExactStatus: "failure"}
	}
	if err := validateLocalAgentTurnSourceCognitionMetadataV1(source); err != nil {
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure", ExactStatus: "failure", FailureReason: err.Error()}
	}
	matches := matchLocalAgentSourceReferencesV1(current.Text, source.SnapshotCandidateSourceRefs, source.NamedSourceRefs)
	if matches.OverLimit || (len(matches.Ambiguous) > 0 && len(matches.Matches) == 0) {
		status := "ambiguous"
		if matches.OverLimit {
			status = "over_limit"
		}
		return agentTurnCognitionInput{AdapterStatus: "not_requested", SelectionStatus: "no_result", ExactStatus: status, Ambiguous: matches.Ambiguous}
	}
	selections := sourceCognitionExactSelections(source, matches.Matches)
	query := publicChatSourceCognitionQuery(source, current, transcript, conversationSummary, relationships, actions)
	if query == "" {
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure"}
	}
	scopeID := sourceCognitionScopeID(localAgentRef)
	outcome, err := r.svc.sourceCognitionBridge.SearchAgentSource(
		ctx,
		ownerUserID,
		localAgentRef,
		scopeID,
		source.SnapshotHash,
		cognitionservice.AgentSourceQuery{Text: query, PartitionIdentity: source.Partition.PartitionHash, UnitCount: source.Partition.UnitCount, OmissionCount: source.Partition.OmissionCount, ExactSourceRefs: selections, Limit: publicChatSourceCognitionCandidateLimit},
	)
	if err != nil {
		r.svc.scheduleSourceCognitionRebuild(ownerUserID, localAgentRef, true)
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure"}
	}
	if err := validateSourceCognitionOutcomeBinding(outcome, scopeID, source.SnapshotHash); err != nil || validateSourceCognitionGenerationBinding(outcome, source.Partition) != nil {
		r.svc.scheduleSourceCognitionRebuild(ownerUserID, localAgentRef, true)
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure"}
	}
	result := agentTurnCognitionInput{
		AdapterStatus: outcome.Status, SelectionStatus: outcome.Status,
		Generation: outcome.Generation, CandidateCount: uint32(len(outcome.Units)),
		ExactStatus: outcome.ExactStatus, GenerationStatus: outcome.GenerationStatus, Ambiguous: matches.Ambiguous,
	}
	if outcome.Status != "ready" {
		if outcome.Status == "failure" || outcome.Status == "unavailable" {
			r.svc.scheduleSourceCognitionRebuild(ownerUserID, localAgentRef, false)
		}
		if outcome.ExactStatus != "ready" {
			return result
		}
	}
	seen := make(map[string]struct{}, len(outcome.Units))
	for _, candidate := range outcome.Units {
		exact := sourceCognitionCandidateMatchesSelection(candidate, selections)
		semantic := candidate.SelectionBasis == "" || candidate.SelectionBasis == "embedding"
		if len(result.Candidates) >= publicChatSourceCognitionSelectedLimit || math.IsNaN(candidate.Score) || math.IsInf(candidate.Score, 0) ||
			(!exact && (!semantic || outcome.Status != "ready" || candidate.Score < publicChatSourceCognitionMinimumScore)) ||
			(exact && !candidate.HasSemanticScore && candidate.Score != 0) || sourceCognitionCandidateIsAmbiguous(candidate, matches) {
			continue
		}
		if _, duplicate := seen[candidate.UnitID]; duplicate {
			continue
		}
		if strings.TrimSpace(candidate.UnitID) == "" || !isLocalAgentSourceSemanticCategoryV1(candidate.Category) ||
			strings.TrimSpace(candidate.SourcePath) == "" || validateLocalAgentCognitionTextV1(candidate.Text) != nil ||
			strings.TrimSpace(candidate.SourceRef.Kind) == "" || strings.TrimSpace(candidate.SourceRef.RefID) == "" ||
			strings.TrimSpace(candidate.SourceRef.SchemaVersion) == "" || !isLowerSHA256V3(candidate.SourceRef.ContentHash) ||
			!localAgentSourceCategoryMatchesRefKindV1(candidate.Category, candidate.SourceRef.Kind) ||
			!localAgentSourceCandidateRefBelongsToTurnViewV1(source, candidate.SourceRef) ||
			!localAgentSourceUnitBelongsToTurnViewV1(source, candidate) ||
			validateLocalAgentCognitionProvenanceRefsV1(candidate.ProvenanceRefs) != nil {
			continue
		}
		seen[candidate.UnitID] = struct{}{}
		result.Candidates = append(result.Candidates, agentTurnCognitionCandidateInput{
			UnitID: candidate.UnitID, Category: candidate.Category, SourcePath: candidate.SourcePath,
			SourceRef: agentTurnContextItemSourceRef{Kind: candidate.SourceRef.Kind, WorldID: candidate.SourceRef.WorldID, RefID: candidate.SourceRef.RefID, SchemaVersion: candidate.SourceRef.SchemaVersion, ContentHash: candidate.SourceRef.ContentHash},
			Text:      candidate.Text, Priority: candidate.Priority, Score: candidate.Score, SelectionBasis: candidate.SelectionBasis, MatchedTerm: candidate.MatchedTerm, HasSemanticScore: candidate.HasSemanticScore,
		})
	}
	if len(outcome.Units) > 0 && len(result.Candidates) == 0 {
		result.SelectionStatus = "no_result"
	} else if len(result.Candidates) > 0 {
		result.SelectionStatus = "ready"
	}
	return result
}

func sourceCognitionExactSelections(source localAgentTurnSourceViewV1, matches []localAgentSourceReferenceMatchV1) []cognitionservice.AgentSourceSelection {
	selections := make([]cognitionservice.AgentSourceSelection, 0, len(matches))
	for _, match := range matches {
		ref := match.SourceRef
		selection := cognitionservice.AgentSourceSelection{SourceRef: cognitionservice.AgentSourceRef{Kind: ref.Kind, WorldID: ref.WorldID, RefID: ref.RefID, SchemaVersion: ref.SchemaVersion, ContentHash: ref.ContentHash}, Basis: match.Basis, Term: match.Term, Units: []cognitionservice.AgentSourceUnitBinding{}}
		for _, unit := range source.CognitionUnitBindings {
			if unit.SourceRef == ref {
				selection.Units = append(selection.Units, cognitionservice.AgentSourceUnitBinding{UnitID: unit.UnitID, ContentHash: unit.ContentHash})
			}
		}
		selections = append(selections, selection)
	}
	return selections
}

func sourceCognitionCandidateMatchesSelection(candidate cognitionservice.AgentSourceUnit, selections []cognitionservice.AgentSourceSelection) bool {
	for _, selection := range selections {
		if candidate.SourceRef == selection.SourceRef && candidate.SelectionBasis == selection.Basis && candidate.MatchedTerm == selection.Term {
			return true
		}
	}
	return false
}

func sourceCognitionCandidateIsAmbiguous(candidate cognitionservice.AgentSourceUnit, matches localAgentSourceReferenceMatchesV1) bool {
	ref := agentTurnContextItemSourceRef{Kind: candidate.SourceRef.Kind, WorldID: candidate.SourceRef.WorldID, RefID: candidate.SourceRef.RefID, SchemaVersion: candidate.SourceRef.SchemaVersion, ContentHash: candidate.SourceRef.ContentHash}
	for _, match := range matches.Matches {
		if ref == match.SourceRef {
			return false
		}
	}
	for _, ambiguity := range matches.Ambiguous {
		for _, ambiguousRef := range ambiguity.Refs {
			if ref == ambiguousRef {
				return true
			}
		}
	}
	return false
}

func localAgentSourceUnitBelongsToTurnViewV1(source localAgentTurnSourceViewV1, candidate cognitionservice.AgentSourceUnit) bool {
	for _, binding := range source.CognitionUnitBindings {
		if binding.UnitID == candidate.UnitID {
			return binding.ContentHash == cognitionservice.AgentSourceUnitContentHash(candidate)
		}
	}
	return false
}

func localAgentSourceCandidateRefBelongsToTurnViewV1(source localAgentTurnSourceViewV1, candidate cognitionservice.AgentSourceRef) bool {
	for _, ref := range source.SnapshotCandidateSourceRefs {
		if candidate.Kind == ref.Kind && candidate.WorldID == ref.WorldID && candidate.RefID == ref.RefID &&
			candidate.SchemaVersion == ref.SchemaVersion && candidate.ContentHash == ref.ContentHash {
			return true
		}
	}
	return false
}

func publicChatSourceCognitionQuery(
	source localAgentTurnSourceViewV1,
	current agentTurnCurrentUserInput,
	transcript []agentTurnTranscriptPairInput,
	conversationSummary *agentTurnConversationSummaryInput,
	relationships []agentTurnRelationshipInput,
	actions publicChatAvailableActions,
) string {
	parts := make([]string, 0, 6)
	if text := boundedPublicChatSourceCognitionText(current.Text, publicChatSourceCognitionCurrentSignalMaxBytes); text != "" {
		parts = append(parts, "current_turn="+text)
	}
	typedState := make([]string, 0, 1+len(current.Media))
	if actions.ImageGenerate != "" {
		typedState = append(typedState, "tool=image.generate state="+string(actions.ImageGenerate))
	}
	for _, media := range current.Media {
		kind := strings.TrimSpace(media.Kind)
		mimeType := strings.TrimSpace(media.MIMEType)
		if kind == "" || mimeType == "" {
			continue
		}
		typedState = append(typedState, "media="+kind+" mime="+mimeType)
	}
	if signal := boundedPublicChatSourceCognitionText(strings.Join(typedState, "\n"), publicChatSourceCognitionTypedStateSignalMaxBytes); signal != "" {
		parts = append(parts, signal)
	}
	if conversationSummary != nil {
		if summary := boundedPublicChatSourceCognitionText(conversationSummary.Text, publicChatSourceCognitionSummarySignalMaxBytes); summary != "" {
			parts = append(parts, "conversation_summary="+summary)
		}
	}
	postures := make([]string, 0, len(source.Partition.Lorebook.Character.RelationshipPostures))
	for _, posture := range source.Partition.Lorebook.Character.RelationshipPostures {
		fields := []string{"target=" + strings.TrimSpace(posture.TargetRef)}
		if posture.RelationshipRef != nil {
			fields = append(fields, "relationship="+strings.TrimSpace(*posture.RelationshipRef))
		}
		fields = append(fields, "posture="+strings.TrimSpace(posture.Statement))
		postures = append(postures, strings.Join(fields, " "))
	}
	if signal := boundedPublicChatSourceCognitionText(strings.Join(postures, "\n"), publicChatSourceCognitionPostureSignalMaxBytes); signal != "" {
		parts = append(parts, "relationship_postures="+signal)
	}
	runtimeRelationships := make([]string, 0, 4)
	for index, relationship := range relationships {
		if index >= 4 {
			break
		}
		runtimeRelationships = append(runtimeRelationships, strings.TrimSpace(relationship.Summary))
	}
	if signal := boundedPublicChatSourceCognitionText(strings.Join(runtimeRelationships, "\n"), publicChatSourceCognitionRelationshipSignalMaxBytes); signal != "" {
		parts = append(parts, "runtime_relationships="+signal)
	}
	recent := make([]string, 0, 4)
	for index := len(transcript) - 1; index >= 0 && len(transcript)-index <= 2; index-- {
		recent = append(recent, strings.TrimSpace(transcript[index].UserText), strings.TrimSpace(transcript[index].AssistantText))
	}
	if signal := boundedPublicChatSourceCognitionText(strings.Join(recent, "\n"), publicChatSourceCognitionRecentSignalMaxBytes); signal != "" {
		parts = append(parts, "recent_turns="+signal)
	}
	return boundedPublicChatSourceCognitionText(strings.Join(parts, "\n"), publicChatSourceCognitionQueryMaxBytes)
}

func boundedPublicChatSourceCognitionText(value string, maximumBytes int) string {
	value = strings.TrimSpace(value)
	if len(value) <= maximumBytes {
		return value
	}
	for maximumBytes > 0 && !utf8.ValidString(value[:maximumBytes]) {
		maximumBytes--
	}
	return strings.TrimSpace(value[:maximumBytes])
}
