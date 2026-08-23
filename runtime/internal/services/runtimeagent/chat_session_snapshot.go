package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	publicChatTurnStatusAccepted    = "accepted"
	publicChatTurnStatusStarted     = "started"
	publicChatTurnStatusStreaming   = "streaming"
	publicChatTurnStatusCommitted   = "committed"
	publicChatTurnStatusCompleted   = "completed"
	publicChatTurnStatusFailed      = "failed"
	publicChatTurnStatusInterrupted = "interrupted"
)

type publicChatTurnProjectionState struct {
	TurnID            string
	StreamID          string
	Status            string
	TraceID           string
	StreamSequence    uint64
	TimelineStartedAt time.Time
	Origin            string
	ChainID           string
	FollowUpDepth     int
	MaxFollowUpTurns  int
	SourceTurnID      string
	SourceActionID    string
	ModelResolved     string
	RouteDecision     runtimev1.RoutePolicy
	OutputObserved    bool
	ReasoningObserved bool
	MessageID         string
	AssistantText     string
	Structured        *publicChatStructuredEnvelope
	AssistantMemory   *publicChatAssistantMemoryOutcome
	Sidecar           *publicChatSidecarOutcome
	FollowUp          *publicChatFollowUpOutcome
	ContextSummary    *runtimev1.AgentTurnContextSummary
	FinishReason      string
	StreamSimulated   bool
	Usage             *runtimev1.UsageStats
	ReasonCode        runtimev1.ReasonCode
	// ReasonCodeToken, when set, is the exact reason code string projected to
	// consumers in place of the enum label (e.g. the typed
	// turn-attachment-route-vision-unsupported failure of
	// rule.nimi.runtime.agent-participation.r174).
	ReasonCodeToken  string
	ActionHint       string
	Message          string
	ActionStatus     string
	ActionReasonCode runtimev1.ReasonCode
	ActionMessage    string
	UpdatedAt        time.Time
}

func newPublicChatTurnProjection(turn *publicChatTurnState) *publicChatTurnProjectionState {
	if turn == nil {
		return nil
	}
	return &publicChatTurnProjectionState{
		TurnID:            turn.TurnID,
		StreamID:          turn.StreamID,
		Status:            publicChatTurnStatusAccepted,
		TimelineStartedAt: turn.TimelineStartedAt,
		Origin:            firstNonEmpty(strings.TrimSpace(turn.Origin), publicChatTurnOriginUser),
		ChainID:           strings.TrimSpace(turn.ChainID),
		FollowUpDepth:     turn.FollowUpDepth,
		MaxFollowUpTurns:  turn.MaxFollowUpTurns,
		SourceTurnID:      strings.TrimSpace(turn.SourceTurnID),
		SourceActionID:    strings.TrimSpace(turn.SourceActionID),
		UpdatedAt:         time.Now().UTC(),
	}
}

func clonePublicChatTurnProjectionState(input *publicChatTurnProjectionState) *publicChatTurnProjectionState {
	if input == nil {
		return nil
	}
	out := *input
	out.Structured = clonePublicChatStructuredEnvelope(input.Structured)
	out.AssistantMemory = clonePublicChatAssistantMemoryOutcome(input.AssistantMemory)
	out.Sidecar = clonePublicChatSidecarOutcome(input.Sidecar)
	out.FollowUp = clonePublicChatFollowUpOutcome(input.FollowUp)
	out.ContextSummary = cloneAgentTurnContextSummary(input.ContextSummary)
	if input.Usage != nil {
		out.Usage = proto.Clone(input.Usage).(*runtimev1.UsageStats)
	}
	return &out
}

func cloneAgentTurnContextSummary(input *runtimev1.AgentTurnContextSummary) *runtimev1.AgentTurnContextSummary {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentTurnContextSummary)
}

// commitPublicChatTurnTranscript appends the current user message and its
// committed assistant response as one Runtime-owned transcript turn.
// Request-carried history is never admitted here.
func (s *Service) commitPublicChatTurnTranscript(anchorID string, currentUser *runtimev1.ChatMessage, assistantText string) error {
	return s.commitPublicChatTurnTranscriptForTurn(anchorID, "", currentUser, assistantText)
}

func (s *Service) commitPublicChatTurnTranscriptForTurn(anchorID string, turnID string, currentUser *runtimev1.ChatMessage, assistantText string) error {
	return s.commitPublicChatTurnTranscriptForTurnWithProjection(context.Background(), anchorID, turnID, currentUser, assistantText, nil)
}

func (s *Service) commitPublicChatTurnTranscriptForTurnWithProjection(
	commitContext context.Context,
	anchorID string,
	turnID string,
	currentUser *runtimev1.ChatMessage,
	assistantText string,
	finalizeProjection func(*publicChatTurnProjectionState),
) error {
	if strings.TrimSpace(anchorID) == "" || !validRuntimeOwnedCurrentUserMessage(currentUser) || strings.TrimSpace(assistantText) == "" {
		return status.Error(codes.InvalidArgument, "committed transcript requires anchor, current user, and assistant text")
	}
	return s.commitPublicChatTranscriptTurn(
		commitContext,
		anchorID,
		turnID,
		publicChatTurnOriginUser,
		currentUser.GetContent(),
		publicChatCommittedAttachmentFromMessage(currentUser),
		assistantText,
		finalizeProjection,
	)
}

