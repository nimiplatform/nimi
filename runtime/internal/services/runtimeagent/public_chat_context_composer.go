package runtimeagent

import (
	"context"
	"fmt"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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

// publicChatTranscriptAttachmentMarker is the model-context representation of
// a committed user attachment message whose text is empty. It is truthful
// (the user did send an image) and carries no artifact bytes or identity.
const publicChatTranscriptAttachmentMarker = "[The user sent an image attachment.]"

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
	return r.composePublicChatTurnContextWithRecall(ctx, session, turn, req, nil)
}

func (r publicChatRuntime) composePublicChatTurnContextWithRecall(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
	privateRecall *agentTurnPrivateRecallInput,
) (*agentTurnContextCompilation, error) {
	if r.svc == nil {
		return nil, newPublicChatContextCompositionError(session, turn, nil,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED,
			status.Error(codes.FailedPrecondition, "Runtime LocalAgent turn source view is unavailable"))
	}
	source, found := r.svc.turnSourceView(session.LocalAgentRef)
	if !found {
		return nil, newPublicChatContextCompositionError(session, turn, nil,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED,
			status.Error(codes.FailedPrecondition, "Runtime LocalAgent compact source view is not materialized"))
	}
	if source.LocalAgentRef != session.LocalAgentRef || source.LocalAgentRef != session.AgentID {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_SNAPSHOT_INVALID,
			status.Error(codes.DataLoss, "Runtime LocalAgent turn source identity mismatch"))
	}
	memoryViews, err := r.loadPublicChatPreTurnMemoryInputs(ctx, session, req)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			err)
	}
	memory, relationships, err := publicChatAgentTurnMemoryInputs(memoryViews)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, err.Error()))
	}
	transcript, err := publicChatAgentTurnTranscriptInput(session)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, err.Error()))
	}
	currentTurn, err := publicChatAgentTurnCurrentInput(req.Messages, req.resolvedAttachments)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			err)
	}
	conversationSummary, err := publicChatAgentTurnConversationSummaryInput(session, transcript)
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, err.Error()))
	}
	cognition := r.retrievePublicChatSourceCognition(ctx, session, source, currentTurn, transcript, conversationSummary, relationships, turn.AvailableActions)
	catalogDigest, err := hashSourceMaterializationDomainJCS(publicChatCatalogRevisionHashDomain, struct {
		CatalogRevision string `json:"catalogRevision"`
		ModelRevision   string `json:"modelRevision"`
		ProviderID      string `json:"providerId"`
	}{session.Binding.CatalogRevision, session.Binding.ModelRevision, session.Binding.ProviderID})
	if err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
				err,
				grpcerr.ReasonOptions{Message: "Runtime LocalAgent catalog revision digest failed"},
			))
	}
	reservedOutput := publicChatContextDefaultOutputTokens
	if req.MaxOutputTokens > 0 {
		reservedOutput = uint64(req.MaxOutputTokens)
	}
	outputContract := publicChatAPMLOutputContractPrompt(turn.AvailableActions)
	if privateRecall != nil {
		outputContract = publicChatAPMLFinalOutputContractPrompt(turn.AvailableActions)
	}
	compiled, err := compileAgentTurnContext(agentTurnContextCompileInput{
		Source:               source,
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
			APML:       outputContract,
		},
		Relationships:       relationships,
		Memory:              memory,
		Transcript:          transcript,
		ConversationSummary: conversationSummary,
		Capabilities:        publicChatAgentTurnCapabilities(turn.AvailableActions),
		CurrentUserTurn:     currentTurn,
		Cognition:           cognition,
		PrivateRecall:       privateRecall,
		Budget: agentTurnContextBudgetInput{
			ContextWindowTokens:     session.Binding.ContextWindowTokens,
			ReservedOutputTokens:    reservedOutput,
			ReservedReasoningTokens: publicChatReasoningReserveTokens(turn.Reasoning, reservedOutput),
			ReservedSafetyTokens:    publicChatContextSafetyTokens,
			ReservedAdapterTokens:   publicChatContextAdapterTokens,
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
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			grpcerr.WrapWithReasonCode(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
				err,
				grpcerr.ReasonOptions{Message: "Runtime LocalAgent context compilation failed"},
			))
	}
	if err := validateAgentTurnContextProjection(compiled.Summary); err != nil {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, "Runtime LocalAgent context projection is invalid"))
	}
	if compiled.Manifest.Budget.ReservedOutputTokens == 0 || compiled.Manifest.Budget.ReservedOutputTokens > math.MaxInt32 {
		return nil, newPublicChatContextCompositionError(session, turn, &source,
			runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID,
			status.Error(codes.DataLoss, "Runtime LocalAgent reserved output budget is not provider-admissible"))
	}
	return compiled, nil
}

