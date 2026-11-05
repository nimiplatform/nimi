package capabilitydriver

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func liveProtocolFixture(t *testing.T) (CloudRealtimeProtocol, CloudRealtimeTarget, CloudRealtimeOpen) {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": OpenAILiveModel, "remoteModelCatalogId": "catalog-live"})
	driver, target, err := NewProductionCloudRealtimeRegistry().Resolve(Identity{ImplementationID: "cloud.realtime.interact.openai", DriverID: "nimi.runtime.driver.openai", DriverDialect: "openai/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	open := CloudRealtimeOpen{InteractionMode: runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS, AudioOutput: true, InitialInstruction: "Keep caller permissions.  ", InputAudio: &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 24000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 960}}
	protocol, err := driver.NewSession(target, open)
	if err != nil {
		t.Fatal(err)
	}
	return protocol, target, open
}

func liveResourceFixture() map[string]any {
	return map[string]any{"id": "native-live-session", "model": OpenAILiveModel, "status": "active", "expires_at": time.Now().Add(time.Hour).Unix(), "store": false, "audio": map[string]any{"format": map[string]any{"type": "audio/pcm", "rate": 24000}, "output": map[string]any{"voice": "marin"}}, "delegation": map[string]any{"type": "client"}}
}
func liveWireFixture(value map[string]any) []byte { raw, _ := json.Marshal(value); return raw }
func readyLiveFixture(t *testing.T, protocol CloudRealtimeProtocol) {
	t.Helper()
	if _, err := protocol.OpenWire("start-event"); err != nil {
		t.Fatal(err)
	}
	events, err := protocol.Normalize(liveWireFixture(map[string]any{"type": "session.started", "client_event_id": "start-event", "session": liveResourceFixture()}))
	if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventReady {
		t.Fatal(events, err)
	}
}

func TestOpenAILiveUsesExplicitContinuousClientDelegationWithoutResponseCalls(t *testing.T) {
	protocol, target, open := liveProtocolFixture(t)
	transport := protocol.Transport()
	if transport.Path != "/v1/live/sessions" || transport.ModelQuery {
		t.Fatal(transport)
	}
	wire, err := protocol.OpenWire("start-event")
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err = json.Unmarshal(wire, &payload); err != nil {
		t.Fatal(err)
	}
	session := payload["session"].(map[string]any)
	if payload["type"] != "session.start" || session["model"] != OpenAILiveModel || session["store"] != false || session["instructions"] != open.InitialInstruction || session["delegation"].(map[string]any)["type"] != "client" {
		t.Fatal(string(wire))
	}
	if strings.Contains(string(wire), "responses") || strings.Contains(string(wire), "tools") {
		t.Fatal("enabled implicit backend work")
	}
	if _, err := protocol.Normalize(liveWireFixture(map[string]any{"type": "session.started", "session": liveResourceFixture()})); err != nil {
		t.Fatal(err)
	}
	for _, control := range []runtimev1.AiRealtimeOwnerControlKind{runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_PAUSE_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE} {
		if _, err := protocol.OwnerControl("control", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: control}); err == nil {
			t.Fatal("invented response control", control)
		}
	}
	if _, err := protocol.Interrupt("interrupt", "track"); err == nil {
		t.Fatal("invented output cancellation")
	}
	for control, kind := range map[runtimev1.AiRealtimeOwnerControlKind]string{runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_MUTE_INPUT: "session.input_audio.mute", runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_UNMUTE_INPUT: "session.input_audio.unmute"} {
		effect, err := protocol.OwnerControl("control", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: control})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(effect.Wires[0]), kind) || effect.AwaitNativeStop {
			t.Fatal(effect)
		}
	}
	for _, change := range []func(*CloudRealtimeOpen){func(v *CloudRealtimeOpen) {
		v.InteractionMode = runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_OWNER_CONTROLLED
	}, func(v *CloudRealtimeOpen) { v.AudioOutput = false }, func(v *CloudRealtimeOpen) { v.SelfIntention = true }, func(v *CloudRealtimeOpen) {
		v.TurnDetection = runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL
	}} {
		invalid := open
		change(&invalid)
		if _, err := newOpenAILiveSession(target, invalid); err == nil {
			t.Fatal("unsupported Live mode admitted")
		}
	}
}

