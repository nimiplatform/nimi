package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestIdeogramPromptTargetsRejectUnmappedInputsBeforeDispatch(t *testing.T) {
	for _, model := range []string{"ideogram-v3", "ideogram-v2-turbo"} {
		driver, target := cloudMediaDriverTarget(t, "ideogram", model, "image.generate")
		base := &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat", AspectRatio: "16:9", Style: "realistic", Seed: proto.Int64(0)}
		mapRequest := func(spec *runtimev1.ImageGenerateScenarioSpec) error {
			_, err := driver.MapRequest(target, &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}}}, nil, CloudMediaStreamNone)
			return err
		}
		if err := mapRequest(base); err != nil {
			t.Fatal(err)
		}
		for _, mutate := range []func(*runtimev1.ImageGenerateScenarioSpec){
			func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(-1) },
			func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(2147483648) },
			func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "1024x1024" },
			func(s *runtimev1.ImageGenerateScenarioSpec) { s.Quality = "high" },
			func(s *runtimev1.ImageGenerateScenarioSpec) { s.N = proto.Int32(2) },
			func(s *runtimev1.ImageGenerateScenarioSpec) {
				s.ReferenceImages = []string{"https://media.example/source.png"}
			},
			func(s *runtimev1.ImageGenerateScenarioSpec) { s.AspectRatio = "ASPECT_16_9" },
		} {
			spec := proto.Clone(base).(*runtimev1.ImageGenerateScenarioSpec)
			mutate(spec)
			if err := mapRequest(spec); err == nil {
				t.Fatalf("unmapped input accepted for %s: %v", model, spec)
			}
		}
	}
}
