package ai

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

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
