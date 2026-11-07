package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestSeedreamExactSizesAndUnsupportedControls(t *testing.T) {
	for _, model := range []string{Seedream5ProModel, Seedream5FlashModel, Seedream5Model, Seedream45Model} {
		req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "  Keep the original prompt.\n"}}}}
		if err := validateSeedreamImageRequest(req, model); err != nil {
			t.Fatal(err)
		}
		s := req.GetSpec().GetImageGenerate()
		if s.GetSize() != "2K" || s.GetN() != 1 || s.GetOutputFormat() != "jpeg" || s.GetResponseFormat() != "b64_json" || s.GetPrompt() != "  Keep the original prompt.\n" {
			t.Fatal("captured defaults or text lost")
		}
		for name, change := range map[string]func(*runtimev1.ImageGenerateScenarioSpec){
			"small size":         func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "512x512" },
			"auto is layer-only": func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "auto" },
			"seed zero":          func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(0) },
			"mask":               func(s *runtimev1.ImageGenerateScenarioSpec) { s.Mask = "https://example.test/mask.png" },
			"negative":           func(s *runtimev1.ImageGenerateScenarioSpec) { s.NegativePrompt = "letters" },
			"ratio":              func(s *runtimev1.ImageGenerateScenarioSpec) { s.AspectRatio = "16:9" },
			"style":              func(s *runtimev1.ImageGenerateScenarioSpec) { s.Style = "natural" },
			"quality":            func(s *runtimev1.ImageGenerateScenarioSpec) { s.Quality = "high" },
			"group":              func(s *runtimev1.ImageGenerateScenarioSpec) { s.N = proto.Int32(2) },
		} {
			copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
			change(copy.GetSpec().GetImageGenerate())
			if validateSeedreamImageRequest(copy, model) == nil {
				t.Fatal("ignored control accepted", model, name)
			}
		}
		for _, size := range []string{"1K", "1.5K", "3K", "4K", "1024x1024", "2048x1024", "1920x1920"} {
			copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
			copy.GetSpec().GetImageGenerate().Size = size
			valid := size == "1920x1920" || SeedreamProFlash(model) && (size == "1K" || size == "1.5K" || size == "1024x1024" || size == "2048x1024") || model == Seedream5Model && (size == "3K" || size == "4K") || model == Seedream45Model && size == "4K"
			if err := validateSeedreamImageRequest(copy, model); (err == nil) != valid {
				t.Fatal("size cohort", model, size, err)
			}
		}
	}
}