func (s *Service) commitPublicChatFollowUpTranscript(anchorID string, turnID string, instruction string, assistantText string) error {
	return s.commitPublicChatFollowUpTranscriptWithProjection(context.Background(), anchorID, turnID, instruction, assistantText, nil)
}

func (s *Service) commitPublicChatFollowUpTranscriptWithProjection(
	commitContext context.Context,
	anchorID string,
	turnID string,
	instruction string,
	assistantText string,
	finalizeProjection func(*publicChatTurnProjectionState),
) error {
	if strings.TrimSpace(anchorID) == "" || strings.TrimSpace(turnID) == "" || strings.TrimSpace(instruction) == "" || strings.TrimSpace(assistantText) == "" {
		return status.Error(codes.InvalidArgument, "committed follow-up transcript requires anchor, turn, instruction, and assistant text")
	}
	return s.commitPublicChatTranscriptTurn(
		commitContext,
		anchorID,
		turnID,
		publicChatTurnOriginFollowUp,
		instruction,
		nil,
		assistantText,
		finalizeProjection,
	)
}

// commitPublicChatTranscriptTurn is the irreversible Runtime turn boundary.
// It appends the canonical transcript record and, for live turns, installs the
// committed-message projection in one chatSurfaceMu-serialized durable
// transaction. The turn remains active while independent post-turn work runs;
// terminal projection is installed only when the reservation is released.
// Any capture or SQLite failure restores the exact pre-commit in-memory state;
// callers may then classify the still-uncommitted turn as failed.
func (s *Service) commitPublicChatTranscriptTurn(
	commitContext context.Context,
	anchorID string,
	turnID string,
	origin string,
	inputText string,
	inputAttachment *publicChatCommittedTranscriptAttachment,
	assistantText string,
	finalizeProjection func(*publicChatTurnProjectionState),
) error {
	if s == nil {
		return status.Error(codes.FailedPrecondition, "public chat service unavailable")
	}
	trimmedAnchorID := strings.TrimSpace(anchorID)
	trimmedTurnID := strings.TrimSpace(turnID)
	trimmedInput := strings.TrimSpace(inputText)
	trimmedAssistant := strings.TrimSpace(assistantText)
	inputAttachment = normalizePublicChatCommittedTranscriptAttachment(inputAttachment)
	userOnlyAttachmentFailure := origin == publicChatTurnOriginUser && inputAttachment != nil && trimmedAssistant == ""
	if trimmedAnchorID == "" || (trimmedInput == "" && inputAttachment == nil) || (trimmedAssistant == "" && !userOnlyAttachmentFailure) ||
		(origin != publicChatTurnOriginUser && origin != publicChatTurnOriginFollowUp) ||
		(origin == publicChatTurnOriginFollowUp && (trimmedTurnID == "" || inputAttachment != nil)) {
		return status.Error(codes.InvalidArgument, "committed transcript turn is invalid")
	}

	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()

	session := s.chatAnchors[trimmedAnchorID]
	if session == nil {
		return status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
		return status.Error(codes.DataLoss, err.Error())
	}

	var turn *publicChatTurnState
	if finalizeProjection != nil {
		turn = s.chatTurns[trimmedTurnID]
		if turn == nil || strings.TrimSpace(turn.ConversationAnchorID) != trimmedAnchorID {
			return status.Error(codes.FailedPrecondition, "committed transcript live turn is unavailable under conversation anchor")
		}
		if commitContext == nil {
			return status.Error(codes.FailedPrecondition, "durable transcript commit context is unavailable")
		}
		if err := commitContext.Err(); err != nil {
			return status.FromContextError(err).Err()
		}
		if turn.Interrupted {
			return status.Errorf(codes.Canceled, "public chat turn interrupted before durable commit: %s", firstNonEmpty(strings.TrimSpace(turn.InterruptReason), "user_cancel"))
		}
	}

	transcriptBefore := clonePublicChatCommittedTranscript(session.CommittedTranscript)
	activeBefore := clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	lastBefore := clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	completedBefore := clonePublicChatTurnProjectionStateMap(session.CompletedTurnSnapshots)
	lastTurnIDBefore := session.LastTurnID
	lastMessageIDBefore := session.LastMessageID
	updatedAtBefore := session.UpdatedAt
	versionBefore := s.chatSurfaceVersion
	var projectionBefore *publicChatTurnProjectionState
	if turn != nil {
		projectionBefore = clonePublicChatTurnProjectionState(turn.Projection)
	}
	rollback := func() {
		session.CommittedTranscript = transcriptBefore
		session.ActiveTurnSnapshot = activeBefore
		session.LastTurnSnapshot = lastBefore
		session.CompletedTurnSnapshots = completedBefore
		session.LastTurnID = lastTurnIDBefore
		session.LastMessageID = lastMessageIDBefore
		session.UpdatedAt = updatedAtBefore
		s.chatSurfaceVersion = versionBefore
		if turn != nil {
			turn.Projection = projectionBefore
		}
	}

	replayed := false
	committedTurnID := trimmedTurnID
	if committedTurnID == "" && len(session.CommittedTranscript) > 0 {
		last := session.CommittedTranscript[len(session.CommittedTranscript)-1]
		replayed = last.Origin == origin && last.InputText == trimmedInput && last.AssistantText == trimmedAssistant &&
			publicChatCommittedTranscriptAttachmentsEqual(last.InputAttachment, inputAttachment)
		if replayed {
			committedTurnID = last.TurnID
		}
	}
	if !replayed {
		sequence := uint64(len(session.CommittedTranscript))
		committedTurnID = publicChatCommittedTranscriptTurnID(committedTurnID, sequence, origin, trimmedInput, inputAttachment, trimmedAssistant)
		var err error
		replayed, err = validatePublicChatCommittedTurnIDReplay(session.CommittedTranscript, committedTurnID, origin, trimmedInput, inputAttachment, trimmedAssistant)
		if err != nil {
			return status.Error(codes.DataLoss, err.Error())
		}
		if !replayed {
			session.CommittedTranscript = append(session.CommittedTranscript, publicChatCommittedTranscriptTurn{
				TurnID:          committedTurnID,
				Sequence:        sequence,
				Origin:          origin,
				InputText:       trimmedInput,
				AssistantText:   trimmedAssistant,
				InputAttachment: inputAttachment,
			})
		}
	}

	if finalizeProjection != nil {
		if turn.Projection == nil {
			turn.Projection = newPublicChatTurnProjection(turn)
		}
		finalizeProjection(turn.Projection)
		turn.Projection.UpdatedAt = time.Now().UTC()
		if turn.Projection.Status != publicChatTurnStatusCommitted ||
			(!userOnlyAttachmentFailure && (strings.TrimSpace(turn.Projection.MessageID) == "" ||
				strings.TrimSpace(turn.Projection.AssistantText) == "")) {
			rollback()
			return status.Error(codes.FailedPrecondition, "durable transcript commit requires committed message projection")
		}
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
		session.LastTurnID = trimmedTurnID
		session.LastMessageID = strings.TrimSpace(turn.Projection.MessageID)
	}
	if replayed && finalizeProjection == nil {
		return nil
	}
	session.UpdatedAt = time.Now().UTC()
	if err := s.persistPublicChatSurfaceStateLocked(); err != nil {
		rollback()
		return grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "committed Runtime transcript could not be persisted"},
		)
	}
	return nil
}

