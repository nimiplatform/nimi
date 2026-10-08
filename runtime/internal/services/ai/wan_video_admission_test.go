package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestWan27ImageVideoAudioToggleFailsBeforeJobPublication(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusUnauthorized) }))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.7-i2v", server.URL, Config{AllowLoopbackEndpoint: true})
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.lab", "user-001"), "video.generate", f.targetRef)
	for _, audio := range []bool{false, true} {
		response, err := f.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
			Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.lab", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
				Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, Prompt: "A gentle pan.",
				Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://media.example.test/frame.png"}}},
				Options: &runtimev1.VideoGenerationOptions{GenerateAudio: &audio},
			}}},
		})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || response != nil || calls.Load() != 0 {
			t.Fatalf("unsupported audio toggle published/dispatched: response=%v calls=%d err=%v", response, calls.Load(), err)
		}
	}
}

func TestWan27TextVideoDeadlineFailsBeforePublication(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusUnauthorized) }))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.7-t2v", server.URL, Config{AllowLoopbackEndpoint: true})
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.lab", "user-001"), "video.generate", f.targetRef)
	duration := int32(2)
	for _, ms := range []int32{-1, 900001} {
		response, err := f.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
			Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.lab", SubjectUserId: "user-001", TimeoutMs: ms}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
				Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
				Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A cup."}},
				Options: &runtimev1.VideoGenerationOptions{DurationSec: &duration, Resolution: "720P"},
			}}},
		})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || response != nil || calls.Load() != 0 {
			t.Fatalf("invalid deadline published/dispatched: ms=%d response=%v calls=%d err=%v", ms, response, calls.Load(), err)
		}
		f.service.scenarioJobs.mu.RLock()
		published := len(f.service.scenarioJobs.jobs)
		f.service.scenarioJobs.mu.RUnlock()
		if published != 0 {
			t.Fatalf("invalid deadline retained %d jobs", published)
		}
	}
}

func TestWan27TextVideoDeadlineReachesHostWithoutClamping(t *testing.T) {
	for _, ms := range []int32{0, 900000} {
		t.Run(fmt.Sprint(ms), func(t *testing.T) {
			deadlineSeen := make(chan time.Time, 1)
			duration := int32(2)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"output": map[string]any{"task_id": "wan-deadline-task", "task_status": "PENDING"}})
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.7-t2v", server.URL, Config{
				AllowLoopbackEndpoint: true,
				providerPollWait: func(ctx context.Context, _ time.Duration) error {
					deadline, ok := ctx.Deadline()
					if !ok {
						return fmt.Errorf("provider poll has no deadline")
					}
					deadlineSeen <- deadline
					<-ctx.Done()
					return ctx.Err()
				},
			})
			ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.lab", "user-001"), "video.generate", f.targetRef)
			// The fixture admits two leases per App. Hold both so that the
			// published deadline spends real time in the scheduler queue.
			blockers := make([]func(), 0, 2)
			for i := 0; i < 2; i++ {
				release, _, acquireErr := f.service.scheduler.Acquire(context.Background(), "nimi.lab")
				if acquireErr != nil {
					t.Fatal(acquireErr)
				}
				blockers = append(blockers, release)
			}
			defer func() {
				for _, release := range blockers {
					release()
				}
			}()
			response, err := f.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
				Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.lab", SubjectUserId: "user-001", TimeoutMs: ms}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
					Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
					Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A cup."}},
					Options: &runtimev1.VideoGenerationOptions{DurationSec: &duration, Resolution: "720P"},
				}}},
			})
			if err != nil || response == nil || response.GetJob() == nil {
				t.Fatalf("admitted deadline did not publish: %v", err)
			}
			job := response.GetJob()
			defer func() {
				_, _ = f.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: job.GetJobId()})
			}()
			time.Sleep(100 * time.Millisecond)
			queued, ok := f.service.scenarioJobs.get(job.GetJobId())
			if !ok || queued.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
				t.Fatalf("job did not wait in queue: %v", queued)
			}
			blockers[0]()
			blockers = blockers[1:]
			select {
			case deadline := <-deadlineSeen:
				budget := deadline.Sub(job.GetCreatedAt().AsTime())
				if budget > 15*time.Minute || budget < 15*time.Minute-time.Second {
					t.Fatalf("submission deadline changed before Host polling: %s", budget)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("admitted video did not reach provider polling")
			}
		})
	}
}
