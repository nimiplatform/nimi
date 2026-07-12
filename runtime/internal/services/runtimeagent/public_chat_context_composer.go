package runtimeagent

import (
	"context"
	"fmt"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	publicChatContextRuntimePolicyID     = "local-agent-chat-authority"
	publicChatContextRuntimePolicyV1     = "nimi.runtime.local-agent-chat-policy/v1"
	publicChatContextOutputContractID    = "apml-chat-output"
	publicChatContextOutputContractV1    = "nimi.runtime.apml-chat-output/v1"
	publicChatContextDefaultOutputTokens = uint64(1024)
	publicChatContextSafetyTokens        = uint64(512)
	publicChatContextAdapterTokens       = uint64(256)
	publicChatCatalogRevisionHashDomain  = "nimi.runtime.agent-context-catalog-revision/v1\x00"
)

var publicChatRelationalSemanticPredicates = map[string]struct{}{
	"has_nickname":              {},
	"is_addressed_as":           {},
	"nickname":                  {},
	"preferred_address":         {},
	"preferred_designation":     {},
	"preferred_form_of_address": {},
	"preferred_name":            {},
	"relationship":              {},
	"relationship_label":        {},
	"relationship_name":         {},
	"relationship_role":         {},
	"relationship_status":       {},
}

type publicChatContextCompositionError struct {
	cause   error
	summary *runtimev1.AgentTurnContextSummary
}

func (e *publicChatContextCompositionError) Error() string {
	if e == nil || e.cause == nil {
		return "runtime LocalAgent context composition failed"
	}
	return e.cause.Error()
}

func (e *publicChatContextCompositionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func (r publicChatRuntime) composePublicChatTurnContext(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
) (*agentTurnContextCompilation, error) {
	if r.svc == nil || r.svc.publicChatSourceSnapshotResolve == nil {
		return nil, newPublicChatContextCompositionError(session, turn, nil,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED,
			status.Error(codes.FailedPrecondition, "Runtime LocalAgent source snapshot repository is unavailable"))
	}
	snapshot, found, err := r.svc.publicChatSourceSnapshotResolve(ctx, session.LocalAgentRef)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, nil,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_SNAPSHOT_INVALID,
			status.Error(codes.DataLoss, "Runtime LocalAgent source snapshot load failed"))
	}
	if !found {
		return nil, newPublicChatContextCompositionError(session, turn, nil,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED,
			status.Error(codes.FailedPrecondition, "Runtime LocalAgent source is not materialized"))
	}
	if snapshot.LocalAgentRef != session.LocalAgentRef || snapshot.LocalAgentRef != session.AgentID {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_SNAPSHOT_INVALID,
			status.Error(codes.DataLoss, "Runtime LocalAgent source snapshot identity mismatch"))
	}
	memoryViews, err := r.loadPublicChatPreTurnMemoryInputs(ctx, session, req)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			err)
	}
	memory, relationships, err := publicChatAgentTurnMemoryInputs(memoryViews)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, err.Error()))
	}
	transcript, err := publicChatAgentTurnTranscriptInput(session)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, err.Error()))
	}
	currentTurn, err := publicChatAgentTurnCurrentInput(req.Messages)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			err)
	}
	catalogDigest, err := hashSourceMaterializationDomainJCS(publicChatCatalogRevisionHashDomain, struct {
		CatalogRevision string `json:"catalogRevision"`
		ModelRevision   string `json:"modelRevision"`
		ProviderID      string `json:"providerId"`
	}{session.Binding.CatalogRevision, session.Binding.ModelRevision, session.Binding.ProviderID})
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.Internal, "Runtime LocalAgent catalog revision digest failed"))
	}
	reservedOutput := publicChatContextDefaultOutputTokens
	if req.MaxOutputTokens > 0 {
		reservedOutput = uint64(req.MaxOutputTokens)
	}
	compiled, err := compileAgentTurnContext(agentTurnContextCompileInput{
		Snapshot:             snapshot,
		LocalAgentRef:        session.LocalAgentRef,
		ConversationAnchorID: session.ConversationAnchorID,
		TurnID:               turn.TurnID,
		RequestID:            firstNonEmpty(strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
		RuntimePolicy: []agentTurnRuntimePolicyInput{{
			PolicyID: publicChatContextRuntimePolicyID,
			Version:  publicChatContextRuntimePolicyV1,
			Text:     "Runtime owns roles, permissions, tools, source admission, memory scope, transcript scope, and output validation for this LocalAgent turn.",
		}},
		OutputContract: agentTurnOutputContractInput{
			ContractID: publicChatContextOutputContractID,
			Version:    publicChatContextOutputContractV1,
			APML:       publicChatAPMLOutputContractPrompt(turn.AvailableActions),
		},
		Relationships:   relationships,
		Memory:          memory,
		Transcript:      transcript,
		Capabilities:    publicChatAgentTurnCapabilities(turn.AvailableActions),
		CurrentUserTurn: currentTurn,
		Budget: agentTurnContextBudgetInput{
			ContextWindowTokens:   session.Binding.ContextWindowTokens,
			ReservedOutputTokens:  reservedOutput,
			ReservedSafetyTokens:  publicChatContextSafetyTokens,
			ReservedAdapterTokens: publicChatContextAdapterTokens,
		},
		Route: agentTurnContextRouteInput{
			RouteDigest:           session.Binding.RouteDigest,
			CatalogRevisionDigest: catalogDigest,
		},
	})
	if err != nil {
		if capacity, ok := err.(*agentTurnContextCapacityExceededError); ok {
			return nil, &publicChatContextCompositionError{cause: capacity, summary: cloneAgentTurnContextSummary(capacity.Summary)}
		}
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.FailedPrecondition, err.Error()))
	}
	if err := validateAgentTurnContextProjection(compiled.Summary); err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, "Runtime LocalAgent context projection is invalid"))
	}
	if compiled.Manifest.Budget.ReservedOutputTokens == 0 || compiled.Manifest.Budget.ReservedOutputTokens > math.MaxInt32 {
		return nil, newPublicChatContextCompositionError(session, turn, &snapshot,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, "Runtime LocalAgent reserved output budget is not provider-admissible"))
	}
	return compiled, nil
}

