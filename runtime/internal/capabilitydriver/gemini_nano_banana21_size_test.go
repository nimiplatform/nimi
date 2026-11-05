package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestNanoBanana21NativeResolutionTiers(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-nano-banana-2.1", "image.generate")
	for _, size := range []string{"", "1K", "2K", "4K"} {
		spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "panoramic lake", Size: size, AspectRatio: "8:1"}
		if _, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone); err != nil {
			t.Fatal(err)
		}
		native, err := GeminiNanoBanana21ImageSize(spec)
		if err != nil || native != size {
			t.Fatalf("native tier %q %v", native, err)
		}
	}
	for _, size := range []string{"512", "1920x1080", "2048x2048", "8K"} {
		spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "mug", Size: size}
		if _, err := driver.MapRequest(target, geminiImageRequest(spec), nil, CloudMediaStreamNone); err == nil {
			t.Fatal("unreviewed resolution admitted")
		}
	}
}
