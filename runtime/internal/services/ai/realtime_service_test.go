package ai

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestAiRealtimePublicWireIsNeutralAndClosed(t *testing.T) {
	open := (&runtimev1.OpenRealtimeSessionResponse{}).ProtoReflect().Descriptor()
	for _, forbidden := range []string{"route_decision", "model_resolved", "provider", "connector", "driver", "engine", "trace_id", "agent_id", "participant_id", "conversation_id", "turn_id"} {
		if open.Fields().ByName(protoreflect.Name(forbidden)) != nil {
			t.Fatalf("Open response exposes forbidden field %q", forbidden)
		}
	}
	event := (&runtimev1.AiRealtimeEvent{}).ProtoReflect().Descriptor()
	if event.Oneofs().Len() != 1 || event.Oneofs().Get(0).Fields().Len() != 10 {
		t.Fatalf("Realtime event union = oneofs:%d variants:%d", event.Oneofs().Len(), event.Oneofs().Get(0).Fields().Len())
	}
	for _, forbidden := range []string{"kind", "payload", "unknown", "agent_id", "conversation_id", "turn_id"} {
		if event.Fields().ByName(protoreflect.Name(forbidden)) != nil {
			t.Fatalf("Realtime event exposes generic/owner field %q", forbidden)
		}
	}
}

func TestValidateRealtimeOpenNegotiatesExactPCMFormats(t *testing.T) {
	input, output, turn, err := validateRealtimeOpen(&runtimev1.OpenRealtimeSessionRequest{
		InputAudio: &runtimev1.AiRealtimeAudioFormat{
			Codec:        runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE,
			SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640,
		},
		AudioOutputEnabled: true,
	})
	if err != nil || input.GetSampleRateHz() != 16000 || output.GetSampleRateHz() != 24000 ||
		turn != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD {
		t.Fatalf("negotiation input=%+v output=%+v turn=%v err=%v", input, output, turn, err)
	}
	bad := protoCloneRealtimeOpen(input)
	bad.InputAudio.MaximumFrameBytes = 641
	if _, _, _, err := validateRealtimeOpen(bad); err == nil {
		t.Fatal("unsupported frame tuple was admitted")
	}
	input100, _, _, err := validateRealtimeOpen(&runtimev1.OpenRealtimeSessionRequest{
		InputAudio: &runtimev1.AiRealtimeAudioFormat{
			Codec:        runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE,
			SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 100, MaximumFrameBytes: 3200,
		},
	})
	if err != nil || input100.GetFrameDurationMs() != 100 || input100.GetMaximumFrameBytes() != 3200 {
		t.Fatalf("100ms input negotiation = %+v err=%v", input100, err)
	}
	_, disabledOutput, _, err := validateRealtimeOpen(&runtimev1.OpenRealtimeSessionRequest{
		InputAudio:         input,
		AudioOutputEnabled: false,
	})
	if err != nil || disabledOutput != nil {
		t.Fatalf("disabled output negotiation = %+v err=%v", disabledOutput, err)
	}
}

func TestRealtimeInputAllowsOnlyCommittedSequentialTracksAndPreservesProviderIdentity(t *testing.T) {
	record := &realtimeSessionRecord{
		inputAudio:       &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 640},
		inputsByProvider: make(map[string]realtimeInputIdentity),
	}
	frame := func(track, utterance string, sequence uint64) *runtimev1.AppendRealtimeInputRequest {
		return &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{
			InputTrackId: track, UtteranceId: utterance, FrameSequence: sequence, Frame: make([]byte, 640),
		}}}
	}
	if err := validateAndCaptureRealtimeInput(record, frame("track-a", "utterance-a", 1)); err != nil {
		t.Fatal(err)
	}
	if err := validateAndCaptureRealtimeInput(record, frame("track-b", "utterance-b", 1)); err == nil {
		t.Fatal("second input track was admitted before the first commit")
	}
	if err := beginRealtimeInputCommit(record); err != nil {
		t.Fatal(err)
	}
	if err := validateAndCaptureRealtimeInput(record, frame("track-b", "utterance-b", 1)); err != nil {
		t.Fatal(err)
	}
	if !bindRealtimeInputIdentity(record, "provider-item-a") {
		t.Fatal("provider input item was not bound to the committed Runtime identity")
	}
	first, ok := resolveRealtimeTranscriptIdentity(record, "provider-item-a", true)
	if !ok || first.inputTrackID != "track-a" || first.utteranceID != "utterance-a" {
		t.Fatalf("provider item mapped to %+v", first)
	}
}

