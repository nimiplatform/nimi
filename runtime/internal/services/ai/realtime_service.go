package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	aiRealtimeEventCapacity       = 128
	aiRealtimePressureAt          = 96
	aiRealtimeOpenTimeout         = 15 * time.Second
	aiRealtimeMaxTextBytes        = 32 * 1024
	aiRealtimeMaxInstructionBytes = 16 * 1024
	aiRealtimeMaxPendingInputs    = 8
	aiRealtimeMaxInputIdentities  = 64
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r113
// @nimi-authority: rule.nimi.runtime.ai-provider.r114
func (s *Service) OpenRealtimeSession(ctx context.Context, req *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error) {
	inputFormat, outputFormat, turnDetection, err := validateRealtimeOpen(req)
	if err != nil {
		return nil, err
	}
	caller, err := realtimeAppCaller(ctx)
	if err != nil {
		return nil, err
	}
	head := &runtimev1.ScenarioRequestHead{AppId: caller.appID}
	capturedCtx, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.RealtimeInteractCapabilityContract)
	if err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	if !intent.IsCloud() || s == nil || s.cloudRealtimeDrivers == nil || s.remoteRealtimeHost == nil || s.connStore == nil || s.speechCatalog == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	record, _, err := connector.ValidateAIConfigCloudSelection(
		s.connStore, s.speechCatalog, caller.accountNamespace, capabilitydriver.RealtimeInteractCapabilityContract,
		intent.CloudImplementation,
		connector.RemoteModelCatalogRef{
			ConnectorID:          intent.ConnectorRef,
			Provider:             intent.ProviderModelTarget.GetFields()["provider"].GetStringValue(),
			ProviderModelID:      intent.ProviderModelTarget.GetFields()["providerModelId"].GetStringValue(),
			RemoteModelCatalogID: intent.ProviderModelTarget.GetFields()["remoteModelCatalogId"].GetStringValue(),
		},
	)
	if err != nil {
		return nil, err
	}
	capturedRecord, credentialPayload, err := s.connStore.CaptureRealtimeCredential(record.ConnectorID)
	if err != nil || capturedRecord.ConnectorID != record.ConnectorID || capturedRecord.OwnerID != record.OwnerID ||
		capturedRecord.Status != record.Status || capturedRecord.Provider != record.Provider {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	driver, target, err := s.cloudRealtimeDrivers.Resolve(capabilitydriver.IdentityFromProto(intent.CloudImplementation), intent.ProviderModelTarget)
	if err != nil {
		return nil, realtimeDriverError(err)
	}
	providerSession, err := s.remoteRealtimeHost.Open(capturedCtx, caller.accountNamespace, capturedRecord, credentialPayload, target, driver.Endpoint(target))
	if err != nil {
		return nil, err
	}
	openWire, err := driver.MapOpen(ulid.Make().String(), target, capabilitydriver.CloudRealtimeOpen{
		InputAudio: inputFormat, AudioOutput: req.GetAudioOutputEnabled(), TurnDetection: turnDetection,
		InitialInstruction: req.GetInitialInstruction(),
	})
	if err != nil {
		_ = providerSession.Close()
		return nil, realtimeDriverError(err)
	}
	if err := providerSession.Send(capturedCtx, openWire); err != nil {
		_ = providerSession.Close()
		return nil, err
	}
	if err := waitRealtimeProviderReady(capturedCtx, providerSession, driver); err != nil {
		_ = providerSession.Close()
		return nil, err
	}
	sessionID, channelID, correlationID := ulid.Make().String(), ulid.Make().String(), ulid.Make().String()
	coreStream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: sessionID, ChannelID: channelID, AdapterKind: "ai",
		Generation: 1, Capacity: aiRealtimeEventCapacity, PressureAt: aiRealtimePressureAt,
	})
	if err != nil {
		_ = providerSession.Close()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	_ = coreStream.Transition(1, realtimecore.LifecycleReady)
	sessionCtx, cancel := context.WithCancel(context.Background())
	realtime := &realtimeSessionRecord{
		sessionID: sessionID, channelID: channelID, generation: 1,
		appID: caller.appID, subjectUserID: caller.accountNamespace, correlationID: correlationID,
		inputAudio: cloneRealtimeAudioFormat(inputFormat), outputAudio: cloneRealtimeAudioFormat(outputFormat), turnDetection: turnDetection,
		stream: coreStream, driver: driver, provider: providerSession, ctx: sessionCtx, cancel: cancel,
		inputsByProvider: make(map[string]realtimeInputIdentity),
		terminalInputs:   make(map[string]struct{}),
		tracksByProvider: make(map[string]*realtimeOutputTrack), tracksByRuntime: make(map[string]*realtimeOutputTrack),
	}
	if !s.realtimeSessions.create(realtime) {
		cancel()
		_ = providerSession.Close()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	opened := &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_Opened{Opened: &runtimev1.AiRealtimeSessionOpened{
		InputAudio: cloneRealtimeAudioFormat(inputFormat), OutputAudio: cloneRealtimeAudioFormat(outputFormat), TurnDetection: turnDetection,
	}}}
	if err := s.publishRealtimeEvent(realtime, opened); err != nil {
		s.terminalizeRealtimeSession(realtime, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, realtimecore.TerminalOwnerFailed)
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	go s.runRealtimeProvider(realtime)
	control := realtimeControl(realtime, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNSPECIFIED, "")
	return &runtimev1.OpenRealtimeSessionResponse{
		RealtimeSessionId: sessionID, ChannelId: channelID, Generation: 1,
		NegotiatedInputAudio: cloneRealtimeAudioFormat(inputFormat), NegotiatedOutputAudio: cloneRealtimeAudioFormat(outputFormat), Control: control,
	}, nil
}

func validateRealtimeOpen(req *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.AiRealtimeAudioFormat, *runtimev1.AiRealtimeAudioFormat, runtimev1.AiRealtimeTurnDetectionMode, error) {
	if req == nil || req.GetInputAudio() == nil {
		return nil, nil, 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	input := req.GetInputAudio()
	inputFrameSupported := (input.GetFrameDurationMs() == 20 && input.GetMaximumFrameBytes() == 640) ||
		(input.GetFrameDurationMs() == 100 && input.GetMaximumFrameBytes() == 3200)
	if input.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE || input.GetSampleRateHz() != 16000 ||
		input.GetChannelCount() != 1 || !inputFrameSupported {
		return nil, nil, 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}
	if len(req.GetInitialInstruction()) > aiRealtimeMaxInstructionBytes {
		return nil, nil, 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	turnDetection := req.GetTurnDetection()
	if turnDetection == runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_UNSPECIFIED {
		turnDetection = runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD
	}
	if turnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD &&
		turnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL {
		return nil, nil, 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}
	var output *runtimev1.AiRealtimeAudioFormat
	if req.GetAudioOutputEnabled() {
		output = &runtimev1.AiRealtimeAudioFormat{
			Codec:        runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE,
			SampleRateHz: 24000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 960,
		}
	}
	return cloneRealtimeAudioFormat(input), output, turnDetection, nil
}

func waitRealtimeProviderReady(ctx context.Context, session interface {
	Events() <-chan []byte
	Errors() <-chan error
}, driver capabilitydriver.CloudRealtimeDriver) error {
	timer := time.NewTimer(aiRealtimeOpenTimeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return rpcctx.ContextDoneError(ctx)
		case <-timer.C:
			return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		case err, ok := <-session.Errors():
			if !ok || err == nil {
				return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
			}
			return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
		case raw, ok := <-session.Events():
			if !ok {
				return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
			}
			events, err := driver.NormalizeEvent(raw)
			if err != nil {
				return realtimeDriverError(err)
			}
			for _, event := range events {
				if event.Kind == capabilitydriver.CloudRealtimeEventReady {
					return nil
				}
				if event.Kind == capabilitydriver.CloudRealtimeEventFailed {
					return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
				}
			}
		}
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r115
func (s *Service) AppendRealtimeInput(ctx context.Context, req *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error) {
	record, err := s.authorizedRealtimeRecord(ctx, req.GetRealtimeSessionId(), req.GetGeneration())
	if err != nil {
		return nil, err
	}
	if err := validateAndCaptureRealtimeInput(record, req); err != nil {
		if s.logger != nil {
			frameSequence, frameBytes, variant := uint64(0), 0, "unknown"
			switch input := req.GetInput().(type) {
			case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
				variant, frameSequence, frameBytes = "audio_frame", input.AudioFrame.GetFrameSequence(), len(input.AudioFrame.GetFrame())
			case *runtimev1.AppendRealtimeInputRequest_Text:
				variant = "text"
			case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
				variant = "owner_context"
			}
			s.logger.Warn("AI Realtime input rejected", "variant", variant, "frame_sequence", frameSequence, "frame_bytes", frameBytes, "error", err)
		}
		return nil, err
	}
	wire, err := record.driver.MapInput(ulid.Make().String(), req)
	if err != nil {
		return nil, realtimeDriverError(err)
	}
	if err := record.provider.Send(record.ctx, wire); err != nil {
		s.terminalizeRealtimeSession(record, reasonCodeOr(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE), realtimecore.TerminalOwnerFailed)
		return nil, err
	}
	accepted := &runtimev1.AiRealtimeInputAccepted{}
	publishAccepted := true
	switch input := req.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		accepted.InputTrackId = input.AudioFrame.GetInputTrackId()
		accepted.UtteranceId = input.AudioFrame.GetUtteranceId()
		accepted.FrameSequence = input.AudioFrame.GetFrameSequence()
		// Unary acknowledgement is the per-frame acceptance contract. The
		// event stream projects bounded status at 500 ms cadence instead of
		// duplicating 50 control events per second into a slower UI consumer.
		publishAccepted = accepted.FrameSequence == 1 || accepted.FrameSequence%25 == 0
	case *runtimev1.AppendRealtimeInputRequest_Text:
		accepted.RequestId = input.Text.GetRequestId()
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		accepted.RequestId = input.OwnerContext.GetRequestId()
	}
	if publishAccepted {
		if err := s.publishRealtimeEvent(record, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_InputAccepted{InputAccepted: accepted}}); err != nil {
			return nil, realtimePublishError(err)
		}
	}
	return &runtimev1.AppendRealtimeInputResponse{Ack: &runtimev1.Ack{Ok: true}, Control: realtimeControl(record, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, 0, "")}, nil
}

func validateAndCaptureRealtimeInput(record *realtimeSessionRecord, req *runtimev1.AppendRealtimeInputRequest) error {
	if record == nil || req == nil || req.GetInput() == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	if record.closed {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	switch input := req.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		frame := input.AudioFrame
		if frame == nil || strings.TrimSpace(frame.GetInputTrackId()) == "" || strings.TrimSpace(frame.GetUtteranceId()) == "" ||
			frame.GetFrameSequence() == 0 || len(frame.GetFrame()) == 0 || len(frame.GetFrame()) > int(record.inputAudio.GetMaximumFrameBytes()) || len(frame.GetFrame())%2 != 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if record.inputTrackID == frame.GetInputTrackId() && record.utteranceID == frame.GetUtteranceId() {
			if record.inputCommitted {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			if frame.GetFrameSequence() != record.inputFrameSeq+1 {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
		} else {
			if record.inputFrameSeq != 0 && !record.inputCommitted {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			if record.inputIdentityCount >= aiRealtimeMaxInputIdentities {
				return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			if len(record.pendingInputs) >= aiRealtimeMaxPendingInputs {
				return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			if frame.GetFrameSequence() != 1 {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			record.inputCommitted = false
			record.inputIdentityCount++
		}
		record.inputTrackID, record.utteranceID, record.inputFrameSeq = frame.GetInputTrackId(), frame.GetUtteranceId(), frame.GetFrameSequence()
	case *runtimev1.AppendRealtimeInputRequest_Text:
		if input.Text == nil || strings.TrimSpace(input.Text.GetRequestId()) == "" || strings.TrimSpace(input.Text.GetText()) == "" || len(input.Text.GetText()) > aiRealtimeMaxTextBytes {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		if input.OwnerContext == nil || strings.TrimSpace(input.OwnerContext.GetRequestId()) == "" || strings.TrimSpace(input.OwnerContext.GetText()) == "" ||
			len(input.OwnerContext.GetText()) > aiRealtimeMaxTextBytes || input.OwnerContext.GetKind() == runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_UNSPECIFIED {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func (s *Service) SubmitRealtimeOwnerControl(ctx context.Context, req *runtimev1.SubmitRealtimeOwnerControlRequest) (*runtimev1.SubmitRealtimeOwnerControlResponse, error) {
	record, err := s.authorizedRealtimeRecord(ctx, req.GetRealtimeSessionId(), req.GetGeneration())
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetRequestId()) == "" || req.GetControl() == runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	record.mu.Lock()
	if req.GetControl() == runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE ||
		req.GetControl() == runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE {
		record.pendingRequestID = req.GetRequestId()
	}
	record.mu.Unlock()
	wire, err := record.driver.MapOwnerControl(ulid.Make().String(), req)
	if err != nil {
		return nil, realtimeDriverError(err)
	}
	if req.GetControl() == runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT {
		if err := beginRealtimeInputCommit(record); err != nil {
			return nil, err
		}
	}
	if err := record.provider.Send(record.ctx, wire); err != nil {
		s.terminalizeRealtimeSession(record, reasonCodeOr(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE), realtimecore.TerminalOwnerFailed)
		return nil, err
	}
	return &runtimev1.SubmitRealtimeOwnerControlResponse{Ack: &runtimev1.Ack{Ok: true}, Control: realtimeControl(record, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, 0, "")}, nil
}

func (s *Service) ReadRealtimeEvents(req *runtimev1.ReadRealtimeEventsRequest, stream runtimev1.RuntimeAiRealtimeService_ReadRealtimeEventsServer) error {
	record, err := s.authorizedRealtimeRecord(stream.Context(), req.GetRealtimeSessionId(), req.GetGeneration())
	if err != nil {
		return err
	}
	reader, release, err := record.stream.ClaimReader()
	if errors.Is(err, realtimecore.ErrReaderConflict) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	if err != nil {
		return realtimePublishError(err)
	}
	defer release()
	for {
		select {
		case <-stream.Context().Done():
			return rpcctx.ContextDoneError(stream.Context())
		case event, ok := <-reader:
			if !ok {
				return nil
			}
			if event != nil {
				if err := stream.Send(event); err != nil {
					return err
				}
			}
		}
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r116
func (s *Service) InterruptRealtimeOutput(ctx context.Context, req *runtimev1.InterruptRealtimeOutputRequest) (*runtimev1.InterruptRealtimeOutputResponse, error) {
	record, err := s.authorizedRealtimeRecord(ctx, req.GetRealtimeSessionId(), req.GetGeneration())
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetOutputTrackId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	record.mu.Lock()
	track := record.tracksByRuntime[req.GetOutputTrackId()]
	if track == nil || track.terminal || track.interrupting || track.requestTerminal {
		record.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	providerResponseID := track.providerResponseID
	record.mu.Unlock()
	wire, err := record.driver.MapInterrupt(ulid.Make().String(), providerResponseID)
	if err != nil {
		return nil, realtimeDriverError(err)
	}
	record.mu.Lock()
	if record.closed || track.terminal || track.interrupting || track.requestTerminal {
		record.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	track.interrupting = true
	record.mu.Unlock()
	if err := record.provider.Send(record.ctx, wire); err != nil {
		s.terminalizeRealtimeSession(record, reasonCodeOr(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE), realtimecore.TerminalOwnerFailed)
		return nil, err
	}
	record.mu.Lock()
	if record.closed || !track.interrupting {
		record.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	track.interrupting = false
	track.terminal, track.interrupted, track.requestTerminal = true, true, true
	publishErr := s.publishRealtimeEventLocked(record, realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED, runtimev1.ReasonCode_ACTION_EXECUTED))
	record.mu.Unlock()
	s.handleRealtimePublishError(record, publishErr)
	if publishErr != nil {
		return nil, realtimePublishError(publishErr)
	}
	return &runtimev1.InterruptRealtimeOutputResponse{Ack: &runtimev1.Ack{Ok: true}, Control: realtimeControl(record, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, 0, "")}, nil
}

func (s *Service) CloseRealtimeSession(ctx context.Context, req *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error) {
	record, err := s.authorizedRealtimeRecord(ctx, req.GetRealtimeSessionId(), req.GetGeneration())
	if err != nil {
		return nil, err
	}
	control := realtimeControl(record, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED, runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_CANCELLED, "")
	s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_ACTION_EXECUTED, realtimecore.TerminalCancelled)
	return &runtimev1.CloseRealtimeSessionResponse{Ack: &runtimev1.Ack{Ok: true}, Control: control}, nil
}

func (s *Service) runRealtimeProvider(record *realtimeSessionRecord) {
	for {
		select {
		case <-record.ctx.Done():
			return
		case err, ok := <-record.provider.Errors():
			if !ok || err == nil {
				if s.logger != nil {
					s.logger.Warn("AI Realtime provider error channel closed")
				}
				s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, realtimecore.TerminalOwnerFailed)
				return
			}
			if s.logger != nil {
				s.logger.Warn("AI Realtime provider transport failed", "error", err)
			}
			s.terminalizeRealtimeSession(record, reasonCodeOr(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE), realtimecore.TerminalOwnerFailed)
			return
		case raw, ok := <-record.provider.Events():
			if !ok {
				if s.logger != nil {
					s.logger.Warn("AI Realtime provider event channel closed")
				}
				s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, realtimecore.TerminalOwnerFailed)
				return
			}
			events, err := record.driver.NormalizeEvent(raw)
			if err != nil {
				if s.logger != nil {
					s.logger.Warn("AI Realtime provider event rejected", "error", err)
				}
				s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
				return
			}
			for _, event := range events {
				if s.projectRealtimeProviderEvent(record, event) {
					return
				}
			}
		}
	}
}

func (s *Service) projectRealtimeProviderEvent(record *realtimeSessionRecord, source capabilitydriver.CloudRealtimeEvent) bool {
	switch source.Kind {
	case capabilitydriver.CloudRealtimeEventReady:
		return false
	case capabilitydriver.CloudRealtimeEventInputCommitted:
		if !bindRealtimeInputIdentity(record, source.ProviderItemID) {
			s.logRealtimeIdentityFailure(record, "input_committed", source.ProviderItemID, false)
			s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
			return true
		}
	case capabilitydriver.CloudRealtimeEventSpeechStarted, capabilitydriver.CloudRealtimeEventSpeechStopped:
		identity, ok := resolveRealtimeSpeechIdentity(record, source.ProviderItemID)
		if !ok {
			if isTerminalRealtimeInput(record, source.ProviderItemID) {
				return false
			}
			s.logRealtimeIdentityFailure(record, "speech_status", source.ProviderItemID, false)
			s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
			return true
		}
		state := runtimev1.AiRealtimeSpeechState_AI_REALTIME_SPEECH_STATE_STARTED
		if source.Kind == capabilitydriver.CloudRealtimeEventSpeechStopped {
			state = runtimev1.AiRealtimeSpeechState_AI_REALTIME_SPEECH_STATE_STOPPED
		}
		_ = s.publishRealtimeEvent(record, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_SpeechStatus{SpeechStatus: &runtimev1.AiRealtimeSpeechStatus{InputTrackId: identity.inputTrackID, UtteranceId: identity.utteranceID, State: state}}})
	case capabilitydriver.CloudRealtimeEventTranscriptPartial, capabilitydriver.CloudRealtimeEventTranscriptFinal:
		final := source.Kind == capabilitydriver.CloudRealtimeEventTranscriptFinal
		identity, ok := resolveRealtimeTranscriptIdentity(record, source.ProviderItemID, final)
		if !ok {
			if isTerminalRealtimeInput(record, source.ProviderItemID) {
				return false
			}
			s.logRealtimeIdentityFailure(record, "transcript", source.ProviderItemID, final)
			s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
			return true
		}
		_ = s.publishRealtimeEvent(record, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_Transcript{Transcript: &runtimev1.AiRealtimeTranscript{InputTrackId: identity.inputTrackID, UtteranceId: identity.utteranceID, Text: source.Text, Final: final}}})
	case capabilitydriver.CloudRealtimeEventInputTranscriptionFailed:
		if s.logger != nil {
			s.logger.Warn("AI Realtime input transcription failed", "provider_error_code", source.ErrorCode)
		}
		_ = s.publishRealtimeEvent(record, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_Failure{Failure: &runtimev1.AiRealtimeFailure{ReasonCode: runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID}}})
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID, realtimecore.TerminalOwnerFailed)
		return true
	case capabilitydriver.CloudRealtimeEventOutputStarted:
		track := ensureRealtimeOutputTrack(record, source.ProviderResponseID)
		_ = s.publishRealtimeEvent(record, realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_ACTIVE, 0))
	case capabilitydriver.CloudRealtimeEventTextDelta, capabilitydriver.CloudRealtimeEventTextFinal:
		track := ensureRealtimeOutputTrack(record, source.ProviderResponseID)
		s.publishRealtimeTextOutput(record, track, source.Text, source.Kind == capabilitydriver.CloudRealtimeEventTextFinal)
	case capabilitydriver.CloudRealtimeEventAudioDelta:
		track := ensureRealtimeOutputTrack(record, source.ProviderResponseID)
		maximum := int(record.outputAudio.GetMaximumFrameBytes())
		if maximum <= 0 {
			s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
			return true
		}
		for offset := 0; offset < len(source.Audio); offset += maximum {
			end := min(len(source.Audio), offset+maximum)
			if !s.publishRealtimeAudioFrame(record, track, source.Audio[offset:end]) {
				break
			}
		}
	case capabilitydriver.CloudRealtimeEventAudioDone:
		// Audio completion is not a response terminal. response.done owns the
		// single output-track/request decision so cancellation can still win.
		_ = ensureRealtimeOutputTrack(record, source.ProviderResponseID)
	case capabilitydriver.CloudRealtimeEventResponseDone:
		track := ensureRealtimeOutputTrack(record, source.ProviderResponseID)
		s.completeRealtimeResponse(record, track, source.ResponseStatus, source.Usage)
	case capabilitydriver.CloudRealtimeEventFailed:
		if s.logger != nil {
			s.logger.Warn("AI Realtime provider event failed", "provider_error_code", source.ErrorCode)
		}
		_ = s.publishRealtimeEvent(record, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_Failure{Failure: &runtimev1.AiRealtimeFailure{ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_INTERNAL}}})
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, realtimecore.TerminalOwnerFailed)
		return true
	}
	return false
}

func (s *Service) logRealtimeIdentityFailure(record *realtimeSessionRecord, eventKind, providerItemID string, final bool) {
	if s == nil || s.logger == nil || record == nil {
		return
	}
	record.mu.Lock()
	pendingInputs := len(record.pendingInputs)
	boundInputs := len(record.inputsByProvider)
	inputCommitted := record.inputCommitted
	record.mu.Unlock()
	s.logger.Warn(
		"AI Realtime provider identity rejected",
		"event_kind", eventKind,
		"provider_item_id", strings.TrimSpace(providerItemID),
		"final", final,
		"pending_inputs", pendingInputs,
		"bound_inputs", boundInputs,
		"input_committed", inputCommitted,
	)
}

func ensureRealtimeOutputTrack(record *realtimeSessionRecord, providerResponseID string) *realtimeOutputTrack {
	record.mu.Lock()
	defer record.mu.Unlock()
	providerResponseID = strings.TrimSpace(providerResponseID)
	if providerResponseID == "" {
		providerResponseID = "provider-response-" + ulid.Make().String()
	}
	if track := record.tracksByProvider[providerResponseID]; track != nil {
		return track
	}
	track := &realtimeOutputTrack{providerResponseID: providerResponseID, outputTrackID: ulid.Make().String(), requestID: record.pendingRequestID}
	record.tracksByProvider[providerResponseID] = track
	record.tracksByRuntime[track.outputTrackID] = track
	return track
}

func beginRealtimeInputCommit(record *realtimeSessionRecord) error {
	if record == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	if record.closed {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	if record.inputTrackID == "" || record.utteranceID == "" {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if record.inputCommitted {
		for _, pending := range record.pendingInputs {
			if pending.inputTrackID == record.inputTrackID && pending.utteranceID == record.utteranceID {
				return nil
			}
		}
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if len(record.pendingInputs) >= aiRealtimeMaxPendingInputs {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	identity := realtimeInputIdentity{inputTrackID: record.inputTrackID, utteranceID: record.utteranceID}
	for _, candidate := range record.inputsByProvider {
		if candidate.inputTrackID != record.inputTrackID || candidate.utteranceID != record.utteranceID {
			continue
		}
		if identity.providerItemID != "" && identity.providerItemID != candidate.providerItemID {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		identity = candidate
	}
	record.inputCommitted = true
	record.pendingInputs = append(record.pendingInputs, identity)
	return nil
}

func bindRealtimeInputIdentity(record *realtimeSessionRecord, providerItemID string) bool {
	if record == nil {
		return false
	}
	providerItemID = strings.TrimSpace(providerItemID)
	if providerItemID == "" {
		return false
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	if record.inputsByProvider == nil {
		record.inputsByProvider = make(map[string]realtimeInputIdentity)
	}
	if _, terminal := record.terminalInputs[providerItemID]; terminal {
		return false
	}
	if record.closed {
		return false
	}
	if existing, ok := record.inputsByProvider[providerItemID]; ok {
		for _, pending := range record.pendingInputs {
			if pending.providerItemID == providerItemID {
				return sameRealtimeInputIdentity(existing, pending)
			}
		}
		if !record.inputCommitted && existing.inputTrackID == record.inputTrackID && existing.utteranceID == record.utteranceID && len(record.pendingInputs) < aiRealtimeMaxPendingInputs {
			record.inputCommitted = true
			record.pendingInputs = append(record.pendingInputs, existing)
			return true
		}
		return false
	}
	for index := range record.pendingInputs {
		if record.pendingInputs[index].providerItemID != "" {
			continue
		}
		record.pendingInputs[index].providerItemID = providerItemID
		record.inputsByProvider[providerItemID] = record.pendingInputs[index]
		return true
	}
	// Server VAD commits the active buffer without a preceding owner-control
	// RPC. Bind that provider-issued item directly to the one active Runtime
	// input identity; never guess among multiple pending inputs.
	if !record.inputCommitted && record.inputTrackID != "" && record.utteranceID != "" && len(record.pendingInputs) < aiRealtimeMaxPendingInputs {
		identity := realtimeInputIdentity{
			inputTrackID: record.inputTrackID, utteranceID: record.utteranceID, providerItemID: providerItemID,
		}
		record.inputCommitted = true
		record.pendingInputs = append(record.pendingInputs, identity)
		record.inputsByProvider[providerItemID] = identity
		return true
	}
	return false
}

func resolveRealtimeSpeechIdentity(record *realtimeSessionRecord, providerItemID string) (realtimeInputIdentity, bool) {
	if record == nil {
		return realtimeInputIdentity{}, false
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	providerItemID = strings.TrimSpace(providerItemID)
	if providerItemID != "" {
		return ensureRealtimeInputIdentityLocked(record, providerItemID)
	}
	identity := realtimeInputIdentity{inputTrackID: record.inputTrackID, utteranceID: record.utteranceID}
	return identity, identity.inputTrackID != "" && identity.utteranceID != ""
}

func resolveRealtimeTranscriptIdentity(record *realtimeSessionRecord, providerItemID string, final bool) (realtimeInputIdentity, bool) {
	if record == nil {
		return realtimeInputIdentity{}, false
	}
	providerItemID = strings.TrimSpace(providerItemID)
	if providerItemID == "" {
		return realtimeInputIdentity{}, false
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	identity, found := record.inputsByProvider[providerItemID]
	if !found && !final {
		identity, found = ensureRealtimeInputIdentityLocked(record, providerItemID)
	}
	if !found {
		return realtimeInputIdentity{}, false
	}
	if final {
		pendingIndex := -1
		for index := range record.pendingInputs {
			if record.pendingInputs[index].providerItemID == providerItemID && sameRealtimeInputIdentity(record.pendingInputs[index], identity) {
				pendingIndex = index
				break
			}
		}
		if pendingIndex < 0 || len(record.terminalInputs) >= aiRealtimeMaxInputIdentities {
			return realtimeInputIdentity{}, false
		}
		delete(record.inputsByProvider, providerItemID)
		record.pendingInputs = append(record.pendingInputs[:pendingIndex], record.pendingInputs[pendingIndex+1:]...)
		if record.terminalInputs == nil {
			record.terminalInputs = make(map[string]struct{})
		}
		record.terminalInputs[providerItemID] = struct{}{}
	}
	return identity, true
}

func ensureRealtimeInputIdentityLocked(record *realtimeSessionRecord, providerItemID string) (realtimeInputIdentity, bool) {
	if record == nil || record.closed || providerItemID == "" {
		return realtimeInputIdentity{}, false
	}
	if record.inputsByProvider == nil {
		record.inputsByProvider = make(map[string]realtimeInputIdentity)
	}
	if _, terminal := record.terminalInputs[providerItemID]; terminal {
		return realtimeInputIdentity{}, false
	}
	if identity, ok := record.inputsByProvider[providerItemID]; ok {
		return identity, true
	}
	for _, identity := range record.inputsByProvider {
		if identity.inputTrackID == record.inputTrackID && identity.utteranceID == record.utteranceID {
			return realtimeInputIdentity{}, false
		}
	}
	for index := range record.pendingInputs {
		if record.pendingInputs[index].providerItemID != "" {
			continue
		}
		record.pendingInputs[index].providerItemID = providerItemID
		record.inputsByProvider[providerItemID] = record.pendingInputs[index]
		return record.pendingInputs[index], true
	}
	if record.inputCommitted || record.inputTrackID == "" || record.utteranceID == "" {
		return realtimeInputIdentity{}, false
	}
	identity := realtimeInputIdentity{
		inputTrackID: record.inputTrackID, utteranceID: record.utteranceID, providerItemID: providerItemID,
	}
	record.inputsByProvider[providerItemID] = identity
	return identity, true
}

func sameRealtimeInputIdentity(left, right realtimeInputIdentity) bool {
	return left.inputTrackID == right.inputTrackID && left.utteranceID == right.utteranceID && left.providerItemID == right.providerItemID
}

func isTerminalRealtimeInput(record *realtimeSessionRecord, providerItemID string) bool {
	if record == nil {
		return false
	}
	record.mu.Lock()
	_, terminal := record.terminalInputs[strings.TrimSpace(providerItemID)]
	record.mu.Unlock()
	return terminal
}

func realtimeOutputTrackEvent(track *realtimeOutputTrack, lifecycle runtimev1.AiRealtimeOutputTrackLifecycle, reason runtimev1.ReasonCode) *runtimev1.AiRealtimeEvent {
	return &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_OutputTrack{OutputTrack: &runtimev1.AiRealtimeOutputTrackStatus{
		RequestId: track.requestID, OutputTrackId: track.outputTrackID, Lifecycle: lifecycle, ReasonCode: reason,
	}}}
}

func (s *Service) publishRealtimeTextOutput(record *realtimeSessionRecord, track *realtimeOutputTrack, text string, final bool) bool {
	if record == nil || track == nil {
		return false
	}
	record.mu.Lock()
	if record.closed || track.terminal || track.interrupted || track.interrupting || track.requestTerminal {
		record.mu.Unlock()
		return false
	}
	err := s.publishRealtimeEventLocked(record, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{
		RequestId: track.requestID, OutputTrackId: track.outputTrackID, Text: text, Final: final,
	}}})
	record.mu.Unlock()
	s.handleRealtimePublishError(record, err)
	return err == nil
}

func (s *Service) publishRealtimeAudioFrame(record *realtimeSessionRecord, track *realtimeOutputTrack, frame []byte) bool {
	if record == nil || track == nil || len(frame) == 0 {
		return false
	}
	record.mu.Lock()
	if record.closed || track.terminal || track.interrupted || track.interrupting || track.requestTerminal {
		record.mu.Unlock()
		return false
	}
	track.frameSequence++
	err := s.publishRealtimeEventLocked(record, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameOutput{
		RequestId: track.requestID, OutputTrackId: track.outputTrackID, FrameSequence: track.frameSequence,
		Frame: append([]byte(nil), frame...), Format: cloneRealtimeAudioFormat(record.outputAudio),
	}}})
	record.mu.Unlock()
	s.handleRealtimePublishError(record, err)
	return err == nil
}

func (s *Service) completeRealtimeResponse(record *realtimeSessionRecord, track *realtimeOutputTrack, providerStatus capabilitydriver.CloudRealtimeResponseStatus, usage *runtimev1.UsageStats) {
	if record == nil || track == nil {
		return
	}
	record.mu.Lock()
	if record.closed || track.requestTerminal || track.interrupted || track.interrupting {
		record.mu.Unlock()
		return
	}
	var publishErr error
	publish := func(event *runtimev1.AiRealtimeEvent) {
		if publishErr == nil {
			publishErr = s.publishRealtimeEventLocked(record, event)
		}
	}
	switch providerStatus {
	case capabilitydriver.CloudRealtimeResponseStatusCompleted:
		track.terminal = true
		track.requestTerminal = true
		publish(realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_COMPLETED, runtimev1.ReasonCode_ACTION_EXECUTED))
		publish(&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_RequestTerminal{RequestTerminal: &runtimev1.AiRealtimeRequestTerminal{
			RequestId: track.requestID, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: usage, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		}}})
	case capabilitydriver.CloudRealtimeResponseStatusCancelled:
		track.terminal, track.interrupted, track.requestTerminal = true, true, true
		publish(realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED, runtimev1.ReasonCode_AI_STREAM_BROKEN))
		publish(&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_Failure{Failure: &runtimev1.AiRealtimeFailure{
			RequestId: track.requestID, OutputTrackId: track.outputTrackID, ReasonCode: runtimev1.ReasonCode_AI_STREAM_BROKEN,
		}}})
	case capabilitydriver.CloudRealtimeResponseStatusFailed:
		track.terminal, track.requestTerminal = true, true
		publish(realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_FAILED, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL))
		publish(&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_Failure{Failure: &runtimev1.AiRealtimeFailure{
			RequestId: track.requestID, OutputTrackId: track.outputTrackID, ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
		}}})
	default:
		record.mu.Unlock()
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
		return
	}
	record.mu.Unlock()
	s.handleRealtimePublishError(record, publishErr)
}

func (s *Service) publishRealtimeEvent(record *realtimeSessionRecord, event *runtimev1.AiRealtimeEvent) error {
	if record == nil || event == nil {
		return realtimecore.ErrClosed
	}
	record.mu.Lock()
	err := s.publishRealtimeEventLocked(record, event)
	record.mu.Unlock()
	s.handleRealtimePublishError(record, err)
	return err
}

func (s *Service) publishRealtimeEventLocked(record *realtimeSessionRecord, event *runtimev1.AiRealtimeEvent) error {
	if record == nil || event == nil || record.closed {
		return realtimecore.ErrClosed
	}
	record.nextSequence++
	event.Control = realtimeControlLocked(record, record.nextSequence, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, 0, "")
	_, err := record.stream.Publish(record.generation, event)
	return err
}

func (s *Service) handleRealtimePublishError(record *realtimeSessionRecord, err error) {
	if errors.Is(err, realtimecore.ErrSlowConsumer) {
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED, realtimecore.TerminalSlowConsumer)
	}
}

func (s *Service) terminalizeRealtimeSession(record *realtimeSessionRecord, reason runtimev1.ReasonCode, terminal realtimecore.TerminalReason) {
	if record == nil {
		return
	}
	record.mu.Lock()
	if record.closed {
		record.mu.Unlock()
		return
	}
	record.closed = true
	if s.logger != nil {
		if terminal == realtimecore.TerminalCancelled || terminal == realtimecore.TerminalRuntimeShutdown || terminal == realtimecore.TerminalStaleGeneration {
			s.logger.Info("AI Realtime session terminal", "reason_code", reason.String(), "terminal_reason", string(terminal))
		} else {
			s.logger.Warn("AI Realtime session terminal", "reason_code", reason.String(), "terminal_reason", string(terminal))
		}
	}
	record.nextSequence++
	sequence := record.nextSequence
	lifecycle := runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_FAILED
	terminalReason := runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_OWNER_FAILED
	if terminal == realtimecore.TerminalCancelled || terminal == realtimecore.TerminalRuntimeShutdown {
		lifecycle = runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED
		terminalReason = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_CANCELLED
	}
	if terminal == realtimecore.TerminalRuntimeShutdown {
		terminalReason = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_RUNTIME_SHUTDOWN
	}
	if terminal == realtimecore.TerminalSlowConsumer {
		terminalReason = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_SLOW_CONSUMER
	}
	if terminal == realtimecore.TerminalStaleGeneration {
		lifecycle = runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED
		terminalReason = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_STALE_GENERATION
	}
	event := &runtimev1.AiRealtimeEvent{
		Control: realtimeControlLocked(record, sequence, lifecycle, terminalReason, ""),
		Event:   &runtimev1.AiRealtimeEvent_SessionTerminal{SessionTerminal: &runtimev1.AiRealtimeSessionTerminal{ReasonCode: reason}},
	}
	record.mu.Unlock()
	s.realtimeSessions.remove(record.sessionID)
	if record.cancel != nil {
		record.cancel()
	}
	if record.provider != nil {
		_ = record.provider.Close()
	}
	_ = record.stream.PublishTerminal(record.generation, event, terminal)
}

func (s *Service) authorizedRealtimeRecord(ctx context.Context, sessionID string, generation uint64) (*realtimeSessionRecord, error) {
	if s == nil || s.realtimeSessions == nil || strings.TrimSpace(sessionID) == "" || generation == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	record, ok := s.realtimeSessions.get(sessionID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	caller, err := realtimeAppCaller(ctx)
	if err != nil || caller.appID != record.appID || caller.accountNamespace != record.subjectUserID {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if generation != record.generation {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	return record, nil
}

func realtimeAppCaller(ctx context.Context) (appAIConfigCaller, error) {
	if caller, err := authenticatedAppAIConfigCaller(ctx); err == nil {
		return caller, nil
	}
	identity := authn.IdentityFromContext(ctx)
	appID := incomingAppID(ctx)
	if identity == nil {
		return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
	}
	caller, ok := exactAppAIConfigCaller(strings.TrimSpace(identity.SubjectUserID), appID)
	if !ok {
		return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
	}
	return caller, nil
}

func incomingAppID(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get(metadataAppIDKey)
	if len(values) != 1 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func realtimeControl(record *realtimeSessionRecord, lifecycle runtimev1.RealtimeLifecycle, terminal runtimev1.RealtimeTerminalReason, hint string) *runtimev1.RealtimeControlStatus {
	if record == nil {
		return nil
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	return realtimeControlLocked(record, record.nextSequence, lifecycle, terminal, hint)
}

func realtimeControlLocked(record *realtimeSessionRecord, sequence uint64, lifecycle runtimev1.RealtimeLifecycle, terminal runtimev1.RealtimeTerminalReason, hint string) *runtimev1.RealtimeControlStatus {
	snapshot := record.stream.Snapshot()
	pressure := runtimev1.RealtimeBackpressureState_REALTIME_BACKPRESSURE_STATE_NORMAL
	if snapshot.Backpressure == realtimecore.BackpressurePressured {
		pressure = runtimev1.RealtimeBackpressureState_REALTIME_BACKPRESSURE_STATE_PRESSURED
	} else if snapshot.Backpressure == realtimecore.BackpressureBlocked {
		pressure = runtimev1.RealtimeBackpressureState_REALTIME_BACKPRESSURE_STATE_BLOCKED
	}
	return &runtimev1.RealtimeControlStatus{
		RealtimeSessionId: record.sessionID, ChannelId: record.channelID,
		AdapterKind: runtimev1.RealtimeAdapterKind_REALTIME_ADAPTER_KIND_AI,
		Lifecycle:   lifecycle, Generation: record.generation, Sequence: sequence, CorrelationId: record.correlationID,
		Backpressure: pressure, BufferedItems: uint32(snapshot.BufferedItems), BufferCapacity: aiRealtimeEventCapacity,
		TerminalReason: terminal, ActionHint: hint, OccurredAt: timestamppb.New(time.Now().UTC()),
	}
}

func cloneRealtimeAudioFormat(value *runtimev1.AiRealtimeAudioFormat) *runtimev1.AiRealtimeAudioFormat {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.AiRealtimeAudioFormat)
	return cloned
}

func realtimeDriverError(err error) error {
	if err == nil {
		return nil
	}
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
}

func realtimePublishError(err error) error {
	if errors.Is(err, realtimecore.ErrSlowConsumer) {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	if errors.Is(err, realtimecore.ErrStaleGeneration) || errors.Is(err, realtimecore.ErrClosed) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
}

func reasonCodeOr(err error, fallback runtimev1.ReasonCode) runtimev1.ReasonCode {
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		return reason
	}
	return fallback
}

func (s *Service) ShutdownRealtime() {
	if s == nil || s.realtimeSessions == nil {
		return
	}
	for _, record := range s.realtimeSessions.all() {
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED, realtimecore.TerminalRuntimeShutdown)
	}
}
