package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
			presentationEvent, perr := r.svc.emitPresentationExpressionEvent(entry.Agent.GetLocalAgentRef(), anchorID, turnID, streamID, mood, 0, now)
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
		activityEvent, aerr := r.svc.emitPresentationActivityEvent(entry.Agent.GetLocalAgentRef(), anchorID, turnID, streamID, activityName, category, intensity, "apml_output", now)
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

// projectCommittedConversationVoice synthesizes the provider-neutral Conversation
// voice sidecar and semantic artifact/timing timeline. Avatar autoplay and
// renderer lipsync are not Runtime inputs or outputs.
func (r publicChatRuntime) projectCommittedConversationVoice(ctx context.Context, session publicChatAnchorState, turn publicChatTurnState, structured *publicChatStructuredEnvelope) {
	if r.svc == nil || r.svc.isClosed() || structured == nil {
		return
	}
	text := strings.TrimSpace(structured.Message.Text)
	messageID := strings.TrimSpace(structured.Message.MessageID)
	turnID := strings.TrimSpace(turn.TurnID)
	if text == "" || messageID == "" || turnID == "" {
		return
	}
	policy, ok, policyReason := r.agentVoiceOutputPolicyForSession(ctx, session)
	if !ok {
		if strings.TrimSpace(policyReason) == "" {
			return
		}
		r.emitVoiceProjectionFailedTerminal(session, turn, messageID, policyReason)
		return
	}
	if r.svc.voiceLipsync == nil {
		r.emitVoiceProjectionFailedTerminal(session, turn, messageID, "VOICE_SYNTHESIS_UNAVAILABLE")
		return
	}
	synthesisInput := voiceLipsyncSynthesisInput{
		Context:                ctx,
		TurnID:                 turnID,
		MessageID:              messageID,
		Text:                   text,
		DefaultVoiceReference:  policy.DefaultVoiceReference,
		SpeechModelID:          policy.SpeechModelID,
		SpeechRoutePolicy:      policy.SpeechRoutePolicy,
		SpeechConnectorID:      policy.SpeechConnectorID,
		SpeechTargetRef:        clonePublicChatTargetRef(policy.SpeechTargetRef),
		SpeechExecutionIntent:  executionintent.Clone(policy.SpeechExecutionIntent),
		SpeechLocalExecution:   localexecution.CloneSelectedLocalExecution(policy.SpeechLocalExecution),
		SpeechLocalIntent:      policy.SpeechLocalIntent,
		SpeechRequiredFeatures: append([]string(nil), policy.SpeechRequiredFeatures...),
		SpeechAppID:            policy.SpeechAppID,
		OwnerUserID:            policy.OwnerUserID,
		AgentID:                session.AgentID,
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
		r.emitVoiceProjectionFailedTerminal(session, turn, messageID, voiceProjectionTerminalReason(err, "VOICE_SYNTHESIS_FAILED"))
		return
	}
	if strings.TrimSpace(out.AudioArtifactID) == "" {
		r.emitVoiceProjectionFailedTerminal(session, turn, messageID, "VOICE_OUTPUT_INVALID")
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
		r.emitVoiceProjectionFailedTerminal(session, turn, messageID, "VOICE_ARTIFACT_UNAVAILABLE")
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
		r.emitVoiceProjectionFailedTerminal(session, turn, messageID, "VOICE_ARTIFACT_RETENTION_FAILED")
		return
	}
	if err := r.svc.commitLocalAppConversationVoiceReady(session, turn, messageID, out.AudioArtifactID); err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("commit protected final voice sidecar failed", "turn_id", turnID, "error", err)
		}
		return
	}
	if err := r.emitVoiceArtifactTimelineEvent(session, turn, publicChatVoiceArtifactProjection{
		AudioArtifactID:  out.AudioArtifactID,
		AudioMimeType:    out.AudioMimeType,
		MessageID:        messageID,
		ArtifactSequence: 1,
		ArtifactComplete: true,
		DurationMs:       out.DurationMs,
		Reason:           "final_artifact_available",
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit semantic voice artifact failed",
			"agent_id", session.AgentID,
			"turn_id", turnID,
			"audio_artifact_id", out.AudioArtifactID,
			"error", err,
		)
		return
	}
	if err := r.emitVoiceTimingReadyTimelineEvent(session, turn, publicChatVoiceTimingReadyProjection{
		AudioArtifactID: out.AudioArtifactID,
		AudioMimeType:   out.AudioMimeType,
		MessageID:       messageID,
		DurationMs:      out.DurationMs,
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit semantic voice timing ready failed",
			"agent_id", session.AgentID,
			"turn_id", turnID,
			"audio_artifact_id", out.AudioArtifactID,
			"error", err,
		)
		return
	}
}

