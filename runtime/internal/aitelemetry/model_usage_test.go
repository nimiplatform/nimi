package aitelemetry

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
	"time"
)

func TestModelUsageBreakdownStaysOneAttemptWithoutInventedCompletePrice(t *testing.T) {
	s, _, now := testOwner(t)
	facts := testRecord("svg", "account-a", *now).Facts
	facts.Models = []*runtimev1.DesktopAIExecutionModel{{ProviderId: "openai", ModelId: "image-model", Role: "image-render"}, {ProviderId: "openai", ModelId: "author-model", Role: "svg-author"}}
	from := now.Add(-time.Second)
	for _, complete := range []bool{true, false} {
		attempt := s.Begin(facts)
		parts := []*runtimev1.DesktopAIModelUsage{{Model: facts.Models[0], Usage: &runtimev1.UsageStats{InputTokens: 10, OutputTokens: 20}}, {Model: facts.Models[1]}}
		if complete {
			parts[1].Usage = &runtimev1.UsageStats{InputTokens: 30, OutputTokens: 40, ReasoningOutputTokens: 15}
		}
		attempt.SetModelUsage(parts)
		attempt.Complete(parts[0].Usage, runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED, runtimev1.ReasonCode_ACTION_EXECUTED)
		attempt.Complete(parts[0].Usage, runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED, runtimev1.ReasonCode_ACTION_EXECUTED)
		if complete && (attempt.record.Usage.InputTokens != 40 || attempt.record.Usage.OutputTokens != 60 || attempt.record.Usage.ReasoningOutputTokens != 15) {
			t.Fatal("components not summed once")
		}
		if !complete && attempt.record.Usage != nil {
			t.Fatal("partial component became complete usage")
		}
		if _, _, priced := estimateCost(attempt.record); priced {
			t.Fatal("image price used for author")
		}
	}
	*now = now.Add(time.Second)
	flushOwner(t, s)
	history, err := s.CloudHistory(context.Background(), "account-a", "", from, *now, 20, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Attempts) != 2 {
		t.Fatalf("component invented attempts: %d", len(history.Attempts))
	}
	for _, attempt := range history.Attempts {
		if len(attempt.ModelUsage) != 2 || attempt.ModelUsage[0].Usage.InputTokens != 10 {
			t.Fatal("breakdown lost in persisted projection")
		}
	}
}