func validatePublicChatCommittedTranscript(transcript []publicChatCommittedTranscriptTurn) error {
	seen := make(map[string]struct{}, len(transcript))
	for index, turn := range transcript {
		attachment := normalizePublicChatCommittedTranscriptAttachment(turn.InputAttachment)
		userOnlyAttachmentFailure := turn.Origin == publicChatTurnOriginUser && attachment != nil && strings.TrimSpace(turn.AssistantText) == ""
		if turn.Sequence != uint64(index) || strings.TrimSpace(turn.TurnID) == "" || turn.TurnID != strings.TrimSpace(turn.TurnID) ||
			(strings.TrimSpace(turn.InputText) == "" && attachment == nil) || (strings.TrimSpace(turn.AssistantText) == "" && !userOnlyAttachmentFailure) ||
			turn.InputText != strings.TrimSpace(turn.InputText) || turn.AssistantText != strings.TrimSpace(turn.AssistantText) ||
			(turn.Origin != publicChatTurnOriginUser && turn.Origin != publicChatTurnOriginFollowUp) ||
			(turn.Origin == publicChatTurnOriginFollowUp && attachment != nil) ||
			!publicChatCommittedTranscriptAttachmentsEqual(turn.InputAttachment, attachment) {
			return fmt.Errorf("Runtime committed transcript turn is invalid")
		}
		if _, duplicate := seen[turn.TurnID]; duplicate {
			return fmt.Errorf("Runtime committed transcript contains duplicate turn id")
		}
		seenOutputs := make(map[string]struct{}, len(turn.OutputArtifacts))
		for outputIndex := range turn.OutputArtifacts {
			output := turn.OutputArtifacts[outputIndex]
			normalized := normalizePublicChatCommittedTranscriptAttachment(&output)
			if normalized == nil || !publicChatCommittedTranscriptAttachmentsEqual(&output, normalized) {
				return fmt.Errorf("Runtime committed transcript output artifact is invalid")
			}
			if _, duplicate := seenOutputs[normalized.ArtifactID]; duplicate {
				return fmt.Errorf("Runtime committed transcript contains duplicate output artifact id")
			}
			seenOutputs[normalized.ArtifactID] = struct{}{}
		}
		seen[turn.TurnID] = struct{}{}
	}
	return nil
}

