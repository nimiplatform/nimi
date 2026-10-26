package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-accounting
func (s *Service) configureRealtimeAIObservation(ctx context.Context, record *realtimeSessionRecord, providerID, modelID, connectorRef string) {
	if s.aiObservation == nil || record == nil {
		return
	}
	record.aiObservation = s.aiObservation
	record.aiObservationStarted = time.Now().UTC()
	record.aiObservationFacts = s.aiObservationFacts(ctx, record.subjectUserID, record.appID, record.sessionID,
		capabilitydriver.RealtimeInteractCapabilityContract,
		[]*runtimev1.DesktopAIExecutionModel{{ProviderId: providerID, ModelId: modelID}},
		runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD)
	record.aiObservationFacts.ConnectorRef = connectorRef
	record.ctx = aitelemetry.WithSource(record.ctx, record.aiObservationFacts.Source)
}

// The caller holds the session mutex. A Provider response identity is an
// observation fact; an audio fragment or invented replacement ID is not one.
func beginRealtimeAIObservationLocked(record *realtimeSessionRecord, providerResponseID, requestID string) *aitelemetry.Attempt {
	if attempt := record.aiAttemptsByResponse[providerResponseID]; attempt != nil {
		return attempt
	}
	if record.aiObservation == nil || record.closed {
		return nil
	}
	if providerResponseID == "" {
		if !record.aiObservationGap {
			record.aiObservationGap = true
			record.aiObservation.MarkGap("realtime", record.aiObservationStarted, "response-identity-unavailable")
		}
		return nil
	}
	facts := record.aiObservationFacts
	facts.OperationID = record.sessionID + ":" + providerResponseID
	if facts.Source.Kind == "local-agent" && facts.Source.ParentID == "" && requestID != "" {
		facts.Source.ParentID, facts.Source.ParentKind = requestID, "agent-realtime-turn"
	}
	attempt := record.aiObservation.Begin(facts)
	if record.aiAttemptsByResponse == nil {
		record.aiAttemptsByResponse = make(map[string]*aitelemetry.Attempt)
	}
	record.aiAttemptsByResponse[providerResponseID] = attempt
	return attempt
}

func finishRealtimeAIObservation(record *realtimeSessionRecord, responseID string, usage *runtimev1.UsageStats, result capabilitydriver.CloudRealtimeResponseStatus) {
	record.mu.Lock()
	attempt := record.aiAttemptsByResponse[responseID]
	if track := record.tracksByProvider[responseID]; attempt == nil && track != nil {
		attempt = track.aiAttempt
	}
	delete(record.aiAttemptsByResponse, responseID)
	if attempt == nil && record.aiObservation != nil && !record.aiObservationGap {
		record.aiObservationGap = true
		record.aiObservation.MarkGap("realtime", record.aiObservationStarted, "response-start-unobserved")
	}
	record.mu.Unlock()
	outcome := runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNKNOWN
	reason := runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	switch result {
	case capabilitydriver.CloudRealtimeResponseStatusCompleted:
		outcome, reason = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED, runtimev1.ReasonCode_ACTION_EXECUTED
	case capabilitydriver.CloudRealtimeResponseStatusFailed:
		outcome, reason = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	case capabilitydriver.CloudRealtimeResponseStatusCancelled:
		outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_CANCELLED
	}
	attempt.Complete(usage, outcome, reason)
}

func markRealtimeAIObservationUnknown(record *realtimeSessionRecord) {
	record.mu.Lock()
	attempts := make(map[*aitelemetry.Attempt]struct{})
	for _, track := range record.tracksByProvider {
		if track.aiAttempt != nil {
			attempts[track.aiAttempt] = struct{}{}
		}
	}
	for _, attempt := range record.aiAttemptsByResponse {
		if attempt != nil {
			attempts[attempt] = struct{}{}
		}
	}
	record.mu.Unlock()
	for attempt := range attempts {
		// A closed transport does not prove a remote response stopped or cost 0.
		attempt.Unknown()
	}
}
