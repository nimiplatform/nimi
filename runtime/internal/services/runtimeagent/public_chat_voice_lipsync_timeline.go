package runtimeagent

import (
	"math"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	publicChatPresentationVoicePlaybackRequestedType = "runtime.agent.presentation.voice_playback_requested"
	publicChatPresentationVoiceStreamChunkType       = "runtime.agent.presentation.voice_stream_chunk_available"
	publicChatPresentationVoicePlaybackTerminalType  = "runtime.agent.presentation.voice_playback_terminal"
	publicChatPresentationLipsyncFrameBatchType      = "runtime.agent.presentation.lipsync_frame_batch"
)

type publicChatVoicePlaybackProjection struct {
	AudioArtifactID       string
	AudioMimeType         string
	VoiceStreamID         string
	MessageID             string
	DurationMs            int64
	DeadlineOffsetMs      int64
	PlaybackState         string
	VoiceOutputMode       string
	VoicePlaybackState    string
	PlaybackTarget        string
	FinalArtifact         bool
	Reason                string
	DefaultVoiceReference string
	VoiceRouteBinding     *voiceRouteBindingProjection
}

type publicChatLipsyncFrameProjection struct {
	FrameSequence uint64
	OffsetMs      int64
	DurationMs    int64
	MouthOpenY    float64
	AudioLevel    float64
}

type publicChatVoiceStreamChunkProjection struct {
	AudioArtifactID    string
	AudioMimeType      string
	VoiceStreamID      string
	ChunkTransportRef  string
	MessageID          string
	ChunkSequence      uint64
	FinalChunk         bool
	VoiceOutputMode    string
	VoicePlaybackState string
	DurationMs         int64
	Reason             string
	PlaybackTarget     string
}

type publicChatVoicePlaybackTerminalProjection struct {
	VoiceStreamID      string
	AudioArtifactID    string
	AudioMimeType      string
	MessageID          string
	VoiceOutputMode    string
	VoicePlaybackState string
	PlaybackTarget     string
	TerminalReason     string
}

type publicChatLipsyncFrameBatchProjection struct {
	AudioArtifactID string
	Frames          []publicChatLipsyncFrameProjection
}

func publicChatBuildVoicePlaybackDetail(input publicChatVoicePlaybackProjection) (map[string]any, error) {
	audioArtifactID := strings.TrimSpace(input.AudioArtifactID)
	audioMimeType := strings.TrimSpace(input.AudioMimeType)
	if audioArtifactID == "" || audioMimeType == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_playback_requested requires runtime-owned audio identity")
	}
	if !isPlayableAudioMimeType(audioMimeType) {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_playback_requested requires playable audio artifact")
	}
	if input.DurationMs < 0 || input.DeadlineOffsetMs < 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_requested duration/deadline must be non-negative")
	}
	playbackState := strings.TrimSpace(input.PlaybackState)
	switch playbackState {
	case "requested", "started", "completed", "interrupted", "canceled", "failed":
	default:
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_requested playback_state invalid")
	}
	voiceOutputMode := normalizeVoiceOutputMode(input.VoiceOutputMode, input.FinalArtifact)
	if !isValidVoiceOutputMode(voiceOutputMode) {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_requested voice_output_mode invalid")
	}
	voicePlaybackState := normalizeVoicePlaybackState(input.VoicePlaybackState)
	if !isValidVoicePlaybackState(voicePlaybackState) {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_requested voice_playback_state invalid")
	}
	detail := map[string]any{
		"audio_artifact_id":    audioArtifactID,
		"audio_mime_type":      audioMimeType,
		"playback_state":       playbackState,
		"voice_output_mode":    voiceOutputMode,
		"voice_playback_state": voicePlaybackState,
	}
	if voiceStreamID := strings.TrimSpace(input.VoiceStreamID); voiceStreamID != "" {
		detail["voice_stream_id"] = voiceStreamID
	}
	if messageID := strings.TrimSpace(input.MessageID); messageID != "" {
		detail["message_id"] = messageID
	}
	if target := strings.TrimSpace(input.PlaybackTarget); target != "" {
		switch target {
		case "avatar_autoplay", "desktop_manual", "replay":
			detail["playback_target"] = target
		default:
			return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_requested playback_target invalid")
		}
	}
	if input.FinalArtifact {
		detail["final_artifact"] = true
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
	if voiceRef := strings.TrimSpace(input.DefaultVoiceReference); voiceRef != "" {
		detail["default_voice_reference"] = voiceRef
	}
	if binding := publicChatVoiceRouteBindingDetail(input.VoiceRouteBinding); binding != nil {
		detail["voice_route_binding"] = binding
	}
	return detail, nil
}