// commitPublicChatTurnOutputArtifact adds a store-validated assistant media
// reference to the already committed turn. This is a second irreversible
// boundary because action execution occurs after the text commit; event
// delivery is projected only after this durable reference succeeds.
func (s *Service) commitPublicChatTurnOutputArtifact(anchorID string, turnID string, artifact publicChatCommittedTranscriptAttachment) error {
	if s == nil {
		return status.Error(codes.FailedPrecondition, "public chat service unavailable")
	}
	trimmedAnchorID := strings.TrimSpace(anchorID)
	trimmedTurnID := strings.TrimSpace(turnID)
	normalized := normalizePublicChatCommittedTranscriptAttachment(&artifact)
	if trimmedAnchorID == "" || trimmedTurnID == "" || normalized == nil {
		return status.Error(codes.InvalidArgument, "committed transcript output artifact is invalid")
	}

	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()

	session := s.chatAnchors[trimmedAnchorID]
	if session == nil {
		return status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
		return status.Error(codes.DataLoss, err.Error())
	}
	turnIndex := -1
	for index := range session.CommittedTranscript {
		if session.CommittedTranscript[index].TurnID == trimmedTurnID {
			turnIndex = index
			break
		}
	}
	if turnIndex < 0 {
		return status.Error(codes.FailedPrecondition, "committed transcript turn is unavailable for output artifact")
	}
	for _, existing := range session.CommittedTranscript[turnIndex].OutputArtifacts {
		if existing.ArtifactID != normalized.ArtifactID {
			continue
		}
		if existing.MimeType == normalized.MimeType {
			return nil
		}
		return status.Error(codes.DataLoss, "committed transcript output artifact mime conflicts with existing reference")
	}

	transcriptBefore := clonePublicChatCommittedTranscript(session.CommittedTranscript)
	updatedAtBefore := session.UpdatedAt
	versionBefore := s.chatSurfaceVersion
	session.CommittedTranscript[turnIndex].OutputArtifacts = append(
		session.CommittedTranscript[turnIndex].OutputArtifacts,
		*normalized,
	)
	session.UpdatedAt = time.Now().UTC()
	if err := s.persistPublicChatSurfaceStateLocked(); err != nil {
		session.CommittedTranscript = transcriptBefore
		session.UpdatedAt = updatedAtBefore
		s.chatSurfaceVersion = versionBefore
		return grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "committed Runtime output artifact could not be persisted"},
		)
	}
	return nil
}

// normalizePublicChatCommittedTranscriptAttachment validates the durable
// attachment truth of a committed turn. A malformed attachment normalizes to
// nil so callers fail closed through the caller-side validity checks.
func normalizePublicChatCommittedTranscriptAttachment(input *publicChatCommittedTranscriptAttachment) *publicChatCommittedTranscriptAttachment {
	if input == nil {
		return nil
	}
	artifactID := strings.TrimSpace(input.ArtifactID)
	mimeType := strings.ToLower(strings.TrimSpace(input.MimeType))
	displayName := strings.TrimSpace(input.DisplayName)
	if artifactID == "" || artifactID != input.ArtifactID {
		return nil
	}
	if !utf8.ValidString(displayName) || len([]byte(displayName)) > localAppConversationMaxDisplayNameBytes || strings.ContainsRune(displayName, '\x00') {
		return nil
	}
	switch mimeType {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
	default:
		return nil
	}
	return &publicChatCommittedTranscriptAttachment{ArtifactID: artifactID, MimeType: mimeType, DisplayName: displayName}
}

func publicChatCommittedTranscriptAttachmentsEqual(left, right *publicChatCommittedTranscriptAttachment) bool {
	if (left == nil) != (right == nil) {
		return false
	}
	if left == nil {
		return true
	}
	return left.ArtifactID == right.ArtifactID && left.MimeType == right.MimeType && left.DisplayName == right.DisplayName
}

func validatePublicChatCommittedTurnIDReplay(transcript []publicChatCommittedTranscriptTurn, turnID string, origin string, inputText string, inputAttachment *publicChatCommittedTranscriptAttachment, assistantText string) (bool, error) {
	for _, turn := range transcript {
		if turn.TurnID != turnID {
			continue
		}
		if turn.Origin == origin && turn.InputText == inputText && turn.AssistantText == assistantText &&
			publicChatCommittedTranscriptAttachmentsEqual(turn.InputAttachment, inputAttachment) {
			return true, nil
		}
		return false, fmt.Errorf("Runtime committed transcript turn id conflicts with existing content")
	}
	return false, nil
}

