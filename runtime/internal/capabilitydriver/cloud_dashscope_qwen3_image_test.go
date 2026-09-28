package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestDashscopeQwen3ImageAdmitsOnlyTextAndOneHTTPSReference(t *testing.T) {
	for _, model := range []string{dashscopeQwen3ImageModel, dashscopeQwen3ImageProModel} {
		driver, target := cloudMediaDriverTarget(t, "dashscope", model, "image.generate")
		for name, spec := range map[string]*runtimev1.ImageGenerateScenarioSpec{
			"text":         {Prompt: "a red apple"},
			"reference":    {Prompt: "make it green", ReferenceImages: []string{"https://example.com/apple.png"}},
			"explicit one": {Prompt: "a red apple", N: testInt32(1), ResponseFormat: "url"},
		} {
			mapped, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone)
			if err != nil || mapped.Adapter() != CloudMediaAdapterAlibabaNative || mapped.ProviderModelID() != model {
				t.Fatalf("%s/%s: mapped=%+v err=%v", model, name, mapped, err)
			}
		}
		for name, spec := range map[string]*runtimev1.ImageGenerateScenarioSpec{
			"two images":       {Prompt: "a red apple", N: testInt32(2)},
			"second reference": {Prompt: "combine", ReferenceImages: []string{"https://example.com/a.png", "https://example.com/b.png"}},
			"HTTP reference":   {Prompt: "edit", ReferenceImages: []string{"http://example.com/a.png"}},
			"size":             {Prompt: "a red apple", Size: "1024x1024"},
			"seed":             {Prompt: "a red apple", Seed: testInt64(7)},
			"mask":             {Prompt: "edit", ReferenceImages: []string{"https://example.com/a.png"}, Mask: "https://example.com/mask.png"},
			"base64 response":  {Prompt: "a red apple", ResponseFormat: "b64_json"},
		} {
			_, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
				t.Fatalf("%s/%s must fail typed before dispatch: reason=%v present=%v err=%v", model, name, reason, ok, err)
			}
		}
	}
}