func publicChatReasoningReserveTokens(reasoning *publicChatReasoningConfig, reservedOutput uint64) uint64 {
	if reasoning == nil || reasoning.Mode != runtimev1.ReasoningMode_REASONING_MODE_ON {
		return 0
	}
	if reasoning.BudgetTokens > 0 {
		return uint64(reasoning.BudgetTokens)
	}
	// A provider-admitted reasoning mode without an explicit token budget is
	// still capacity-bearing. Reuse this turn's captured output upper bound as
	// the conservative reserve instead of inventing a provider-independent
	// default.
	return reservedOutput
}

func newPublicChatContextCompositionError(
	session publicChatAnchorState,
	turn publicChatTurnState,
	source *localAgentTurnSourceViewV1,
	reason runtimev1.AgentContextProjectionReasonCode,
	cause error,
) *publicChatContextCompositionError {
	summary := &runtimev1.AgentTurnContextSummary{
		SchemaVersion:        runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2,
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
	if source != nil {
		summary.SourceSnapshotHash = source.SnapshotHash
		summary.SourceRef = sourceMaterializationProtoRefV3(source.SourceRef)
		summary.WorldContentHash = source.WorldContentHash
		summary.MaterializationContextHash = source.MaterializationContextHash
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
	out, err := publicChatEligibleCommittedTranscript(session.CommittedTranscript)
	if err != nil {
		return nil, err
	}
	start := 0
	if len(out) > publicChatRecentVerbatimTurnLimit {
		start = len(out) - publicChatRecentVerbatimTurnLimit
	}
	summary := session.ConversationSummary
	valid := publicChatLastValidConversationSummary(summary)
	expandAfterLastValid := summary != nil && summary.LastAttempt.Status != "ready" && valid != nil
	targetEnd, due, err := publicChatConversationSummaryTarget(&session)
	if err != nil {
		return nil, err
	}
	if due {
		attemptCoversTarget := summary != nil && !summary.LastAttempt.AttemptedAt.IsZero() && summary.LastAttempt.TargetSequenceEnd >= targetEnd
		if !attemptCoversTarget {
			if valid == nil {
				start = 0
			} else {
				expandAfterLastValid = true
			}
		}
	}
	if expandAfterLastValid {
		for index, turn := range out {
			if turn.Sequence > valid.CoveredSequenceEnd {
				if index < start {
					start = index
				}
				break
			}
		}
	}
	if start > 0 {
		out = append([]agentTurnTranscriptPairInput(nil), out[start:]...)
	}
	return out, nil
}

func publicChatEligibleCommittedTranscript(committed []publicChatCommittedTranscriptTurn) ([]agentTurnTranscriptPairInput, error) {
	if err := validatePublicChatCommittedTranscript(committed); err != nil {
		return nil, err
	}
	out := make([]agentTurnTranscriptPairInput, 0, len(committed))
	for _, turn := range committed {
		// A feature-mismatch turn may durably commit only the user attachment
		// for product continuity. It never became provider-consumed dialogue,
		// so it must not be fabricated into the paired private model transcript.
		if strings.TrimSpace(turn.AssistantText) == "" {
			continue
		}
		inputText := turn.InputText
		if turn.Origin == publicChatTurnOriginFollowUp {
			inputText = "Runtime-admitted follow-up instruction: " + inputText
		}
		if inputText == "" && turn.InputAttachment != nil {
			// The attachment bytes never re-enter later provider contexts (a
			// route without vision would otherwise be poisoned by history);
			// the model sees this truthful marker while the app-facing
			// projection keeps the real media kind + artifact reference.
			inputText = publicChatTranscriptAttachmentMarker
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

func publicChatAgentTurnConversationSummaryInput(session publicChatAnchorState, transcript []agentTurnTranscriptPairInput) (*agentTurnConversationSummaryInput, error) {
	summary := session.ConversationSummary
	if summary == nil {
		return nil, nil
	}
	if err := validatePublicChatConversationSummary(summary, session.CommittedTranscript); err != nil {
		return nil, err
	}
	input := &agentTurnConversationSummaryInput{Status: summary.LastAttempt.Status}
	valid := publicChatLastValidConversationSummary(summary)
	if valid != nil {
		input.Revision = valid.Revision
		input.CoveredSequenceStart = valid.CoveredSequenceStart
		input.CoveredSequenceEnd = valid.CoveredSequenceEnd
		if len(transcript) == 0 || valid.CoveredSequenceEnd >= transcript[0].Sequence {
			return nil, fmt.Errorf("conversation summary overlaps recent transcript")
		}
		if expected, ok := publicChatFirstEligibleSequenceAfter(session.CommittedTranscript, valid.CoveredSequenceEnd); ok && transcript[0].Sequence != expected {
			input.Status = "unavailable"
			return input, nil
		}
		if summary.LastAttempt.Status == "ready" && valid.CoveredSequenceEnd+1 != transcript[0].Sequence {
			input.Status = "unavailable"
			return input, nil
		}
		input.Text = valid.Text
		input.RouteCorrelation = valid.RouteCorrelation
	}
	return input, nil
}

func publicChatFirstEligibleSequenceAfter(transcript []publicChatCommittedTranscriptTurn, sequence uint64) (uint64, bool) {
	for _, turn := range transcript {
		if turn.Sequence > sequence && strings.TrimSpace(turn.AssistantText) != "" {
			return turn.Sequence, true
		}
	}
	return 0, false
}

func publicChatAgentTurnCurrentInput(messages []publicChatMessagePayload, attachments []publicChatResolvedAttachment) (agentTurnCurrentUserInput, error) {
	if len(messages) != 1 {
		return agentTurnCurrentUserInput{}, status.Error(codes.InvalidArgument, "Runtime LocalAgent turn requires exactly one current input")
	}
	role := strings.TrimSpace(messages[0].Role)
	if role != "user" && role != publicChatInternalFollowUpInstructionRole {
		return agentTurnCurrentUserInput{}, status.Error(codes.InvalidArgument, "Runtime LocalAgent current input role is not admitted")
	}
	text := strings.TrimSpace(messages[0].Content)
	if text == "" && len(attachments) == 0 {
		return agentTurnCurrentUserInput{}, status.Error(codes.InvalidArgument, "Runtime LocalAgent current input is empty")
	}
	if role == publicChatInternalFollowUpInstructionRole {
		if len(attachments) > 0 {
			return agentTurnCurrentUserInput{}, status.Error(codes.InvalidArgument, "Runtime LocalAgent follow-up input must not carry attachments")
		}
		text = "Runtime-admitted follow-up instruction: " + text
	}
	media := make([]agentTurnContextMedia, 0, len(attachments))
	for _, attachment := range attachments {
		// The artifact store record mime fixed at admission is the only
		// trusted mime; the caller display hint is admitted only when it is a
		// well-formed opaque media identity, otherwise the artifact id is the
		// media identity.
		mediaID := attachment.ArtifactID
		if isAgentTurnContextOpaqueRef(attachment.DisplayName) {
			mediaID = attachment.DisplayName
		}
		media = append(media, agentTurnContextMedia{
			MediaID:     mediaID,
			Kind:        "image",
			MIMEType:    attachment.MimeType,
			ArtifactRef: attachment.ArtifactID,
		})
	}
	return agentTurnCurrentUserInput{Text: text, Media: media}, nil
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
