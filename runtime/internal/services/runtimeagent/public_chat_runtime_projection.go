package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func (r publicChatRuntime) projectCommittedStatusCue(session publicChatAnchorState, turn publicChatTurnState, structured *publicChatStructuredEnvelope) {
	if r.svc == nil || r.svc.isClosed() || structured == nil || structured.StatusCue == nil {
		return
	}
	mood := strings.TrimSpace(structured.StatusCue.Mood)
	activityName := strings.TrimSpace(structured.StatusCue.ActionCue)
	if mood == "" && activityName == "" {
		return
	}
	anchorID := strings.TrimSpace(session.ConversationAnchorID)
	turnID := strings.TrimSpace(turn.TurnID)
	streamID := strings.TrimSpace(turn.StreamID)
	if anchorID == "" || turnID == "" || streamID == "" {
		return
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(session.AgentID))
	if err != nil {
		return
	}
	now := time.Now().UTC()
	origin := stateEventOrigin{
		ConversationAnchorID: anchorID,
		OriginatingTurnID:    turnID,
		OriginatingStreamID:  streamID,
	}
	events := make([]*runtimev1.AgentEvent, 0, 3)
	if mood != "" {
		emotionEvent, eerr := r.svc.applyCurrentEmotionTransition(entry, mood, "chat_status_cue", origin, now)
		if eerr != nil {
			if r.svc.logger != nil {
				r.svc.logger.Warn("skip runtime.agent.state.emotion_changed; emotion invalid", "agent_id", session.AgentID, "error", eerr)
			}
		}
		if emotionEvent != nil {
			events = append(events, emotionEvent)
			presentationEvent, perr := r.svc.emitPresentationExpressionEvent(entry.Agent.GetAgentId(), anchorID, turnID, streamID, mood, 0, now)
			if perr != nil {
				if r.svc.logger != nil {
					r.svc.logger.Warn("skip presentation.expression_requested; envelope invalid", "agent_id", session.AgentID, "error", perr)
				}
			} else {
				events = append(events, presentationEvent)
			}
		}
	}
	if activityName != "" {
		category, intensity, ierr := normalizePublicChatActivityProjection(activityName, structured.StatusCue.Intensity)
		if ierr != nil {
			if r.svc.logger != nil {
				r.svc.logger.Warn("skip presentation.activity_requested; activity ontology invalid", "agent_id", session.AgentID, "error", ierr)
			}
			return
		}
		activityEvent, aerr := r.svc.emitPresentationActivityEvent(entry.Agent.GetAgentId(), anchorID, turnID, streamID, activityName, category, intensity, "apml_output", now)
		if aerr != nil {
			if r.svc.logger != nil {
				r.svc.logger.Warn("skip presentation.activity_requested; envelope invalid", "agent_id", session.AgentID, "error", aerr)
			}
		} else {
			events = append(events, activityEvent)
		}
	}
	if len(events) == 0 {
		return
	}
	if err := r.svc.updateAgent(entry, events...); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit runtime.agent.state+presentation from status cue failed", "agent_id", session.AgentID, "turn_id", turnID, "error", err)
	}
}