func publicChatCommittedTranscriptTurnID(turnID string, sequence uint64, origin string, inputText string, inputAttachment *publicChatCommittedTranscriptAttachment, assistantText string) string {
	if trimmed := strings.TrimSpace(turnID); trimmed != "" {
		return trimmed
	}
	attachmentRef := ""
	if inputAttachment == nil {
		digest := sha256HexBytes([]byte(fmt.Sprintf("%d\x00%s\x00%s\x00%s", sequence, origin, inputText, assistantText)))
		return "agent_turn_committed_" + digest[:24]
	}
	attachmentRef = inputAttachment.ArtifactID + "\x00" + inputAttachment.MimeType
	digest := sha256HexBytes([]byte(fmt.Sprintf("%d\x00%s\x00%s\x00%s\x00%s", sequence, origin, inputText, attachmentRef, assistantText)))
	return "agent_turn_committed_" + digest[:24]
}

func clonePublicChatCommittedTranscript(input []publicChatCommittedTranscriptTurn) []publicChatCommittedTranscriptTurn {
	if len(input) == 0 {
		return nil
	}
	out := append([]publicChatCommittedTranscriptTurn(nil), input...)
	for index := range out {
		if input[index].InputAttachment != nil {
			attachment := *input[index].InputAttachment
			out[index].InputAttachment = &attachment
		}
		out[index].OutputArtifacts = append([]publicChatCommittedTranscriptAttachment(nil), input[index].OutputArtifacts...)
	}
	return out
}

// publicChatTranscriptProjection derives the app-facing message
// history from the canonical committed transcript. Runtime follow-up turns are
// intentionally absent from this projection while remaining available to the
// next context composition.
func publicChatTranscriptProjection(transcript []publicChatCommittedTranscriptTurn) ([]*runtimev1.ChatMessage, error) {
	if err := validatePublicChatCommittedTranscript(transcript); err != nil {
		return nil, err
	}
	messages := make([]*runtimev1.ChatMessage, 0, len(transcript)*3)
	for _, turn := range transcript {
		if turn.Origin != publicChatTurnOriginUser {
			continue
		}
		userMessage := &runtimev1.ChatMessage{Role: "user", Content: turn.InputText}
		if attachment := normalizePublicChatCommittedTranscriptAttachment(turn.InputAttachment); attachment != nil {
			userMessage.Parts = []*runtimev1.ChatContentPart{{
				Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
				Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{
					LocalArtifactId: attachment.ArtifactID,
					MimeType:        attachment.MimeType,
					DisplayName:     attachment.DisplayName,
				}},
			}}
		}
		messages = append(messages, userMessage)
		if strings.TrimSpace(turn.AssistantText) != "" {
			messages = append(messages, &runtimev1.ChatMessage{Role: "assistant", Content: turn.AssistantText})
		}
		for outputIndex := range turn.OutputArtifacts {
			output := turn.OutputArtifacts[outputIndex]
			attachment := normalizePublicChatCommittedTranscriptAttachment(&output)
			if attachment == nil {
				return nil, fmt.Errorf("Runtime committed transcript output artifact is invalid")
			}
			messages = append(messages, &runtimev1.ChatMessage{
				Role: "assistant",
				Parts: []*runtimev1.ChatContentPart{{
					Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
					Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{
						LocalArtifactId: attachment.ArtifactID,
						MimeType:        attachment.MimeType,
						DisplayName:     attachment.DisplayName,
					}},
				}},
			})
		}
	}
	return messages, nil
}

// validRuntimeOwnedCurrentUserMessage admits the Runtime-owned current user
// message at the transcript commit point. Beyond plain text, exactly one
// artifact_ref image part (the admitted user attachment) may accompany or
// replace the text; every other part shape stays rejected.
func validRuntimeOwnedCurrentUserMessage(message *runtimev1.ChatMessage) bool {
	if message == nil || strings.TrimSpace(message.GetRole()) != "user" || strings.TrimSpace(message.GetName()) != "" ||
		len(message.GetToolCalls()) > 0 || strings.TrimSpace(message.GetToolCallId()) != "" ||
		len(message.GetToolResults()) > 0 || len(message.GetToolApprovalResponses()) > 0 {
		return false
	}
	if len(message.GetParts()) == 0 {
		return strings.TrimSpace(message.GetContent()) != ""
	}
	return publicChatCommittedAttachmentFromMessage(message) != nil
}

// publicChatCommittedAttachmentFromMessage extracts the admitted user
// attachment from a current user message: exactly one artifact_ref part with
// an opaque local artifact id and an admitted image mime. Any other part
// shape yields nil so the commit fails closed.
func publicChatCommittedAttachmentFromMessage(message *runtimev1.ChatMessage) *publicChatCommittedTranscriptAttachment {
	if message == nil || len(message.GetParts()) != 1 {
		return nil
	}
	part := message.GetParts()[0]
	if part == nil || part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
		return nil
	}
	ref := part.GetArtifactRef()
	if ref == nil {
		return nil
	}
	return normalizePublicChatCommittedTranscriptAttachment(&publicChatCommittedTranscriptAttachment{
		ArtifactID:  ref.GetLocalArtifactId(),
		MimeType:    ref.GetMimeType(),
		DisplayName: ref.GetDisplayName(),
	})
}

