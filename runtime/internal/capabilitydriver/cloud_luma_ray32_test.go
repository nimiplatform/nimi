package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestLumaRay32ExactAdapterAndDefaultFrameGrid(t *testing.T) {
	d, target := cloudMediaDriverTarget(t, "luma", LumaRay32Model, "video.generate")
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "boat", Mode: runtimev1.VideoMode_VIDEO_MODE_T2V}}}}
	mapped, err := d.MapRequest(target, req, nil, CloudMediaStreamNone)
	if err != nil {
		t.Fatal(err)
	}
	if mapped.Adapter() != CloudMediaAdapterLumaRay32 || mapped.Request().GetSpec().GetVideoGenerate().GetOptions().GetDurationSec() != 5 || req.GetSpec().GetVideoGenerate().Options != nil {
		t.Fatal("wrong adapter or mutable default capture")
	}
	for name, mutate := range map[string]func(*runtimev1.VideoGenerateScenarioSpec){
		"automatic":   func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.DurationSec = proto.Int32(-1) },
		"seed zero":   func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Seed = proto.Int64(0) },
		"audio false": func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.GenerateAudio = proto.Bool(false) },
		"draft false": func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Draft = proto.Bool(false) },
		"4k":          func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Resolution = "4k" },
		"reference":   func(s *runtimev1.VideoGenerateScenarioSpec) { s.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE },
	} {
		t.Run(name, func(t *testing.T) {
			r := mapped.Request()
			mutate(r.GetSpec().GetVideoGenerate())
			if _, err := d.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("unsupported input admitted")
			}
		})
	}
}
