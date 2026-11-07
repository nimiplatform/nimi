package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestRunwayModeSpecificControlsAndUTF16Budget(t *testing.T) {
	for _, tc := range []struct {
		name, model, prompt, ratio string
		mode                       runtimev1.VideoMode
		bad                        bool
	}{
		{"1000-units", "gen4.5", strings.Repeat("😀", 500), "1280:720", runtimev1.VideoMode_VIDEO_MODE_T2V, false},
		{"1002-units", "gen4.5", strings.Repeat("😀", 501), "1280:720", runtimev1.VideoMode_VIDEO_MODE_T2V, true},
		{"square-text-not-supported", "gen4.5", "cup", "960:960", runtimev1.VideoMode_VIDEO_MODE_T2V, true},
		{"square-image", "gen4.5", "cup", "960:960", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, false},
		{"turbo-image-only", "gen4_turbo", "", "1280:720", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, false},
		{"turbo-not-text", "gen4_turbo", "cup", "1280:720", runtimev1.VideoMode_VIDEO_MODE_T2V, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			driver, target := cloudMediaDriverTarget(t, "runway", tc.model, "video.generate")
			s := &runtimev1.VideoGenerateScenarioSpec{Mode: tc.mode, Prompt: tc.prompt, Options: &runtimev1.VideoGenerationOptions{Ratio: tc.ratio, Seed: proto.Int64(0)}}
			if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
				s.Content = []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/source.png"}}}
			}
			req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: s}}}
			mapped, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone)
			if (err != nil) != tc.bad {
				t.Fatal(mapped, err)
			}
			if !tc.bad {
				got := mapped.Request().GetSpec().GetVideoGenerate()
				if tc.model == "gen4.5" && got.Options.GetDurationSec() != 5 || tc.model == "gen4_turbo" && got.Options.DurationSec != nil || got.Options.Seed == nil || got.Options.GetSeed() != 0 {
					t.Fatal("default or explicit zero lost", got)
				}
			}
		})
	}
}