func TestRealtimePartialTranscriptBindsBeforeManualCommitAndConfirmsSameProviderItem(t *testing.T) {
	record := &realtimeSessionRecord{
		inputTrackID: "track-live", utteranceID: "utterance-live", inputFrameSeq: 7,
		inputAudio:       &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 640},
		inputsByProvider: make(map[string]realtimeInputIdentity),
		terminalInputs:   make(map[string]struct{}),
	}
	partial, ok := resolveRealtimeTranscriptIdentity(record, "provider-live", false)
	if !ok || partial.inputTrackID != "track-live" || partial.utteranceID != "utterance-live" {
		t.Fatalf("partial transcript identity=%+v found=%v", partial, ok)
	}
	if record.inputCommitted || len(record.pendingInputs) != 0 {
		t.Fatalf("partial transcript committed input early: committed=%v pending=%+v", record.inputCommitted, record.pendingInputs)
	}
	if _, duplicate := resolveRealtimeTranscriptIdentity(record, "provider-other", false); duplicate {
		t.Fatal("a second provider item claimed the active Runtime input")
	}
	if _, earlyFinal := resolveRealtimeTranscriptIdentity(record, "provider-live", true); earlyFinal {
		t.Fatal("final transcript was accepted before matching input commit confirmation")
	}
	if err := beginRealtimeInputCommit(record); err != nil {
		t.Fatalf("manual commit after partial transcript: %v", err)
	}
	if len(record.pendingInputs) != 1 || record.pendingInputs[0].providerItemID != "provider-live" {
		t.Fatalf("manual commit lost provisional provider identity: %+v", record.pendingInputs)
	}
	if !bindRealtimeInputIdentity(record, "provider-live") {
		t.Fatal("provider committed event did not confirm the provisional identity")
	}
	final, ok := resolveRealtimeTranscriptIdentity(record, "provider-live", true)
	if !ok || !sameRealtimeInputIdentity(final, partial) || len(record.pendingInputs) != 0 {
		t.Fatalf("final transcript identity=%+v found=%v pending=%+v", final, ok, record.pendingInputs)
	}
	if !isTerminalRealtimeInput(record, "provider-live") {
		t.Fatal("final transcript did not fence its provider item identity")
	}
	next := &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{
		InputTrackId: "track-next", UtteranceId: "utterance-next", FrameSequence: 1, Frame: make([]byte, 640),
	}}}
	if err := validateAndCaptureRealtimeInput(record, next); err != nil {
		t.Fatalf("next input after final transcript: %v", err)
	}
	if _, late := resolveRealtimeTranscriptIdentity(record, "provider-live", false); late {
		t.Fatal("late partial transcript rebound a terminal provider item to the next input")
	}
	if record.inputTrackID != "track-next" || record.utteranceID != "utterance-next" {
		t.Fatalf("late provider item mutated next input identity: track=%q utterance=%q", record.inputTrackID, record.utteranceID)
	}
}