func clonePublicChatTurnProjectionStateMap(input map[string]*publicChatTurnProjectionState) map[string]*publicChatTurnProjectionState {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]*publicChatTurnProjectionState, len(input))
	for key, projection := range input {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" && projection != nil {
			trimmedKey = strings.TrimSpace(projection.TurnID)
		}
		if trimmedKey == "" || projection == nil {
			continue
		}
		out[trimmedKey] = clonePublicChatTurnProjectionState(projection)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (p *publicChatTurnProjectionState) payload() map[string]any {
	if p == nil {
		return map[string]any{}
	}
	out := map[string]any{
		"turn_id":             strings.TrimSpace(p.TurnID),
		"stream_id":           strings.TrimSpace(p.StreamID),
		"status":              strings.TrimSpace(p.Status),
		"stream_sequence":     p.StreamSequence,
		"turn_origin":         firstNonEmpty(strings.TrimSpace(p.Origin), publicChatTurnOriginUser),
		"follow_up_depth":     p.FollowUpDepth,
		"max_follow_up_turns": p.MaxFollowUpTurns,
		"output_observed":     p.OutputObserved,
		"reasoning_observed":  p.ReasoningObserved,
		"updated_at":          p.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if !p.TimelineStartedAt.IsZero() {
		out["timeline_started_at"] = p.TimelineStartedAt.UTC().Format(time.RFC3339Nano)
	}
	if strings.TrimSpace(p.TraceID) != "" {
		out["trace_id"] = strings.TrimSpace(p.TraceID)
	}
	if strings.TrimSpace(p.ChainID) != "" {
		out["chain_id"] = strings.TrimSpace(p.ChainID)
	}
	if strings.TrimSpace(p.SourceTurnID) != "" {
		out["source_turn_id"] = strings.TrimSpace(p.SourceTurnID)
	}
	if strings.TrimSpace(p.SourceActionID) != "" {
		out["source_action_id"] = strings.TrimSpace(p.SourceActionID)
	}
	if strings.TrimSpace(p.ModelResolved) != "" {
		out["model_resolved"] = strings.TrimSpace(p.ModelResolved)
	}
	if p.RouteDecision != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		out["route_decision"] = publicChatRouteLabel(p.RouteDecision)
	}
	if strings.TrimSpace(p.MessageID) != "" {
		out["message_id"] = strings.TrimSpace(p.MessageID)
	}
	if strings.TrimSpace(p.AssistantText) != "" {
		out["text"] = strings.TrimSpace(p.AssistantText)
	}
	if p.Structured != nil {
		out["structured"] = p.Structured.payload()
	}
	if p.AssistantMemory != nil {
		out["assistant_memory"] = p.AssistantMemory.payload()
	}
	if p.Sidecar != nil {
		out["chat_sidecar"] = p.Sidecar.payload()
	}
	if p.FollowUp != nil {
		out["follow_up"] = p.FollowUp.payload()
	}
	if contextSummary := publicChatTurnContextSummaryPayload(p.ContextSummary); contextSummary != nil {
		out["context_summary"] = contextSummary
	}
	if strings.TrimSpace(p.FinishReason) != "" {
		out["finish_reason"] = strings.TrimSpace(p.FinishReason)
	}
	if p.StreamSimulated {
		out["stream_simulated"] = true
	}
	if p.Usage != nil {
		out["usage"] = usagePayload(p.Usage)
	}
	if strings.TrimSpace(p.ReasonCodeToken) != "" {
		out["reason_code"] = strings.TrimSpace(p.ReasonCodeToken)
	} else if p.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		out["reason_code"] = publicChatReasonCodeLabel(p.ReasonCode)
	}
	if strings.TrimSpace(p.ActionHint) != "" {
		out["action_hint"] = strings.TrimSpace(p.ActionHint)
	}
	if strings.TrimSpace(p.Message) != "" {
		out["message"] = strings.TrimSpace(p.Message)
	}
	return out
}

