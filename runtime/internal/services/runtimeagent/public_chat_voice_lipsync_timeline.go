package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	publicChatConversationVoiceTimingReadyType       = "runtime.agent.conversation.voice_timing_ready"
	publicChatConversationVoiceArtifactAvailableType = "runtime.agent.conversation.voice_artifact_available"
	publicChatConversationVoiceTimingTerminalType    = "runtime.agent.conversation.voice_timing_terminal"
)

type publicChatVoiceTimingReadyProjection struct {
	AudioArtifactID  string
	AudioMimeType    string
	MessageID        string
	DurationMs       int64
	DeadlineOffsetMs int64
	Reason           string
}

type publicChatVoiceArtifactProjection struct {
	AudioArtifactID  string
	AudioMimeType    string
	MessageID        string
	ArtifactSequence uint64
	ArtifactComplete bool
	DurationMs       int64
	Reason           string
}

type publicChatVoiceTimingTerminalProjection struct {
	AudioArtifactID string
	AudioMimeType   string
	MessageID       string
	Phase           string
	TerminalReason  string
}

func publicChatBuildVoiceTimingReadyDetail(input publicChatVoiceTimingReadyProjection) (map[string]any, error) {
	audioArtifactID := strings.TrimSpace(input.AudioArtifactID)
	audioMimeType := strings.TrimSpace(input.AudioMimeType)
	if audioArtifactID == "" || audioMimeType == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.conversation.voice_timing_ready requires runtime-owned audio identity")
	}
	if !isPlayableAudioMimeType(audioMimeType) {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.conversation.voice_timing_ready requires playable audio artifact")
	}
	if input.DurationMs < 0 || input.DeadlineOffsetMs < 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.conversation.voice_timing_ready duration/deadline must be non-negative")
	}
	detail := map[string]any{
		"audio_artifact_id":  audioArtifactID,
		"audio_mime_type":    audioMimeType,
		"voice_timing_phase": "active",
	}
	if messageID := strings.TrimSpace(input.MessageID); messageID != "" {
		detail["message_id"] = messageID
	}
	if input.DurationMs > 0 {
		detail["duration_ms"] = input.DurationMs
	}
	if input.DeadlineOffsetMs > 0 {
		detail["deadline_offset_ms"] = input.DeadlineOffsetMs
	}
	if reason := strings.TrimSpace(input.Reason); reason != "" {
		detail["reason"] = reason
	}
	return detail, nil
}

func publicChatBuildVoiceArtifactDetail(input publicChatVoiceArtifactProjection) (map[string]any, error) {
	audioArtifactID := strings.TrimSpace(input.AudioArtifactID)
	audioMimeType := strings.TrimSpace(input.AudioMimeType)
	if input.ArtifactSequence == 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.conversation.voice_artifact_available artifact_sequence must be positive")
	}
	if input.DurationMs < 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.conversation.voice_artifact_available duration must be non-negative")
	}
	if audioArtifactID == "" || audioMimeType == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.conversation.voice_artifact_available requires runtime-owned audio identity")
	}
	if !isPlayableAudioMimeType(audioMimeType) {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.conversation.voice_artifact_available requires playable audio artifact")
	}
	detail := map[string]any{
		"audio_artifact_id":  audioArtifactID,
		"audio_mime_type":    audioMimeType,
		"artifact_sequence":  int64(input.ArtifactSequence),
		"artifact_complete":  input.ArtifactComplete,
		"voice_timing_phase": "active",
	}
	if messageID := strings.TrimSpace(input.MessageID); messageID != "" {
		detail["message_id"] = messageID
	}
	if input.DurationMs > 0 {
		detail["duration_ms"] = input.DurationMs
	}
	if reason := strings.TrimSpace(input.Reason); reason != "" {
		detail["reason"] = reason
	}
	return detail, nil
}

