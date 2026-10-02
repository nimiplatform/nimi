package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func openAIRealtimeFixture(t *testing.T) (CloudRealtimeDriver, CloudRealtimeTarget) {
	t.Helper()
	raw, err := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": "gpt-realtime-2.1", "remoteModelCatalogId": "catalog-test"})
	if err != nil {
		t.Fatal(err)
	}
	driver, target, err := NewProductionCloudRealtimeRegistry().Resolve(Identity{ImplementationID: "cloud.realtime.interact.openai", DriverID: "nimi.runtime.driver.openai", DriverDialect: "openai/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	return driver, target
}

func TestOpenAIRealtimeGAOpenUsesExactPCMAndOwnerControlledVAD(t *testing.T) {
	driver, target := openAIRealtimeFixture(t)
	input := CloudRealtimeOpen{InputAudio: &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 24000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 960}, AudioOutput: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD, InitialInstruction: "Keep whitespace  "}
	wire, err := driver.MapOpen("open-1", target, input)
	if err != nil {
		t.Fatal(err)
	}
	var event struct {
		Session struct {
			Instructions     string   `json:"instructions"`
			OutputModalities []string `json:"output_modalities"`
			Audio            struct {
				Input struct {
					Format struct {
						Rate int `json:"rate"`
					} `json:"format"`
					TurnDetection struct {
						CreateResponse    bool `json:"create_response"`
						InterruptResponse bool `json:"interrupt_response"`
					} `json:"turn_detection"`
				} `json:"input"`
			} `json:"audio"`
		} `json:"session"`
	}
	if err := json.Unmarshal(wire, &event); err != nil {
		t.Fatal(err)
	}
	if event.Session.Instructions != input.InitialInstruction || len(event.Session.OutputModalities) != 1 || event.Session.OutputModalities[0] != "audio" || event.Session.Audio.Input.Format.Rate != 24000 || event.Session.Audio.Input.TurnDetection.CreateResponse || event.Session.Audio.Input.TurnDetection.InterruptResponse {
		t.Fatalf("wrong GA Open: %s", wire)
	}
	input.InputAudio.SampleRateHz = 16000
	if _, err := driver.MapOpen("wrong-rate", target, input); err == nil {
		t.Fatal("16 kHz PCM was mislabeled as OpenAI 24 kHz")
	}
}

func TestOpenAIRealtimeNormalizesGAEventsAndRejectsBrokenAssociation(t *testing.T) {
	driver, _ := openAIRealtimeFixture(t)
	cases := []struct {
		wire string
		kind CloudRealtimeEventKind
		text string
	}{
		{`{"type":"response.output_audio_transcript.delta","response_id":"resp-1","delta":"你好"}`, CloudRealtimeEventTextDelta, "你好"},
		{`{"type":"response.output_text.done","response_id":"resp-1","text":"  exact  "}`, CloudRealtimeEventTextFinal, "  exact  "},
		{`{"type":"conversation.item.input_audio_transcription.delta","item_id":"item-1","delta":"word"}`, CloudRealtimeEventTranscriptPartial, "word"},
		{`{"type":"input_audio_buffer.committed","item_id":"item-1"}`, CloudRealtimeEventInputCommitted, ""},
		{`{"type":"response.output_audio.delta","response_id":"resp-1","delta":"AQIDBA=="}`, CloudRealtimeEventAudioDelta, ""},
		{`{"type":"response.done","response":{"id":"resp-1","status":"cancelled","usage":{"input_tokens":2,"output_tokens":3}}}`, CloudRealtimeEventResponseDone, ""},
	}
	for _, tc := range cases {
		got, err := driver.NormalizeEvent([]byte(tc.wire), CloudRealtimeOpen{})
		if err != nil || len(got) != 1 || got[0].Kind != tc.kind || got[0].Text != tc.text {
			t.Fatalf("%s -> %+v, %v", tc.wire, got, err)
		}
	}
	for _, wire := range []string{`{"type":"response.output_audio.delta","response_id":"resp-1","delta":"AQ=="}`, `{"type":"response.output_text.delta","delta":"orphan"}`, `{"type":"input_audio_buffer.committed"}`, `{"type":"response.done","response":{"id":"resp-1","status":"unknown"}}`, `{"type":"session.updated"}`} {
		if _, err := driver.NormalizeEvent([]byte(wire), CloudRealtimeOpen{}); err == nil {
			t.Fatalf("invalid event admitted: %s", wire)
		}
	}
	if events, err := driver.NormalizeEvent([]byte(`{"type":"response.audio.delta","response_id":"resp-1","delta":"AQIDBA=="}`), CloudRealtimeOpen{}); err != nil || len(events) != 0 {
		t.Fatal("beta event entered GA output")
	}
}

func TestOpenAIRealtimeReadyRequiresActualFormatAndNoAutonomousBusinessWork(t *testing.T) {
	driver, _ := openAIRealtimeFixture(t)
	expected := CloudRealtimeOpen{InputAudio: &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 24000, ChannelCount: 1}, AudioOutput: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD}
	ready := `{"type":"session.updated","session":{"type":"realtime","model":"gpt-realtime-2.1","truncation":"disabled","tools":[],"output_modalities":["audio"],"audio":{"input":{"format":{"type":"audio/pcm","rate":24000},"turn_detection":{"type":"server_vad","create_response":false,"interrupt_response":false}},"output":{"format":{"type":"audio/pcm","rate":24000}}}}}`
	got, err := driver.NormalizeEvent([]byte(ready), expected)
	if err != nil || len(got) != 1 || got[0].Kind != CloudRealtimeEventReady {
		t.Fatalf("ready: %+v %v", got, err)
	}
	var event map[string]any
	if err := json.Unmarshal([]byte(ready), &event); err != nil {
		t.Fatal(err)
	}
	input := event["session"].(map[string]any)["audio"].(map[string]any)["input"].(map[string]any)
	input["turn_detection"].(map[string]any)["interrupt_response"] = true
	wire, _ := json.Marshal(event)
	if _, err := driver.NormalizeEvent(wire, expected); err == nil {
		t.Fatal("automatic interruption was accepted")
	}
	input["turn_detection"] = nil
	expected.TurnDetection = runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL
	wire, _ = json.Marshal(event)
	if _, err := driver.NormalizeEvent(wire, expected); err != nil {
		t.Fatalf("manual mode: %v", err)
	}
}