// projectCommittedVoiceLipsync synthesizes voice/lipsync timeline events from
// committed assistant text only when Runtime-owned agent policy resolves an
// Avatar autoplay target and a playable provider audio artifact. Text commit is
// otherwise complete without voice.
//
// Empty text, disabled policy, unavailable TTS route, non-audio artifact, or
// synthesizer error all skip voice projection without blocking turn completion.
func (r publicChatRuntime) projectCommittedVoiceLipsync(ctx context.Context, session publicChatAnchorState, turn publicChatTurnState, structured *publicChatStructuredEnvelope) {
	if r.svc == nil || r.svc.isClosed() || structured == nil {
		return
	}
	if r.svc.voiceLipsync == nil {
		return
	}
	policy, ok := r.agentVoiceOutputPolicyForSession(session)
	if !ok || !policy.AvatarAutoplay {
		return
	}
	text := strings.TrimSpace(structured.Message.Text)
	messageID := strings.TrimSpace(structured.Message.MessageID)
	turnID := strings.TrimSpace(turn.TurnID)
	if text == "" || messageID == "" || turnID == "" {
		return
	}
	synthesisInput := voiceLipsyncSynthesisInput{
		Context:               ctx,
		TurnID:                turnID,
		MessageID:             messageID,
		Text:                  text,
		DefaultVoiceReference: policy.DefaultVoiceReference,
		SpeechModelID:         policy.SpeechModelID,
		SpeechRoutePolicy:     policy.SpeechRoutePolicy,
		SpeechConnectorID:     policy.SpeechConnectorID,
		SpeechTargetRef:       clonePublicChatTargetRef(policy.SpeechTargetRef),
		AgentID:               session.AgentID,
	}
	if streamed, err := r.projectCommittedNativeVoiceStream(session, turn, synthesisInput); streamed {
		if err != nil && r.svc.logger != nil {
			r.svc.logger.Warn("native voice stream synthesis failed",
				"agent_id", session.AgentID,
				"turn_id", turnID,
				"message_id", messageID,
				"error", err,
			)
		}
		return
	}
	out, err := r.svc.voiceLipsync.synthesize(synthesisInput)
	if err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("voice lipsync synthesis failed",
				"agent_id", session.AgentID,
				"turn_id", turnID,
				"message_id", messageID,
				"error", err,
			)
		}
		return
	}
	if len(out.Frames) == 0 || strings.TrimSpace(out.AudioArtifactID) == "" {
		return
	}
	if err := r.svc.verifyVoiceAudioArtifact(out); err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("voice output artifact unavailable; committed turn remains text-only",
				"agent_id", session.AgentID,
				"turn_id", turnID,
				"audio_artifact_id", out.AudioArtifactID,
				"error", err,
			)
		}
		return
	}
	if err := r.svc.retainGeneratedVoiceArtifact(synthesisInput, out, session); err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("voice output artifact metadata unavailable; committed turn remains text-only",
				"agent_id", session.AgentID,
				"turn_id", turnID,
				"audio_artifact_id", out.AudioArtifactID,
				"error", err,
			)
		}
		return
	}
	if err := r.emitVoiceStreamChunkTimelineEvent(session, turn, publicChatVoiceStreamChunkProjection{
		AudioArtifactID:    out.AudioArtifactID,
		AudioMimeType:      out.AudioMimeType,
		MessageID:          messageID,
		ChunkSequence:      1,
		FinalChunk:         true,
		VoiceOutputMode:    "batch_final_artifact",
		VoicePlaybackState: "active",
		DurationMs:         out.DurationMs,
		Reason:             "final_artifact_available",
		PlaybackTarget:     "avatar_autoplay",
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit voice_stream_chunk_available failed",
			"agent_id", session.AgentID,
			"turn_id", turnID,
			"audio_artifact_id", out.AudioArtifactID,
			"error", err,
		)
		return
	}
	if err := r.emitVoicePlaybackTimelineEvent(session, turn, publicChatVoicePlaybackProjection{
		AudioArtifactID:       out.AudioArtifactID,
		AudioMimeType:         out.AudioMimeType,
		MessageID:             messageID,
		DurationMs:            out.DurationMs,
		DefaultVoiceReference: out.DefaultVoiceReference,
		VoiceRouteBinding:     out.VoiceRouteBinding,
		PlaybackState:         "requested",
		VoiceOutputMode:       "batch_final_artifact",
		VoicePlaybackState:    "active",
		PlaybackTarget:        "avatar_autoplay",
		FinalArtifact:         true,
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit voice_playback_requested failed",
			"agent_id", session.AgentID,
			"turn_id", turnID,
			"audio_artifact_id", out.AudioArtifactID,
			"error", err,
		)
		return
	}
	if err := r.emitLipsyncFrameBatchTimelineEvent(session, turn, publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: out.AudioArtifactID,
		Frames:          out.Frames,
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit lipsync_frame_batch failed",
			"agent_id", session.AgentID,
			"turn_id", turnID,
			"audio_artifact_id", out.AudioArtifactID,
			"frame_count", len(out.Frames),
			"error", err,
		)
	}
}

