package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const xaiReadyFixture = `{"type":"session.updated","session":{"model":"grok-voice-3.0","voice":"Eve","instructions":"Speak clearly.","turn_detection":{"type":null},"tools":[]}}`

func xaiRealtimeFixture(t *testing.T) (CloudRealtimeDriver, CloudRealtimeTarget, CloudRealtimeOpen, CloudRealtimeProtocol) {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "xai", "providerModelId": XAIVoice3Model, "remoteModelCatalogId": "reviewed-xai-voice3"})
	d, target, err := NewProductionCloudRealtimeRegistry().Resolve(Identity{ImplementationID: "cloud.realtime.interact.xai", DriverID: "nimi.runtime.driver.xai", DriverDialect: "xai/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	proposed := &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}
	format, err := d.NegotiateInputAudio(proposed)
	if err != nil || format.GetSampleRateHz() != 24000 || format.GetMaximumFrameBytes() != 960 || proposed.GetSampleRateHz() != 16000 {
		t.Fatal("native input negotiation", format, err)
	}
	open := CloudRealtimeOpen{InputAudio: format, AudioOutput: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL, InitialInstruction: "Speak clearly."}
	s, err := d.NewSession(target, open)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return d, target, open, s
}

func TestXAIVoice3ExactManualProtocol(t *testing.T) {
	d, target, open, s := xaiRealtimeFixture(t)
	wire, err := s.OpenWire("open")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire, &body)
	conf := body["session"].(map[string]any)
	if body["type"] != "session.update" || conf["model"] != XAIVoice3Model || conf["voice"] != "eve" || conf["turn_detection"].(map[string]any)["type"] != nil || conf["resumption"].(map[string]any)["enabled"] != false || len(conf["tools"].([]any)) != 0 || conf["audio"].(map[string]any)["input"].(map[string]any)["format"].(map[string]any)["rate"] != float64(24000) {
		t.Fatal(string(wire))
	}
	if tr := s.Transport(); tr.Path != "/v1/realtime" || !tr.ModelQuery || tr.APIKeyHeader != "" {
		t.Fatal(tr)
	}
	events, err := s.Normalize([]byte(xaiReadyFixture))
	if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventReady {
		t.Fatal(events, err)
	}
	for _, bad := range []string{strings.Replace(xaiReadyFixture, "grok-voice-3.0", "grok-voice-latest", 1), strings.Replace(xaiReadyFixture, `"type":null`, `"type":"server_vad"`, 1), strings.Replace(xaiReadyFixture, `"tools":[]`, `"tools":[{"type":"web_search"}]`, 1), strings.Replace(xaiReadyFixture, `"type":null`, `"type":null,"idle_timeout_ms":1000`, 1), strings.Replace(xaiReadyFixture, `"tools":[]`, `"tools":[],"resumption":{"enabled":true}`, 1), strings.Replace(xaiReadyFixture, `"tools":[]`, `"tools":[],"audio":{"input":{"format":{"type":"audio/pcm","rate":16000}},"output":{"format":{"type":"audio/pcm","rate":24000}}}`, 1)} {
		if _, err := s.Normalize([]byte(bad)); err == nil {
			t.Fatal("mismatched readiness admitted", bad)
		}
	}
	for _, change := range []func(*CloudRealtimeOpen){func(o *CloudRealtimeOpen) { o.AudioOutput = false }, func(o *CloudRealtimeOpen) { o.SelfIntention = true }, func(o *CloudRealtimeOpen) {
		o.TurnDetection = runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD
	}, func(o *CloudRealtimeOpen) {
		o.InteractionMode = runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS
	}} {
		bad := open
		change(&bad)
		if _, err := d.NewSession(target, bad); err == nil {
			t.Fatal("unsupported session admitted")
		}
	}
	for _, control := range []runtimev1.AiRealtimeOwnerControlKind{runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE} {
		effect, err := s.OwnerControl("explicit", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: control})
		if err != nil || len(effect.Wires) != 1 {
			t.Fatal(effect, err)
		}
	}
}

func TestXAIVoice3NativeEventsAndCancellation(t *testing.T) {
	_, _, _, s := xaiRealtimeFixture(t)
	for _, text := range []string{"hello", "hello Nimi"} {
		raw, _ := json.Marshal(map[string]any{"type": "conversation.item.input_audio_transcription.updated", "item_id": "native-input", "transcript": text})
		events, err := s.Normalize(raw)
		if err != nil || len(events) != 1 || events[0].TranscriptTextDelta || events[0].Text != text {
			t.Fatal("cumulative ASR became delta", events, err)
		}
	}
	if _, err := s.Normalize([]byte(`{"type":"response.created","response":{"id":"r1","status":"in_progress"}}`)); err != nil {
		t.Fatal(err)
	}
	effect, err := s.Interrupt("stop", "r1")
	if err != nil || !effect.AwaitNativeStop || effect.ResponseKey != "r1" || !strings.Contains(string(effect.Wires[0]), `"response_id":"r1"`) {
		t.Fatal(effect, err)
	}
	late, err := s.Normalize([]byte(`{"type":"response.output_audio.delta","response_id":"r1","delta":"AQACAA=="}`))
	if err != nil || len(late) != 0 {
		t.Fatal("late audio was not fenced", late, err)
	}
	if _, err := s.Normalize([]byte(`{"type":"response.done","response":{"id":"r1","status":"cancelled","usage":{"input_tokens":0,"output_tokens":3}}}`)); err != nil {
		t.Fatal(err)
	}
	stop, err := s.WaitNativeStop(context.Background(), "r1")
	if err != nil || stop.Status != CloudRealtimeResponseStatusCancelled || stop.Usage.GetInputTokens() != 0 || stop.Usage.GetOutputTokens() != 3 {
		t.Fatal(stop, err)
	}
	if _, err := s.Normalize([]byte(`{"type":"response.created","response":{"id":"r2","status":"in_progress"}}`)); err != nil {
		t.Fatal("next explicit response rejected", err)
	}
	for _, raw := range []string{`{"type":"response.output_audio.delta","response_id":"r2","delta":"AQ=="}`, `{"type":"response.done","response":{"id":"r2","status":"in_progress"}}`, `{"type":"response.done","response":{"id":"r2","status":"completed","usage":{"input_tokens":null,"output_tokens":3}}}`, `{"type":"input_audio_buffer.speech_started","item_id":"auto"}`, `{"type":"response.function_call_arguments.done","response_id":"r2","name":"business"}`} {
		if _, err := s.Normalize([]byte(raw)); err == nil {
			t.Fatal("unsupported wire accepted", raw)
		}
	}
}
