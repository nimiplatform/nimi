package runtimeagent

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocalAppEmbodimentProtoProjectionIsClosed(t *testing.T) {
	now := time.Now().UTC()
	snapshot, err := localAppEmbodimentSnapshotToProto(localAppEmbodimentSnapshot{
		Sequence: 9, ObservedAt: now, Provenance: localAppEmbodimentProvenanceRuntime,
		Activity: &localAppEmbodimentActivity{Name: "thinking", Category: "interaction", Source: "runtime", TurnRef: "turn-1"},
		VoiceTiming: &localAppEmbodimentVoiceTiming{
			Phase: "active", DurationMillis: 640, DeadlineOffsetMillis: 80, TurnRef: "turn-1", CorrelationRef: "voice-1",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.GetSequence() != 9 || snapshot.GetActivity().GetName() != "thinking" ||
		snapshot.GetVoiceTiming().GetPhase() != runtimev1.LocalAppEmbodimentVoicePhase_LOCAL_APP_EMBODIMENT_VOICE_PHASE_ACTIVE ||
		snapshot.GetVoiceTiming().GetDurationMs() != 640 || snapshot.GetObservedAt() == nil {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	event, err := localAppEmbodimentEventToProto(localAppEmbodimentEvent{
		Sequence: 10, ObservedAt: now, Provenance: localAppEmbodimentProvenanceRuntime,
		Kind:    localAppEmbodimentEventEmotion,
		Emotion: &localAppEmbodimentEmotion{Name: "happy", Source: "runtime"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if event.GetKind() != runtimev1.LocalAppEmbodimentEventKind_LOCAL_APP_EMBODIMENT_EVENT_KIND_EMOTION ||
		event.GetEmotion().GetName() != "happy" || event.GetActivity() != nil || event.GetVoiceTiming() != nil {
		t.Fatalf("event = %+v", event)
	}
}
