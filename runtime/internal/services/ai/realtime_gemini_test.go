package ai

import (
	"context"
	"testing"
	"time"

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
	factory := capabilitydriver.NewGeminiRealtimeCandidateDriver()
	target, err := factory.ValidateTarget(capabilitydriver.Identity{ImplementationID: "cloud.realtime.interact.gemini", DriverID: "nimi.runtime.driver.gemini", DriverDialect: "gemini/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	format := &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}
	driver, err := factory.NewSession(target, capabilitydriver.CloudRealtimeOpen{InputAudio: format, AudioOutput: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL})
	if err != nil {
		t.Fatal(err)
	}
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 128})
	if err != nil {
		t.Fatal(err)
	}
	provider := newRealtimeTestProvider()
	record := &realtimeSessionRecord{sessionID: "session", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account", inputAudio: format, outputAudio: &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 960}, driver: driver, provider: provider, ctx: context.Background(), stream: stream, turnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL, inputsByProvider: map[string]realtimeInputIdentity{}, terminalInputs: map[string]struct{}{}, tracksByProvider: map[string]*realtimeOutputTrack{}, tracksByRuntime: map[string]*realtimeOutputTrack{}}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	ctx := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs(metadataAppIDKey, "app"))
	t.Cleanup(driver.Close)
	return svc, record, provider, ctx
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

func TestGeminiCorePreflightAndSealAreRealAndDoNotGenerate(t *testing.T) {
	svc, record, provider, ctx := geminiRealtimeServiceFixture(t)
	frame := &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1, Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{InputTrackId: "track", UtteranceId: "utterance", FrameSequence: 1, Frame: []byte{1, 0}}}}
	if _, err := svc.AppendRealtimeInput(ctx, frame); err != nil {
		t.Fatal(err)
	}
	if len(provider.sent) != 2 {
		t.Fatalf("first frame wires=%d", len(provider.sent))
	}
	if _, err := svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "seal", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT}); err != nil {
		t.Fatal(err)
	}
	if !record.inputCommitted || len(provider.sent) != 2 {
		t.Fatalf("seal=%v wires=%d", record.inputCommitted, len(provider.sent))
	}
	other := &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1, Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{InputTrackId: "other", UtteranceId: "other", FrameSequence: 1, Frame: []byte{1, 0}}}}
	if _, err := svc.AppendRealtimeInput(ctx, other); err == nil {
		t.Fatal("second unresolved input admitted")
	}
	if record.inputTrackID != "track" || record.utteranceID != "utterance" || record.inputIdentityCount != 1 || len(provider.sent) != 2 {
		t.Fatal("rejected input mutated Runtime or sent bytes")
	}
	if _, err := svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "start", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE}); err != nil {
		t.Fatal(err)
	}
	if len(provider.sent) != 3 {
		t.Fatal("owner start did not send native activity end")
	}
}

func TestGeminiCoreInterruptWaitsForNativeProofAndRejectsConcurrentStart(t *testing.T) {
	svc, record, provider, ctx := geminiRealtimeServiceFixture(t)
	if _, err := svc.AppendRealtimeInput(ctx, &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1, Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "input", Text: "Speak"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "start", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE}); err != nil {
		t.Fatal(err)
	}
	projectGeminiFrame(t, svc, record, `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`)
	var track *realtimeOutputTrack
	for _, v := range record.tracksByRuntime {
		track = v
	}
	result := make(chan error, 1)
	go func() {
		_, err := svc.InterruptRealtimeOutput(ctx, &runtimev1.InterruptRealtimeOutputRequest{RealtimeSessionId: "session", Generation: 1, OutputTrackId: track.outputTrackID})
		result <- err
	}()
	deadline := time.Now().Add(time.Second)
	for {
		provider.mu.Lock()
		n := len(provider.sent)
		provider.mu.Unlock()
		if n == 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("native cancel not sent")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case err := <-result:
		t.Fatalf("interrupt acknowledged without native proof: %v", err)
	default:
	}
	if _, err := svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "early", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE}); err == nil {
		t.Fatal("concurrent continue entered draining generation")
	}
	projectGeminiFrame(t, svc, record, `{"serverContent":{"interrupted":true}}`)
	select {
	case err := <-result:
		t.Fatalf("interrupt acknowledged before idle: %v", err)
	default:
	}
	projectGeminiFrame(t, svc, record, `{"serverContent":{"turnComplete":true,"interactionStatus":"IDLE"}}`)
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("native proof did not release owner control")
	}
	if !track.interrupted || record.closed {
		t.Fatal("interrupt lost exact-track scope")
	}
	if _, err := svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "next", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE}); err != nil {
		t.Fatal(err)
	}
}