func TestRealtimeInputIdentityCapacityRejectsNextTrackBeforeMutation(t *testing.T) {
	terminal := make(map[string]struct{}, aiRealtimeMaxInputIdentities)
	for index := 0; index < aiRealtimeMaxInputIdentities-1; index++ {
		terminal[fmt.Sprintf("provider-terminal-%02d", index)] = struct{}{}
	}
	current := realtimeInputIdentity{inputTrackID: "track-64", utteranceID: "utterance-64", providerItemID: "provider-64"}
	record := &realtimeSessionRecord{
		inputAudio:         &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 640},
		inputTrackID:       current.inputTrackID,
		utteranceID:        current.utteranceID,
		inputFrameSeq:      1,
		inputIdentityCount: aiRealtimeMaxInputIdentities,
		inputCommitted:     true,
		pendingInputs:      []realtimeInputIdentity{current},
		inputsByProvider:   map[string]realtimeInputIdentity{current.providerItemID: current},
		terminalInputs:     terminal,
	}
	if _, ok := resolveRealtimeTranscriptIdentity(record, current.providerItemID, true); !ok {
		t.Fatal("the final admitted input identity was rejected at the tombstone bound")
	}
	if len(record.terminalInputs) != aiRealtimeMaxInputIdentities {
		t.Fatalf("terminal input count=%d", len(record.terminalInputs))
	}
	next := &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{
		InputTrackId: "track-65", UtteranceId: "utterance-65", FrameSequence: 1, Frame: make([]byte, 640),
	}}}
	err := validateAndCaptureRealtimeInput(record, next)
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("next input capacity code=%s err=%v", status.Code(err), err)
	}
	if record.inputTrackID != current.inputTrackID || record.utteranceID != current.utteranceID {
		t.Fatalf("capacity rejection mutated active identity: track=%q utterance=%q", record.inputTrackID, record.utteranceID)
	}
}

func TestRealtimeLateTerminalInputEventsAreIgnoredWithoutSessionFailure(t *testing.T) {
	record := &realtimeSessionRecord{
		inputTrackID: "track-next", utteranceID: "utterance-next", inputFrameSeq: 1,
		inputsByProvider: map[string]realtimeInputIdentity{},
		terminalInputs:   map[string]struct{}{"provider-terminal": {}},
	}
	service := &Service{}
	for _, event := range []capabilitydriver.CloudRealtimeEvent{
		{Kind: capabilitydriver.CloudRealtimeEventSpeechStarted, ProviderItemID: "provider-terminal"},
		{Kind: capabilitydriver.CloudRealtimeEventTranscriptPartial, ProviderItemID: "provider-terminal", Text: "late"},
		{Kind: capabilitydriver.CloudRealtimeEventTranscriptFinal, ProviderItemID: "provider-terminal", Text: "late"},
	} {
		if terminal := service.projectRealtimeProviderEvent(record, event); terminal {
			t.Fatalf("late terminal input event ended the session: %+v", event)
		}
		if record.closed || record.nextSequence != 0 || len(record.inputsByProvider) != 0 {
			t.Fatalf("late event mutated session state: closed=%v sequence=%d active=%+v", record.closed, record.nextSequence, record.inputsByProvider)
		}
	}
}

func TestRealtimePendingInputIdentityIsBoundedAndProviderBound(t *testing.T) {
	record := &realtimeSessionRecord{
		inputAudio:       &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 640},
		inputsByProvider: make(map[string]realtimeInputIdentity),
		pendingInputs:    make([]realtimeInputIdentity, aiRealtimeMaxPendingInputs),
		inputTrackID:     "track-current", utteranceID: "utterance-current", inputFrameSeq: 1, inputCommitted: true,
	}
	for index := range record.pendingInputs {
		record.pendingInputs[index] = realtimeInputIdentity{inputTrackID: "track-pending", utteranceID: "utterance-pending"}
	}
	next := &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{
		InputTrackId: "track-next", UtteranceId: "utterance-next", FrameSequence: 1, Frame: make([]byte, 640),
	}}}
	if err := validateAndCaptureRealtimeInput(record, next); err == nil {
		t.Fatal("unbounded pending input identity was admitted")
	}
	if _, ok := resolveRealtimeTranscriptIdentity(record, "provider-unknown", true); ok {
		t.Fatal("transcript guessed an unbound provider item from FIFO state")
	}
}

