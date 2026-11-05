package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestFlux3NativeVideoOriginalTaskStatesAndCredentialSeparation(t *testing.T) {
	var creates, queries, downloads atomic.Int32
	status, id := "Reasoning", "original"
	var origin string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/body" {
			downloads.Add(1)
			if r.Header.Get("x-key") != "" || r.Header.Get("Authorization") != "" {
				t.Error("control credential escaped to artifact host")
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("fixture-only-body"))
			return
		}
		if r.Header.Get("x-key") != "secret" || r.Header.Get("Authorization") != "" {
			t.Error("wrong native auth")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/gateway/v1/flux-3-video":
			creates.Add(1)
			var p map[string]any
			_ = json.NewDecoder(r.Body).Decode(&p)
			frames, _ := p["keyframes"].([]any)
			if p["mode"] != "i2v" || p["duration"] != "auto" || p["generate_audio"] != false || p["resolution"] != "fhd" || len(frames) != 2 || frames[0] != "https://media.example/first.png" || frames[1] != "https://media.example/last.png" {
				t.Errorf("native body changed intent: %+v", p)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "polling_url": origin + "/gateway/v1/get_result?id=original"})
		case "/gateway/v1/get_result":
			queries.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "status": status, "result": map[string]any{"sample": origin + "/body"}})
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	origin = server.URL
	item := func(role runtimev1.VideoContentRole, uri string) *runtimev1.VideoContentItem {
		return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: role, ImageUrl: &runtimev1.VideoContentImageURL{Url: uri}}
	}
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "boat", Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, Content: []*runtimev1.VideoContentItem{item(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME, "https://media.example/last.png"), item(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, "https://media.example/first.png")}, Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(-1), Resolution: "1080p", GenerateAudio: proto.Bool(false)}}}}}
	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	cfg := MediaAdapterConfig{BaseURL: origin + "/gateway/v1", APIKey: "secret", AllowLoopbackEndpoint: true}
	_, _, _, err := ExecuteFluxMedia(ctx, cfg, nil, "job", req, "flux-3-video")
	if !errors.Is(err, ErrNativeTaskYielded) || receipt.Model != "flux-3-video" || queries.Load() != 0 {
		t.Fatalf("no original receipt: %v", err)
	}
	for _, state := range []string{"Pending", "Reasoning", "Generating"} {
		status = state
		v, terminal, e := ObserveNativeTask(context.Background(), cfg, receipt)
		if e != nil || terminal || v != nil {
			t.Fatalf("%s not pending: %v", state, e)
		}
	}
	status = "Ready"
	id = "foreign"
	if _, _, e := ObserveNativeTask(context.Background(), cfg, receipt); e == nil {
		t.Fatal("foreign identity accepted")
	}
	id = "original"
	status = "Content Moderated"
	_, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
	reason, _ := grpcerr.ExtractReasonCode(err)
	if !terminal || reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
		t.Fatal("moderation misclassified", err)
	}
	status = "Ready"
	result, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
	if err != nil || !terminal || len(result.Artifacts) != 1 || result.Artifacts[0].DurationMs != 0 || result.Artifacts[0].Width != 0 {
		t.Fatal("unknown physical metadata invented", err)
	}
	bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, result)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range bodies {
		_, _ = io.Copy(io.Discard, b.Stream)
		_ = b.Stream.Close()
	}
	if creates.Load() != 1 || downloads.Load() != 1 || result.Artifacts[0].GetUri() != "" {
		t.Fatal("create replay or missing custody handoff")
	}
}

func TestFlux3KleinPayloadPreservesSeedZeroAndTier(t *testing.T) {
	p, err := flux3ImagePayload(context.Background(), &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", Seed: proto.Int64(0), Size: "4K"}, "flux-3-image-klein")
	if err != nil || p["seed"] != int64(0) || p["resolution"] != "4k" {
		t.Fatal(p, err)
	}
	p, err = flux3ImagePayload(context.Background(), &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", Size: "1024x768"}, "flux-3-image")
	if err != nil || p["width"] != 1024 || p["height"] != 768 {
		t.Fatal(p, err)
	}
	if _, ok := p["seed"]; ok {
		t.Fatal("absent seed invented")
	}
}