func publicChatBuildVoiceStreamChunkDetail(input publicChatVoiceStreamChunkProjection) (map[string]any, error) {
	audioArtifactID := strings.TrimSpace(input.AudioArtifactID)
	audioMimeType := strings.TrimSpace(input.AudioMimeType)
	if input.ChunkSequence == 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_stream_chunk_available chunk_sequence must be positive")
	}
	if input.DurationMs < 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_stream_chunk_available duration must be non-negative")
	}
	voiceOutputMode := normalizeVoiceOutputMode(input.VoiceOutputMode, input.FinalChunk)
	if !isValidVoiceOutputMode(voiceOutputMode) {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_stream_chunk_available voice_output_mode invalid")
	}
	voicePlaybackState := normalizeVoicePlaybackState(input.VoicePlaybackState)
	if !isValidVoicePlaybackState(voicePlaybackState) {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_stream_chunk_available voice_playback_state invalid")
	}
	voiceStreamID := strings.TrimSpace(input.VoiceStreamID)
	chunkTransportRef := strings.TrimSpace(input.ChunkTransportRef)
	nativeTransientChunk := voiceOutputMode == "native_stream" && !input.FinalChunk
	if nativeTransientChunk {
		if voiceStreamID == "" || chunkTransportRef == "" || audioMimeType == "" {
			return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_stream_chunk_available native chunk requires transient transport identity")
		}
		if audioArtifactID != "" {
			return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_stream_chunk_available native non-final chunk must not mint durable audio artifact")
		}
		if !isPlayableAudioMimeType(audioMimeType) {
			return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_stream_chunk_available requires playable audio mime type")
		}
	} else {
		if audioArtifactID == "" || audioMimeType == "" {
			return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_stream_chunk_available requires runtime-owned audio identity")
		}
		if !isPlayableAudioMimeType(audioMimeType) {
			return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_stream_chunk_available requires playable audio artifact")
		}
	}
	detail := map[string]any{
		"audio_mime_type":      audioMimeType,
		"chunk_sequence":       int64(input.ChunkSequence),
		"final_chunk":          input.FinalChunk,
		"voice_output_mode":    voiceOutputMode,
		"voice_playback_state": voicePlaybackState,
	}
	if audioArtifactID != "" {
		detail["audio_artifact_id"] = audioArtifactID
	}
	if voiceStreamID != "" {
		detail["voice_stream_id"] = voiceStreamID
	}
	if chunkTransportRef != "" {
		detail["chunk_transport_ref"] = chunkTransportRef
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
	if target := strings.TrimSpace(input.PlaybackTarget); target != "" {
		switch target {
		case "avatar_autoplay", "desktop_manual", "replay":
			detail["playback_target"] = target
		default:
			return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_stream_chunk_available playback_target invalid")
		}
	}
	return detail, nil
}

