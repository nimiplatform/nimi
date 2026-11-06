package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func geminiContinuousProtocol(t *testing.T) CloudRealtimeProtocol {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-3.8-live", "remoteModelCatalogId": "catalog"})
	factory, target, err := NewProductionCloudRealtimeRegistry().Resolve(Identity{ImplementationID: "cloud.realtime.interact.gemini", DriverID: "nimi.runtime.driver.gemini", DriverDialect: "gemini/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	format := &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}
	open := CloudRealtimeOpen{InputAudio: format, AudioOutput: true, InteractionMode: runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS, InitialInstruction: "Speak briefly."}
	for _, bad := range []CloudRealtimeOpen{{InputAudio: format, AudioOutput: true}, {InputAudio: format, AudioOutput: true, InteractionMode: open.InteractionMode, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL}, {InputAudio: format, InteractionMode: open.InteractionMode}, {InputAudio: format, AudioOutput: true, InteractionMode: open.InteractionMode, SelfIntention: true}} {
		if _, err := factory.NewSession(target, bad); err == nil {
			t.Fatal("unsupported Gemini mode admitted")
		}
	}
	p, err := factory.NewSession(target, open)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestGeminiContinuousSetupInputAndExplicitControls(t *testing.T) {
	p := geminiContinuousProtocol(t)
	wire, err := p.OpenWire("open")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire, &body)
	setup := body["setup"].(map[string]any)
	if setup["model"] != "models/gemini-3.8-live" || setup["tools"] != nil || setup["proactivity"] != nil || setup["thinkingConfig"] != nil || setup["realtimeInputConfig"].(map[string]any)["automaticActivityDetection"].(map[string]any)["disabled"] != false {
		t.Fatal(setup)
	}
	if _, err := p.Normalize([]byte(`{"setupComplete":{}}`)); err != nil {
		t.Fatal(err)
	}
	frame := &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{InputTrackId: "input", FrameSequence: 1, Frame: []byte{1, 0, 2, 0}}}}
	effect, err := p.Input("input", frame)
	if err != nil || len(effect.Wires) != 1 {
		t.Fatal(effect, err)
	}
	_ = json.Unmarshal(effect.Wires[0], &body)
	audio := body["realtimeInput"].(map[string]any)["audio"].(map[string]any)
	if audio["data"] != "AQACAA==" || audio["mimeType"] != "audio/pcm;rate=16000" {
		t.Fatal(audio)
	}
	for _, control := range []runtimev1.AiRealtimeOwnerControlKind{runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE} {
		if _, err := p.OwnerControl("control", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: control}); err == nil {
			t.Fatal("invented owner response boundary")
		}
	}
	mute, err := p.OwnerControl("mute", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_MUTE_INPUT})
	if err != nil || len(mute.Wires) != 1 {
		t.Fatal(err)
	}
	if _, err := p.Input("muted", frame); err == nil {
		t.Fatal("muted input forwarded")
	}
	unmute, err := p.OwnerControl("unmute", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_UNMUTE_INPUT})
	if err != nil || len(unmute.Wires) != 0 {
		t.Fatal(err)
	}
	if _, err := p.Input("again", frame); err != nil {
		t.Fatal(err)
	}
	context := &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_OwnerContext{OwnerContext: &runtimev1.AiRealtimeOwnerContextInput{RequestId: "context", Kind: runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT, Text: "Additional owner context."}}}
	effect, err = p.Input("context", context)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(effect.Wires[0], &body)
	if body["clientContent"].(map[string]any)["turnComplete"] != false {
		t.Fatal("context forced generation")
	}
	context.GetOwnerContext().Kind = runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_INSTRUCTION
	if _, err := p.Input("instruction", context); err == nil {
		t.Fatal("mutable system instruction invented")
	}
	if _, err := p.Interrupt("stop", "track"); err == nil {
		t.Fatal("per-track owner stop admitted")
	}
	if !p.(CloudRealtimeTransportCloser).CloseByTransportRelease() {
		t.Fatal("wrong closure policy")
	}
}

func TestGeminiContinuousNativeTranscriptsAndInterruptions(t *testing.T) {
	p := geminiContinuousProtocol(t)
	_, _ = p.Normalize([]byte(`{"setupComplete":{}}`))
	events, err := p.Normalize([]byte(`{"serverContent":{"inputTranscription":{"text":" hello ","finished":true},"outputTranscription":{"text":"你好 "},"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`))
	if err != nil || len(events) != 3 || events[0].Text != " hello " || events[0].StartMS != nil || events[0].EndMS != nil || events[1].Text != "你好 " || events[2].Kind != CloudRealtimeEventAudioDelta {
		t.Fatal(events, err)
	}
	events, err = p.Normalize([]byte(`{"serverContent":{"generationComplete":true,"interimInputTranscription":{"text":"hypothesis"}},"usageMetadata":{"promptTokenCount":20,"responseTokenCount":10}}`))
	if err != nil || len(events) != 0 {
		t.Fatal("invented transcript finality or cumulative usage", events, err)
	}
	events, err = p.Normalize([]byte(`{"serverContent":{"interrupted":true,"turnComplete":true,"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`))
	if err != nil || len(events) != 2 || events[0].Kind != CloudRealtimeEventContinuousInterruption || events[1].Kind != CloudRealtimeEventAudioDone {
		t.Fatal("interrupted audio was forwarded", events, err)
	}
	for _, raw := range []string{`{"toolCall":{"functionCalls":[{"name":"action"}]}}`, `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=48000","data":"AQACAA=="}}]}}}`, `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQ=="}}]}}}`} {
		if _, err := p.Normalize([]byte(raw)); err == nil {
			t.Fatal("unsupported native data accepted")
		}
	}
	events, err = p.Normalize([]byte(`{"goAway":{"timeLeft":"60s"}}`))
	if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventFailed || events[0].SessionClosureConfirmed || events[0].SessionAudioSeconds != nil {
		t.Fatal(events, err)
	}
	p.Close()
	if events, err := p.Normalize([]byte(`{"serverContent":{"turnComplete":true}}`)); err != nil || len(events) != 0 {
		t.Fatal("late output after close", events, err)
	}
}
