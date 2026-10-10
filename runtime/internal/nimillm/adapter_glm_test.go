package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteGLMTaskYieldsOriginalReceiptBeforeObservation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/paas/v4/videos/generations":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "glm-task-1"})
		case r.Method == http.MethodGet && r.URL.Path == "/api/paas/v4/async-result/glm-task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "queued"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })

	_, _, providerJobID, err := ExecuteGLMTask(
		ctx,
		MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "glm-key"},
		noopJobStateUpdater{},
		"job-glm-video-cancel",
		newAsyncVideoJobRequest("A short GLM scene."),
		"glm-video-model",
		func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct { return nil },
	)
	if providerJobID != "glm-task-1" {
		t.Fatalf("unexpected provider job id: %q", providerJobID)
	}
	if !errors.Is(err, ErrNativeTaskYielded) {
		t.Fatalf("create did not yield receipt: %v", err)
	}
	cfg := MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "glm-key"}
	if _, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt); err != nil || terminal {
		t.Fatalf("pending Get: terminal=%v err=%v", terminal, err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, terminal, err := ObserveNativeTask(canceled, cfg, receipt); err == nil || terminal {
		t.Fatalf("caller cancellation must not prove provider terminal: %v %v", terminal, err)
	}
}

func newAsyncVideoJobRequest(prompt string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.test",
			SubjectUserId: "user-1",
			TimeoutMs:     int32((5 * time.Second) / time.Millisecond),
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
					Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
					Content: []*runtimev1.VideoContentItem{
						{
							Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
							Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
							Text: prompt,
						},
					},
					Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4)},
				},
			},
		},
	}
}
