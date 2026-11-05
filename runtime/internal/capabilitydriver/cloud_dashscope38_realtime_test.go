package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func qwen38RealtimeFixture(t *testing.T, mode runtimev1.AiRealtimeTurnDetectionMode) (CloudRealtimeProtocol, CloudRealtimeOpen) {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "dashscope", "providerModelId": dashScope38RealtimeModel, "remoteModelCatalogId": "catalog-current"})
	driver, target, err := NewProductionCloudRealtimeRegistry().Resolve(Identity{ImplementationID: "cloud.realtime.interact.dashscope", DriverID: "nimi.runtime.driver.dashscope", DriverDialect: "dashscope/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	open := CloudRealtimeOpen{InteractionMode: runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_OWNER_CONTROLLED, InputAudio: &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}, AudioOutput: true, TurnDetection: mode, InitialInstruction: "Respond briefly."}
	protocol, err := driver.NewSession(target, open)
	if err != nil {
		t.Fatal(err)
	}
	return protocol, open
}

const qwen38Ready = `{"type":"session.updated","session":{"id":"native-1","model":"qwen3.8-omni-flash-realtime","modalities":["audio","text"],"voice":"Tina","audio":{"input":{"format":{"type":"pcm","sample_rate":16000,"sample_format":"s16le","channels":1,"packing":"interleaved","channel_layout":"mono"}},"output":{"format":{"type":"pcm","sample_rate":24000}}},"input_audio_transcription":{"model":"qwen3-asr-flash-realtime"},"turn_detection":null,"tools":[],"enable_search":false}}`

func TestQwen38RealtimeNestedAudioAndOwnedTurns(t *testing.T) {
	protocol, _ := qwen38RealtimeFixture(t, runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL)
	wire, err := protocol.OpenWire("open")
	if err != nil {
		t.Fatal(err)
	}
	var open map[string]any
	if json.Unmarshal(wire, &open) != nil {
		t.Fatal("invalid JSON")
	}
	session := open["session"].(map[string]any)
	if _, exists := session["input_audio_format"]; exists {
		t.Fatal("old flat audio field emitted")
	}
	if session["turn_detection"] != nil || session["enable_search"] != false || len(session["tools"].([]any)) != 0 {
		t.Fatal("unrequested autonomous behavior")
	}
	audio := session["audio"].(map[string]any)
	if audio["output"].(map[string]any)["voice"] != "Tina" || audio["input"].(map[string]any)["format"].(map[string]any)["sample_rate"] != float64(16000) {
		t.Fatal("wrong audio configuration")
	}
	events, err := protocol.Normalize([]byte(qwen38Ready))
	if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventReady {
		t.Fatalf("ready: %+v %v", events, err)
	}
	// The native delta event is a prefix plus tentative suffix, not an append.
	events, err = protocol.Normalize([]byte(`{"type":"conversation.item.input_audio_transcription.delta","item_id":"input-1","text":"Turn ","stash":"left"}`))
	if err != nil || len(events) != 1 || events[0].Text != "Turn left" || events[0].TranscriptTextDelta {
		t.Fatalf("transcript: %+v %v", events, err)
	}
	if _, err = protocol.OwnerControl("response", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE}); err != nil {
		t.Fatal(err)
	}
	events, err = protocol.Normalize([]byte(`{"type":"response.done","response":{"id":"response-1","status":"completed","usage":{"input_tokens":12,"output_tokens":6},"output":[{"type":"message"}]}}`))
	if err != nil || len(events) != 1 || events[0].ResponseStatus != CloudRealtimeResponseStatusCompleted || events[0].Usage.GetInputTokens() != 12 {
		t.Fatalf("terminal: %+v %v", events, err)
	}
}

func TestQwen38RealtimeRejectsWrongNativeNegotiation(t *testing.T) {
	for _, mutation := range []struct {
		name  string
		apply func(map[string]any)
	}{
		{"wrong model", func(s map[string]any) { s["model"] = "qwen3.5-omni-flash-realtime" }},
		{"unrequested search", func(s map[string]any) { s["enable_search"] = true }},
		{"automatic VAD", func(s map[string]any) {
			s["turn_detection"] = map[string]any{"type": "server_vad", "create_response": true}
		}},
		{"missing format", func(s map[string]any) { delete(s, "audio") }},
		{"wrong output format", func(s map[string]any) {
			s["audio"].(map[string]any)["output"].(map[string]any)["format"].(map[string]any)["type"] = "wav"
		}},
		{"unrequested tools", func(s map[string]any) { s["tools"] = []any{map[string]any{"type": "mcp"}} }},
	} {
		t.Run(mutation.name, func(t *testing.T) {
			protocol, _ := qwen38RealtimeFixture(t, runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL)
			var body map[string]any
			_ = json.Unmarshal([]byte(qwen38Ready), &body)
			mutation.apply(body["session"].(map[string]any))
			wire, _ := json.Marshal(body)
			if _, err := protocol.Normalize(wire); err == nil {
				t.Fatal("mismatched native session accepted")
			}
		})
	}
}

func TestQwen38RealtimeVADDoesNotAuthorizeResponseOrInterruption(t *testing.T) {
	protocol, _ := qwen38RealtimeFixture(t, runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD)
	wire, err := protocol.OpenWire("open")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire, &body)
	detection := body["session"].(map[string]any)["turn_detection"].(map[string]any)
	if detection["create_response"] != false || detection["interrupt_response"] != false {
		t.Fatal("native autonomous output enabled")
	}
	_ = json.Unmarshal([]byte(qwen38Ready), &body)
	session := body["session"].(map[string]any)
	session["turn_detection"] = detection
	wire, _ = json.Marshal(body)
	if _, err = protocol.Normalize(wire); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"create_response", "interrupt_response"} {
		detection[key] = true
		wire, _ = json.Marshal(body)
		if _, err = protocol.Normalize(wire); err == nil {
			t.Fatalf("ignored native %s", key)
		}
		detection[key] = false
	}
}
