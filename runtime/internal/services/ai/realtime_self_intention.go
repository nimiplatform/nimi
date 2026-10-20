package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"github.com/oklog/ulid/v2"
)

func (s *Service) collectRealtimeSelfIntention(record *realtimeSessionRecord, source capabilitydriver.CloudRealtimeEvent) {
	record.mu.Lock()
	defer record.mu.Unlock()
	track := record.tracksByProvider[source.ProviderResponseID]
	// One optional suggestion per turn. Repeated or late calls do not replace
	// the first suggestion and never interrupt ordinary streamed speech.
	if record.selfHandler == nil || record.selfUsed || record.selfPending != nil || track == nil ||
		track.terminal || track.interrupted || track.requestTerminal || track.requestID == "" {
		return
	}
	copy := source
	record.selfPending = &copy
}

// Returns handled=true for a response with a suggestion. Its native terminal is
// real, but the original request remains open for one owner-result response.
func (s *Service) completeRealtimeSelfIntention(record *realtimeSessionRecord, source capabilitydriver.CloudRealtimeEvent) (handled, terminal bool) {
	record.mu.Lock()
	call := record.selfPending
	if call == nil || call.ProviderResponseID != source.ProviderResponseID {
		record.mu.Unlock()
		return false, false
	}
	track := record.tracksByProvider[source.ProviderResponseID]
	if source.ResponseStatus != capabilitydriver.CloudRealtimeResponseStatusCompleted || track == nil || track.interrupted || track.requestTerminal {
		record.selfPending = nil
		record.mu.Unlock()
		return false, false
	}
	record.selfPending = nil
	record.selfUsed = true
	record.selfWaiting = true
	record.selfUsage = source.Usage
	ctx, cancel := context.WithCancel(record.ctx)
	record.selfCancel = cancel
	handler := record.selfHandler
	record.mu.Unlock()
	if record.selfUsageObserver != nil && source.Usage != nil {
		record.selfUsageObserver(track.requestID, source.Usage)
	}
	result, err := handler(ctx, call.Text)
	cancel()
	record.operationMu.Lock()
	defer record.operationMu.Unlock()
	record.mu.Lock()
	closed := record.closed || track.interrupted || track.requestTerminal
	record.selfCancel = nil
	record.mu.Unlock()
	if closed {
		return true, true
	}
	if err != nil {
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_OUTPUT_INVALID, realtimecore.TerminalOwnerFailed)
		return true, true
	}
	protocol, ok := record.driver.(capabilitydriver.CloudRealtimeSelfIntentionProtocol)
	if !ok {
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, realtimecore.TerminalOwnerFailed)
		return true, true
	}
	effect, err := protocol.SelfIntentionResult(ulid.Make().String(), call.CallID, result)
	if err == nil {
		err = s.sendRealtimeEffect(record, effect)
	}
	if err != nil {
		s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, realtimecore.TerminalOwnerFailed)
		return true, true
	}
	record.mu.Lock()
	track.terminal = true
	track.requestTerminal = true
	record.mu.Unlock()
	_ = s.publishRealtimeEvent(record, realtimeOutputTrackEvent(track, runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_COMPLETED, 0))
	return true, false
}

func mergeRealtimeIntentionUsage(a, b *runtimev1.UsageStats) *runtimev1.UsageStats {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	return &runtimev1.UsageStats{InputTokens: a.GetInputTokens() + b.GetInputTokens(), OutputTokens: a.GetOutputTokens() + b.GetOutputTokens(), ComputeMs: a.GetComputeMs() + b.GetComputeMs(), CachedInputTokens: a.GetCachedInputTokens() + b.GetCachedInputTokens(), ReasoningOutputTokens: a.GetReasoningOutputTokens() + b.GetReasoningOutputTokens()}
}