func publicChatBuildVoicePlaybackTerminalDetail(input publicChatVoicePlaybackTerminalProjection) (map[string]any, error) {
	voiceStreamID := strings.TrimSpace(input.VoiceStreamID)
	if voiceStreamID == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_playback_terminal requires voice_stream_id")
	}
	voiceOutputMode := normalizeVoiceOutputMode(input.VoiceOutputMode, false)
	if !isValidVoiceOutputMode(voiceOutputMode) {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_terminal voice_output_mode invalid")
	}
	voicePlaybackState := normalizeVoicePlaybackState(input.VoicePlaybackState)
	switch voicePlaybackState {
	case "completed", "failed", "interrupted", "canceled":
	default:
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_terminal voice_playback_state must be terminal")
	}
	terminalReason := strings.TrimSpace(input.TerminalReason)
	if terminalReason == "" {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_terminal terminal_reason required")
	}
	detail := map[string]any{
		"voice_stream_id":      voiceStreamID,
		"voice_output_mode":    voiceOutputMode,
		"voice_playback_state": voicePlaybackState,
		"terminal_reason":      terminalReason,
	}
	if audioArtifactID := strings.TrimSpace(input.AudioArtifactID); audioArtifactID != "" {
		detail["final_artifact_id"] = audioArtifactID
	}
	if audioMimeType := strings.TrimSpace(input.AudioMimeType); audioMimeType != "" {
		if !isPlayableAudioMimeType(audioMimeType) {
			return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_playback_terminal requires playable audio mime type")
		}
		detail["audio_mime_type"] = audioMimeType
	}
	if messageID := strings.TrimSpace(input.MessageID); messageID != "" {
		detail["message_id"] = messageID
	}
	if target := strings.TrimSpace(input.PlaybackTarget); target != "" {
		switch target {
		case "avatar_autoplay", "desktop_manual", "replay":
			detail["playback_target"] = target
		default:
			return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_playback_terminal playback_target invalid")
		}
	}
	return detail, nil
}

func normalizeVoiceOutputMode(value string, finalArtifact bool) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	if finalArtifact {
		return "batch_final_artifact"
	}
	return ""
}

func isValidVoiceOutputMode(value string) bool {
	switch strings.TrimSpace(value) {
	case "native_stream", "simulated_stream", "batch_final_artifact", "text_only":
		return true
	default:
		return false
	}
}

func normalizeVoicePlaybackState(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	return "active"
}

func isValidVoicePlaybackState(value string) bool {
	switch strings.TrimSpace(value) {
	case "active", "completed", "failed", "interrupted", "canceled":
		return true
	default:
		return false
	}
}

func publicChatVoiceRouteBindingDetail(binding *voiceRouteBindingProjection) map[string]any {
	if binding == nil {
		return nil
	}
	detail := map[string]any{}
	if value := strings.TrimSpace(binding.Capability); value != "" {
		detail["capability"] = value
	}
	if value := strings.TrimSpace(binding.DefaultVoiceReference); value != "" {
		detail["default_voice_reference"] = value
	}
	if value := strings.TrimSpace(binding.VoiceReferenceKind); value != "" {
		detail["voice_reference_kind"] = value
	}
	if value := strings.TrimSpace(binding.VoiceReferenceValue); value != "" {
		detail["voice_reference_value"] = value
	}
	if value := strings.TrimSpace(binding.ModelID); value != "" {
		detail["model_id"] = value
	}
	if value := strings.TrimSpace(binding.ModelResolved); value != "" {
		detail["model_resolved"] = value
	}
	if value := strings.TrimSpace(binding.ScenarioJobID); value != "" {
		detail["scenario_job_id"] = value
	}
	if value := strings.TrimSpace(binding.AudioArtifactID); value != "" {
		detail["bound_audio_artifact_id"] = value
	}
	if value := strings.TrimSpace(binding.AudioMimeType); value != "" {
		detail["bound_audio_mime_type"] = value
	}
	if value := strings.TrimSpace(binding.SynthesisMode); value != "" {
		detail["synthesis_mode"] = value
	}
	if value := strings.TrimSpace(binding.Status); value != "" {
		detail["status"] = value
	}
	if value := strings.TrimSpace(binding.Reason); value != "" {
		detail["reason"] = value
	}
	if len(detail) == 0 {
		return nil
	}
	return detail
}

