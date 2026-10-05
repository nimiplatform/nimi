package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func geminiRealtimeFixture(t *testing.T) CloudRealtimeProtocol {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-3.8-live", "remoteModelCatalogId": "catalog-live"})
	driver := NewGeminiRealtimeCandidateDriver()
	target, err := driver.ValidateTarget(Identity{ImplementationID: "cloud.realtime.interact.gemini", DriverID: "nimi.runtime.driver.gemini", DriverDialect: "gemini/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	p, err := driver.NewSession(target, CloudRealtimeOpen{InputAudio: &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}, AudioOutput: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p
}

func TestGeminiRealtimeCandidateIsNotAdmittedByProductionRegistry(t *testing.T) {
	raw, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-3.8-live", "remoteModelCatalogId": "catalog-live"})
	if _, _, err := NewProductionCloudRealtimeRegistry().Resolve(Identity{ImplementationID: "cloud.realtime.interact.gemini", DriverID: "nimi.runtime.driver.gemini", DriverDialect: "gemini/realtime/v1"}, raw); err == nil {
		t.Fatal("unverified native owner controls were offered by the production registry")
	}
}
func geminiAudioInput(seq uint64) *runtimev1.AppendRealtimeInputRequest {
	return &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{InputTrackId: "track", UtteranceId: "utterance", FrameSequence: seq, Frame: []byte{1, 0, 2, 0}}}}
}
func geminiControl(kind runtimev1.AiRealtimeOwnerControlKind) *runtimev1.SubmitRealtimeOwnerControlRequest {
	return &runtimev1.SubmitRealtimeOwnerControlRequest{RequestId: "owner", Control: kind}
}

func TestGeminiRealtimeSealDoesNotSendNativeEndOrGenerate(t *testing.T) {
	p := geminiRealtimeFixture(t)
	open, err := p.OpenWire("open")
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	_ = json.Unmarshal(open, &cfg)
	setup := cfg["setup"].(map[string]any)
	if setup["model"] != "models/gemini-3.8-live" || setup["tools"] != nil || setup["proactivity"] != nil {
		t.Fatalf("setup=%v", cfg)
	}
	first, err := p.Input("frame", geminiAudioInput(1))
	if err != nil || len(first.Wires) != 2 {
		t.Fatalf("first=%v err=%v", first, err)
	}
	seal, err := p.OwnerControl("seal", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT))
	if err != nil || len(seal.Wires) != 0 || seal.BindInputKey == "" {
		t.Fatalf("seal=%v err=%v", seal, err)
	}
	if _, err := p.Input("late", geminiAudioInput(2)); err == nil {
		t.Fatal("sealed input accepted more frames")
	}
	start, err := p.OwnerControl("start", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE))
	if err != nil || len(start.Wires) != 1 {
		t.Fatal(err)
	}
	var wire map[string]any
	_ = json.Unmarshal(start.Wires[0], &wire)
	if wire["realtimeInput"].(map[string]any)["activityEnd"] == nil {
		t.Fatalf("start=%v", wire)
	}
	if _, err := p.OwnerControl("double", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE)); err == nil {
		t.Fatal("parallel response admitted")
	}
}

func TestGeminiRealtimeNativeCancellationAndDrainFence(t *testing.T) {
	p := geminiRealtimeFixture(t)
	_, err := p.Input("text", &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "text", Text: "Speak"}}})
	if err != nil {
		t.Fatal(err)
	}
	start, err := p.OwnerControl("start", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE))
	if err != nil {
		t.Fatal(err)
	}
	events, err := p.Normalize([]byte(`{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`))
	if err != nil || len(events) != 2 || events[0].ProviderResponseID != start.ResponseKey {
		t.Fatalf("events=%v err=%v", events, err)
	}
	cancel, err := p.Interrupt("cancel", start.ResponseKey)
	if err != nil || !cancel.AwaitNativeStop {
		t.Fatal(err)
	}
	var wire map[string]any
	_ = json.Unmarshal(cancel.Wires[0], &wire)
	cc := wire["clientContent"].(map[string]any)
	if cc["turnComplete"] != false || cc["turns"] != nil {
		t.Fatalf("cancel invented content=%v", cc)
	}
	if _, err := p.OwnerControl("early", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE)); err == nil {
		t.Fatal("continue before native drain")
	}
	if _, err := p.Normalize([]byte(`{"serverContent":{"interrupted":true}}`)); err != nil {
		t.Fatal(err)
	}
	late, err := p.Normalize([]byte(`{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`))
	if err != nil || len(late) != 0 {
		t.Fatalf("late=%v err=%v", late, err)
	}
	if _, err := p.Normalize([]byte(`{"serverContent":{"turnComplete":true,"interactionStatus":"IDLE"}}`)); err != nil {
		t.Fatal(err)
	}
	ctx, done := context.WithTimeout(context.Background(), time.Second)
	defer done()
	stopped, err := p.WaitNativeStop(ctx, start.ResponseKey)
	if err != nil || stopped.Status != CloudRealtimeResponseStatusCancelled {
		t.Fatalf("stop=%v err=%v", stopped, err)
	}
	for _, signal := range []string{"interrupted_observed=true", "turn_complete_observed=true", "idle_observed=true", "drain_audio_packets=1"} {
		if !strings.Contains(stopped.Observation, signal) {
			t.Fatalf("missing %s: %s", signal, stopped.Observation)
		}
	}
	next, err := p.OwnerControl("next", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE))
	if err != nil || next.ResponseKey == start.ResponseKey {
		t.Fatalf("next=%v err=%v", next, err)
	}
}

