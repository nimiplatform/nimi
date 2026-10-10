package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestNativeCreateRequiresReceiptIdentityBeforeAnyBodyAcquisition(t *testing.T) {
	image := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup"}}}}
	video := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "pan", Mode: runtimev1.VideoMode_VIDEO_MODE_T2V}}}}
	type execute func(context.Context, MediaAdapterConfig, JobStateUpdater, string, *runtimev1.SubmitScenarioJobRequest, string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error)
	cases := []struct {
		name, model string
		request     *runtimev1.SubmitScenarioJobRequest
		run         execute
	}{
		{"flux", "flux-pro", image, ExecuteFluxImage},
		{"luma", "ray", video, ExecuteLumaTask},
		{"runway", "gen", video, ExecuteRunwayTask},
		{"pika", "pika", video, ExecutePikaTask},
		{"kling-image", "kling", image, ExecuteKlingTask},
		{"kling-video", "kling", video, ExecuteKlingTask},
		{"alibaba-image", "wan2.6-t2i", image, ExecuteAlibabaNative},
		{"ark-video", "seedance", video, ExecuteBytedanceARKTask},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var creates, bodies, publishes atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					bodies.Add(1)
					w.Write([]byte("not a valid body"))
					return
				}
				creates.Add(1)
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"url": endpoint + "/body"}, "output": map[string]any{"url": endpoint + "/body"}})
			}))
			defer server.Close()
			endpoint = server.URL
			cfg := MediaAdapterConfig{BaseURL: endpoint, APIKey: "key", AllowLoopbackEndpoint: true}
			if _, _, _, err := tc.run(context.Background(), cfg, noopJobStateUpdater{}, "job", tc.request, tc.model); err == nil || creates.Load() != 0 {
				t.Fatalf("unowned native create dispatched: %v calls=%d", err, creates.Load())
			}
			ctx := WithNativeTaskPublisher(context.Background(), func(*NativeTaskReceipt) error { publishes.Add(1); return nil })
			artifacts, _, _, err := tc.run(ctx, cfg, noopJobStateUpdater{}, "job", tc.request, tc.model)
			if err == nil || len(artifacts) != 0 || creates.Load() != 1 || bodies.Load() != 0 || publishes.Load() != 0 {
				t.Fatalf("missing identity became result: artifacts=%d err=%v creates=%d bodies=%d receipts=%d", len(artifacts), err, creates.Load(), bodies.Load(), publishes.Load())
			}
		})
	}
}
