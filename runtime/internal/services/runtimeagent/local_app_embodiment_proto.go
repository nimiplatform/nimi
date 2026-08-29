package runtimeagent

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: definition.nimi.platform.core-protocol.app-operation-contract
// @nimi-authority: rule.nimi.runtime.agent-participation.r159
// These projections are used only by the two registered formal App embodiment
// reads; renderer, playback, replay, and diagnostics remain structurally absent.
func localAppEmbodimentSnapshotToProto(input localAppEmbodimentSnapshot) (*runtimev1.LocalAppEmbodimentSnapshot, error) {
	if err := validateLocalAppEmbodimentSnapshot(input); err != nil {
		return nil, err
	}
	result := &runtimev1.LocalAppEmbodimentSnapshot{
		Sequence: input.Sequence, ObservedAt: timestamppb.New(input.ObservedAt), Provenance: input.Provenance,
		Activity: localAppEmbodimentActivityToProto(input.Activity),
		Emotion:  localAppEmbodimentEmotionToProto(input.Emotion),
		Posture:  localAppEmbodimentPostureToProto(input.Posture),
	}
	voice, err := localAppEmbodimentVoiceTimingToProto(input.VoiceTiming)
	if err != nil {
		return nil, err
	}
	result.VoiceTiming = voice
	return result, nil
}

func localAppEmbodimentEventToProto(input localAppEmbodimentEvent) (*runtimev1.LocalAppEmbodimentEvent, error) {
	if err := validateLocalAppEmbodimentEvent(input); err != nil {
		return nil, err
	}
	result := &runtimev1.LocalAppEmbodimentEvent{
		Sequence: input.Sequence, ObservedAt: timestamppb.New(input.ObservedAt), Provenance: input.Provenance,
	}
	switch input.Kind {
	case localAppEmbodimentEventActivity:
		result.Kind = runtimev1.LocalAppEmbodimentEventKind_LOCAL_APP_EMBODIMENT_EVENT_KIND_ACTIVITY
		result.Payload = &runtimev1.LocalAppEmbodimentEvent_Activity{Activity: localAppEmbodimentActivityToProto(input.Activity)}
	case localAppEmbodimentEventEmotion:
		result.Kind = runtimev1.LocalAppEmbodimentEventKind_LOCAL_APP_EMBODIMENT_EVENT_KIND_EMOTION
		result.Payload = &runtimev1.LocalAppEmbodimentEvent_Emotion{Emotion: localAppEmbodimentEmotionToProto(input.Emotion)}
	case localAppEmbodimentEventPosture:
		result.Kind = runtimev1.LocalAppEmbodimentEventKind_LOCAL_APP_EMBODIMENT_EVENT_KIND_POSTURE
		result.Payload = &runtimev1.LocalAppEmbodimentEvent_Posture{Posture: localAppEmbodimentPostureToProto(input.Posture)}
	case localAppEmbodimentEventVoiceTiming:
		voice, err := localAppEmbodimentVoiceTimingToProto(input.VoiceTiming)
		if err != nil {
			return nil, err
		}
		result.Kind = runtimev1.LocalAppEmbodimentEventKind_LOCAL_APP_EMBODIMENT_EVENT_KIND_VOICE_TIMING
		result.Payload = &runtimev1.LocalAppEmbodimentEvent_VoiceTiming{VoiceTiming: voice}
	default:
		return nil, fmt.Errorf("local-app embodiment event kind is unavailable")
	}
	return result, nil
}

func localAppEmbodimentActivityToProto(input *localAppEmbodimentActivity) *runtimev1.LocalAppEmbodimentActivity {
	if input == nil {
		return nil
	}
	return &runtimev1.LocalAppEmbodimentActivity{
		Name: input.Name, Category: input.Category, Intensity: input.Intensity, Source: input.Source, TurnRef: input.TurnRef,
	}
}

func localAppEmbodimentEmotionToProto(input *localAppEmbodimentEmotion) *runtimev1.LocalAppEmbodimentEmotion {
	if input == nil {
		return nil
	}
	return &runtimev1.LocalAppEmbodimentEmotion{Name: input.Name, Source: input.Source}
}

func localAppEmbodimentPostureToProto(input *localAppEmbodimentPosture) *runtimev1.LocalAppEmbodimentPosture {
	if input == nil {
		return nil
	}
	return &runtimev1.LocalAppEmbodimentPosture{ActionFamily: input.ActionFamily, InterruptMode: input.InterruptMode}
}

func localAppEmbodimentVoiceTimingToProto(input *localAppEmbodimentVoiceTiming) (*runtimev1.LocalAppEmbodimentVoiceTiming, error) {
	if input == nil {
		return nil, nil
	}
	phase := runtimev1.LocalAppEmbodimentVoicePhase_LOCAL_APP_EMBODIMENT_VOICE_PHASE_UNSPECIFIED
	switch input.Phase {
	case "active":
		phase = runtimev1.LocalAppEmbodimentVoicePhase_LOCAL_APP_EMBODIMENT_VOICE_PHASE_ACTIVE
	case "completed":
		phase = runtimev1.LocalAppEmbodimentVoicePhase_LOCAL_APP_EMBODIMENT_VOICE_PHASE_COMPLETED
	case "failed":
		phase = runtimev1.LocalAppEmbodimentVoicePhase_LOCAL_APP_EMBODIMENT_VOICE_PHASE_FAILED
	case "interrupted":
		phase = runtimev1.LocalAppEmbodimentVoicePhase_LOCAL_APP_EMBODIMENT_VOICE_PHASE_INTERRUPTED
	case "canceled":
		phase = runtimev1.LocalAppEmbodimentVoicePhase_LOCAL_APP_EMBODIMENT_VOICE_PHASE_CANCELED
	default:
		return nil, fmt.Errorf("local-app embodiment voice phase is unavailable")
	}
	return &runtimev1.LocalAppEmbodimentVoiceTiming{
		Phase: phase, DurationMs: input.DurationMillis, DeadlineOffsetMs: input.DeadlineOffsetMillis,
		TurnRef: input.TurnRef, CorrelationRef: input.CorrelationRef,
	}, nil
}
