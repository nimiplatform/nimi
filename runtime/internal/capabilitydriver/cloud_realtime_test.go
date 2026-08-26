package capabilitydriver

import (
	"encoding/base64"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func dashScopeRealtimeDriverFixture(t *testing.T) (CloudRealtimeDriver, CloudRealtimeTarget) {
	t.Helper()
	target, err := structpb.NewStruct(map[string]any{
		"provider": "dashscope", "providerModelId": "qwen3.5-omni-flash-realtime",
		"remoteModelCatalogId": "dashscope/qwen3.5-omni-flash-realtime",
	})
	if err != nil {
		t.Fatal(err)
	}
	driver, resolved, err := NewProductionCloudRealtimeRegistry().Resolve(Identity{
		ImplementationID: "cloud.realtime.interact.dashscope",
		DriverID:         "nimi.runtime.driver.dashscope", DriverDialect: "dashscope/realtime/v1",
	}, target)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	return driver, resolved
}

func TestDashScopeRealtimeDriverMapsExactNeutralAudioContract(t *testing.T) {
	driver, target := dashScopeRealtimeDriverFixture(t)
	raw, err := driver.MapOpen("event-open", target, CloudRealtimeOpen{
		InputAudio: &runtimev1.AiRealtimeAudioFormat{
			Codec:        runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE,
			SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640,
		},
		AudioOutput:        true,
		TurnDetection:      runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD,
		InitialInstruction: "Respond briefly.",
	})
	if err != nil {
		t.Fatalf("MapOpen: %v", err)
	}
	wire := string(raw)
	for _, expected := range []string{`"type":"session.update"`, `"create_response":false`, `"input_audio_format":"pcm"`, `"output_audio_format":"pcm"`} {
		if !strings.Contains(wire, expected) {
			t.Fatalf("Open wire lacks %s: %s", expected, wire)
		}
	}
	if strings.Contains(wire, "provider") || strings.Contains(wire, "connector") {
		t.Fatalf("Open wire leaked owner routing values: %s", wire)
	}
}

func TestDashScopeRealtimeDriverMapsAndNormalizesAudioFrames(t *testing.T) {
	driver, _ := dashScopeRealtimeDriverFixture(t)
	frame := []byte{1, 2, 3, 4}
	raw, err := driver.MapInput("event-frame", &runtimev1.AppendRealtimeInputRequest{
		Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{Frame: frame}},
	})
	if err != nil || !strings.Contains(string(raw), base64.StdEncoding.EncodeToString(frame)) {
		t.Fatalf("MapInput = %s err=%v", raw, err)
	}
	events, err := driver.NormalizeEvent([]byte(`{"type":"response.audio.delta","response_id":"provider-response","delta":"AQIDBA=="}`))
	if err != nil || len(events) != 1 || string(events[0].Audio) != string(frame) || events[0].Kind != CloudRealtimeEventAudioDelta {
		t.Fatalf("NormalizeEvent = %+v err=%v", events, err)
	}
}

func TestDashScopeRealtimeDriverIgnoresUnknownProviderEventsWithoutGenericProjection(t *testing.T) {
	driver, _ := dashScopeRealtimeDriverFixture(t)
	events, err := driver.NormalizeEvent([]byte(`{"type":"provider.private.experimental","payload":{"secret":true}}`))
	if err != nil || events != nil {
		t.Fatalf("unknown provider event escaped normalization: %+v err=%v", events, err)
	}
}

func TestDashScopeRealtimeDriverNormalizesInputTranscriptionFailure(t *testing.T) {
	driver, _ := dashScopeRealtimeDriverFixture(t)
	events, err := driver.NormalizeEvent([]byte(`{"type":"conversation.item.input_audio_transcription.failed","item_id":"item-1","error":{"code":"audio_too_short"}}`))
	if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventInputTranscriptionFailed || events[0].ErrorCode != "audio_too_short" {
		t.Fatalf("NormalizeEvent = %+v err=%v", events, err)
	}
}
