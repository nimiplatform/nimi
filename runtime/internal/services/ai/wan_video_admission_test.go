package ai

import (
	"context"
	"encoding/json"
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

func TestWan27TextVideoQueueDoesNotStartProviderObservation(t *testing.T) {
	var creates, queries atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			creates.Add(1)
		} else if r.Method == http.MethodGet {
			queries.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"output": map[string]any{"task_id": "wan-queued-task", "task_status": "PENDING"}})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.7-t2v", server.URL, Config{AllowLoopbackEndpoint: true})
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.lab", "user-001"), "video.generate", f.targetRef)
	var blockers []func()
	for i := 0; i < 2; i++ {
		release, _, err := f.service.scheduler.Acquire(context.Background(), "nimi.lab")
		if err != nil {
			t.Fatal(err)
		}
		blockers = append(blockers, release)
	}
	defer func() {
		for _, release := range blockers {
			release()
		}
	}()
	submitted, err := f.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.lab", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A cup.", Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(2), Resolution: "720P"}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	defer f.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: id})
	deadline := time.Now().Add(3 * time.Second)
	for {
		job, _ := f.service.scenarioJobs.get(id)
		if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Job did not enter queue: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	if creates.Load() != 0 || queries.Load() != 0 {
		t.Fatal("queued Job used provider before Host admission")
	}
	blockers[0]()
	blockers = blockers[1:]
	for f.service.scenarioJobs.originalNativeReceipt(id) == nil {
		if time.Now().After(deadline) {
			t.Fatal("released Host did not create original task")
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
	if creates.Load() != 1 || queries.Load() != 0 {
		t.Fatal("native create autonomously polled")
	}
	observed, err := f.service.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || observed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || queries.Load() != 1 {
		t.Fatalf("fresh Get: %v %v queries=%d", observed, err, queries.Load())
	}
}
