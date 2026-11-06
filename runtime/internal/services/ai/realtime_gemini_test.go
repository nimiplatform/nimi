package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

func geminiRealtimeServiceFixture(t *testing.T) (*Service, *realtimeSessionRecord, *realtimeTestProvider, context.Context) {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-3.8-live", "remoteModelCatalogId": "catalog"})
	factory, target, err := capabilitydriver.NewProductionCloudRealtimeRegistry().Resolve(capabilitydriver.Identity{ImplementationID: "cloud.realtime.interact.gemini", DriverID: "nimi.runtime.driver.gemini", DriverDialect: "gemini/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	format := &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}
	open := capabilitydriver.CloudRealtimeOpen{InputAudio: format, AudioOutput: true, InteractionMode: runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS}
	driver, err := factory.NewSession(target, open)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := driver.Normalize([]byte(`{"setupComplete":{}}`)); err != nil {
		t.Fatal(err)
	}
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 128})
	if err != nil {
		t.Fatal(err)
	}
	_ = stream.Transition(1, realtimecore.LifecycleReady)
	provider := newRealtimeTestProvider()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	record := &realtimeSessionRecord{sessionID: "session", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account", inputAudio: format, outputAudio: &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 960}, driver: driver, provider: provider, ctx: ctx, cancel: cancel, stream: stream, interactionMode: open.InteractionMode, openExpectation: open, tracksByRuntime: map[string]*realtimeOutputTrack{}, tracksByProvider: map[string]*realtimeOutputTrack{}}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	caller := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs(metadataAppIDKey, "app"))
	t.Cleanup(driver.Close)
	return svc, record, provider, caller
}

func projectGeminiFrame(t *testing.T, s *Service, r *realtimeSessionRecord, raw string) {
	t.Helper()
	events, err := r.driver.Normalize([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if s.projectRealtimeProviderEvent(r, event) {
			t.Fatal("native message failed Session")
		}
	}
}

func TestGeminiContinuousTranscriptInterruptionAndLocalClose(t *testing.T) {
	s, r, provider, ctx := geminiRealtimeServiceFixture(t)
	reader, release, err := r.stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	projectGeminiFrame(t, s, r, `{"serverContent":{"inputTranscription":{"text":" hello "}}}`)
	transcript := (<-reader).GetContinuousTranscript()
	if transcript == nil || transcript.TextDelta != " hello " || transcript.StartMs != nil || transcript.EndMs != nil {
		t.Fatal("invented timing", transcript)
	}
	projectGeminiFrame(t, s, r, `{"serverContent":{"interrupted":true}}`)
	if event := <-reader; event.GetContinuousInterruption() == nil || event.GetContinuousInterruption().OutputTrackId != "" {
		t.Fatal("invented output track", event)
	}
	projectGeminiFrame(t, s, r, `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`)
	active, audio := <-reader, <-reader
	id := active.GetOutputTrack().GetOutputTrackId()
	if id == "" || audio.GetAudioFrame().GetOutputTrackId() != id {
		t.Fatal("missing actual audio track")
	}
	projectGeminiFrame(t, s, r, `{"serverContent":{"interrupted":true,"turnComplete":true}}`)
	stopped, notice := <-reader, <-reader
	if stopped.GetOutputTrack().GetLifecycle() != runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED || notice.GetContinuousInterruption().GetOutputTrackId() != id || len(r.tracksByRuntime) != 0 {
		t.Fatal("native interruption not fenced")
	}
	before := len(provider.sent)
	closed, err := s.CloseRealtimeSession(ctx, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "session", Generation: 1})
	if err != nil || !closed.GetClosure().GetLocalResourcesReleased() || closed.GetClosure().GetProviderSessionClosed() || closed.Usage != nil || len(provider.sent) != before {
		t.Fatal("fabricated native close receipt", closed, err)
	}
	terminal := <-reader
	if terminal.GetSessionTerminal().GetClosure().GetProviderSessionClosed() || !terminal.GetSessionTerminal().GetClosure().GetLocalResourcesReleased() {
		t.Fatal(terminal)
	}
	replayed, ok := s.ReplayClosedRealtimeSession(ctx, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "session", Generation: 1})
	if !ok || replayed.GetClosure().GetProviderSessionClosed() || !replayed.GetClosure().GetLocalResourcesReleased() {
		t.Fatal("closure replay changed evidence")
	}
}

func TestGeminiContinuousInputAndTrackStorageStayBounded(t *testing.T) {
	s, r, _, ctx := geminiRealtimeServiceFixture(t)
	reader, release, err := r.stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	for i := 0; i < 80; i++ {
		projectGeminiFrame(t, s, r, `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]},"turnComplete":true}}`)
		for j := 0; j < 3; j++ {
			<-reader
		}
		if len(r.tracksByRuntime) != 0 || r.continuousTrack != nil {
			t.Fatal("completed track retained indefinitely")
		}
	}
	for _, control := range []runtimev1.AiRealtimeOwnerControlKind{runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE} {
		if _, err := s.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "control", Control: control}); err == nil {
			t.Fatal("owner-controlled operation accepted")
		}
	}
}