func TestRealtimeServerVADCommitBindsTheActiveInputIdentity(t *testing.T) {
	record := &realtimeSessionRecord{
		inputTrackID: "track-vad", utteranceID: "utterance-vad", inputFrameSeq: 9,
		inputsByProvider: make(map[string]realtimeInputIdentity),
	}
	if !bindRealtimeInputIdentity(record, "provider-vad-item") {
		t.Fatal("server-VAD provider commit did not bind the active Runtime input")
	}
	identity, ok := resolveRealtimeTranscriptIdentity(record, "provider-vad-item", true)
	if !ok || identity.inputTrackID != "track-vad" || identity.utteranceID != "utterance-vad" {
		t.Fatalf("server-VAD transcript identity=%+v found=%v", identity, ok)
	}
}

func protoCloneRealtimeOpen(input *runtimev1.AiRealtimeAudioFormat) *runtimev1.OpenRealtimeSessionRequest {
	return &runtimev1.OpenRealtimeSessionRequest{InputAudio: cloneRealtimeAudioFormat(input)}
}

func TestValidateAndCaptureRealtimeInputFencesSequenceAndBounds(t *testing.T) {
	record := &realtimeSessionRecord{inputAudio: &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 640}}
	frame := func(sequence uint64, size int) *runtimev1.AppendRealtimeInputRequest {
		return &runtimev1.AppendRealtimeInputRequest{Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{
			InputTrackId: "input-1", UtteranceId: "utterance-1", FrameSequence: sequence, Frame: make([]byte, size),
		}}}
	}
	if err := validateAndCaptureRealtimeInput(record, frame(1, 640)); err != nil {
		t.Fatal(err)
	}
	if err := validateAndCaptureRealtimeInput(record, frame(3, 640)); err == nil {
		t.Fatal("sequence gap was admitted")
	}
	if err := validateAndCaptureRealtimeInput(record, frame(2, 642)); err == nil {
		t.Fatal("oversized frame was admitted")
	}
}

func TestRealtimeSessionAuthorizationUsesExactAccountAppAndGeneration(t *testing.T) {
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 4, Capacity: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(&realtimeSessionRecord{
		sessionID: "session", channelID: "channel", generation: 4, appID: "app.a", subjectUserID: "account-a", stream: stream,
	})
	ctx := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account-a"}), metadata.Pairs(metadataAppIDKey, "app.a"))
	if _, err := svc.authorizedRealtimeRecord(ctx, "session", 4); err != nil {
		t.Fatalf("authorizedRealtimeRecord: %v", err)
	}
	wrongApp := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account-a"}), metadata.Pairs(metadataAppIDKey, "app.b"))
	if _, err := svc.authorizedRealtimeRecord(wrongApp, "session", 4); err == nil {
		t.Fatal("wrong App was authorized")
	}
	if _, err := svc.authorizedRealtimeRecord(ctx, "session", 3); err == nil {
		t.Fatal("stale generation was authorized")
	}
}

func TestProviderProjectionRejectsLateAudioAfterTrackInterrupt(t *testing.T) {
	driver, target := realtimeTestDashScopeDriver(t)
	_ = target
	provider := newRealtimeTestProvider()
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	record := &realtimeSessionRecord{
		sessionID: "session", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account",
		outputAudio: &runtimev1.AiRealtimeAudioFormat{MaximumFrameBytes: 4}, stream: stream, driver: driver, provider: provider,
		tracksByProvider: make(map[string]*realtimeOutputTrack), tracksByRuntime: make(map[string]*realtimeOutputTrack),
	}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	track := ensureRealtimeOutputTrack(record, "provider-response")
	track.terminal, track.interrupted = true, true
	if stopped := svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{
		Kind: capabilitydriver.CloudRealtimeEventAudioDelta, ProviderResponseID: "provider-response", Audio: []byte{1, 2, 3, 4},
	}); stopped {
		t.Fatal("late audio closed the session instead of being fenced")
	}
	if snapshot := stream.Snapshot(); snapshot.BufferedItems != 0 {
		t.Fatalf("late audio entered public stream: %+v", snapshot)
	}
}

