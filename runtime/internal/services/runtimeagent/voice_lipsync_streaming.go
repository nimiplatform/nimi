package runtimeagent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var errVoiceNativeStreamUnavailable = errors.New("runtime agent voice native stream unavailable")

type voiceLipsyncNativeStreamChunk struct {
	Sequence uint64
	Bytes    []byte
	MimeType string
}

type voiceLipsyncNativeStreamSink func(voiceLipsyncNativeStreamChunk) error

type voiceLipsyncNativeStreamSynthesizer interface {
	synthesizeNativeStream(voiceLipsyncSynthesisInput, voiceLipsyncNativeStreamSink) (voiceLipsyncSynthesisOutput, bool, error)
}

func (s *aiBackedVoiceLipsyncSynthesizer) synthesizeNativeStream(input voiceLipsyncSynthesisInput, sink voiceLipsyncNativeStreamSink) (voiceLipsyncSynthesisOutput, bool, error) {
	if s == nil || s.streamer == nil {
		return voiceLipsyncSynthesisOutput{}, false, nil
	}
	modelID := strings.TrimSpace(input.SpeechModelID)
	if modelID == "" {
		modelID = strings.TrimSpace(s.modelID)
	}
	if modelID == "" {
		return voiceLipsyncSynthesisOutput{}, false, nil
	}
	routePolicy := input.SpeechRoutePolicy
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		routePolicy = s.routePolicy
	}
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		routePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	}
	turnID := strings.TrimSpace(input.TurnID)
	text := strings.TrimSpace(input.Text)
	if turnID == "" || text == "" {
		return voiceLipsyncSynthesisOutput{}, false, nil
	}
	voiceRef, err := voiceReferenceProtoFromDefaultReference(input.DefaultVoiceReference)
	if err != nil {
		return voiceLipsyncSynthesisOutput{}, false, err
	}
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		intent := input.SpeechExecutionIntent
		cloudTarget := input.SpeechTargetRef.GetCloud()
		if !intent.IsAIConfigCloud() || intent.CapabilityContract != "audio.synthesize" || cloudTarget == nil ||
			intent.ModelID() != strings.TrimSpace(cloudTarget.GetProviderModelId()) ||
			intent.GrantID() != strings.TrimSpace(cloudTarget.GetConnectorGrantId()) {
			return voiceLipsyncSynthesisOutput{}, false, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
	}

	ctx := input.Context
	if ctx == nil {
		ctx = context.Background()
	}
	waitTimeout := s.waitTimeout
	if waitTimeout <= 0 {
		waitTimeout = defaultProviderVoiceSynthesisWait
	}
	ctx, cancel := context.WithTimeout(ctx, waitTimeout)
	defer cancel()
	speechAppID := runtimeAgentVoiceSynthesisAppIDForInput(input)
	ownerUserID := runtimeAgentVoiceSynthesisOwnerForInput(input)
	ctx = runtimeAgentVoiceSynthesisContext(ctx, speechAppID, ownerUserID)
	ctx = withPublicChatExecutionIntent(ctx, publicChatExecutionBinding{
		ModelID:         modelID,
		RoutePolicy:     routePolicy,
		ConnectorID:     strings.TrimSpace(input.SpeechConnectorID),
		TargetRef:       cloneVoiceSynthesisTargetRef(input.SpeechTargetRef),
		ExecutionIntent: executionintent.Clone(input.SpeechExecutionIntent),
	}, "audio.synthesize")

	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         speechAppID,
			SubjectUserId: ownerUserID,
			TimeoutMs:     int32(waitTimeout.Milliseconds()),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text:       text,
					VoiceRef:   voiceRef,
					TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD,
				},
			},
		},
	}

	var nativeStarted bool
	var completed bool
	var modelResolved string
	var chunkSeq uint64
	var finalBytes bytes.Buffer
	var finalMimeType string

	stream := &publicChatScenarioStreamServer{
		ctx: ctx,
		send: func(event *runtimev1.StreamScenarioEvent) error {
			switch payload := event.GetPayload().(type) {
			case *runtimev1.StreamScenarioEvent_Started:
				started := payload.Started
				if started == nil || started.GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM {
					return errVoiceNativeStreamUnavailable
				}
				nativeStarted = true
				modelResolved = strings.TrimSpace(started.GetModelResolved())
				return nil
			case *runtimev1.StreamScenarioEvent_Delta:
				if !nativeStarted {
					return nil
				}
				artifact := payload.Delta.GetArtifact()
				if artifact == nil {
					return nil
				}
				chunk := artifact.GetChunk()
				mimeType := strings.TrimSpace(artifact.GetMimeType())
				if len(chunk) == 0 || !isPlayableAudioMimeType(mimeType) {
					return status.Error(codes.FailedPrecondition, "native voice stream chunk requires non-empty audio/* bytes")
				}
				if finalMimeType == "" {
					finalMimeType = mimeType
				}
				if !strings.EqualFold(finalMimeType, mimeType) {
					return status.Error(codes.FailedPrecondition, "native voice stream chunk mime type changed")
				}
				chunkSeq++
				finalBytes.Write(chunk)
				if sink != nil {
					if err := sink(voiceLipsyncNativeStreamChunk{
						Sequence: chunkSeq,
						Bytes:    bytes.Clone(chunk),
						MimeType: mimeType,
					}); err != nil {
						return err
					}
				}
				return nil
			case *runtimev1.StreamScenarioEvent_Completed:
				if !nativeStarted {
					return errVoiceNativeStreamUnavailable
				}
				if payload.Completed.GetStreamSimulated() {
					return status.Error(codes.FailedPrecondition, "native voice stream completed as simulated")
				}
				completed = true
				return nil
			case *runtimev1.StreamScenarioEvent_Failed:
				if !nativeStarted {
					return errVoiceNativeStreamUnavailable
				}
				failed := payload.Failed
				return status.Errorf(codes.FailedPrecondition, "native voice stream failed: %s %s", failed.GetReasonCode().String(), strings.TrimSpace(failed.GetActionHint()))
			default:
				return nil
			}
		},
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.streamer.StreamScenario(req, stream)
	}()
	select {
	case err := <-errCh:
		if errors.Is(err, errVoiceNativeStreamUnavailable) {
			return voiceLipsyncSynthesisOutput{}, false, nil
		}
		if err != nil && !nativeStarted {
			return voiceLipsyncSynthesisOutput{}, false, nil
		}
		if err != nil {
			return voiceLipsyncSynthesisOutput{}, true, err
		}
	case <-ctx.Done():
		return voiceLipsyncSynthesisOutput{}, nativeStarted, ctx.Err()
	}

	if !nativeStarted {
		return voiceLipsyncSynthesisOutput{}, false, nil
	}
	if !completed {
		return voiceLipsyncSynthesisOutput{}, true, fmt.Errorf("native voice stream ended before completed event")
	}
	if chunkSeq == 0 || finalBytes.Len() == 0 || finalMimeType == "" {
		return voiceLipsyncSynthesisOutput{}, true, fmt.Errorf("native voice stream completed without audio chunks")
	}
	frames := buildSyntheticLipsyncFrames(text)
	if len(frames) == 0 {
		return voiceLipsyncSynthesisOutput{}, true, nil
	}
	last := frames[len(frames)-1]
	finalArtifactID := runtimeAgentVoiceStreamArtifactID("final", turnID, strings.TrimSpace(input.MessageID), 0)
	return voiceLipsyncSynthesisOutput{
		AudioArtifactID:       finalArtifactID,
		AudioMimeType:         finalMimeType,
		AudioBytes:            finalBytes.Bytes(),
		DurationMs:            last.OffsetMs + last.DurationMs,
		DefaultVoiceReference: strings.TrimSpace(input.DefaultVoiceReference),
		VoiceRouteBinding: providerVoiceRouteBindingWithMode(
			strings.TrimSpace(input.DefaultVoiceReference),
			modelID,
			modelResolved,
			"",
			finalArtifactID,
			finalMimeType,
			"provider_native_stream_with_synthetic_lipsync",
			"tts_provider_native_stream_route_bound",
		),
		Frames: frames,
	}, true, nil
}

func runtimeAgentVoiceStreamArtifactID(kind string, turnID string, messageID string, sequence uint64) string {
	parts := []string{
		"runtime-agent-voice",
		strings.TrimSpace(kind),
		strings.TrimSpace(turnID),
		strings.TrimSpace(messageID),
	}
	if sequence > 0 {
		parts = append(parts, fmt.Sprintf("%06d", sequence))
	}
	parts = append(parts, ulid.Make().String())
	return strings.Join(parts, ":")
}

func runtimeAgentVoiceStreamID(turnID string, messageID string) string {
	parts := []string{
		"runtime-agent-voice-stream",
		strings.TrimSpace(turnID),
		strings.TrimSpace(messageID),
		ulid.Make().String(),
	}
	return strings.Join(parts, ":")
}

func runtimeAgentVoiceStreamChunkTransportRef(voiceStreamID string, sequence uint64) string {
	return fmt.Sprintf("runtime-agent-voice-stream://%s/chunks/%06d", strings.TrimSpace(voiceStreamID), sequence)
}
