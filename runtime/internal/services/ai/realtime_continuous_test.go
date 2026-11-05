package ai

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

func continuousServiceFixture(t *testing.T) (*Service, *realtimeSessionRecord, *realtimeTestProvider, context.Context, map[string]any) {
	t.Helper()
	raw, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": capabilitydriver.OpenAILiveModel, "remoteModelCatalogId": "catalog-live"})
	driver, target, err := capabilitydriver.NewProductionCloudRealtimeRegistry().Resolve(capabilitydriver.Identity{ImplementationID: "cloud.realtime.interact.openai", DriverID: "nimi.runtime.driver.openai", DriverDialect: "openai/realtime/v1"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	format := &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 24000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 960}
	open := capabilitydriver.CloudRealtimeOpen{InteractionMode: runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS, InputAudio: format, AudioOutput: true}
	protocol, err := driver.NewSession(target, open)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := protocol.OpenWire("start"); err != nil {
		t.Fatal(err)
	}
	resource := map[string]any{"id": "native-session", "model": capabilitydriver.OpenAILiveModel, "status": "active", "expires_at": time.Now().Add(time.Hour).Unix(), "store": false, "audio": map[string]any{"format": map[string]any{"type": "audio/pcm", "rate": 24000}, "output": map[string]any{"voice": "marin"}}, "delegation": map[string]any{"type": "client"}}
	ready, _ := json.Marshal(map[string]any{"type": "session.started", "session": resource})
	if _, err := protocol.Normalize(ready); err != nil {
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
	record := &realtimeSessionRecord{sessionID: "session", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account", ctx: ctx, cancel: cancel, stream: stream, provider: provider, driver: protocol, openExpectation: open, interactionMode: open.InteractionMode, inputAudio: format, outputAudio: format, tracksByRuntime: map[string]*realtimeOutputTrack{}, tracksByProvider: map[string]*realtimeOutputTrack{}}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	caller := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs(metadataAppIDKey, "app"))
	return svc, record, provider, caller, resource
}

func TestContinuousRealtimeContextIsOpaqueAndFramesHaveNoFakeTurns(t *testing.T) {
	svc, record, provider, caller, _ := continuousServiceFixture(t)
	request := capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventContextRequest, ProviderContextID: "native-delegation-secret-handle", OffsetMS: 120}
	if svc.projectRealtimeProviderEvent(record, request) {
		t.Fatal("context request closed session")
	}
	reader, release, err := record.stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	event := <-reader
	contextID := event.GetContextRequest().GetContextRequestId()
	if contextID == "" || contextID == request.ProviderContextID {
		t.Fatal("native delegation identity leaked")
	}
	if svc.projectRealtimeProviderEvent(record, request) || record.stream.Snapshot().BufferedItems != 0 {
		t.Fatal("duplicate delegation requested more work")
	}
	contextInput := func(kind runtimev1.AiRealtimeOwnerContextKind, id string) *runtimev1.AppendRealtimeInputRequest {
		return &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1, Input: &runtimev1.AppendRealtimeInputRequest_OwnerContext{OwnerContext: &runtimev1.AiRealtimeOwnerContextInput{RequestId: "reply", Kind: kind, Text: "A bounded result prepared by the App.", ContextRequestId: id}}}
	}
	if _, err := svc.AppendRealtimeInput(caller, contextInput(runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT, "foreign-id")); err == nil {
		t.Fatal("foreign context request accepted")
	}
	for _, kind := range []runtimev1.AiRealtimeOwnerContextKind{runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT, runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_SANITIZED_RESULT} {
		if _, err := svc.AppendRealtimeInput(caller, contextInput(kind, contextID)); err != nil {
			t.Fatal(err)
		}
		<-reader
	}
	provider.mu.Lock()
	sent := append([][]byte(nil), provider.sent...)
	provider.mu.Unlock()
	for _, raw := range sent {
		var wire map[string]any
		_ = json.Unmarshal(raw, &wire)
		if wire["delegation_id"] != request.ProviderContextID {
			t.Fatal("lost private correlation", wire)
		}
	}
	if _, err := svc.AppendRealtimeInput(caller, contextInput(runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_SANITIZED_RESULT, contextID)); err == nil {
		t.Fatal("replayed completed context result")
	}
	if svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventAudioDelta, Audio: make([]byte, 1024)}) {
		t.Fatal("audio failed")
	}
	active, first, second := <-reader, <-reader, <-reader
	if active.GetOutputTrack().GetRequestId() != "" || first.GetAudioFrame().GetRequestId() != "" || first.GetAudioFrame().GetFrameSequence() != 1 || second.GetAudioFrame().GetFrameSequence() != 2 || len(first.GetAudioFrame().Frame) != 960 || len(second.GetAudioFrame().Frame) != 64 {
		t.Fatal("invented turn or lost PCM frame geometry")
	}
	if _, err := svc.InterruptRealtimeOutput(caller, &runtimev1.InterruptRealtimeOutputRequest{RealtimeSessionId: "session", Generation: 1, OutputTrackId: active.GetOutputTrack().OutputTrackId}); err == nil {
		t.Fatal("continuous output interruption accepted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatal(reason)
	}
	if record.continuousTrack.terminal {
		t.Fatal("unsupported interrupt changed track")
	}
	frame := &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1, Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{InputTrackId: "stream-input", FrameSequence: 1, Frame: make([]byte, 960)}}}
	if _, err := svc.AppendRealtimeInput(caller, frame); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AppendRealtimeInput(caller, frame); err == nil {
		t.Fatal("duplicate stream frame accepted")
	}
	if _, err := svc.SubmitRealtimeOwnerControl(caller, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1, RequestId: "start", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE}); err == nil {
		t.Fatal("invented response start")
	}
}

