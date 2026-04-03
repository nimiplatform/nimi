package ai

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestTimeoutDurationUsesBoundedOverride(t *testing.T) {
	tests := []struct {
		name           string
		timeoutMS      int32
		defaultTimeout time.Duration
		want           time.Duration
	}{
		{
			name:           "use default when request missing",
			timeoutMS:      0,
			defaultTimeout: defaultGenerateTimeout,
			want:           defaultGenerateTimeout,
		},
		{
			name:           "allow longer caller timeout",
			timeoutMS:      60_000,
			defaultTimeout: defaultGenerateTimeout,
			want:           60 * time.Second,
		},
		{
			name:           "allow shorter caller timeout",
			timeoutMS:      5_000,
			defaultTimeout: defaultGenerateTimeout,
			want:           5 * time.Second,
		},
		{
			name:           "clamp to runtime max",
			timeoutMS:      int32((10 * time.Minute) / time.Millisecond),
			defaultTimeout: defaultGenerateTimeout,
			want:           maxRuntimeRequestTimeout,
		},
		{
			name:           "zero default stays zero",
			timeoutMS:      0,
			defaultTimeout: 0,
			want:           0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := timeoutDuration(tt.timeoutMS, tt.defaultTimeout)
			if got != tt.want {
				t.Fatalf("timeoutDuration(%d, %s) = %s, want %s", tt.timeoutMS, tt.defaultTimeout, got, tt.want)
			}
		})
	}
}

func TestScenarioJobTimeoutDurationFloorsShortLocalImageJobs(t *testing.T) {
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			TimeoutMs: int32((10 * time.Minute) / time.Millisecond),
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
	}

	got := scenarioJobTimeoutDuration(req, defaultGenerateImageTimeout, true)
	if got != minLocalImageJobTimeout {
		t.Fatalf("scenarioJobTimeoutDuration(local image 10m) = %s, want %s", got, minLocalImageJobTimeout)
	}
}

func TestScenarioJobTimeoutDurationClampsLocalImageJobsAtSixtyMinutes(t *testing.T) {
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			TimeoutMs: int32((90 * time.Minute) / time.Millisecond),
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
	}

	got := scenarioJobTimeoutDuration(req, defaultGenerateImageTimeout, true)
	if got != maxLocalImageJobTimeout {
		t.Fatalf("scenarioJobTimeoutDuration(local image 90m) = %s, want %s", got, maxLocalImageJobTimeout)
	}
}

func TestScenarioJobTimeoutDurationPreservesLongerLocalImageJobsWithinCap(t *testing.T) {
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			TimeoutMs: int32((30 * time.Minute) / time.Millisecond),
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
	}

	got := scenarioJobTimeoutDuration(req, defaultGenerateImageTimeout, true)
	if got != 30*time.Minute {
		t.Fatalf("scenarioJobTimeoutDuration(local image 30m) = %s, want %s", got, 30*time.Minute)
	}
}

func TestScenarioJobTimeoutDurationFloorsDefaultLocalImageJobs(t *testing.T) {
	req := &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
	}

	got := scenarioJobTimeoutDuration(req, defaultGenerateImageTimeout, true)
	if got != minLocalImageJobTimeout {
		t.Fatalf("scenarioJobTimeoutDuration(local image default) = %s, want %s", got, minLocalImageJobTimeout)
	}
}

func TestScenarioJobTimeoutDurationKeepsRuntimeCapForRemoteImageJobs(t *testing.T) {
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			TimeoutMs: int32((10 * time.Minute) / time.Millisecond),
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
	}

	got := scenarioJobTimeoutDuration(req, defaultGenerateImageTimeout, false)
	if got != maxRuntimeRequestTimeout {
		t.Fatalf("scenarioJobTimeoutDuration(remote image 10m) = %s, want %s", got, maxRuntimeRequestTimeout)
	}
}