func TestInterruptedProviderResponseDoesNotPublishSuccessTerminal(t *testing.T) {
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	record := &realtimeSessionRecord{
		sessionID: "session", channelID: "channel", generation: 1, stream: stream,
		tracksByProvider: make(map[string]*realtimeOutputTrack), tracksByRuntime: make(map[string]*realtimeOutputTrack),
	}
	track := ensureRealtimeOutputTrack(record, "provider-response")
	track.terminal, track.interrupted = true, true
	svc := &Service{}
	if stopped := svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{
		Kind: capabilitydriver.CloudRealtimeEventResponseDone, ProviderResponseID: "provider-response",
	}); stopped {
		t.Fatal("interrupted response closed the session")
	}
	if snapshot := stream.Snapshot(); snapshot.BufferedItems != 0 {
		t.Fatalf("interrupted response published success: %+v", snapshot)
	}
}

func TestRealtimeInterruptLinearizesBeforeConcurrentProviderDone(t *testing.T) {
	driver, _ := realtimeTestDashScopeDriver(t)
	provider := &blockingRealtimeTestProvider{
		realtimeTestProvider: newRealtimeTestProvider(),
		sendStarted:          make(chan struct{}),
		releaseSend:          make(chan struct{}),
	}
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	record := &realtimeSessionRecord{
		sessionID: "session", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account",
		stream: stream, driver: driver, provider: provider, ctx: context.Background(),
		tracksByProvider: make(map[string]*realtimeOutputTrack), tracksByRuntime: make(map[string]*realtimeOutputTrack),
	}
	track := ensureRealtimeOutputTrack(record, "provider-response")
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	ctx := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs(metadataAppIDKey, "app"))
	done := make(chan error, 1)
	go func() {
		_, err := svc.InterruptRealtimeOutput(ctx, &runtimev1.InterruptRealtimeOutputRequest{
			RealtimeSessionId: "session", Generation: 1, OutputTrackId: track.outputTrackID,
		})
		done <- err
	}()
	select {
	case <-provider.sendStarted:
	case <-time.After(time.Second):
		t.Fatal("interrupt did not reach provider")
	}
	svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{
		Kind: capabilitydriver.CloudRealtimeEventResponseDone, ProviderResponseID: "provider-response",
		ResponseStatus: capabilitydriver.CloudRealtimeResponseStatusCompleted,
	})
	close(provider.releaseSend)
	if err := <-done; err != nil {
		t.Fatalf("interrupt: %v", err)
	}
	reader, release, err := stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	select {
	case event := <-reader:
		if event.GetOutputTrack().GetLifecycle() != runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED || event.GetRequestTerminal() != nil {
			t.Fatalf("interrupt race published success or wrong terminal: %+v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("interrupt terminal was not published")
	}
	if snapshot := stream.Snapshot(); snapshot.BufferedItems != 0 {
		t.Fatalf("provider done raced a second terminal into the stream: %+v", snapshot)
	}
}

func TestCancelledProviderResponsePublishesInterruptedTrackWithoutSuccessTerminal(t *testing.T) {
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	record := &realtimeSessionRecord{
		sessionID: "session", channelID: "channel", generation: 1, stream: stream,
		tracksByProvider: make(map[string]*realtimeOutputTrack), tracksByRuntime: make(map[string]*realtimeOutputTrack),
	}
	track := ensureRealtimeOutputTrack(record, "provider-response")
	svc := &Service{}
	svc.completeRealtimeResponse(record, track, capabilitydriver.CloudRealtimeResponseStatusCancelled, nil)
	reader, release, err := stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	for index := 0; index < 2; index++ {
		select {
		case event := <-reader:
			if event.GetRequestTerminal() != nil || (event.GetOutputTrack() != nil && event.GetOutputTrack().GetLifecycle() != runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED) {
				t.Fatalf("cancelled response published invalid terminal: %+v", event)
			}
		case <-time.After(time.Second):
			t.Fatal("cancelled response did not publish its bounded terminal state")
		}
	}
}

func TestRealtimeStaleGenerationTerminalIsProjectedAsClosed(t *testing.T) {
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	reader, release, err := stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	record := &realtimeSessionRecord{sessionID: "session", channelID: "channel", generation: 1, stream: stream}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	svc.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED, realtimecore.TerminalStaleGeneration)
	select {
	case event := <-reader:
		if event.GetControl().GetLifecycle() != runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED ||
			event.GetControl().GetTerminalReason() != runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_STALE_GENERATION {
			t.Fatalf("stale-generation terminal control=%+v", event.GetControl())
		}
	case <-time.After(time.Second):
		t.Fatal("stale-generation terminal was not projected")
	}
}