func TestOpenAIRealtimeMissingUsageIsNotInvented(t *testing.T) {
	driver, _ := openAIRealtimeFixture(t)
	events, err := driver.NormalizeEvent([]byte(`{"type":"response.done","response":{"id":"resp","status":"completed","usage":null}}`), CloudRealtimeOpen{})
	if err != nil || len(events) != 1 || events[0].Usage != nil {
		t.Fatalf("missing usage: %+v %v", events, err)
	}
	events, err = driver.NormalizeEvent([]byte(`{"type":"conversation.item.input_audio_transcription.delta","item_id":"item","delta":"part"}`), CloudRealtimeOpen{})
	if err != nil || len(events) != 1 || !events[0].TranscriptTextDelta {
		t.Fatal("transcript delta was mislabeled as a complete partial")
	}
	if _, err := driver.NormalizeEvent([]byte(`{"type":"response.done","response":{"id":"resp","status":"completed","usage":{"input_tokens":-1,"output_tokens":0}}}`), CloudRealtimeOpen{}); err == nil {
		t.Fatal("negative usage was admitted")
	}

}

func TestOpenAIRealtimeIncompleteUsageDoesNotBecomeZeroCounts(t *testing.T) {
	driver, _ := openAIRealtimeFixture(t)
	if _, err := driver.NormalizeEvent([]byte(`{"type":"response.done","response":{"id":"resp","status":"completed","usage":{}}}`), CloudRealtimeOpen{}); err == nil {
		t.Fatal("unreported counts became zero usage")
	}
}