func publicChatBuildLipsyncFrameBatchDetail(input publicChatLipsyncFrameBatchProjection) (map[string]any, error) {
	audioArtifactID := strings.TrimSpace(input.AudioArtifactID)
	if audioArtifactID == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.lipsync_frame_batch requires runtime-owned audio identity")
	}
	if len(input.Frames) == 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.lipsync_frame_batch requires frames")
	}
	frames := make([]any, 0, len(input.Frames))
	var previousSequence uint64
	var previousOffset int64 = -1
	for _, frame := range input.Frames {
		if err := publicChatValidateTimelineSequence(publicChatTimelineChannelLipsync, previousSequence, publicChatTimelineChannelLipsync, frame.FrameSequence); err != nil {
			return nil, err
		}
		if frame.OffsetMs < 0 || frame.DurationMs <= 0 {
			return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.lipsync_frame_batch frame offset/duration invalid")
		}
		if previousOffset > frame.OffsetMs {
			return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.lipsync_frame_batch frame offsets must be monotonic")
		}
		if math.IsNaN(frame.MouthOpenY) || math.IsInf(frame.MouthOpenY, 0) || frame.MouthOpenY < 0 || frame.MouthOpenY > 1 {
			return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.lipsync_frame_batch mouth_open_y must be between 0 and 1")
		}
		if math.IsNaN(frame.AudioLevel) || math.IsInf(frame.AudioLevel, 0) || frame.AudioLevel < 0 || frame.AudioLevel > 1 {
			return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.lipsync_frame_batch audio_level must be between 0 and 1")
		}
		frames = append(frames, map[string]any{
			"frame_sequence": int64(frame.FrameSequence),
			"offset_ms":      frame.OffsetMs,
			"duration_ms":    frame.DurationMs,
			"mouth_open_y":   frame.MouthOpenY,
			"audio_level":    frame.AudioLevel,
		})
		previousSequence = frame.FrameSequence
		previousOffset = frame.OffsetMs
	}
	return map[string]any{
		"audio_artifact_id": audioArtifactID,
		"frames":            frames,
	}, nil
}

