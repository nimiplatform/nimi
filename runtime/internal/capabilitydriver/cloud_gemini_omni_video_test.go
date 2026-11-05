package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func TestGeminiOmniVideoAdmitsExactModesAndControls(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", GeminiOmniVideoModel, "video.generate")
	for _, mode := range []runtimev1.VideoMode{runtimev1.VideoMode_VIDEO_MODE_T2V, runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE} {
		t.Run(mode.String(), func(t *testing.T) {
			spec := &runtimev1.VideoGenerateScenarioSpec{Mode: mode, Prompt: "A toy boat on a pond.", Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4), Resolution: "720p", Ratio: "16:9"}}
			image := func(role runtimev1.VideoContentRole) {
				spec.Content = append(spec.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: role, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/boat.png"}})
			}
			switch mode {
			case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
				image(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME)
			case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
				image(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME)
				image(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME)
			case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
				image(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE)
			}
			request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: spec}}}
			mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
			if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiOmniVideo {
				t.Fatalf("map = %+v, %v", mapped, err)
			}
			if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE {
				tooMany := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
				for len(tooMany.GetSpec().GetVideoGenerate().Content) < 7 {
					tooMany.GetSpec().GetVideoGenerate().Content = append(tooMany.GetSpec().GetVideoGenerate().Content, proto.Clone(spec.Content[0]).(*runtimev1.VideoContentItem))
				}
				if _, err := driver.MapRequest(target, tooMany, nil, CloudMediaStreamNone); err == nil {
					t.Fatal("seven references admitted")
				}
			}
			for _, mutate := range []func(*runtimev1.VideoGenerateScenarioSpec){
				func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.DurationSec = testInt32(11) },
				func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Ratio = "1:1" },
				func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Resolution = "8k" },
				func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Seed = testInt64(0) },
				func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.GenerateAudio = testBool(false) },
				func(s *runtimev1.VideoGenerateScenarioSpec) { s.NegativePrompt = "ignore" },
			} {
				invalid := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
				mutate(invalid.GetSpec().GetVideoGenerate())
				if _, err := driver.MapRequest(target, invalid, nil, CloudMediaStreamNone); err == nil {
					t.Fatal("unsupported control was ignored")
				}
			}
		})
	}
	if ResolveCloudMediaAdapter("google_veo", "video.generate") != "" {
		t.Fatal("retired Veo Driver still admitted")
	}
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A pond."}}}}
	if err := validateGeminiOmniVideoRequest(request, "gemini-omni-flash-preview"); err == nil {
		t.Fatal("retired preview admitted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatal(err)
	}
}