func TestOpenAILivePreservesContinuousFragmentsAndCumulativeUsage(t *testing.T) {
	protocol, _, _ := liveProtocolFixture(t)
	readyLiveFixture(t, protocol)
	for _, kind := range []string{"session.input_transcript.delta", "session.output_transcript.delta"} {
		events, err := protocol.Normalize(liveWireFixture(map[string]any{"type": kind, "delta": " hello ", "start_ms": 0, "end_ms": 125}))
		if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventContinuousTranscript || events[0].Text != " hello " || events[0].StartMS != 0 || events[0].EndMS != 125 || events[0].ProviderResponseID != "" {
			t.Fatal(events, err)
		}
	}
	pcm := []byte{1, 0, 2, 0}
	events, err := protocol.Normalize(liveWireFixture(map[string]any{"type": "session.output_audio.delta", "delta": base64.StdEncoding.EncodeToString(pcm)}))
	if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventAudioDelta || events[0].ProviderResponseID != "" || protocol.CurrentResponseKey() != "" {
		t.Fatal(events, err)
	}
	for _, seconds := range []float64{0, 2.5, 4.8} {
		events, err = protocol.Normalize(liveWireFixture(map[string]any{"type": "session.usage.updated", "usage": map[string]any{"seconds": seconds}}))
		if err != nil || *events[0].SessionAudioSeconds != seconds || events[0].Usage != nil {
			t.Fatal("usage summed or converted to tokens", events, err)
		}
	}
	wire, err := protocol.(CloudRealtimeSessionCloser).CloseWire("close-event")
	if err != nil || !strings.Contains(string(wire), "session.close") {
		t.Fatal(string(wire), err)
	}
	if _, err := protocol.(CloudRealtimeSessionCloser).CloseWire("again"); err == nil {
		t.Fatal("repeated native close")
	}
	events, err = protocol.Normalize(liveWireFixture(map[string]any{"type": "session.closed", "reason": "close_requested", "session": liveResourceFixture(), "usage": map[string]any{"seconds": 4.8}}))
	if err != nil || events[0].Kind != CloudRealtimeEventSessionClosed || *events[0].SessionAudioSeconds != 4.8 {
		t.Fatal(events, err)
	}
}

func TestOpenAILiveRejectsBackendDelegationChangedConfigurationAndFalseTiming(t *testing.T) {
	for name, event := range map[string]map[string]any{
		"backend delegation":      {"type": "session.delegation.created", "offset_ms": 20, "delegation": map[string]any{"id": "native-request", "type": "delegation", "target": "responses"}},
		"reversed timeline":       {"type": "session.input_transcript.delta", "delta": "text", "start_ms": 20, "end_ms": 10},
		"odd PCM":                 {"type": "session.output_audio.delta", "delta": base64.StdEncoding.EncodeToString([]byte{1})},
		"sideband audio":          {"type": "session.output_audio.delta", "delta": "AAA=", "start_ms": 0, "end_ms": 20},
		"backend event":           {"type": "response.event"},
		"negative usage":          {"type": "session.usage.updated", "usage": map[string]any{"seconds": -1}},
		"unconfirmed final usage": {"type": "session.closed", "reason": "close_requested", "session": liveResourceFixture()},
	} {
		t.Run(name, func(t *testing.T) {
			protocol, _, _ := liveProtocolFixture(t)
			readyLiveFixture(t, protocol)
			if _, err := protocol.Normalize(liveWireFixture(event)); err == nil {
				t.Fatal("invalid native event admitted")
			}
		})
	}
	protocol, _, _ := liveProtocolFixture(t)
	_, _ = protocol.OpenWire("start-event")
	resource := liveResourceFixture()
	resource["store"] = true
	if _, err := protocol.Normalize(liveWireFixture(map[string]any{"type": "session.started", "session": resource})); err == nil {
		t.Fatal("server enabled storage")
	}
}
