package runtimeagent

import (
	"math"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	publicChatPresentationVoicePlaybackRequestedType = "runtime.agent.presentation.voice_playback_requested"
	publicChatPresentationVoiceStreamChunkType       = "runtime.agent.presentation.voice_stream_chunk_available"
	publicChatPresentationLipsyncFrameBatchType      = "runtime.agent.presentation.lipsync_frame_batch"
)

type publicChatVoicePlaybackProjection struct {
	AudioArtifactID       string
	AudioMimeType         string
	MessageID             string
	DurationMs            int64
	DeadlineOffsetMs      int64
	PlaybackState         string
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
	AudioArtifactID string
	AudioMimeType   string
	MessageID       string
	ChunkSequence   uint64
	FinalChunk      bool
	DurationMs      int64
	Reason          string
	PlaybackTarget  string
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
	detail := map[string]any{
		"audio_artifact_id": audioArtifactID,
		"audio_mime_type":   audioMimeType,
		"playback_state":    playbackState,
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
	if audioArtifactID == "" || audioMimeType == "" {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_stream_chunk_available requires runtime-owned audio identity")
	}
	if !isPlayableAudioMimeType(audioMimeType) {
		return nil, status.Error(codes.FailedPrecondition, "runtime.agent.presentation.voice_stream_chunk_available requires playable audio artifact")
	}
	if input.ChunkSequence == 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_stream_chunk_available chunk_sequence must be positive")
	}
	if input.DurationMs < 0 {
		return nil, status.Error(codes.InvalidArgument, "runtime.agent.presentation.voice_stream_chunk_available duration must be non-negative")
	}
	detail := map[string]any{
		"audio_artifact_id": audioArtifactID,
		"audio_mime_type":   audioMimeType,
		"chunk_sequence":    int64(input.ChunkSequence),
		"final_chunk":       input.FinalChunk,
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
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, messageType, out)
}

func publicChatProjectionRuleIDForTimelineMessage(messageType string) string {
	if strings.TrimSpace(messageType) == publicChatPresentationVoiceStreamChunkType {
		return "K-AGCORE-133"
	}
	return "K-AGCORE-051"
}