func publicChatBuildVoiceTimingTerminalDetail(input publicChatVoiceTimingTerminalProjection) (map[string]any, error) {
	phase := strings.TrimSpace(input.Phase)
	switch phase {
	case "completed", "failed", "interrupted", "canceled":
	default:
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.conversation.voice_timing_terminal phase must be terminal")
	}
	terminalReason := strings.TrimSpace(input.TerminalReason)
	if terminalReason == "" {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.conversation.voice_timing_terminal terminal_reason required")
	}
	detail := map[string]any{
		"voice_timing_phase": phase,
		"terminal_reason":    terminalReason,
	}
	if audioArtifactID := strings.TrimSpace(input.AudioArtifactID); audioArtifactID != "" {
		detail["audio_artifact_id"] = audioArtifactID
	}
	if audioMimeType := strings.TrimSpace(input.AudioMimeType); audioMimeType != "" {
		if !isPlayableAudioMimeType(audioMimeType) {
			return nil, status.Error(codes.FailedPrecondition, "runtime.agent.conversation.voice_timing_terminal requires playable audio mime type")
		}
		detail["audio_mime_type"] = audioMimeType
	}
	if messageID := strings.TrimSpace(input.MessageID); messageID != "" {
		detail["message_id"] = messageID
	}
	return detail, nil
}

