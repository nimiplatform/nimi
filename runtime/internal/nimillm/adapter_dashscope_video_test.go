package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func wanFrame(role runtimev1.VideoContentRole, location string) *runtimev1.VideoContentItem {
	return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: role, ImageUrl: &runtimev1.VideoContentImageURL{Url: location}}
}

func wanFirstFrameSpec() *runtimev1.VideoGenerateScenarioSpec {
	return &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, Prompt: "A gentle pan.",
		Content: []*runtimev1.VideoContentItem{wanFrame(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, "https://media.example.test/first.png")}}
}

func TestWan27ImageVideoUsesNativeMediaThroughProductionAdapter(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/aigc/video-generation/video-synthesis" || r.Header.Get("X-DashScope-Async") != "enable" {
			t.Errorf("unexpected video transport: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		// Stop after recording the request; this test does not fabricate a video.
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	spec := wanFirstFrameSpec()
	zero, off := int64(0), false
	spec.Options = &runtimev1.VideoGenerationOptions{Resolution: "720p", DurationSec: testInt32(4), Seed: &zero, Watermark: &off}
	_, _, _, err := ExecuteAlibabaNative(WithNativeTaskPublisher(context.Background(), func(*NativeTaskReceipt) error {
		t.Error("unauthorized create unexpectedly published receipt")
		return context.Canceled
	}), MediaAdapterConfig{BaseURL: server.URL + "/compatible-mode/v1", APIKey: "test-key", AllowLoopbackEndpoint: true}, noopGeminiJobUpdater{}, "job", &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: spec}},
	}, "wan2.7-i2v")
	want := map[string]any{"model": "wan2.7-i2v", "input": map[string]any{"prompt": "A gentle pan.", "media": []any{map[string]any{"type": "first_frame", "url": "https://media.example.test/first.png"}}},
		"parameters": map[string]any{"resolution": "720P", "duration": float64(4), "seed": float64(0), "watermark": false}}
	if err == nil || !reflect.DeepEqual(body, want) {
		t.Fatalf("native first-frame wire=%+v err=%v", body, err)
	}
}

func TestWan27ImageVideoRoleAndOptionBoundaries(t *testing.T) {
	spec := wanFirstFrameSpec()
	spec.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST
	spec.Content = append(spec.Content, wanFrame(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME, "https://media.example.test/last.png"), &runtimev1.VideoContentItem{
		Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://media.example.test/speech.wav"},
	})
	body, err := buildWan27ImageVideoPayload("wan2.7-i2v", spec)
	if err != nil {
		t.Fatal(err)
	}
	media := body["input"].(map[string]any)["media"].([]map[string]any)
	if len(media) != 3 || media[0]["type"] != "first_frame" || media[1]["type"] != "last_frame" || media[2]["type"] != "driving_audio" || len(body["parameters"].(map[string]any)) != 0 {
		t.Fatalf("role mapping or omitted defaults changed: %+v", body)
	}
	for _, mutate := range []func(*runtimev1.VideoGenerateScenarioSpec){
		func(s *runtimev1.VideoGenerateScenarioSpec) { s.Mode = runtimev1.VideoMode_VIDEO_MODE_T2V },
		func(s *runtimev1.VideoGenerateScenarioSpec) { s.Content = nil },
		func(s *runtimev1.VideoGenerateScenarioSpec) { s.Content = append(s.Content, s.Content[0]) },
		func(s *runtimev1.VideoGenerateScenarioSpec) { s.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST },
		func(s *runtimev1.VideoGenerateScenarioSpec) {
			s.Content = append(s.Content, wanFrame(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME, "https://media.example.test/last.png"))
		},
	} {
		s := wanFirstFrameSpec()
		mutate(s)
		if _, err := buildWan27ImageVideoPayload("wan2.7-i2v", s); err == nil {
			t.Fatal("invalid mode/role combination admitted")
		}
	}
	for _, audio := range []bool{false, true} {
		s := wanFirstFrameSpec()
		s.Options = &runtimev1.VideoGenerationOptions{GenerateAudio: &audio}
		_, err := buildWan27ImageVideoPayload("wan2.7-i2v", s)
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("unsupported audio toggle ignored: %v", err)
		}
	}
}
