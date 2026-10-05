package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"google.golang.org/grpc/codes"
)

func (s *Service) sendRealtimeEffect(record *realtimeSessionRecord, effect capabilitydriver.CloudRealtimeEffect) error {
	for _, wire := range effect.Wires {
		if err := record.provider.Send(record.ctx, wire); err != nil {
			return err
		}
	}
	if effect.AwaitNativeStop && s.logger != nil {
		s.logger.Info("AI Realtime native cancel sent", "realtime_session_id", record.sessionID, "response_key", effect.ResponseKey, "wires_sent", len(effect.Wires))
	}
	if effect.BindInputKey != "" && !bindRealtimeInputIdentity(record, effect.BindInputKey) {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	for _, event := range effect.Events {
		if s.projectRealtimeProviderEvent(record, event) {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-live-owner-controls
func (s *Service) finishRealtimeNativeStop(ctx context.Context, record *realtimeSessionRecord, track *realtimeOutputTrack, key string) error {
	waitCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := record.driver.WaitNativeStop(waitCtx, key)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("AI Realtime native stop unconfirmed", "realtime_session_id", record.sessionID, "error", err)
		}
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, realtimecore.TerminalOwnerFailed)
		return realtimeDriverError(err)
	}
	if s.logger != nil {
		s.logger.Info("AI Realtime native stop observed", "realtime_session_id", record.sessionID, "status", result.Status, "control_observation", result.Observation)
	}
	record.mu.Lock()
	if record.closed {
		record.mu.Unlock()
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	track.interrupting = false
	if result.Status == capabilitydriver.CloudRealtimeResponseStatusCompleted {
		record.mu.Unlock()
		s.completeRealtimeResponse(record, track, result.Status, result.Usage)
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	if result.Status != capabilitydriver.CloudRealtimeResponseStatusCancelled {
		record.mu.Unlock()
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	track.terminal, track.interrupted, track.requestTerminal = true, true, true
	delete(record.requestsByResponse, key)
	err = s.publishRealtimeEventLocked(record, realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED, runtimev1.ReasonCode_ACTION_EXECUTED))
	record.mu.Unlock()
	s.handleRealtimePublishError(record, err)
	return err
}