func (r publicChatRuntime) emitVoiceTimingReadyTimelineEvent(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoiceTimingReadyProjection) error {
	detail, err := publicChatBuildVoiceTimingReadyDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannel(session, turn.TurnID, publicChatConversationVoiceTimingReadyType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitVoiceArtifactTimelineEvent(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoiceArtifactProjection) error {
	detail, err := publicChatBuildVoiceArtifactDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannel(session, turn.TurnID, publicChatConversationVoiceArtifactAvailableType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitVoiceTimingTerminalTimelineEvent(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoiceTimingTerminalProjection) error {
	detail, err := publicChatBuildVoiceTimingTerminalDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannel(session, turn.TurnID, publicChatConversationVoiceTimingTerminalType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitTimelineEventForChannel(session publicChatAnchorState, turnID string, messageType string, channel string, detail map[string]any) error {
	trimmedTurnID := strings.TrimSpace(turnID)
	streamID := r.svc.publicChatTurnStreamID(trimmedTurnID)
	if streamID == "" {
		return status.Error(codes.FailedPrecondition, "runtime.agent.timeline stream identity unavailable")
	}
	sequence := r.svc.nextPublicChatStreamSequence(trimmedTurnID)
	timeline, err := r.svc.publicChatTurnTimelineEnvelopeForChannel(trimmedTurnID, channel, sequence, time.Now())
	if err != nil {
		return err
	}
	timeline["projection_rule_id"] = publicChatProjectionRuleIDForTimelineMessage(messageType)
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                trimmedTurnID,
		"stream_id":              streamID,
		"timeline":               timeline,
		"detail":                 detail,
	}
	if err := r.emitEvent(session.SubjectUserID, messageType, out); err != nil {
		return err
	}
	return r.emitSemanticVoiceAgentEvent(session, trimmedTurnID, streamID, messageType, detail, time.Now().UTC())
}

func (r publicChatRuntime) emitSemanticVoiceAgentEvent(session publicChatAnchorState, turnID string, streamID string, messageType string, detail map[string]any, observedAt time.Time) error {
	if r.svc == nil {
		return nil
	}
	presentation := publicChatSemanticVoiceAgentEventDetail(session, turnID, streamID, messageType, detail)
	if presentation == nil {
		return nil
	}
	if err := validatePresentationDetail(presentation); err != nil {
		return err
	}
	event := r.svc.newEventAt(session.AgentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION, &runtimev1.AgentEvent_Presentation{Presentation: presentation}, observedAt)
	return r.svc.commitAgentEvents(event)
}

func publicChatSemanticVoiceAgentEventDetail(session publicChatAnchorState, turnID string, streamID string, messageType string, detail map[string]any) *runtimev1.AgentPresentationEventDetail {
	base := &runtimev1.AgentPresentationEventDetail{
		ConversationAnchorId: strings.TrimSpace(session.ConversationAnchorID),
		TurnId:               strings.TrimSpace(turnID),
		StreamId:             strings.TrimSpace(streamID),
	}
	switch strings.TrimSpace(messageType) {
	case publicChatConversationVoiceTimingReadyType:
		base.Family = runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_TIMING_READY
		base.AudioArtifactId = publicChatProjectionString(detail, "audio_artifact_id")
		base.AudioMimeType = publicChatProjectionString(detail, "audio_mime_type")
		base.MessageId = publicChatProjectionString(detail, "message_id")
		base.DurationMs = publicChatProjectionInt64(detail, "duration_ms")
		base.DeadlineOffsetMs = publicChatProjectionInt64(detail, "deadline_offset_ms")
		base.VoiceTimingPhase = runtimeAgentVoiceTimingPhaseFromName(publicChatProjectionString(detail, "voice_timing_phase"))
		base.Reason = publicChatProjectionString(detail, "reason")
		return base
	case publicChatConversationVoiceArtifactAvailableType:
		base.Family = runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_ARTIFACT_AVAILABLE
		base.AudioArtifactId = publicChatProjectionString(detail, "audio_artifact_id")
		base.AudioMimeType = publicChatProjectionString(detail, "audio_mime_type")
		base.MessageId = publicChatProjectionString(detail, "message_id")
		base.ArtifactSequence = publicChatProjectionUint64(detail, "artifact_sequence")
		base.ArtifactComplete = publicChatProjectionBool(detail, "artifact_complete")
		base.DurationMs = publicChatProjectionInt64(detail, "duration_ms")
		base.VoiceTimingPhase = runtimeAgentVoiceTimingPhaseFromName(publicChatProjectionString(detail, "voice_timing_phase"))
		base.Reason = publicChatProjectionString(detail, "reason")
		return base
	case publicChatConversationVoiceTimingTerminalType:
		base.Family = runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_TIMING_TERMINAL
		base.AudioArtifactId = publicChatProjectionString(detail, "audio_artifact_id")
		base.AudioMimeType = publicChatProjectionString(detail, "audio_mime_type")
		base.MessageId = publicChatProjectionString(detail, "message_id")
		base.VoiceTimingPhase = runtimeAgentVoiceTimingPhaseFromName(publicChatProjectionString(detail, "voice_timing_phase"))
		base.TerminalReason = publicChatProjectionString(detail, "terminal_reason")
		return base
	default:
		return nil
	}
}

func publicChatProjectionString(detail map[string]any, key string) string {
	if detail == nil {
		return ""
	}
	value, _ := detail[key].(string)
	return strings.TrimSpace(value)
}

func publicChatProjectionBool(detail map[string]any, key string) bool {
	if detail == nil {
		return false
	}
	value, _ := detail[key].(bool)
	return value
}

func publicChatProjectionInt64(detail map[string]any, key string) int64 {
	if detail == nil {
		return 0
	}
	switch value := detail[key].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case uint64:
		return int64(value)
	default:
		return 0
	}
}

func publicChatProjectionUint64(detail map[string]any, key string) uint64 {
	if detail == nil {
		return 0
	}
	switch value := detail[key].(type) {
	case uint64:
		return value
	case int64:
		if value > 0 {
			return uint64(value)
		}
	case int:
		if value > 0 {
			return uint64(value)
		}
	}
	return 0
}

func runtimeAgentVoiceTimingPhaseFromName(value string) runtimev1.AgentVoiceTimingPhase {
	switch strings.TrimSpace(value) {
	case "active":
		return runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_ACTIVE
	case "completed":
		return runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_COMPLETED
	case "failed":
		return runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_FAILED
	case "interrupted":
		return runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_INTERRUPTED
	case "canceled":
		return runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_CANCELED
	default:
		return runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_UNSPECIFIED
	}
}

func publicChatProjectionRuleIDForTimelineMessage(messageType string) string {
	switch strings.TrimSpace(messageType) {
	case publicChatConversationVoiceArtifactAvailableType, publicChatConversationVoiceTimingTerminalType:
		return "K-AGCORE-133"
	default:
		return "K-AGCORE-051"
	}
}