func TestGeminiRealtimeRejectsAutonomousAndUnconfirmedStop(t *testing.T) {
	p := geminiRealtimeFixture(t)
	if _, err := p.Normalize([]byte(`{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`)); err == nil {
		t.Fatal("autonomous output admitted")
	}
	_, _ = p.Input("text", &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "text", Text: "Speak"}}})
	start, _ := p.OwnerControl("start", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE))
	_, _ = p.Normalize([]byte(`{"serverContent":{"outputTranscription":{"text":"Speech"}}}`))
	_, _ = p.Interrupt("cancel", start.ResponseKey)
	_, _ = p.Normalize([]byte(`{"serverContent":{"interrupted":true}}`))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.WaitNativeStop(ctx, start.ResponseKey); err == nil {
		t.Fatal("cancel without native proof admitted")
	} else {
		for _, signal := range []string{"interrupted_observed=true", "turn_complete_observed=false", "idle_observed=false", "interaction=absent", "input_finished_observed=false"} {
			if !strings.Contains(err.Error(), signal) {
				t.Fatalf("missing %s: %v", signal, err)
			}
		}
	}
}

func TestGeminiRealtimeInputFinalUsesFinishedAndIsSessionPrivate(t *testing.T) {
	p := geminiRealtimeFixture(t)
	other := geminiRealtimeFixture(t)
	_, _ = p.Input("audio", geminiAudioInput(1))
	seal, _ := p.OwnerControl("seal", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT))
	_, _ = p.OwnerControl("start", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE))
	partial, err := p.Normalize([]byte(`{"serverContent":{"inputTranscription":{"text":"Actual"}}}`))
	if err != nil || len(partial) != 1 || partial[0].Kind != CloudRealtimeEventTranscriptPartial || partial[0].ProviderItemID != seal.BindInputKey {
		t.Fatalf("partial=%v err=%v", partial, err)
	}
	final, err := p.Normalize([]byte(`{"serverContent":{"inputTranscription":{"finished":true}}}`))
	if err != nil || len(final) != 1 || final[0].Kind != CloudRealtimeEventTranscriptFinal || final[0].Text != "Actual" {
		t.Fatalf("final=%v err=%v", final, err)
	}
	if _, err := other.Normalize([]byte(`{"serverContent":{"inputTranscription":{"text":"foreign"}}}`)); err == nil {
		t.Fatal("input state leaked between Sessions")
	}
}

func TestGeminiRealtimeUsageUsesReportedResponseAndSurvivesSplitTerminal(t *testing.T) {
	for _, test := range []struct {
		name, usage string
		want        *runtimev1.UsageStats
	}{
		{name: "missing"},
		{name: "partial", usage: `{"promptTokenCount":8}`},
		{name: "zero", usage: `{"promptTokenCount":0,"responseTokenCount":0,"totalTokenCount":50}`, want: &runtimev1.UsageStats{}},
		{name: "reported", usage: `{"promptTokenCount":8,"responseTokenCount":3}`, want: &runtimev1.UsageStats{InputTokens: 8, OutputTokens: 3}},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := geminiRealtimeFixture(t)
			_, _ = p.Input("text", &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "text", Text: "Speak"}}})
			_, _ = p.OwnerControl("start", geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE))
			if test.usage != "" {
				if _, err := p.Normalize([]byte(`{"usageMetadata":` + test.usage + `}`)); err != nil {
					t.Fatal(err)
				}
			}
			events, err := p.Normalize([]byte(`{"serverContent":{"waitingForInput":true,"turnComplete":true,"interactionStatus":"IDLE"}}`))
			if err != nil || len(events) != 1 {
				t.Fatalf("events=%v err=%v", events, err)
			}
			u := events[0].Usage
			if (u == nil) != (test.want == nil) || u.GetInputTokens() != test.want.GetInputTokens() || u.GetOutputTokens() != test.want.GetOutputTokens() {
				t.Fatalf("usage=%v want=%v", u, test.want)
			}
		})
	}
}

func TestGeminiRealtimeUnassignedUsageDoesNotCloseOrPolluteNextResponse(t *testing.T) {
	p := geminiRealtimeFixture(t)
	usage := `"usageMetadata":{"promptTokenCount":23,"responseTokenCount":17}`
	if events, err := p.Normalize([]byte(`{` + usage + `}`)); err != nil || len(events) != 0 {
		t.Fatalf("idle usage: events=%v err=%v", events, err)
	}
	_, _ = p.Input("text", &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "text", Text: "Speak"}}})
	for _, request := range []string{"first", "next"} {
		if _, err := p.OwnerControl(request, geminiControl(runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE)); err != nil {
			t.Fatal(err)
		}
		events, err := p.Normalize([]byte(`{"serverContent":{"waitingForInput":true,"turnComplete":true,"interactionStatus":"IDLE"}}`))
		if err != nil || len(events) != 1 || events[0].Usage != nil {
			t.Fatalf("%s terminal: events=%v err=%v", request, events, err)
		}
		if events, err := p.Normalize([]byte(`{` + usage + `}`)); err != nil || len(events) != 0 {
			t.Fatalf("post-terminal usage: events=%v err=%v", events, err)
		}
	}
	if _, err := p.Normalize([]byte(`{` + usage + `,"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`)); err == nil {
		t.Fatal("unassigned usage masked autonomous content")
	}
}