func TestContinuousRealtimeCloseWaitsForNativeFinalUsageAndReplaysOnlyReceipt(t *testing.T) {
	svc, record, provider, caller, resource := continuousServiceFixture(t)
	go svc.runRealtimeProvider(record)
	closed := make(chan *runtimev1.CloseRealtimeSessionResponse, 1)
	go func() {
		response, err := svc.CloseRealtimeSession(caller, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "session", Generation: 1})
		if err != nil {
			t.Error(err)
		}
		closed <- response
	}()
	deadline := time.Now().Add(time.Second)
	for {
		provider.mu.Lock()
		n := len(provider.sent)
		provider.mu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("close wire not sent")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case <-closed:
		t.Fatal("local close fabricated native finalization")
	default:
	}
	raw, _ := json.Marshal(map[string]any{"type": "session.closed", "reason": "close_requested", "session": resource, "usage": map[string]any{"seconds": 45.8}})
	provider.events <- raw
	response := <-closed
	if response == nil || !response.GetUsage().GetFinal() || response.GetUsage().GetAudioSeconds() != 45.8 || response.GetControl().GetLifecycle() != runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED {
		t.Fatal(response)
	}
	provider.mu.Lock()
	count := len(provider.sent)
	provider.mu.Unlock()
	replayed, err := svc.CloseRealtimeSession(caller, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "session", Generation: 1})
	if err != nil {
		t.Fatal(err)
	}
	if replayed.GetUsage().GetAudioSeconds() != 45.8 {
		t.Fatal("lost close receipt usage")
	}
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if len(provider.sent) != count {
		t.Fatal("receipt replay called provider")
	}
}

func TestContinuousRealtimeOwnerLossClosesWithoutAnActiveReader(t *testing.T) {
	svc, record, _, _, _ := continuousServiceFixture(t)
	invalidated := make(chan struct{})
	record.ownerInvalidated = invalidated
	go svc.runRealtimeProvider(record)
	close(invalidated)
	select {
	case <-record.terminalDone:
	case <-time.After(time.Second):
		t.Fatal("revoked owner left continuous session alive")
	}
	if record.continuousUsage != nil {
		t.Fatal("owner loss fabricated final usage")
	}
}

func TestContinuousRealtimeCloseTimeoutKeepsUsageExplicitlyPartial(t *testing.T) {
	svc, record, _, caller, _ := continuousServiceFixture(t)
	seconds := 2.5
	svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventSessionUsage, SessionAudioSeconds: &seconds})
	deadline, cancel := context.WithTimeout(caller, 20*time.Millisecond)
	defer cancel()
	_, _ = svc.CloseRealtimeSession(deadline, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "session", Generation: 1})
	<-record.terminalDone
	receipt, err := svc.CloseRealtimeSession(caller, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "session", Generation: 1})
	if err != nil {
		t.Fatal(err)
	}
	if receipt.GetControl().GetLifecycle() != runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_FAILED || receipt.GetUsage().GetFinal() || receipt.GetUsage().GetAudioSeconds() != 2.5 {
		t.Fatal("timeout fabricated finalization", receipt)
	}
}

func TestContinuousRealtimeBufferedFinalizationWinsBeforeTransportEOF(t *testing.T) {
	for i := 0; i < 10; i++ {
		svc, record, provider, _, resource := continuousServiceFixture(t)
		provider.events = make(chan []byte, 1)
		raw, _ := json.Marshal(map[string]any{"type": "session.closed", "reason": "expired", "session": resource, "usage": map[string]any{"seconds": 4.8}})
		provider.events <- raw
		close(provider.errors)
		close(provider.events)
		svc.runRealtimeProvider(record)
		if record.continuousUsage == nil || !record.continuousUsage.Final || record.terminalControl.GetTerminalReason() != runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_COMPLETED {
			t.Fatal("received finalization lost to EOF", record.continuousUsage, record.terminalControl)
		}
	}
}
