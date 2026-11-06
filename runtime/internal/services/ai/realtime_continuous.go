package ai

import (
	"context"
	"strings"
	"time"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

type realtimeContextRequest struct {
	nativeID string
	offsetMS int64
	replied  bool
}

func normalizedRealtimeInteractionMode(mode runtimev1.AiRealtimeInteractionMode) runtimev1.AiRealtimeInteractionMode {
	if mode == runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_UNSPECIFIED {
		return runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_OWNER_CONTROLLED
	}
	return mode
}

func cloneRealtimeSessionUsage(usage *runtimev1.AiRealtimeSessionUsage) *runtimev1.AiRealtimeSessionUsage {
	if usage == nil {
		return nil
	}
	return proto.Clone(usage).(*runtimev1.AiRealtimeSessionUsage)
}

func cloneRealtimeSessionClosure(value *runtimev1.AiRealtimeSessionClosure) *runtimev1.AiRealtimeSessionClosure {
	if value == nil {
		return nil
	}
	return proto.Clone(value).(*runtimev1.AiRealtimeSessionClosure)
}

func validRealtimeCorrelation(value string) bool {
	return value != "" && len(value) <= 128 && strings.TrimSpace(value) == value && !strings.ContainsFunc(value, unicode.IsControl)
}

func continuousRealtimeInputAdmissionLocked(record *realtimeSessionRecord, req *runtimev1.AppendRealtimeInputRequest, capture bool) error {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	switch input := req.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		frame := input.AudioFrame
		if frame == nil || !validRealtimeCorrelation(frame.InputTrackId) || frame.UtteranceId != "" || frame.FrameSequence == 0 || len(frame.Frame) == 0 || len(frame.Frame)%2 != 0 || len(frame.Frame) > int(record.inputAudio.GetMaximumFrameBytes()) {
			return invalid
		}
		if record.inputTrackID != "" && record.inputTrackID != frame.InputTrackId || frame.FrameSequence != record.inputFrameSeq+1 {
			return invalid
		}
		if capture {
			record.inputTrackID = frame.InputTrackId
			record.inputFrameSeq = frame.FrameSequence
		}
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		value := input.OwnerContext
		if value == nil || !validRealtimeCorrelation(value.RequestId) || strings.TrimSpace(value.Text) == "" || len(value.Text) > aiRealtimeMaxTextBytes {
			return invalid
		}
		switch value.Kind {
		case runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_INSTRUCTION, runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT, runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_SANITIZED_RESULT:
		default:
			return invalid
		}
		if value.ContextRequestId != "" {
			request := record.contextRequests[value.ContextRequestId]
			if request == nil || request.replied {
				return invalid
			}
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}

func continuousRealtimeInputRequest(record *realtimeSessionRecord, req *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputRequest, error) {
	if record.interactionMode != runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS || req.GetOwnerContext().GetContextRequestId() == "" {
		return req, nil
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	request := record.contextRequests[req.GetOwnerContext().GetContextRequestId()]
	if request == nil || request.replied || record.closed || record.closing {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	copy := proto.Clone(req).(*runtimev1.AppendRealtimeInputRequest)
	copy.GetOwnerContext().ContextRequestId = request.nativeID
	return copy, nil
}

func markContinuousContextReplied(record *realtimeSessionRecord, req *runtimev1.AppendRealtimeInputRequest) {
	if record.interactionMode != runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS || req.GetOwnerContext().GetKind() != runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_SANITIZED_RESULT {
		return
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	if request := record.contextRequests[req.GetOwnerContext().GetContextRequestId()]; request != nil {
		request.replied = true
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gpt-live-continuous
// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-live-owner-controls
func (s *Service) projectContinuousRealtimeEvent(record *realtimeSessionRecord, source capabilitydriver.CloudRealtimeEvent) bool {
	record.mu.Lock()
	closed := record.closed
	record.mu.Unlock()
	if closed {
		return true
	}
	fail := func(reason runtimev1.ReasonCode) bool {
		s.terminalizeRealtimeSession(record, reason, realtimecore.TerminalOwnerFailed)
		return true
	}
	publish := func(event *runtimev1.AiRealtimeEvent) bool {
		err := s.publishRealtimeEvent(record, event)
		if err != nil {
			s.handleRealtimePublishError(record, err)
		}
		return err != nil
	}
	switch source.Kind {
	case capabilitydriver.CloudRealtimeEventAudioDelta:
		record.mu.Lock()
		track := record.continuousTrack
		created := track == nil
		if created {
			track = &realtimeOutputTrack{outputTrackID: ulid.Make().String()}
			record.continuousTrack = track
			record.tracksByRuntime[track.outputTrackID] = track
		}
		record.mu.Unlock()
		if created && publish(realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_ACTIVE, 0)) {
			return true
		}
		maximum := int(record.outputAudio.GetMaximumFrameBytes())
		if maximum <= 0 {
			return fail(runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		for offset := 0; offset < len(source.Audio); offset += maximum {
			if !s.publishRealtimeAudioFrame(record, track, source.Audio[offset:min(len(source.Audio), offset+maximum)]) {
				return true
			}
		}
	case capabilitydriver.CloudRealtimeEventContinuousTranscript:
		if (source.StartMS == nil) != (source.EndMS == nil) {
			return fail(runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		return publish(&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_ContinuousTranscript{ContinuousTranscript: &runtimev1.AiRealtimeContinuousTranscript{Direction: source.TranscriptDirection, TextDelta: source.Text, StartMs: source.StartMS, EndMs: source.EndMS}}})
	case capabilitydriver.CloudRealtimeEventContinuousInterruption, capabilitydriver.CloudRealtimeEventAudioDone:
		record.mu.Lock()
		track := record.continuousTrack
		id := ""
		if track != nil {
			id = track.outputTrackID
			track.terminal = true
			track.interrupted = source.Kind == capabilitydriver.CloudRealtimeEventContinuousInterruption
			record.continuousTrack = nil
			delete(record.tracksByRuntime, id)
		}
		record.mu.Unlock()
		if track != nil {
			lifecycle := runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_COMPLETED
			if track.interrupted {
				lifecycle = runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED
			}
			if publish(realtimeOutputTrackEvent(track, lifecycle, runtimev1.ReasonCode_ACTION_EXECUTED)) {
				return true
			}
		}
		if source.Kind == capabilitydriver.CloudRealtimeEventContinuousInterruption {
			return publish(&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_ContinuousInterruption{ContinuousInterruption: &runtimev1.AiRealtimeContinuousInterruption{OutputTrackId: id}}})
		}
	case capabilitydriver.CloudRealtimeEventContextRequest:
		record.mu.Lock()
		if id := record.contextRequestsByProvider[source.ProviderContextID]; id != "" {
			previous := record.contextRequests[id]
			same := previous != nil && previous.offsetMS == source.OffsetMS
			record.mu.Unlock()
			if !same {
				return fail(runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			return false
		}
		pending := 0
		for _, request := range record.contextRequests {
			if !request.replied {
				pending++
			}
		}
		if pending >= aiRealtimeMaxPendingInputs || len(record.contextRequests) >= aiRealtimeMaxInputIdentities {
			record.mu.Unlock()
			return fail(runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED)
		}
		id := ulid.Make().String()
		if record.contextRequests == nil {
			record.contextRequests = map[string]*realtimeContextRequest{}
			record.contextRequestsByProvider = map[string]string{}
		}
		record.contextRequests[id] = &realtimeContextRequest{nativeID: source.ProviderContextID, offsetMS: source.OffsetMS}
		record.contextRequestsByProvider[source.ProviderContextID] = id
		record.mu.Unlock()
		return publish(&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_ContextRequest{ContextRequest: &runtimev1.AiRealtimeContextRequest{ContextRequestId: id, OffsetMs: source.OffsetMS}}})
	case capabilitydriver.CloudRealtimeEventSessionUsage:
		if source.SessionAudioSeconds == nil {
			return fail(runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		usage := &runtimev1.AiRealtimeSessionUsage{AudioSeconds: *source.SessionAudioSeconds}
		record.mu.Lock()
		record.continuousUsage = usage
		record.mu.Unlock()
		return publish(&runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_SessionUsage{SessionUsage: cloneRealtimeSessionUsage(usage)}})
	case capabilitydriver.CloudRealtimeEventSessionClosed:
		if source.SessionAudioSeconds == nil || !source.SessionClosureConfirmed {
			return fail(runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		reason := runtimev1.ReasonCode_ACTION_EXECUTED
		terminal := realtimecore.TerminalCompleted
		outcome := runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED
		switch source.SessionCloseReason {
		case "close_requested":
			terminal = realtimecore.TerminalCancelled
		case "expired", "remote_hangup":
		case "content":
			reason = runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED
			terminal = realtimecore.TerminalOwnerFailed
			outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED
		case "connection_lost":
			reason = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			terminal = realtimecore.TerminalOwnerFailed
			outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNKNOWN
		default:
			return fail(runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		record.mu.Lock()
		record.continuousUsage = &runtimev1.AiRealtimeSessionUsage{AudioSeconds: *source.SessionAudioSeconds, Final: true}
		record.providerSessionClosed = true
		attempt := record.continuousAttempt
		record.continuousAttempt = nil
		track := record.continuousTrack
		if track != nil {
			track.terminal = true
		}
		record.mu.Unlock()
		if attempt != nil {
			attempt.Complete(nil, outcome, reason)
		} // Audio seconds are not fabricated token usage.
		if track != nil {
			lifecycle := runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_COMPLETED
			if outcome != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED {
				lifecycle = runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_FAILED
			}
			if publish(realtimeOutputTrackEvent(track, lifecycle, reason)) {
				return true
			}
		}
		s.terminalizeRealtimeSession(record, reason, terminal)
		return true
	case capabilitydriver.CloudRealtimeEventFailed:
		if source.FailureReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			return fail(source.FailureReason)
		}
		return fail(runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	default:
		return fail(runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return false
}

func (s *Service) closeContinuousRealtimeSession(ctx context.Context, record *realtimeSessionRecord) {
	record.mu.Lock()
	if record.closed || record.closing {
		record.mu.Unlock()
		return
	}
	record.closing = true
	record.mu.Unlock()
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	// A close fences new input immediately, then waits only for the one already
	// admitted write. It never sends the native close ahead of an in-flight frame.
	ticker := time.NewTicker(2 * time.Millisecond)
	defer ticker.Stop()
	for !record.operationMu.TryLock() {
		select {
		case <-bounded.Done():
			s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, realtimecore.TerminalOwnerFailed)
			return
		case <-ticker.C:
		}
	}
	if closer, ok := record.driver.(capabilitydriver.CloudRealtimeTransportCloser); ok && closer.CloseByTransportRelease() {
		record.operationMu.Unlock()
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_ACTION_EXECUTED, realtimecore.TerminalCancelled)
		return
	}
	closer, ok := record.driver.(capabilitydriver.CloudRealtimeSessionCloser)
	if !ok {
		record.operationMu.Unlock()
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
		return
	}
	wire, err := closer.CloseWire(ulid.Make().String())
	if err == nil {
		err = record.provider.Send(bounded, wire)
	}
	record.operationMu.Unlock()
	if err != nil {
		s.terminalizeRealtimeSession(record, reasonCodeOr(err, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE), realtimecore.TerminalOwnerFailed)
		return
	}
	select {
	case <-record.terminalDone:
	case <-bounded.Done():
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, realtimecore.TerminalOwnerFailed)
	}
}
