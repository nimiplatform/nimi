package capabilitydriver

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func geminiImageRequest(spec *runtimev1.ImageGenerateScenarioSpec) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}},
	}
}

func TestGeminiImageMapRequestAdmitsOnlyVerifiedCombinations(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-3.1-flash-image", "image.generate")
	for name, spec := range map[string]*runtimev1.ImageGenerateScenarioSpec{
		"prompt":            {Prompt: "a red apple"},
		"aspect ratio":      {Prompt: "a red apple", AspectRatio: "16:9"},
		"reference edit":    {Prompt: "make it green", ReferenceImages: []string{"https://example.com/apple.png"}},
		"single image":      {Prompt: "a red apple", N: testInt32(1), ResponseFormat: "b64_json"},
		"base64 alias":      {Prompt: "a red apple", ResponseFormat: "base64"},
		"unset image count": {Prompt: "a red apple", N: testInt32(0)},
	} {
		mapped, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone)
		if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiOperation || mapped.ProviderModelID() != "gemini-3.1-flash-image" {
			t.Fatalf("%s: mapped=%+v err=%v", name, mapped, err)
		}
	}

	references := make([]string, geminiImageMaxReferenceImages+1)
	for index := range references {
		references[index] = "https://example.com/reference.png"
	}
	for name, spec := range map[string]*runtimev1.ImageGenerateScenarioSpec{
		"multiple images":     {Prompt: "a red apple", N: testInt32(2)},
		"pixel size":          {Prompt: "a red apple", Size: "1920x1080"},
		"seed":                {Prompt: "a red apple", Seed: testInt64(7)},
		"negative prompt":     {Prompt: "a red apple", NegativePrompt: "blur"},
		"quality":             {Prompt: "a red apple", Quality: "hd"},
		"style":               {Prompt: "a red apple", Style: "vivid"},
		"mask":                {Prompt: "a red apple", ReferenceImages: []string{"https://example.com/apple.png"}, Mask: "https://example.com/mask.png"},
		"url output":          {Prompt: "a red apple", ResponseFormat: "url"},
		"undocumented ratio":  {Prompt: "a red apple", AspectRatio: "10:7"},
		"too many references": {Prompt: "combine", ReferenceImages: references},
	} {
		_, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("%s must fail typed before dispatch: reason=%v ok=%v err=%v", name, reason, ok, err)
		}
	}
}

func TestGeminiImageMapRequestRejectsTargetsWithoutAdmittedContract(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-2.5-flash-image", "image.generate")
	_, err := driver.MapRequest(target, geminiImageRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "a red apple"}), nil, CloudMediaStreamNone)
	var invocationErr *CloudInvocationError
	if !errors.As(err, &invocationErr) || invocationErr.Kind != CloudInvocationFailureTarget {
		t.Fatalf("unadmitted Gemini image target must fail as target configuration: %v", err)
	}
}

func TestGeminiFlashLiteImageAdmitsOnlyItsDocumentedRatiosAndDefaultOneK(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-3.1-flash-lite-image", "image.generate")
	for _, spec := range []*runtimev1.ImageGenerateScenarioSpec{
		{Prompt: "a blue square"},
		{Prompt: "a blue square", AspectRatio: "16:9"},
		{Prompt: "make the square green", ReferenceImages: []string{"https://example.com/square.jpg"}},
	} {
		mapped, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone)
		if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiOperation || mapped.ProviderModelID() != "gemini-3.1-flash-lite-image" {
			t.Fatalf("Flash Lite valid combination rejected: mapped=%+v err=%v", mapped, err)
		}
	}
	for _, spec := range []*runtimev1.ImageGenerateScenarioSpec{
		{Prompt: "a blue square", AspectRatio: "1:4"},
		{Prompt: "a blue square", Size: "2048x2048"},
		{Prompt: "a blue square", N: testInt32(2)},
	} {
		_, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("Flash Lite unsupported combination reason=%v present=%v err=%v", reason, ok, err)
		}
	}
}