func publicChatTurnContextSummaryPayload(input *runtimev1.AgentTurnContextSummary) map[string]any {
	if input == nil {
		return nil
	}
	raw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(input)
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func publicChatExecutionBindingProjectionPayload(binding publicChatExecutionBinding) map[string]any {
	out := map[string]any{
		"route":    publicChatRouteLabel(binding.RoutePolicy),
		"model_id": strings.TrimSpace(binding.ModelID),
	}
	if strings.TrimSpace(binding.BindingAlias) != "" {
		out["binding_alias"] = strings.TrimSpace(binding.BindingAlias)
	}
	if strings.TrimSpace(binding.ConnectorID) != "" {
		out["connector_id"] = strings.TrimSpace(binding.ConnectorID)
	}
	return out
}

func publicChatExecutionBindingsProjectionPayload(bindings publicChatExecutionBindings, textBinding publicChatExecutionBinding) map[string]any {
	effective := clonePublicChatExecutionBindings(bindings)
	if len(effective) == 0 && strings.TrimSpace(textBinding.ModelID) != "" {
		effective = publicChatExecutionBindings{"text.generate": textBinding}
	}
	out := make(map[string]any, len(effective))
	for capability, binding := range effective {
		trimmedCapability := strings.TrimSpace(capability)
		if trimmedCapability == "" {
			continue
		}
		out[trimmedCapability] = publicChatExecutionBindingProjectionPayload(binding)
	}
	return out
}

func publicChatPendingFollowUpPayload(followUp *publicChatFollowUpState) map[string]any {
	if followUp == nil {
		return map[string]any{}
	}
	return map[string]any{
		"status":              "scheduled",
		"follow_up_id":        followUp.FollowUpID,
		"scheduled_for":       followUp.ScheduledFor.UTC().Format(time.RFC3339Nano),
		"chain_id":            followUp.ChainID,
		"follow_up_depth":     followUp.FollowUpDepth,
		"max_follow_up_turns": followUp.MaxFollowUpTurns,
		"source_turn_id":      followUp.SourceTurnID,
		"source_action_id":    followUp.SourceActionID,
	}
}

func (s *Service) mutatePublicChatTurnProjection(turnID string, persist bool, mutate func(*publicChatTurnProjectionState)) *publicChatTurnProjectionState {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	if turn.Projection == nil {
		turn.Projection = newPublicChatTurnProjection(turn)
	}
	projection := turn.Projection
	if mutate != nil {
		mutate(projection)
	}
	projection.UpdatedAt = time.Now().UTC()
	if session := s.chatAnchors[turn.ConversationAnchorID]; session != nil {
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(projection)
	}
	out := clonePublicChatTurnProjectionState(projection)
	s.chatSurfaceMu.Unlock()
	if persist {
		s.persistCurrentPublicChatSurfaceState()
	}
	return out
}

func (s *Service) finalizePublicChatTurnProjection(turnID string, persist bool, mutate func(*publicChatTurnProjectionState)) *publicChatTurnProjectionState {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		var terminalSession *publicChatAnchorState
		for _, session := range s.chatAnchors {
			if session == nil || strings.TrimSpace(session.LastTurnID) != trimmedTurnID ||
				session.LastTurnSnapshot == nil || strings.TrimSpace(session.LastTurnSnapshot.TurnID) != trimmedTurnID {
				continue
			}
			if terminalSession != nil {
				s.chatSurfaceMu.Unlock()
				return nil
			}
			terminalSession = session
		}
		if terminalSession == nil {
			s.chatSurfaceMu.Unlock()
			return nil
		}
		projection := clonePublicChatTurnProjectionState(terminalSession.LastTurnSnapshot)
		if mutate != nil {
			mutate(projection)
		}
		projection.UpdatedAt = time.Now().UTC()
		terminalSession.LastTurnSnapshot = clonePublicChatTurnProjectionState(projection)
		if messageID := strings.TrimSpace(projection.MessageID); messageID != "" {
			terminalSession.LastMessageID = messageID
		}
		if publicChatTurnProjectionIsTerminal(projection) {
			if terminalSession.CompletedTurnSnapshots == nil {
				terminalSession.CompletedTurnSnapshots = make(map[string]*publicChatTurnProjectionState)
			}
			terminalSession.CompletedTurnSnapshots[trimmedTurnID] = clonePublicChatTurnProjectionState(projection)
		}
		terminalSession.UpdatedAt = time.Now().UTC()
		out := clonePublicChatTurnProjectionState(projection)
		s.chatSurfaceMu.Unlock()
		if persist {
			s.persistCurrentPublicChatSurfaceState()
		}
		return out
	}
	projection := clonePublicChatTurnProjectionState(turn.Projection)
	if projection == nil {
		projection = newPublicChatTurnProjection(turn)
	}
	if mutate != nil {
		mutate(projection)
	}
	projection.UpdatedAt = time.Now().UTC()
	turn.TerminalProjection = projection
	out := clonePublicChatTurnProjectionState(projection)
	s.chatSurfaceMu.Unlock()
	if persist {
		s.persistCurrentPublicChatSurfaceState()
	}
	return out
}

func publicChatTurnProjectionIsTerminal(projection *publicChatTurnProjectionState) bool {
	if projection == nil || strings.TrimSpace(projection.TurnID) == "" {
		return false
	}
	switch projection.Status {
	case publicChatTurnStatusCompleted, publicChatTurnStatusFailed, publicChatTurnStatusInterrupted:
		return true
	default:
		return false
	}
}