func TestDashScopeResponseDonePreservesProviderTerminalStatus(t *testing.T) {
	driver, _ := realtimeTestDashScopeDriver(t)
	events, err := driver.NormalizeEvent([]byte(`{"type":"response.done","response":{"id":"response-1","status":"cancelled","usage":{"input_tokens":1,"output_tokens":2}}}`))
	if err != nil || len(events) != 1 || events[0].ResponseStatus != capabilitydriver.CloudRealtimeResponseStatusCancelled {
		t.Fatalf("cancelled response normalization events=%+v err=%v", events, err)
	}
	if _, err := driver.NormalizeEvent([]byte(`{"type":"response.done","response":{"id":"response-1","status":""}}`)); err == nil {
		t.Fatal("response.done without a typed provider terminal status was admitted")
	}
}

func realtimeTestDashScopeDriver(t *testing.T) (capabilitydriver.CloudRealtimeDriver, capabilitydriver.CloudRealtimeTarget) {
	t.Helper()
	target, _ := structpb.NewStruct(map[string]any{
		"provider": "dashscope", "providerModelId": "qwen3.5-omni-flash-realtime", "remoteModelCatalogId": "dashscope/realtime",
	})
	driver, resolved, err := capabilitydriver.NewProductionCloudRealtimeRegistry().Resolve(capabilitydriver.Identity{
		ImplementationID: "cloud.realtime.interact.dashscope", DriverID: "nimi.runtime.driver.dashscope", DriverDialect: "dashscope/realtime/v1",
	}, target)
	if err != nil {
		t.Fatal(err)
	}
	return driver, resolved
}

type realtimeTestProvider struct {
	mu     sync.Mutex
	sent   [][]byte
	events chan []byte
	errors chan error
}

type blockingRealtimeTestProvider struct {
	*realtimeTestProvider
	sendStarted chan struct{}
	releaseSend chan struct{}
}

func (p *blockingRealtimeTestProvider) Send(ctx context.Context, payload []byte) error {
	select {
	case <-p.sendStarted:
	default:
		close(p.sendStarted)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-p.releaseSend:
		return p.realtimeTestProvider.Send(ctx, payload)
	}
}

func newRealtimeTestProvider() *realtimeTestProvider {
	return &realtimeTestProvider{events: make(chan []byte), errors: make(chan error)}
}

func (p *realtimeTestProvider) Send(_ context.Context, payload []byte) error {
	p.mu.Lock()
	p.sent = append(p.sent, append([]byte(nil), payload...))
	p.mu.Unlock()
	return nil
}
func (p *realtimeTestProvider) Events() <-chan []byte { return p.events }
func (p *realtimeTestProvider) Errors() <-chan error  { return p.errors }
func (p *realtimeTestProvider) Close() error          { return nil }

func TestRealtimePublicTypeNamesContainNoProviderProvenance(t *testing.T) {
	types := []reflect.Type{
		reflect.TypeOf(runtimev1.OpenRealtimeSessionResponse{}), reflect.TypeOf(runtimev1.AiRealtimeEvent{}),
	}
	for _, typ := range types {
		if strings.Contains(strings.ToLower(typ.Name()), "provider") || strings.Contains(strings.ToLower(typ.Name()), "model") {
			t.Fatalf("public type contains provider provenance: %s", typ.Name())
		}
	}
}