func (r publicChatRuntime) projectCommittedNativeVoiceStream(session publicChatAnchorState, turn publicChatTurnState, input voiceLipsyncSynthesisInput) (bool, error) {
	if r.svc == nil || r.svc.voiceLipsync == nil {
		return false, nil
	}
	streamer, ok := r.svc.voiceLipsync.(voiceLipsyncNativeStreamSynthesizer)
	if !ok {
		return false, nil
	}
	messageID := strings.TrimSpace(input.MessageID)
	voiceStreamID := runtimeAgentVoiceStreamID(input.TurnID, input.MessageID)
	parentCtx := input.Context
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	streamCtx, cancel := context.WithCancel(parentCtx)
	defer cancel()
	unregisterCancel := r.svc.registerAgentVoiceStreamCancel(voiceStreamID, cancel)
	defer unregisterCancel()
	streamInput := input
	streamInput.Context = streamCtx
	var emittedChunks uint64
	out, streamed, err := streamer.synthesizeNativeStream(streamInput, func(chunk voiceLipsyncNativeStreamChunk) error {
		r.svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
			VoiceStreamId:        voiceStreamID,
			ConversationAnchorId: session.ConversationAnchorID,
			TurnId:               turn.TurnID,
			StreamId:             turn.StreamID,
			MessageId:            messageID,
			ChunkSequence:        chunk.Sequence,
			Chunk:                append([]byte(nil), chunk.Bytes...),
			MimeType:             chunk.MimeType,
			VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
			PlaybackTarget:       "avatar_autoplay",
			VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE,
		})
		if err := r.emitVoiceStreamChunkTimelineEvent(session, turn, publicChatVoiceStreamChunkProjection{
			AudioMimeType:      chunk.MimeType,
			VoiceStreamID:      voiceStreamID,
			ChunkTransportRef:  runtimeAgentVoiceStreamChunkTransportRef(voiceStreamID, chunk.Sequence),
			MessageID:          messageID,
			ChunkSequence:      chunk.Sequence,
			FinalChunk:         false,
			VoiceOutputMode:    "native_stream",
			VoicePlaybackState: "active",
			Reason:             "native_stream_chunk_available",
			PlaybackTarget:     "avatar_autoplay",
		}); err != nil {
			return err
		}
		emittedChunks = chunk.Sequence
		return nil
	})
	if !streamed {
		return false, nil
	}
	if err != nil {
		if r.svc.agentVoiceStreamTerminalState(voiceStreamID) == runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED {
			return true, nil
		}
		if emittedChunks > 0 {
			if terminalErr := r.emitNativeVoiceStreamFailedTerminal(session, turn, input, voiceStreamID); terminalErr != nil {
				return true, terminalErr
			}
		}
		return true, err
	}
	if emittedChunks == 0 {
		return true, nil
	}
	if r.svc.agentVoiceStreamTerminalState(voiceStreamID) == runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED {
		return true, nil
	}
	if err := r.svc.putGeneratedVoiceArtifactBytes(
		out.AudioArtifactID,
		out.AudioBytes,
		out.AudioMimeType,
		input,
		session,
		"generated_agent_voice",
	); err != nil {
		return true, err
	}
	if err := r.svc.verifyVoiceAudioArtifact(out); err != nil {
		return true, err
	}
	if err := r.emitVoicePlaybackTimelineEvent(session, turn, publicChatVoicePlaybackProjection{
		AudioArtifactID:       out.AudioArtifactID,
		AudioMimeType:         out.AudioMimeType,
		VoiceStreamID:         voiceStreamID,
		MessageID:             messageID,
		DurationMs:            out.DurationMs,
		DefaultVoiceReference: out.DefaultVoiceReference,
		VoiceRouteBinding:     out.VoiceRouteBinding,
		PlaybackState:         "requested",
		VoiceOutputMode:       "native_stream",
		VoicePlaybackState:    "active",
		PlaybackTarget:        "avatar_autoplay",
		FinalArtifact:         true,
		Reason:                "native_stream_final_artifact_available",
	}); err != nil {
		return true, err
	}
	if err := r.emitLipsyncFrameBatchTimelineEvent(session, turn, publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: out.AudioArtifactID,
		Frames:          out.Frames,
	}); err != nil {
		return true, err
	}
	if err := r.emitVoicePlaybackTerminalTimelineEvent(session, turn, publicChatVoicePlaybackTerminalProjection{
		VoiceStreamID:      voiceStreamID,
		AudioArtifactID:    out.AudioArtifactID,
		AudioMimeType:      out.AudioMimeType,
		MessageID:          messageID,
		VoiceOutputMode:    "native_stream",
		VoicePlaybackState: "completed",
		PlaybackTarget:     "avatar_autoplay",
		TerminalReason:     "native_stream_completed",
	}); err != nil {
		return true, err
	}
	r.svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: session.ConversationAnchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            messageID,
		MimeType:             out.AudioMimeType,
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		Terminal:             true,
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_COMPLETED,
		TerminalReason:       "native_stream_completed",
	})
	return true, nil
}

func (r publicChatRuntime) emitNativeVoiceStreamFailedTerminal(
	session publicChatAnchorState,
	turn publicChatTurnState,
	input voiceLipsyncSynthesisInput,
	voiceStreamID string,
) error {
	const terminalReason = "native_stream_failed"
	messageID := strings.TrimSpace(input.MessageID)
	if err := r.emitVoicePlaybackTerminalTimelineEvent(session, turn, publicChatVoicePlaybackTerminalProjection{
		VoiceStreamID:      voiceStreamID,
		MessageID:          messageID,
		VoiceOutputMode:    "native_stream",
		VoicePlaybackState: "failed",
		PlaybackTarget:     "avatar_autoplay",
		TerminalReason:     terminalReason,
	}); err != nil {
		return err
	}
	r.svc.publishAgentVoiceStreamEvent(&runtimev1.AgentVoiceStreamEvent{
		VoiceStreamId:        voiceStreamID,
		ConversationAnchorId: session.ConversationAnchorID,
		TurnId:               turn.TurnID,
		StreamId:             turn.StreamID,
		MessageId:            messageID,
		VoiceOutputMode:      runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
		PlaybackTarget:       "avatar_autoplay",
		Terminal:             true,
		VoicePlaybackState:   runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_FAILED,
		TerminalReason:       terminalReason,
	})
	return nil
}