func (r publicChatRuntime) emitVoicePlaybackTimelineEvent(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoicePlaybackProjection) error {
	detail, err := publicChatBuildVoicePlaybackDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannel(session, turn.TurnID, publicChatPresentationVoicePlaybackRequestedType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitVoiceStreamChunkTimelineEvent(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoiceStreamChunkProjection) error {
	detail, err := publicChatBuildVoiceStreamChunkDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannel(session, turn.TurnID, publicChatPresentationVoiceStreamChunkType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitVoicePlaybackTerminalTimelineEvent(session publicChatAnchorState, turn publicChatTurnState, input publicChatVoicePlaybackTerminalProjection) error {
	detail, err := publicChatBuildVoicePlaybackTerminalDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannel(session, turn.TurnID, publicChatPresentationVoicePlaybackTerminalType, publicChatTimelineChannelVoice, detail)
}

func (r publicChatRuntime) emitLipsyncFrameBatchTimelineEvent(session publicChatAnchorState, turn publicChatTurnState, input publicChatLipsyncFrameBatchProjection) error {
	detail, err := publicChatBuildLipsyncFrameBatchDetail(input)
	if err != nil {
		return err
	}
	return r.emitTimelineEventForChannel(session, turn.TurnID, publicChatPresentationLipsyncFrameBatchType, publicChatTimelineChannelLipsync, detail)
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
	if err := r.emitEvent(session.CallerAppID, session.SubjectUserID, messageType, out); err != nil {
		return err
	}
	return r.emitPresentationAgentEventForTimeline(session, trimmedTurnID, streamID, messageType, detail, time.Now().UTC())
}

func (r publicChatRuntime) emitPresentationAgentEventForTimeline(session publicChatAnchorState, turnID string, streamID string, messageType string, detail map[string]any, observedAt time.Time) error {
	if r.svc == nil {
		return nil
	}
	presentation := publicChatPresentationAgentEventDetail(session, turnID, streamID, messageType, detail)
	if presentation == nil {
		return nil
	}
	if err := validatePresentationDetail(presentation); err != nil {
		return err
	}
	event := r.svc.newEventAt(session.AgentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION, &runtimev1.AgentEvent_Presentation{Presentation: presentation}, observedAt)
	return r.svc.commitAgentEvents(event)
}

func publicChatPresentationAgentEventDetail(session publicChatAnchorState, turnID string, streamID string, messageType string, detail map[string]any) *runtimev1.AgentPresentationEventDetail {
	base := &runtimev1.AgentPresentationEventDetail{
		ConversationAnchorId: strings.TrimSpace(session.ConversationAnchorID),
		TurnId:               strings.TrimSpace(turnID),
		StreamId:             strings.TrimSpace(streamID),
	}
	switch strings.TrimSpace(messageType) {
	case publicChatPresentationVoicePlaybackRequestedType:
		base.Family = runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_PLAYBACK_REQUESTED
		base.AudioArtifactId = publicChatProjectionString(detail, "audio_artifact_id")
		base.AudioMimeType = publicChatProjectionString(detail, "audio_mime_type")
		base.VoiceStreamId = publicChatProjectionString(detail, "voice_stream_id")
		base.MessageId = publicChatProjectionString(detail, "message_id")
		base.DurationMs = publicChatProjectionInt64(detail, "duration_ms")
		base.DeadlineOffsetMs = publicChatProjectionInt64(detail, "deadline_offset_ms")
		base.VoiceOutputMode = runtimeAgentVoiceOutputModeFromName(publicChatProjectionString(detail, "voice_output_mode"))
		base.VoicePlaybackState = runtimeAgentVoicePlaybackStateFromName(publicChatProjectionString(detail, "voice_playback_state"))
		base.PlaybackTarget = publicChatProjectionString(detail, "playback_target")
		base.FinalArtifact = publicChatProjectionBool(detail, "final_artifact")
		base.Reason = publicChatProjectionString(detail, "reason")
		return base
	case publicChatPresentationVoiceStreamChunkType:
		base.Family = runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_STREAM_CHUNK_AVAILABLE
		base.AudioArtifactId = publicChatProjectionString(detail, "audio_artifact_id")
		base.AudioMimeType = publicChatProjectionString(detail, "audio_mime_type")
		base.VoiceStreamId = publicChatProjectionString(detail, "voice_stream_id")
		base.ChunkTransportRef = publicChatProjectionString(detail, "chunk_transport_ref")
		base.MessageId = publicChatProjectionString(detail, "message_id")
		base.ChunkSequence = publicChatProjectionUint64(detail, "chunk_sequence")
		base.FinalChunk = publicChatProjectionBool(detail, "final_chunk")
		base.DurationMs = publicChatProjectionInt64(detail, "duration_ms")
		base.VoiceOutputMode = runtimeAgentVoiceOutputModeFromName(publicChatProjectionString(detail, "voice_output_mode"))
		base.VoicePlaybackState = runtimeAgentVoicePlaybackStateFromName(publicChatProjectionString(detail, "voice_playback_state"))
		base.PlaybackTarget = publicChatProjectionString(detail, "playback_target")
		base.Reason = publicChatProjectionString(detail, "reason")
		return base
	case publicChatPresentationVoicePlaybackTerminalType:
		base.Family = runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_PLAYBACK_TERMINAL
		base.VoiceStreamId = publicChatProjectionString(detail, "voice_stream_id")
		base.FinalArtifactId = publicChatProjectionString(detail, "final_artifact_id")
		base.AudioMimeType = publicChatProjectionString(detail, "audio_mime_type")
		base.MessageId = publicChatProjectionString(detail, "message_id")
		base.VoiceOutputMode = runtimeAgentVoiceOutputModeFromName(publicChatProjectionString(detail, "voice_output_mode"))
		base.VoicePlaybackState = runtimeAgentVoicePlaybackStateFromName(publicChatProjectionString(detail, "voice_playback_state"))
		base.PlaybackTarget = publicChatProjectionString(detail, "playback_target")
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

func runtimeAgentVoiceOutputModeFromName(value string) runtimev1.VoiceOutputMode {
	switch strings.TrimSpace(value) {
	case "native_stream":
		return runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM
	case "simulated_stream":
		return runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_SIMULATED_STREAM
	case "batch_final_artifact":
		return runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_BATCH_FINAL_ARTIFACT
	case "text_only":
		return runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_TEXT_ONLY
	default:
		return runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_UNSPECIFIED
	}
}

func runtimeAgentVoicePlaybackStateFromName(value string) runtimev1.VoicePlaybackState {
	switch strings.TrimSpace(value) {
	case "active":
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE
	case "completed":
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_COMPLETED
	case "failed":
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_FAILED
	case "interrupted":
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED
	case "canceled":
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_CANCELED
	default:
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_UNSPECIFIED
	}
}

func publicChatProjectionRuleIDForTimelineMessage(messageType string) string {
	switch strings.TrimSpace(messageType) {
	case publicChatPresentationVoiceStreamChunkType, publicChatPresentationVoicePlaybackTerminalType:
		return "K-AGCORE-133"
	default:
		return "K-AGCORE-051"
	}
}
