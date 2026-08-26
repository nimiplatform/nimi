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
	if r.svc == nil || r.svc.sourceCognitionBridge == nil {
		return agentTurnCognitionInput{AdapterStatus: "unavailable", SelectionStatus: "unavailable"}
	}
	query := publicChatSourceCognitionQuery(source, current, transcript, conversationSummary, relationships, actions)
	if query == "" {
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure"}
	}
	scopeID := sourceCognitionScopeID(session.LocalAgentRef)
	outcome, err := r.svc.sourceCognitionBridge.SearchAgentSource(
		ctx,
		session.OwnerUserID,
		session.LocalAgentRef,
		scopeID,
		source.SnapshotHash,
		query,
		publicChatSourceCognitionCandidateLimit,
	)
	if err != nil {
		r.svc.scheduleSourceCognitionRebuild(session.OwnerUserID, session.LocalAgentRef, true)
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure"}
	}
	if err := validateSourceCognitionOutcomeBinding(outcome, scopeID, source.SnapshotHash); err != nil || validateSourceCognitionGenerationBinding(outcome, source.Partition) != nil {
		r.svc.scheduleSourceCognitionRebuild(session.OwnerUserID, session.LocalAgentRef, true)
		return agentTurnCognitionInput{AdapterStatus: "failure", SelectionStatus: "failure"}
	}
	result := agentTurnCognitionInput{
		AdapterStatus: outcome.Status, SelectionStatus: outcome.Status,
		Generation: outcome.Generation, CandidateCount: uint32(len(outcome.Units)),
	}
	if outcome.Status != "ready" {
		if outcome.Status == "failure" || outcome.Status == "unavailable" {
			r.svc.scheduleSourceCognitionRebuild(session.OwnerUserID, session.LocalAgentRef, false)
		}
		return result
	}
	seen := make(map[string]struct{}, len(outcome.Units))
	for _, candidate := range outcome.Units {
		if len(result.Candidates) >= publicChatSourceCognitionSelectedLimit || math.IsNaN(candidate.Score) || math.IsInf(candidate.Score, 0) || candidate.Score < publicChatSourceCognitionMinimumScore {
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
			validateLocalAgentCognitionProvenanceRefsV1(candidate.ProvenanceRefs) != nil {
			continue
		}
		seen[candidate.UnitID] = struct{}{}
		result.Candidates = append(result.Candidates, agentTurnCognitionCandidateInput{
			UnitID: candidate.UnitID, Category: candidate.Category, SourcePath: candidate.SourcePath,
			SourceRef: agentTurnContextItemSourceRef{Kind: candidate.SourceRef.Kind, WorldID: candidate.SourceRef.WorldID, RefID: candidate.SourceRef.RefID, SchemaVersion: candidate.SourceRef.SchemaVersion, ContentHash: candidate.SourceRef.ContentHash},
			Text:      candidate.Text, Priority: candidate.Priority, Score: candidate.Score,
		})
	}
	if len(outcome.Units) > 0 && len(result.Candidates) == 0 {
		result.SelectionStatus = "no_result"
	}
	return result
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