func (r publicChatRuntime) emitVoiceProjectionFailedTerminal(
	session publicChatAnchorState,
	turn publicChatTurnState,
	messageID string,
	terminalReason string,
) {
	if r.svc == nil {
		return
	}
	reason := strings.TrimSpace(terminalReason)
	if reason == "" {
		reason = "VOICE_SYNTHESIS_FAILED"
	}
	if err := r.svc.commitLocalAppConversationVoiceFailed(session, turn, reason); err != nil {
		if status.Code(err) == codes.Canceled {
			return
		}
		if r.svc.logger != nil {
			r.svc.logger.Warn("commit protected voice failure sidecar failed", "turn_id", turn.TurnID, "error", err)
		}
		return
	}
	if err := r.emitVoiceTimingTerminalTimelineEvent(session, turn, publicChatVoiceTimingTerminalProjection{
		MessageID:      strings.TrimSpace(messageID),
		Phase:          "failed",
		TerminalReason: reason,
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit voice failure terminal failed",
			"agent_id", session.AgentID,
			"turn_id", turn.TurnID,
			"message_id", messageID,
			"terminal_reason", reason,
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
	parentCtx := input.Context
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	streamCtx, cancel := context.WithCancel(parentCtx)
	defer cancel()
	streamInput := input
	streamInput.Context = streamCtx
	var emittedChunks uint64
	out, streamed, err := streamer.synthesizeNativeStream(streamInput, func(chunk voiceLipsyncNativeStreamChunk) error {
		emittedChunks = chunk.Sequence
		return nil
	})
	if !streamed {
		return false, nil
	}
	if err != nil {
		if terminalErr := r.emitNativeVoiceStreamFailedTerminal(session, turn, input, voiceProjectionTerminalReason(err, "VOICE_SYNTHESIS_FAILED")); terminalErr != nil {
			return true, terminalErr
		}
		return true, err
	}
	if emittedChunks == 0 {
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
	if err := r.svc.commitLocalAppConversationVoiceReady(session, turn, messageID, out.AudioArtifactID); err != nil {
		return true, err
	}
	if err := r.emitVoiceArtifactTimelineEvent(session, turn, publicChatVoiceArtifactProjection{
		AudioArtifactID:  out.AudioArtifactID,
		AudioMimeType:    out.AudioMimeType,
		MessageID:        messageID,
		ArtifactSequence: emittedChunks,
		ArtifactComplete: true,
		DurationMs:       out.DurationMs,
		Reason:           "final_artifact_available",
	}); err != nil {
		return true, err
	}
	if err := r.emitVoiceTimingReadyTimelineEvent(session, turn, publicChatVoiceTimingReadyProjection{
		AudioArtifactID: out.AudioArtifactID,
		AudioMimeType:   out.AudioMimeType,
		MessageID:       messageID,
		DurationMs:      out.DurationMs,
		Reason:          "final_artifact_available",
	}); err != nil {
		return true, err
	}
	if err := r.emitVoiceTimingTerminalTimelineEvent(session, turn, publicChatVoiceTimingTerminalProjection{
		AudioArtifactID: out.AudioArtifactID,
		AudioMimeType:   out.AudioMimeType,
		MessageID:       messageID,
		Phase:           "completed",
		TerminalReason:  "final_artifact_completed",
	}); err != nil {
		return true, err
	}
	return true, nil
}

func (r publicChatRuntime) emitNativeVoiceStreamFailedTerminal(
	session publicChatAnchorState,
	turn publicChatTurnState,
	input voiceLipsyncSynthesisInput,
	terminalReason string,
) error {
	terminalReason = strings.TrimSpace(terminalReason)
	if terminalReason == "" {
		terminalReason = "VOICE_SYNTHESIS_FAILED"
	}
	if err := r.svc.commitLocalAppConversationVoiceFailed(session, turn, terminalReason); err != nil {
		return err
	}
	messageID := strings.TrimSpace(input.MessageID)
	if err := r.emitVoiceTimingTerminalTimelineEvent(session, turn, publicChatVoiceTimingTerminalProjection{
		MessageID:      messageID,
		Phase:          "failed",
		TerminalReason: terminalReason,
	}); err != nil {
		return err
	}
	return nil
}

type agentVoiceOutputPolicy struct {
	DefaultVoiceReference  string
	SpeechModelID          string
	SpeechRoutePolicy      runtimev1.RoutePolicy
	SpeechConnectorID      string
	SpeechTargetRef        *runtimeidentity.Target
	SpeechExecutionIntent  executionintent.Intent
	SpeechLocalExecution   *localexecution.SelectedLocalExecution
	SpeechLocalIntent      bool
	SpeechRequiredFeatures []string
	SpeechAppID            string
	OwnerUserID            string
}

func (r publicChatRuntime) agentVoiceOutputPolicyForSession(ctx context.Context, session publicChatAnchorState) (agentVoiceOutputPolicy, bool, string) {
	profile := r.agentPresentationProfileForSession(session)
	if profile == nil {
		return agentVoiceOutputPolicy{}, false, ""
	}
	policy := agentVoiceOutputPolicy{}
	voiceRef, err := normalizeDefaultVoiceReference(profile.GetDefaultVoiceReference())
	if err != nil || voiceRef == "" {
		return policy, false, "VOICE_POLICY_INVALID"
	}
	audioBinding, ok, err := r.svc.committedOptionalExecutionBinding(session.LocalAgentRef, runtimeAgentAIConfigCapabilityAudioSynthesize)
	if err != nil || !ok {
		return policy, false, voiceProjectionTerminalReason(err, "VOICE_BINDING_UNAVAILABLE")
	}
	modelID := strings.TrimSpace(audioBinding.ModelID)
	routePolicy := audioBinding.RoutePolicy
	if modelID == "" || routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return policy, false, "VOICE_BINDING_INVALID"
	}
	voiceAssetTargetRef := audioBinding.TargetRef
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && audioBinding.LocalExecution != nil {
		voiceAssetTargetRef = audioBinding.LocalExecution.ExecutionTarget
	}
	ownerUserID := strings.TrimSpace(session.OwnerUserID)
	speechAppID, err := resolveRuntimeAgentVoiceAssetExecutionApp(
		ctx,
		r.svc.currentVoiceAssetResolver(),
		ownerUserID,
		voiceRef,
		voiceAssetTargetRef,
	)
	if err != nil || speechAppID == "" || ownerUserID == "" {
		return policy, false, voiceProjectionTerminalReason(err, "VOICE_REFERENCE_UNAVAILABLE")
	}
	speechIntent := executionintent.Clone(audioBinding.ExecutionIntent)
	return agentVoiceOutputPolicy{
		DefaultVoiceReference:  voiceRef,
		SpeechModelID:          modelID,
		SpeechRoutePolicy:      routePolicy,
		SpeechConnectorID:      audioBinding.ConnectorID,
		SpeechTargetRef:        clonePublicChatTargetRef(audioBinding.TargetRef),
		SpeechExecutionIntent:  executionintent.Clone(speechIntent),
		SpeechLocalExecution:   localexecution.CloneSelectedLocalExecution(audioBinding.LocalExecution),
		SpeechLocalIntent:      audioBinding.LocalAIConfigIntent,
		SpeechRequiredFeatures: append([]string(nil), audioBinding.RequiredFeatures...),
		SpeechAppID:            speechAppID,
		OwnerUserID:            ownerUserID,
	}, true, ""
}

func (r publicChatRuntime) agentPresentationProfileForSession(session publicChatAnchorState) *runtimev1.AgentPresentationProfile {
	if r.svc == nil {
		return nil
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(session.AgentID))
	if err != nil || entry == nil || entry.Agent == nil {
		return nil
	}
	if err := validatePersistedAgentPresentationProfile(entry.Agent); err != nil {
		return nil
	}
	return entry.Agent.GetPresentationProfile()
}

// emitTurnEvent composes the runtime.agent.turn.* projection envelope:
// payload top level carries the required envelope fields (`agent_id`,
// `conversation_anchor_id`, `turn_id`, `stream_id`); event-specific
// fields live under `detail` per the mounted `turn_events.detail`
// schema. Runtime execution truth (model_resolved, trace_id,
// follow_up_depth, transcript metadata, etc.) is NOT carried on
// `runtime.agent.turn.*` projection events; it is recovered exclusively
// through the unary public chat session snapshot. Per
// stream identity is distinct from turn identity and is
// allocated at turn open onto `publicChatTurnState.StreamID`.
//
// Per yaml `extra_fields_by_event`, `runtime.agent.turn.message_committed`
// additionally carries `message_id` at envelope level; callers must
// emit it through emitTurnMessageCommitted, which sets that envelope
// extra explicitly rather than relying on detail merge.
