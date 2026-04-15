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

func TestScenarioJobUsesDetachedPollingForVideoAdapters(t *testing.T) {
	videoType := runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE
	imageType := runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE

	detachedAdapters := []string{
		"bytedance_ark_task_adapter",
		"alibaba_native_adapter",
		"gemini_operation_adapter",
		"minimax_task_adapter",
		"glm_task_adapter",
		"kling_task_adapter",
		"luma_task_adapter",
		"pika_task_adapter",
		"runway_task_adapter",
		"google_veo_operation_adapter",
	}
	for _, adapter := range detachedAdapters {
		if !scenarioJobUsesDetachedPolling(videoType, adapter) {
			t.Errorf("scenarioJobUsesDetachedPolling(VIDEO, %q) = false, want true", adapter)
		}
	}

	// Non-video scenario types must not use detached polling.
	for _, adapter := range detachedAdapters {
		if scenarioJobUsesDetachedPolling(imageType, adapter) {
			t.Errorf("scenarioJobUsesDetachedPolling(IMAGE, %q) = true, want false", adapter)
		}
	}

	// Unknown adapters must not use detached polling.
	if scenarioJobUsesDetachedPolling(videoType, "openai_compat_adapter") {
		t.Error("scenarioJobUsesDetachedPolling(VIDEO, openai_compat) = true, want false")
	}
}
