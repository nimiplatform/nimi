package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
// the committed assistant text per K-AGCORE-051. Runtime owns the voice
// playback request + lipsync frame batch projection; provider selection is
// outside the rule. The synthesizer adapter (default: deterministic synthetic)
// produces frames whose `audio_artifact_id` carries a `synthetic://lipsync/...`
// scheme and `audio_mime_type=application/x-nimi-synthetic-lipsync`, so any
// app-side audio consumer fails closed instead of attempting playback.
//
// Empty committed text → silent skip (no events). Synthesizer error → log warn
// and skip; turn commit is not blocked. Failure / interrupt paths do NOT call
// this projection (callers gate on the committed text path).
func (r publicChatRuntime) projectCommittedVoiceLipsync(session publicChatAnchorState, turn publicChatTurnState, structured *publicChatStructuredEnvelope) {
	if r.svc == nil || r.svc.isClosed() || structured == nil {
		return
	}
	if r.svc.voiceLipsync == nil {
		return
	}
	text := strings.TrimSpace(structured.Message.Text)
	messageID := strings.TrimSpace(structured.Message.MessageID)
	turnID := strings.TrimSpace(turn.TurnID)
	if text == "" || messageID == "" || turnID == "" {
		return
	}
	out, err := r.svc.voiceLipsync.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    turnID,
		MessageID: messageID,
		Text:      text,
	})
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
	if err := r.emitVoicePlaybackTimelineEvent(session, turn, publicChatVoicePlaybackProjection{
		AudioArtifactID: out.AudioArtifactID,
		AudioMimeType:   out.AudioMimeType,
		DurationMs:      out.DurationMs,
		PlaybackState:   "requested",
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
