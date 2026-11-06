package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestKlingVideoControlsDoNotCrossVersionOrMode(t *testing.T) {
	for _, tc := range []struct {
		model string
		s     *runtimev1.VideoGenerateScenarioSpec
	}{
		{"kling-4.0-flash", &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "cup", Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(21)}}},
		{"kling-4.0", &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "cup", Options: &runtimev1.VideoGenerationOptions{Resolution: "4k"}}},
		{"kling-4.0", &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "cup", NegativePrompt: "dark"}},
		{"kling-4.0", &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, Prompt: "cup", Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: "owned"}}}, Options: &runtimev1.VideoGenerationOptions{Ratio: "16:9"}}},
	} {
		driver, target := cloudMediaDriverTarget(t, "kling", tc.model, "video.generate")
		req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: tc.s}}}
		if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
			t.Fatal("unsupported version/mode control admitted", tc.model, tc.s)
		}
	}
}

func TestKlingImageNativeRestrictions(t *testing.T) {
	for _, tc := range []struct {
		model string
		s     *runtimev1.ImageGenerateScenarioSpec
	}{
		{"kling-v3", &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", ReferenceImageArtifactId: "owned", NegativePrompt: "dark"}},
		{"kling-v3", &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", ReferenceImages: []string{"https://example.com/a.png", "https://example.com/b.png"}}},
		{"kling-v3-omni", &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", AspectRatio: "auto"}},
		{"kling-v3-omni", &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", N: proto.Int32(10)}},
	} {
		driver, target := cloudMediaDriverTarget(t, "kling", tc.model, "image.generate")
		req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: tc.s}}}
		if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
			t.Fatal("unsupported image combination admitted", tc.model, tc.s)
		}
	}
}
