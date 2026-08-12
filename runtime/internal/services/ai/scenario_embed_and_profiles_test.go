package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestListScenarioProfiles(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.ListScenarioProfiles(context.Background(), &runtimev1.ListScenarioProfilesRequest{})
	if err != nil {
		t.Fatalf("list scenario profiles: %v", err)
	}
	if len(resp.GetProfiles()) != 9 {
		t.Fatalf("expected 9 scenario profiles, got %d", len(resp.GetProfiles()))
	}
	var foundTextGenerate bool
	var foundImageGenerate bool
	var foundWorldGenerate bool
	for _, profile := range resp.GetProfiles() {
		switch profile.GetScenarioType() {
		case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
			foundTextGenerate = true
			if len(profile.GetSupportedExecutionModes()) < 2 {
				t.Fatalf("text generate profile should expose sync+stream modes")
			}
		case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
			foundImageGenerate = true
			if got := profile.GetSupportedExecutionModes(); len(got) != 1 || got[0] != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
				t.Fatalf("image generate profile should expose async-job-only, got=%v", got)
			}
		case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
			foundWorldGenerate = true
			if got := profile.GetSupportedExecutionModes(); len(got) != 1 || got[0] != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
				t.Fatalf("world generate profile should expose async-job-only, got=%v", got)
			}
		}
	}
	if !foundTextGenerate {
		t.Fatalf("text generate profile not found")
	}
	if !foundImageGenerate {
		t.Fatalf("image generate profile not found")
	}
	if !foundWorldGenerate {
		t.Fatalf("world generate profile not found")
	}
}
