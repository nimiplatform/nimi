package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestLumaUniImageCapturesFormatAndEditControls(t *testing.T) {
	for _, model := range []string{"uni-1", "uni-1-max"} {
		d, target := cloudMediaDriverTarget(t, "luma", model, "image.generate")
		request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "a cup"}}}}
		mapped, err := d.MapRequest(target, request, nil, CloudMediaStreamNone)
		if err != nil || mapped.Adapter() != CloudMediaAdapterLumaUniImage || mapped.Request().GetSpec().GetImageGenerate().GetOutputFormat() != "png" || request.GetSpec().GetImageGenerate().GetOutputFormat() != "" {
			t.Fatalf("default capture: %v %v", mapped, err)
		}
		for name, change := range map[string]func(*runtimev1.ImageGenerateScenarioSpec){
			"seed":            func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(0) },
			"mask":            func(s *runtimev1.ImageGenerateScenarioSpec) { s.Mask = "https://media.example/mask.png" },
			"complexity":      func(s *runtimev1.ImageGenerateScenarioSpec) { s.Complexity = "low" },
			"webp":            func(s *runtimev1.ImageGenerateScenarioSpec) { s.OutputFormat = "webp" },
			"manga landscape": func(s *runtimev1.ImageGenerateScenarioSpec) { s.Style = "manga"; s.AspectRatio = "16:9" },
			"edit ratio": func(s *runtimev1.ImageGenerateScenarioSpec) {
				s.ReferenceImageArtifactId = "source"
				s.AspectRatio = "1:1"
			},
			"mixed sources": func(s *runtimev1.ImageGenerateScenarioSpec) {
				s.ReferenceImageArtifactId = "source"
				s.ReferenceImages = []string{"https://media.example/source.png"}
			},
		} {
			r := mapped.Request()
			change(r.GetSpec().GetImageGenerate())
			if _, err := d.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
				t.Fatalf("%s accepted", name)
			}
		}
		r := mapped.Request()
		s := r.GetSpec().GetImageGenerate()
		s.Style = "manga"
		s.ReferenceImageArtifactId = "source"
		s.OutputFormat = "jpeg"
		if _, err := d.MapRequest(target, r, nil, CloudMediaStreamNone); err != nil {
			t.Fatal("source-derived manga edit rejected", err)
		}
	}
}
