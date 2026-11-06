package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestAzureImagesUseIndependentNativeAdmission(t *testing.T) {
	for _, model := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-1.5"} {
		driver, target := cloudMediaDriverTarget(t, "azure", model, "image.generate")
		for _, spec := range []*runtimev1.ImageGenerateScenarioSpec{
			{Prompt: "A boat", OutputFormat: "png", Size: "1024x1024", Quality: "high"},
			{Prompt: "Edit the boat", OutputFormat: "jpeg", ReferenceImageArtifactId: "source"},
			{Prompt: "Edit the marked region", ReferenceImageArtifactId: "source", MaskArtifactId: "mask"},
			{Prompt: "Edit the boat", ReferenceImages: []string{"https://example.com/source.png"}},
		} {
			r := openAIImageTestRequest(nil)
			r.Spec.Spec = &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}
			mapped, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone)
			if err != nil || mapped.Adapter() != CloudMediaAdapterOpenAIImages || mapped.ProviderModelID() != model {
				t.Fatalf("%s: %v", model, err)
			}
		}
		for _, spec := range []*runtimev1.ImageGenerateScenarioSpec{
			{Prompt: "boat", OutputFormat: "svg"}, {Prompt: "boat", OutputFormat: "gif"}, {Prompt: "boat", OutputFormat: "webp"},
			{Prompt: "boat", Complexity: "high"}, {Prompt: "boat", FrameCount: proto.Int32(9)},
			{Prompt: "boat", ReferenceImageArtifactId: "source", MarkupArtifactId: "markup"},
			{Prompt: "boat", MaskArtifactId: "mask"}, {Prompt: "boat", Seed: proto.Int64(0)},
			{Prompt: "boat", NegativePrompt: "people"}, {Prompt: "boat", ResponseFormat: "url"},
			{Prompt: "boat", AspectRatio: "16:9"}, {Prompt: "boat", Style: "vivid"},
			{Prompt: "boat", Strength: proto.Float32(0.5)}, {Prompt: strings.Repeat("船", 32001)},
		} {
			r := openAIImageTestRequest(nil)
			r.Spec.Spec = &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}
			if _, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
				t.Fatalf("%s admitted unsupported controls: %v", model, spec)
			}
		}
		r := openAIImageTestRequest(func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size, s.Quality = "3840x2160", "max" })
		_, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone)
		if (err == nil) != (model != "gpt-image-1.5") {
			t.Fatalf("%s custom size/quality: %v", model, err)
		}
	}
	if SupportsGPTImageOwnedInputs("azure", "gpt-image-2.6-flare") || SupportsGPTImageOwnedInputs("openai", "gpt-image-1.5") {
		t.Fatal("unreviewed provider/model combination inherited image controls")
	}
}
