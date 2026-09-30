package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func openAIImageTestRequest(mutate func(*runtimev1.ImageGenerateScenarioSpec)) *runtimev1.SubmitScenarioJobRequest {
	spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "A paper lantern on a quiet river at dusk"}
	if mutate != nil {
		mutate(spec)
	}
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}},
	}
}

func TestOpenAIImageMapsOnlyPromptSizeAndQuality(t *testing.T) {
	for _, model := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst"} {
		driver, target := cloudMediaDriverTarget(t, "openai", model, "image.generate")
		for name, mutate := range map[string]func(*runtimev1.ImageGenerateScenarioSpec){
			"plain":            nil,
			"landscape low":    func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size, s.Quality = "1536x1024", "low" },
			"custom max":       func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size, s.Quality = "2048x1152", "max" },
			"one base64 image": func(s *runtimev1.ImageGenerateScenarioSpec) { s.N, s.ResponseFormat = proto.Int32(1), "b64_json" },
			"reference edit": func(s *runtimev1.ImageGenerateScenarioSpec) {
				s.ReferenceImages = []string{"https://example.com/a.png"}
			},
			"masked edit": func(s *runtimev1.ImageGenerateScenarioSpec) {
				s.ReferenceImages, s.Mask = []string{"https://example.com/a.png"}, "https://example.com/mask.png"
			},
		} {
			mapped, err := driver.MapRequest(target, openAIImageTestRequest(mutate), nil, CloudMediaStreamNone)
			if err != nil || mapped.Adapter() != CloudMediaAdapterOpenAIImages || mapped.ProviderModelID() != model {
				t.Fatalf("%s %s mapping=%+v err=%v", model, name, mapped, err)
			}
		}
	}

	previous, previousTarget := cloudMediaDriverTarget(t, "openai", "gpt-image-1.5", "image.generate")
	if mapped, err := previous.MapRequest(previousTarget, openAIImageTestRequest(func(s *runtimev1.ImageGenerateScenarioSpec) {
		s.Size, s.Quality = "1024x1536", "high"
	}), nil, CloudMediaStreamNone); err != nil || mapped.Adapter() != CloudMediaAdapterOpenAIImages {
		t.Fatalf("gpt-image-1.5 mapping=%+v err=%v", mapped, err)
	}
	for name, mutate := range map[string]func(*runtimev1.ImageGenerateScenarioSpec){
		"custom size": func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "2048x1152" },
		"xhigh":       func(s *runtimev1.ImageGenerateScenarioSpec) { s.Quality = "xhigh" },
		"edit": func(s *runtimev1.ImageGenerateScenarioSpec) {
			s.ReferenceImages = []string{"https://example.com/a.png"}
		},
	} {
		_, err := previous.MapRequest(previousTarget, openAIImageTestRequest(mutate), nil, CloudMediaStreamNone)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("gpt-image-1.5 %s must fail typed before dispatch: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}

	driver, target := cloudMediaDriverTarget(t, "openai", "gpt-image-2.5-flare", "image.generate")
	for name, mutate := range map[string]func(*runtimev1.ImageGenerateScenarioSpec){
		"two images":      func(s *runtimev1.ImageGenerateScenarioSpec) { s.N = proto.Int32(2) },
		"negative prompt": func(s *runtimev1.ImageGenerateScenarioSpec) { s.NegativePrompt = "people" },
		"aspect ratio":    func(s *runtimev1.ImageGenerateScenarioSpec) { s.AspectRatio = "16:9" },
		"style":           func(s *runtimev1.ImageGenerateScenarioSpec) { s.Style = "vivid" },
		"seed":            func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(7) },
		"strength":        func(s *runtimev1.ImageGenerateScenarioSpec) { s.Strength = proto.Float32(0.5) },
		"two references": func(s *runtimev1.ImageGenerateScenarioSpec) {
			s.ReferenceImages = []string{"https://example.com/a.png", "https://example.com/b.png"}
		},
		"plain http reference": func(s *runtimev1.ImageGenerateScenarioSpec) { s.ReferenceImages = []string{"http://example.com/a.png"} },
		"data reference": func(s *runtimev1.ImageGenerateScenarioSpec) {
			s.ReferenceImages = []string{"data:image/png;base64,iVBORw0KGgo="}
		},
		"plain http mask": func(s *runtimev1.ImageGenerateScenarioSpec) {
			s.ReferenceImages, s.Mask = []string{"https://example.com/a.png"}, "http://example.com/mask.png"
		},
		"reference artifact":  func(s *runtimev1.ImageGenerateScenarioSpec) { s.ReferenceImageArtifactId = "artifact-1" },
		"mask":                func(s *runtimev1.ImageGenerateScenarioSpec) { s.Mask = "https://example.com/mask.png" },
		"mask artifact":       func(s *runtimev1.ImageGenerateScenarioSpec) { s.MaskArtifactId = "artifact-2" },
		"url output":          func(s *runtimev1.ImageGenerateScenarioSpec) { s.ResponseFormat = "url" },
		"edge not 16":         func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "1000x1000" },
		"edge over 3840":      func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "3856x1024" },
		"too few pixels":      func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "512x512" },
		"wider than 3:1":      func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "3072x960" },
		"size keyword":        func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "auto" },
		"unknown quality":     func(s *runtimev1.ImageGenerateScenarioSpec) { s.Quality = "ultra" },
		"hd quality spelling": func(s *runtimev1.ImageGenerateScenarioSpec) { s.Quality = "hd" },
	} {
		_, err := driver.MapRequest(target, openAIImageTestRequest(mutate), nil, CloudMediaStreamNone)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("%s must fail typed before dispatch: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
	extended := openAIImageTestRequest(nil)
	payload, _ := structpb.NewStruct(map[string]any{"background": "transparent"})
	extended.Extensions = []*runtimev1.ScenarioExtension{{Namespace: "nimi.scenario.image_generate.request", Payload: payload}}
	_, err := driver.MapRequest(target, extended, nil, CloudMediaStreamNone)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("extensions must not reach the exact image cell: reason=%v present=%v err=%v", reason, ok, err)
	}
}
