package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func TestGoogleVeoDriverAdmitsOnlyExactFastTextVideo(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "google_veo", "veo-3.1-fast-generate-preview", "video.generate")
	request := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Mode:    runtimev1.VideoMode_VIDEO_MODE_T2V,
			Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A sunrise."}},
			Options: &runtimev1.VideoGenerationOptions{Resolution: "720p", Ratio: "16:9", DurationSec: testInt32(4)},
		}}},
	}
	if _, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone); err != nil {
		t.Fatalf("exact Fast text-video request rejected: %v", err)
	}
	for _, model := range []string{googleVeoStandardTextVideoModel, googleVeoLiteTextVideoModel} {
		driver, target := cloudMediaDriverTarget(t, "google_veo", model, "video.generate")
		if _, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone); err != nil {
			t.Fatalf("exact %s text-video request rejected: %v", model, err)
		}
	}
	if admittedGoogleVeoTextVideoModel("veo-3.0-generate-001") || admittedGoogleVeoTextVideoModel("veo-3.1-generate") {
		t.Fatal("retired or invented Veo model was admitted")
	}
	cases := []struct {
		name   string
		mutate func(*runtimev1.VideoGenerateScenarioSpec)
	}{
		{"other duration", func(spec *runtimev1.VideoGenerateScenarioSpec) { spec.Options.DurationSec = testInt32(8) }},
		{"other resolution", func(spec *runtimev1.VideoGenerateScenarioSpec) { spec.Options.Resolution = "1080p" }},
		{"native audio control", func(spec *runtimev1.VideoGenerateScenarioSpec) { spec.Options.GenerateAudio = testBool(false) }},
		{"image content", func(spec *runtimev1.VideoGenerateScenarioSpec) {
			spec.Content = append(spec.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL})
		}},
		{"negative prompt", func(spec *runtimev1.VideoGenerateScenarioSpec) { spec.NegativePrompt = "rain" }},
		{"other mode", func(spec *runtimev1.VideoGenerateScenarioSpec) {
			spec.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clone := proto.Clone(request.GetSpec().GetVideoGenerate()).(*runtimev1.VideoGenerateScenarioSpec)
			tc.mutate(clone)
			candidate := &runtimev1.SubmitScenarioJobRequest{ScenarioType: request.GetScenarioType(), Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: clone}}}
			_, err := driver.MapRequest(target, candidate, nil, CloudMediaStreamNone)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
				t.Fatalf("unsupported Google Veo request reason=%v ok=%v err=%v", reason, ok, err)
			}
		})
	}
}
