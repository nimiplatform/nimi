package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestDashscopeZImageAdmission(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "dashscope", DashscopeZImageTurbo, "image.generate")
	for _, spec := range []*runtimev1.ImageGenerateScenarioSpec{
		{Prompt: "cube", Size: "2304x1024"}, {Prompt: "cube", N: testInt32(1)}, {Prompt: "cube", Size: "1024x1024", Seed: testInt64(0), ResponseFormat: "url"},
	} {
		if _, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone); err != nil {
			t.Fatal(err)
		}
	}
	for _, spec := range []*runtimev1.ImageGenerateScenarioSpec{
		{Prompt: "cube", ReferenceImageArtifactId: "artifact"}, {Prompt: "cube", Mask: "mask"}, {Prompt: "cube", NegativePrompt: "glare"},
		{Prompt: "cube", N: testInt32(2)}, {Prompt: "cube", Size: "511x512"}, {Prompt: "cube", Size: "2048x2049"},
		{Prompt: "cube", Seed: testInt64(2147483648)}, {Prompt: "cube", ResponseFormat: "b64_json"},
	} {
		_, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("accepted unsupported spec %v: %v", spec, err)
		}
	}
}