// snapshotPublicChatAnchorForCaller returns an anchor snapshot for a given
// caller. Per K-AGCORE-034 the lookup key is `conversation_anchor_id` (the
// only admitted cross-surface continuity scope). Late-join surfaces recover
// continuity through this anchor-native snapshot, not through app-local
// history replay.
func (s *Service) snapshotPublicChatAnchorForCaller(callerAppID string, anchorID string) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if strings.TrimSpace(callerAppID) == "" || trimmedAnchorID == "" {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.InvalidArgument, "public chat anchor snapshot requires caller app and conversation_anchor_id")
	}
	return s.snapshotPublicChatAnchor(trimmedAnchorID, "", false)
}

func (s *Service) snapshotPublicChatAnchorForAvatarLiveInstance(callerAppID string, anchorID string, identity localAgentIdentity) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	trimmedCallerAppID := strings.TrimSpace(callerAppID)
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if trimmedCallerAppID == "" || trimmedAnchorID == "" {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.InvalidArgument, "public chat avatar snapshot requires caller app and conversation_anchor_id")
	}

	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[trimmedAnchorID]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if session.LocalAgentRef != identity.LocalAgentRef || session.OwnerUserID != identity.OwnerUserID || session.RuntimeSourceRef != identity.RuntimeSourceRef {
		s.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.PermissionDenied, "public chat anchor local identity mismatch")
	}
	s.chatSurfaceMu.Unlock()

	return s.snapshotPublicChatAnchor(trimmedAnchorID, "", false)
}

func (s *Service) snapshotPublicChatAnchor(anchorID string, callerAppID string, enforceCaller bool) (publicChatAnchorState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if err := validatePublicChatCommittedTranscript(session.CommittedTranscript); err != nil {
		return publicChatAnchorState{}, nil, nil, nil, status.Error(codes.DataLoss, err.Error())
	}
	_ = callerAppID
	_ = enforceCaller
	snapshot := *session
	snapshot.Reasoning = clonePublicChatReasoningConfig(session.Reasoning)
	snapshot.CommittedTranscript = clonePublicChatCommittedTranscript(session.CommittedTranscript)
	snapshot.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	snapshot.LastTurnSnapshot = clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	snapshot.CompletedTurnSnapshots = clonePublicChatTurnProjectionStateMap(session.CompletedTurnSnapshots)
	var activeTurn *publicChatTurnProjectionState
	if trimmedActiveTurnID := strings.TrimSpace(session.ActiveTurnID); trimmedActiveTurnID != "" {
		if turn := s.chatTurns[trimmedActiveTurnID]; turn != nil {
			activeTurn = clonePublicChatTurnProjectionState(turn.Projection)
		}
	}
	if activeTurn == nil {
		activeTurn = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	}
	lastTurn := clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	var pendingFollowUp *publicChatFollowUpState
	if trimmedFollowUpID := strings.TrimSpace(session.PendingFollowUpID); trimmedFollowUpID != "" {
		if followUp := s.chatFollowUps[trimmedFollowUpID]; followUp != nil {
			copyFollowUp := *followUp
			pendingFollowUp = &copyFollowUp
		}
	}
	return snapshot, activeTurn, lastTurn, pendingFollowUp, nil
}

func publicChatSessionStatus(activeTurn *publicChatTurnProjectionState, pendingFollowUp *publicChatFollowUpState) string {
	if activeTurn != nil && strings.TrimSpace(activeTurn.TurnID) != "" {
		return "turn_active"
	}
	if pendingFollowUp != nil && strings.TrimSpace(pendingFollowUp.FollowUpID) != "" {
		return "follow_up_pending"
	}
	return "idle"
}

func clonePublicChatStructuredEnvelope(input *publicChatStructuredEnvelope) *publicChatStructuredEnvelope {
	if input == nil {
		return nil
	}
	out := &publicChatStructuredEnvelope{
		SchemaID: strings.TrimSpace(input.SchemaID),
		Message: publicChatStructuredMessage{
			MessageID: strings.TrimSpace(input.Message.MessageID),
			Text:      strings.TrimSpace(input.Message.Text),
		},
		Actions: make([]publicChatStructuredAction, 0, len(input.Actions)),
	}
	if input.StatusCue != nil {
		statusCue := *input.StatusCue
		if input.StatusCue.Intensity != nil {
			intensity := *input.StatusCue.Intensity
			statusCue.Intensity = &intensity
		}
		out.StatusCue = &statusCue
	}
	for _, action := range input.Actions {
		out.Actions = append(out.Actions, action)
	}
	return out
}

func clonePublicChatAssistantMemoryOutcome(input *publicChatAssistantMemoryOutcome) *publicChatAssistantMemoryOutcome {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}

func clonePublicChatSidecarOutcome(input *publicChatSidecarOutcome) *publicChatSidecarOutcome {
	if input == nil {
		return nil
	}
	out := *input
	out.CanceledHookIDs = append([]string(nil), input.CanceledHookIDs...)
	return &out
}

func clonePublicChatFollowUpOutcome(input *publicChatFollowUpOutcome) *publicChatFollowUpOutcome {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}