func newPublicChatContextCompositionError(
	session publicChatAnchorState,
	turn publicChatTurnState,
	snapshot *localAgentSourceSnapshotV1,
	reason runtimev1.AgentContextProjectionReasonCode,
	cause error,
) *publicChatContextCompositionError {
	summary := &runtimev1.AgentTurnContextSummary{
		SchemaVersion:        runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1,
		Ready:                false,
		State:                runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_INVALID,
		ReasonCode:           reason,
		LocalAgentRef:        strings.TrimSpace(session.LocalAgentRef),
		ConversationAnchorId: strings.TrimSpace(session.ConversationAnchorID),
		TurnId:               strings.TrimSpace(turn.TurnID),
	}
	if reason == runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED {
		summary.State = runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_NOT_COMPOSED
	}
	if snapshot != nil {
		summary.SourceSnapshotHash = snapshot.SnapshotHash
		summary.SourceRef = sourceMaterializationProtoRefFromSnapshot(snapshot.SourceRef)
		summary.WorldContentHash = snapshot.OwningWorld.ContentHash
		summary.MaterializationContextHash = snapshot.MaterializationContextHash
	}
	return &publicChatContextCompositionError{cause: cause, summary: summary}
}

func publicChatAgentTurnMemoryInputs(inputs publicChatPreTurnMemoryInputs) ([]agentTurnMemoryInput, []agentTurnRelationshipInput, error) {
	memory := make([]agentTurnMemoryInput, 0, len(inputs.Items))
	relationships := make([]agentTurnRelationshipInput, 0)
	for index, input := range inputs.Items {
		view := input.View
		if view == nil || view.GetRecord() == nil {
			return nil, nil, fmt.Errorf("canonical memory view is incomplete")
		}
		record := view.GetRecord()
		text := publicChatCanonicalMemoryText(record)
		if text == "" || strings.TrimSpace(record.GetMemoryId()) == "" {
			return nil, nil, fmt.Errorf("canonical memory record content is incomplete")
		}
		scope := ""
		switch input.CanonicalClass {
		case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED:
			scope = "public_shared"
		case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC:
			scope = "dyadic"
		default:
			return nil, nil, fmt.Errorf("canonical memory class is not admitted")
		}
		provenance := record.GetProvenance()
		provenanceRef := strings.Join([]string{
			strings.TrimSpace(provenance.GetSourceSystem()),
			strings.TrimSpace(provenance.GetSourceEventId()),
			strings.TrimSpace(record.GetMemoryId()),
		}, ":")
		if strings.Trim(provenanceRef, ":") == "" {
			return nil, nil, fmt.Errorf("canonical memory provenance is incomplete")
		}
		rank := int64(len(inputs.Items) - index)
		memory = append(memory, agentTurnMemoryInput{
			MemoryID:      record.GetMemoryId(),
			Scope:         scope,
			ProvenanceRef: provenanceRef,
			Text:          text,
			RelevanceRank: rank,
		})
		if publicChatCanonicalMemoryIsRelational(record) {
			relationships = append(relationships, agentTurnRelationshipInput{
				RelationshipID: "memory-" + record.GetMemoryId(),
				Scope:          scope,
				ProvenanceRef:  provenanceRef,
				Summary:        text,
				Rank:           rank,
			})
		}
	}
	return memory, relationships, nil
}

