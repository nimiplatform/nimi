package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestAlibabaCurrentNativePayloadPreservesControlsAndGateway(t *testing.T) {
	var body map[string]any
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.EscapedPath() != "/gateway%2Ftenant/api/v1/services/aigc/video-generation/video-synthesis" || r.URL.RawQuery != "route=tenant%2Fa/" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("X-DashScope-Async") != "enable" {
			t.Errorf("changed native target: %s", r.URL)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	spec := &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
		Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO, VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://media.example.test/clip.mp4"}}, {Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://media.example.test/voice.wav"}}},
		Options: &runtimev1.VideoGenerationOptions{Resolution: "480p", DurationSec: proto.Int32(-1), Seed: proto.Int64(0), Watermark: proto.Bool(false), GenerateAudio: proto.Bool(false)}}
	ctx := WithNativeTaskPublisher(context.Background(), func(*NativeTaskReceipt) error { t.Error("failed creation published a receipt"); return nil })
	_, _, _, err := ExecuteAlibabaNative(ctx, MediaAdapterConfig{BaseURL: server.URL + "/gateway%2Ftenant/compatible-mode/v1?route=tenant%2Fa/", APIKey: "test-key", AllowLoopbackEndpoint: true}, noopGeminiJobUpdater{}, "job", &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: spec}}}, "wan3.0-video")
	want := map[string]any{"model": "wan3.0-video", "input": map[string]any{"media": []any{map[string]any{"type": "reference_video", "url": "https://media.example.test/clip.mp4"}, map[string]any{"type": "reference_audio", "url": "https://media.example.test/voice.wav"}}}, "parameters": map[string]any{"resolution": "480P", "duration": float64(-1), "seed": float64(0), "watermark": false, "audio": false}}
	if err == nil || calls != 1 || !reflect.DeepEqual(body, want) {
		t.Fatalf("calls=%d payload=%+v err=%v", calls, body, err)
	}
}

func TestJoinURLKeepsEscapedPathAndQuery(t *testing.T) {
	for _, tc := range [][3]string{
		{"https://example.test/gateway%2Ftenant/v1?route=a/", "/tasks/one%2Ftwo?view=brief", "https://example.test/gateway%2Ftenant/v1/tasks/one%2Ftwo?route=a/&view=brief"},
		{"https://example.test/v1/", "/tasks", "https://example.test/v1/tasks"},
		{"https://example.test/v1?route=a", "https://other.example.test/result?x=1", "https://other.example.test/result?x=1"},
	} {
		if got := JoinURL(tc[0], tc[1]); got != tc[2] {
			t.Errorf("JoinURL=%s want %s", got, tc[2])
		}
	}
}
