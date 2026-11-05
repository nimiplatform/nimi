package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLumaRay32FrameGridOriginalIdentityAndNoFalseCancellation(t *testing.T) {
	creates, queries, deletes := 0, 0, 0
	state, model, kind := "queued", "ray-3.2", "video"
	var origin string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key" {
			t.Error("native auth missing")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodDelete {
			deletes++
			t.Error("finished resource delete used as cancel")
			return
		}
		switch r.URL.Path {
		case "/gateway/v1/generations":
			creates++
			var p map[string]any
			_ = json.NewDecoder(r.Body).Decode(&p)
			v := p["video"].(map[string]any)
			frames := v["keyframes"].([]any)
			positions := v["keyframe_indexes"].([]any)
			if p["model"] != "ray-3.2" || p["type"] != "video" || v["duration"] != "10s" || len(frames) != 2 || positions[0] != float64(0) || positions[1] != float64(240) || frames[0].(map[string]any)["url"] != "https://media.example/first.png" || frames[1].(map[string]any)["url"] != "https://media.example/last.png" {
				t.Error("role or native frame grid changed")
			}
			if _, ok := v["start_frame"]; ok {
				t.Error("mixed anchor protocols")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "model": "ray-3.2", "type": "video", "state": "queued"})
		case "/gateway/v1/generations/original":
			queries++
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "model": model, "type": kind, "state": state, "output": []any{map[string]any{"type": "video", "url": origin + "/video"}}})
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	origin = server.URL
	imageItem := func(role runtimev1.VideoContentRole, uri string) *runtimev1.VideoContentItem {
		return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: role, ImageUrl: &runtimev1.VideoContentImageURL{Url: uri}}
	}
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "boat", Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, Content: []*runtimev1.VideoContentItem{imageItem(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME, "https://media.example/last.png"), imageItem(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, "https://media.example/first.png")}, Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(10)}}}}}
	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	cfg := MediaAdapterConfig{BaseURL: origin + "/gateway/v1", APIKey: "key", AllowLoopbackEndpoint: true}
	_, _, _, err := ExecuteLumaRay32(ctx, cfg, req)
	if !errors.Is(err, ErrNativeTaskYielded) || queries != 0 {
		t.Fatal(err)
	}
	if _, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt); terminal || err != nil {
		t.Fatal("queued", err)
	}
	state = "completed"
	model = "ray-2"
	if _, _, err := ObserveNativeTask(context.Background(), cfg, receipt); err == nil {
		t.Fatal("model mismatch accepted")
	}
	model = "ray-3.2"
	kind = "video_edit"
	if _, _, err := ObserveNativeTask(context.Background(), cfg, receipt); err == nil {
		t.Fatal("operation mismatch accepted")
	}
	kind = "video"
	result, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
	if err != nil || !terminal || len(result.Artifacts) != 1 || result.Artifacts[0].GetDurationMs() != 0 {
		t.Fatal(result, err)
	}
	outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterLumaRay32, receipt.TaskID, cfg)
	if err != nil || outcome != ProviderTaskCleanupNotCancelable || deletes != 0 || creates != 1 {
		t.Fatal("false cancel or recreation", outcome, err)
	}
}