func TestGeminiCoreOldTerminalKeepsRequestAcrossNewAcceptedStart(t *testing.T) {
	for _, noOutput := range []bool{true, false} {
		t.Run(map[bool]string{true: "no-output", false: "first-output-terminal"}[noOutput], func(t *testing.T) {
			svc, record, _, ctx := geminiRealtimeServiceFixture(t)
			_, err := svc.AppendRealtimeInput(ctx, &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1, Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "input", Text: "Speak"}}})
			if err != nil {
				t.Fatal(err)
			}
			control := func(id string) {
				t.Helper()
				if _, err := svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: id, Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE}); err != nil {
					t.Fatal(err)
				}
			}
			control("old-request")
			raw := `{"serverContent":{"turnComplete":true,"interactionStatus":"IDLE","waitingForInput":true}}`
			if !noOutput {
				raw = `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]},"generationComplete":true,"turnComplete":true,"interactionStatus":"IDLE"}}`
			}
			events, err := record.driver.Normalize([]byte(raw))
			if err != nil {
				t.Fatal(err)
			}
			control("new-request")
			for _, event := range events {
				if svc.projectRealtimeProviderEvent(record, event) {
					t.Fatal("old event failed")
				}
			}
			if record.pendingRequestID != "new-request" {
				t.Fatalf("old terminal cleared new request: %q", record.pendingRequestID)
			}
			if noOutput {
				if len(record.tracksByRuntime) != 0 {
					t.Fatal("no-output created fake track")
				}
			} else {
				for _, track := range record.tracksByRuntime {
					if track.requestID != "old-request" {
						t.Fatalf("old frame relabelled: %q", track.requestID)
					}
				}
			}
		})
	}
}

func TestGeminiOwnerCancelFencesLateFramesBeforeNativeConfirmation(t *testing.T) {
	svc, record, provider, ctx := geminiRealtimeServiceFixture(t)
	_, _ = svc.AppendRealtimeInput(ctx, &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1, Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "input", Text: "Speak"}}})
	_, _ = svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "start", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE})
	projectGeminiFrame(t, svc, record, `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`)
	var track *realtimeOutputTrack
	for _, v := range record.tracksByRuntime {
		track = v
	}
	result := make(chan error, 1)
	go func() {
		_, err := svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "cancel", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE})
		result <- err
	}()
	deadline := time.Now().Add(time.Second)
	for {
		provider.mu.Lock()
		n := len(provider.sent)
		provider.mu.Unlock()
		if n == 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancel not sent")
		}
		time.Sleep(time.Millisecond)
	}
	record.mu.Lock()
	before := record.nextSequence
	record.mu.Unlock()
	projectGeminiFrame(t, svc, record, `{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}}]}}}`)
	record.mu.Lock()
	after := record.nextSequence
	record.mu.Unlock()
	if after != before {
		t.Fatal("late frame publicly delivered during owner cancel")
	}
	select {
	case err := <-result:
		t.Fatalf("owner cancel success before native proof: %v", err)
	default:
	}
	projectGeminiFrame(t, svc, record, `{"serverContent":{"interrupted":true,"turnComplete":true,"interactionStatus":"IDLE"}}`)
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("confirmed cancel did not settle")
	}
	if !track.interrupted || record.closed {
		t.Fatal("owner cancel exceeded selected track")
	}
}