type agentVoiceOutputPolicy struct {
	AvatarAutoplay        bool
	DefaultVoiceReference string
	SpeechModelID         string
	SpeechRoutePolicy     runtimev1.RoutePolicy
	SpeechConnectorID     string
	SpeechTargetRef       *runtimev1.RuntimeDurableTargetRef
}

func (r publicChatRuntime) agentVoiceOutputPolicyForSession(session publicChatAnchorState) (agentVoiceOutputPolicy, bool) {
	profile := r.profileContextForSession(session)
	if profile == nil {
		return agentVoiceOutputPolicy{}, false
	}
	voiceRef, err := normalizeDefaultVoiceReference(profileString(profile, "defaultVoiceReference", "default_voice_reference"))
	if err != nil || voiceRef == "" {
		return agentVoiceOutputPolicy{}, false
	}
	audioBinding, ok, err := r.svc.committedOptionalExecutionBinding(session.LocalAgentRef, runtimeAgentAIConfigCapabilityAudioSynthesize)
	if err != nil || !ok {
		return agentVoiceOutputPolicy{}, false
	}
	modelID := strings.TrimSpace(audioBinding.ModelID)
	routePolicy := audioBinding.RoutePolicy
	if modelID == "" || routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED ||
		audioBinding.TargetRef == nil || audioBinding.TargetRef.GetTarget() == nil {
		return agentVoiceOutputPolicy{}, false
	}
	return agentVoiceOutputPolicy{
		AvatarAutoplay:        profileBool(profile, "avatarAutoplay", "avatar_autoplay"),
		DefaultVoiceReference: voiceRef,
		SpeechModelID:         modelID,
		SpeechRoutePolicy:     routePolicy,
		SpeechConnectorID:     audioBinding.ConnectorID,
		SpeechTargetRef:       clonePublicChatTargetRef(audioBinding.TargetRef),
	}, true
}

func (r publicChatRuntime) defaultVoiceReferenceForSession(session publicChatAnchorState) string {
	if r.svc == nil || r.svc.chatStateRepo == nil {
		return ""
	}
	metadata, err := r.svc.chatStateRepo.loadConversationAnchorMetadata(session.ConversationAnchorID)
	if err != nil || metadata == nil {
		return ""
	}
	profile := conversationAnchorProfileContext(metadata)
	if profile == nil {
		return ""
	}
	value := profileString(profile, "defaultVoiceReference", "default_voice_reference")
	normalized, err := normalizeDefaultVoiceReference(value)
	if err != nil {
		return ""
	}
	return normalized
}

func (r publicChatRuntime) profileContextForSession(session publicChatAnchorState) map[string]*structpb.Value {
	if profile := r.agentPresentationProfileContextForSession(session); profile != nil {
		return profile
	}
	if r.svc == nil || r.svc.chatStateRepo == nil {
		return nil
	}
	metadata, err := r.svc.chatStateRepo.loadConversationAnchorMetadata(session.ConversationAnchorID)
	if err != nil || metadata == nil {
		return nil
	}
	return conversationAnchorProfileContext(metadata)
}

func (r publicChatRuntime) agentPresentationProfileContextForSession(session publicChatAnchorState) map[string]*structpb.Value {
	if r.svc == nil {
		return nil
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(session.AgentID))
	if err != nil || entry == nil || entry.Agent == nil {
		return nil
	}
	metadata := entry.Agent.GetMetadata()
	if metadata == nil {
		return nil
	}
	profile := metadata.GetFields()["presentationProfile"].GetStructValue()
	if profile == nil || len(profile.GetFields()) == 0 {
		return nil
	}
	return profile.GetFields()
}

// emitTurnEvent composes the runtime.agent.turn.* envelope per
// K-AGCORE-037 / runtime-agent-event-projection.yaml `turn_envelope`:
// payload top level carries the required envelope fields (`agent_id`,
// `conversation_anchor_id`, `turn_id`, `stream_id`); event-specific
// fields live under `detail` per the mounted `turn_events.detail`
// schema. Runtime execution truth (model_resolved, trace_id,
// follow_up_depth, transcript metadata, etc.) is NOT carried on
// `runtime.agent.turn.*` projection events; it is recovered exclusively
// through the unary public chat session snapshot. Per
// K-AGCORE-030 stream identity is distinct from turn identity and is
// allocated at turn open onto `publicChatTurnState.StreamID`.
//
// Per yaml `extra_fields_by_event`, `runtime.agent.turn.message_committed`
// additionally carries `message_id` at envelope level; callers must
// emit it through emitTurnMessageCommitted, which sets that envelope
// extra explicitly rather than relying on detail merge.