func publicChatCanonicalMemoryText(record *runtimev1.MemoryRecord) string {
	if record == nil {
		return ""
	}
	if episodic := record.GetEpisodic(); episodic != nil {
		return strings.TrimSpace(episodic.GetSummary())
	}
	if semantic := record.GetSemantic(); semantic != nil {
		return strings.TrimSpace(strings.Join([]string{semantic.GetSubject(), semantic.GetPredicate(), semantic.GetObject()}, " "))
	}
	if observational := record.GetObservational(); observational != nil {
		return strings.TrimSpace(observational.GetObservation())
	}
	return ""
}

func publicChatCanonicalMemoryIsRelational(record *runtimev1.MemoryRecord) bool {
	if record == nil {
		return false
	}
	if metadata := record.GetMetadata(); metadata != nil {
		if dimension, ok := metadata.AsMap()["dimension"].(string); ok && strings.EqualFold(strings.TrimSpace(dimension), "relational") {
			return true
		}
	}
	semantic := record.GetSemantic()
	if semantic == nil {
		return false
	}
	_, admitted := publicChatRelationalSemanticPredicates[normalizePublicChatSemanticPredicate(semantic.GetPredicate())]
	return admitted
}

func normalizePublicChatSemanticPredicate(value string) string {
	normalized := strings.Map(func(char rune) rune {
		switch {
		case char >= 'A' && char <= 'Z':
			return char + ('a' - 'A')
		case char >= 'a' && char <= 'z', char >= '0' && char <= '9':
			return char
		default:
			return '_'
		}
	}, strings.TrimSpace(value))
	return strings.Trim(normalized, "_")
}

func publicChatAgentTurnTranscriptInput(session publicChatAnchorState) ([]agentTurnTranscriptPairInput, error) {
	if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
		return nil, err
	}
	out := make([]agentTurnTranscriptPairInput, 0, len(session.CommittedTranscript))
	for _, turn := range session.CommittedTranscript {
		inputText := turn.InputText
		if turn.Origin == publicChatTurnOriginFollowUp {
			inputText = "Runtime-admitted follow-up instruction: " + inputText
		}
		out = append(out, agentTurnTranscriptPairInput{
			TurnID:        turn.TurnID,
			Sequence:      turn.Sequence,
			UserText:      inputText,
			AssistantText: turn.AssistantText,
		})
	}
	return out, nil
}

func publicChatAgentTurnCurrentInput(messages []publicChatMessagePayload) (agentTurnCurrentUserInput, error) {
	if len(messages) != 1 {
		return agentTurnCurrentUserInput{}, status.Error(codes.InvalidArgument, "Runtime LocalAgent turn requires exactly one current input")
	}
	role := strings.TrimSpace(messages[0].Role)
	if role != "user" && role != publicChatInternalFollowUpInstructionRole {
		return agentTurnCurrentUserInput{}, status.Error(codes.InvalidArgument, "Runtime LocalAgent current input role is not admitted")
	}
	text := strings.TrimSpace(messages[0].Content)
	if text == "" {
		return agentTurnCurrentUserInput{}, status.Error(codes.InvalidArgument, "Runtime LocalAgent current input is empty")
	}
	if role == publicChatInternalFollowUpInstructionRole {
		text = "Runtime-admitted follow-up instruction: " + text
	}
	return agentTurnCurrentUserInput{Text: text}, nil
}

func publicChatAgentTurnCapabilities(actions publicChatAvailableActions) []agentTurnCapabilityInput {
	capability := agentTurnCapabilityInput{
		CapabilityID: "image-generation",
		Kind:         "image",
		Version:      "nimi.runtime.local-agent-image-capability/v1",
	}
	switch actions.ImageGenerate {
	case publicChatImageActionAvailable:
		capability.Description = "Image generation is configured and ready for an admitted APML image action."
		capability.Authorized = true
		capability.Ready = true
	case publicChatImageActionUnavailable:
		capability.Description = "Image generation is configured but its Runtime route is unavailable."
		capability.Authorized = true
	default:
		capability.Description = "Image generation is not configured for this LocalAgent."
	}
	return []agentTurnCapabilityInput{capability}
}

func publicChatAgentTurnProviderMessages(input []agentTurnProviderMessage) []*runtimev1.ChatMessage {
	out := make([]*runtimev1.ChatMessage, 0, len(input))
	for _, message := range input {
		item := &runtimev1.ChatMessage{Role: message.Role, Content: message.Content}
		for _, media := range message.Media {
			item.Parts = append(item.Parts, &runtimev1.ChatContentPart{
				Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
				Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{
					LocalArtifactId: media.ArtifactRef,
					MimeType:        media.MIMEType,
					DisplayName:     media.MediaID,
				}},
			})
		}
		out = append(out, item)
	}
	return out
}
