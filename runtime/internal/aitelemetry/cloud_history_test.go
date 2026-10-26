package aitelemetry

import (
	"context"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
	"time"
)

func TestCloudHistoryAndSummaryUseCapturedConnectionsAndSafeOutcomes(t *testing.T) {
	s, _, now := testOwner(t)
	from := *now
	for index, connection := range []string{"connection-a", "connection-b", ""} {
		*now = now.Add(time.Second)
		record := testRecord(string(rune('a'+index)), "account-a", *now)
		record.ConnectorRef = connection
		record.TerminalAt = *now
		record.Outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED
		if index == 1 {
			record.Outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED
			record.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
			record.Usage = &runtimev1.UsageStats{InputTokens: 12, OutputTokens: 3}
		}
		if err := s.Record(record); err != nil {
			t.Fatal(err)
		}
	}
	other := testRecord("foreign", "account-b", *now)
	other.ConnectorRef = "connection-a"
	if err := s.Record(other); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Second)
	flushOwner(t, s)
	ctx := context.Background()
	summary, err := s.ConnectorSummary(ctx, "account-a", "connection-a", from, *now)
	if err != nil || summary.GetTotals().GetAttemptCount() != 1 || summary.AttributionComplete {
		t.Fatalf("summary: %+v %v", summary, err)
	}
	first, err := s.CloudHistory(ctx, "account-a", "", from, *now, 1, "")
	if err != nil || len(first.GetAttempts()) != 1 || first.NextPageToken == "" || first.AttributionComplete {
		t.Fatalf("first: %+v %v", first, err)
	}
	second, err := s.CloudHistory(ctx, "account-a", "", from, *now, 1, first.NextPageToken)
	if err != nil || second.Attempts[0].ConnectorRef != "connection-b" || second.Attempts[0].Outcome != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED || !second.Attempts[0].UsageMeasured {
		t.Fatalf("second: %+v %v", second, err)
	}
	if _, err := s.CloudHistory(ctx, "account-b", "", from, *now, 1, first.NextPageToken); !errors.Is(err, ErrCloudHistoryCursor) {
		t.Fatalf("cross-account cursor: %v", err)
	}
	filtered, err := s.CloudHistory(ctx, "account-a", "connection-a", from, *now, 20, "")
	if err != nil || len(filtered.Attempts) != 1 || filtered.Attempts[0].UsageMeasured || filtered.Attempts[0].Outcome != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED {
		t.Fatalf("success without usage: %+v %v", filtered, err)
	}
}

func TestCloudOutcomeDoesNotRegressWhenLateUsageArrives(t *testing.T) {
	s, _, now := testOwner(t)
	from := *now
	*now = now.Add(time.Second)
	facts := testRecord("source", "account-a", *now).Facts
	facts.ConnectorRef = "removed-connection"
	attempt := s.Begin(facts)
	attempt.Complete(nil, runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	attempt.Complete(&runtimev1.UsageStats{InputTokens: 7}, runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED, runtimev1.ReasonCode_ACTION_EXECUTED)
	s.FinishOperation(facts.OperationID, &runtimev1.UsageStats{InputTokens: 7})
	s.FinishOperation(facts.OperationID, &runtimev1.UsageStats{InputTokens: 7})
	*now = now.Add(time.Second)
	flushOwner(t, s)
	history, err := s.CloudHistory(context.Background(), "account-a", "removed-connection", from, *now, 20, "")
	if err != nil || len(history.Attempts) != 1 {
		t.Fatalf("history: %+v %v", history, err)
	}
	row := history.Attempts[0]
	if row.Outcome != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_FAILED || row.GetUsage().GetInputTokens() != 7 {
		t.Fatalf("outcome changed: %+v", row)
	}
	summary, err := s.ConnectorSummary(context.Background(), "account-a", "removed-connection", from, *now)
	if err != nil || summary.Totals.AttemptCount != 1 || summary.Totals.InputTokens != 7 {
		t.Fatalf("duplicate accounting: %+v %v", summary, err)
	}
}

func TestCapturedCloudHistorySurvivesAccountingRestart(t *testing.T) {
	s, backend, now := testOwner(t)
	from := *now
	*now = now.Add(time.Second)
	facts := testRecord("persisted", "account-a", *now).Facts
	facts.ConnectorRef = "historical-connection"
	attempt := s.Begin(facts)
	attempt.Complete(&runtimev1.UsageStats{InputTokens: 4}, runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED, runtimev1.ReasonCode_ACTION_EXECUTED)
	*now = now.Add(time.Second)
	flushOwner(t, s)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := openWithClock(backend, s.logger, func() time.Time { return *now })
	t.Cleanup(func() { _ = reopened.Close() })
	flushOwner(t, reopened)
	history, err := reopened.CloudHistory(context.Background(), "account-a", "historical-connection", from, *now, 20, "")
	if err != nil || len(history.GetAttempts()) != 1 || history.Attempts[0].GetConnectorRef() != facts.ConnectorRef || history.Attempts[0].GetOutcome() != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED {
		t.Fatalf("captured history after restart: %+v %v", history, err)
	}
}
