package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestFlux3ExactImageAdmission(t *testing.T) {
	for _, model := range []string{"flux-3-image", "flux-3-image-klein"} {
		driver, target := cloudMediaDriverTarget(t, "flux", model, "image.generate")
		for _, s := range []*runtimev1.ImageGenerateScenarioSpec{
			{Prompt: "cup", Size: "4K", AspectRatio: "21:9"},
			{Prompt: "cup", Size: "2048x2048", ReferenceImageArtifactId: "owned"},
			{Prompt: "cup", ReferenceImages: []string{"https://media.example.test/cup.png"}},
		} {
			if _, err := driver.MapRequest(target, geminiImageRequest(s), nil, CloudMediaStreamNone); err != nil {
				t.Fatalf("%s: %v", model, err)
			}
		}
		for _, s := range []*runtimev1.ImageGenerateScenarioSpec{
			{Prompt: "cup", Size: "4096x4096", AspectRatio: "1:1"},
			{Prompt: "cup", Size: "6256x6256"},
			{Prompt: "cup", Quality: "high"},
			{Prompt: "cup", Seed: proto.Int64(-1)},
			{Prompt: "cup", N: proto.Int32(2)},
			{Prompt: "cup", ResponseFormat: "url"},
			{Prompt: "cup", ReferenceImageArtifactId: "owned", ReferenceImages: []string{"https://media.example.test/cup.png"}},
		} {
			if _, err := driver.MapRequest(target, geminiImageRequest(s), nil, CloudMediaStreamNone); err == nil {
				t.Fatalf("%s admitted unsupported %v", model, s)
			}
		}
	}
	s := &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", Seed: proto.Int64(0)}
	if ValidateFlux3ImageRequest(s, "flux-3-image") == nil || ValidateFlux3ImageRequest(s, "flux-3-image-klein") != nil {
		t.Fatal("seed presence or exact model lost")
	}
	s.Seed = nil
	s.ReferenceImageArtifactId = "owned"
	s.Size = "4096x4096"
	if ValidateFlux3ImageRequest(s, "flux-3-image") == nil || ValidateFlux3ImageRequest(s, "flux-3-image-klein") != nil {
		t.Fatal("full-model edit area bound lost")
	}
	s.Size = "match_input"
	if ValidateFlux3ImageRequest(s, "flux-3-image") != nil || ValidateFlux3ImageRequest(s, "flux-3-image-klein") == nil {
		t.Fatal("match_input exact target lost")
	}
}

func TestFlux3VideoRejectsIgnoredControlsAndReferenceReinterpretation(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "flux", "flux-3-video", "video.generate")
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "boat", Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(-1), GenerateAudio: proto.Bool(false)}}}}}
	if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*runtimev1.VideoGenerateScenarioSpec){
		"short":           func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.DurationSec = proto.Int32(4) },
		"seed zero":       func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Seed = proto.Int64(0) },
		"false watermark": func(s *runtimev1.VideoGenerateScenarioSpec) { s.Options.Watermark = proto.Bool(false) },
		"draft fhd": func(s *runtimev1.VideoGenerateScenarioSpec) {
			s.Options.Draft = proto.Bool(true)
			s.Options.Resolution = "1080p"
		},
		"reference mode": func(s *runtimev1.VideoGenerateScenarioSpec) { s.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE },
	} {
		t.Run(name, func(t *testing.T) {
			r := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
			mutate(r.GetSpec().GetVideoGenerate())
			if _, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("ignored or reinterpreted input admitted")
			}
		})
	}
}
