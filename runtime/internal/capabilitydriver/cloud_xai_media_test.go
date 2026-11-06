package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func xaiVideoRequest(model string, mode runtimev1.VideoMode, first, last, references int) *runtimev1.SubmitScenarioJobRequest {
	s := &runtimev1.VideoGenerateScenarioSpec{Mode: mode, Prompt: "a boat", Options: &runtimev1.VideoGenerationOptions{}}
	add := func(role runtimev1.VideoContentRole, count int) {
		for i := 0; i < count; i++ {
			s.Content = append(s.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: role, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://media.example/image.png"}})
		}
	}
	add(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, first)
	add(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME, last)
	add(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, references)
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: s}}}
}
func TestXAIImageNativeOptionsAndRetiredTargets(t *testing.T) {
	d, target := cloudMediaDriverTarget(t, "xai", XAIImage2Model, "image.generate")
	request := geminiImageRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "a boat", N: proto.Int32(10), ReferenceImages: []string{"https://media.example/a.png", "https://media.example/b.webp"}})
	mapped, err := d.MapRequest(target, request, nil, CloudMediaStreamNone)
	if err != nil {
		t.Fatal(err)
	}
	spec := mapped.Request().GetSpec().GetImageGenerate()
	if mapped.Adapter() != CloudMediaAdapterXAIImage || spec.GetQuality() != "auto" || spec.GetSize() != "1k" || spec.GetResponseFormat() != "b64_json" || request.GetSpec().GetImageGenerate().GetSize() != "" {
		t.Fatal("image defaults or native adapter missing")
	}
	for name, change := range map[string]func(*runtimev1.ImageGenerateScenarioSpec){
		"pixel size":          func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "1024x1024" },
		"unreviewed tier":     func(s *runtimev1.ImageGenerateScenarioSpec) { s.Size = "1.5k" },
		"unsupported quality": func(s *runtimev1.ImageGenerateScenarioSpec) { s.Quality = "high" },
		"codec":               func(s *runtimev1.ImageGenerateScenarioSpec) { s.OutputFormat = "png" },
		"seed":                func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(1) },
		"mask":                func(s *runtimev1.ImageGenerateScenarioSpec) { s.MaskArtifactId = "mask" },
		"too many images":     func(s *runtimev1.ImageGenerateScenarioSpec) { s.N = proto.Int32(11) },
	} {
		t.Run(name, func(t *testing.T) {
			r := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
			change(r.GetSpec().GetImageGenerate())
			if _, err := d.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("unsupported image option accepted")
			}
		})
	}
	for _, id := range []string{"grok-imagine-image-quality", "grok-imagine-image-pro"} {
		driver, badTarget := cloudMediaDriverTarget(t, "xai", id, "image.generate")
		if _, err := driver.MapRequest(badTarget, geminiImageRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "a boat"}), nil, CloudMediaStreamNone); err == nil {
			t.Fatal("retired redirect admitted")
		}
	}
}
func TestXAIVideoExactModesAndVisibleDefaults(t *testing.T) {
	for _, model := range []string{XAIVideo15Model, XAIVideo15LiteModel, XAIVideo1Model} {
		d, target := cloudMediaDriverTarget(t, "xai", model, "video.generate")
		for _, mode := range []runtimev1.VideoMode{runtimev1.VideoMode_VIDEO_MODE_T2V, runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME} {
			first := 0
			if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
				first = 1
			}
			request := xaiVideoRequest(model, mode, first, 0, 0)
			if first > 0 {
				request.GetSpec().GetVideoGenerate().Prompt = ""
			}
			mapped, err := d.MapRequest(target, request, nil, CloudMediaStreamNone)
			if err != nil {
				t.Fatal(err)
			}
			s := mapped.Request().GetSpec().GetVideoGenerate()
			if mapped.Adapter() != CloudMediaAdapterXAIVideo || s.GetOptions().GetDurationSec() != 8 || s.GetOptions().GetResolution() != "720p" || !s.GetOptions().GetGenerateAudio() {
				t.Fatal("native defaults missing")
			}
			if first > 0 && s.GetOptions().GetRatio() != "" {
				t.Fatal("invented image-to-video ratio")
			}
		}
	}
	full, target := cloudMediaDriverTarget(t, "xai", XAIVideo15Model, "video.generate")
	refs := xaiVideoRequest(XAIVideo15Model, runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, 0, 0, 14)
	if _, err := full.MapRequest(target, refs, nil, CloudMediaStreamNone); err != nil {
		t.Fatal("14 references rejected", err)
	}
	for name, request := range map[string]*runtimev1.SubmitScenarioJobRequest{
		"15 references":     xaiVideoRequest(XAIVideo15Model, runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, 0, 0, 15),
		"mixing mode roles": xaiVideoRequest(XAIVideo15Model, runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, 1, 0, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := full.MapRequest(target, request, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("unsupported shape accepted")
			}
		})
	}
	image := xaiVideoRequest(XAIVideo15Model, runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, 1, 0, 0)
	image.GetSpec().GetVideoGenerate().Options.Ratio = "16:9"
	if _, err := full.MapRequest(target, image, nil, CloudMediaStreamNone); err == nil {
		t.Fatal("ignored ratio accepted")
	}
	image.GetSpec().GetVideoGenerate().Options.Ratio = "adaptive"
	if _, err := full.MapRequest(target, image, nil, CloudMediaStreamNone); err != nil {
		t.Fatal("source aspect request rejected", err)
	}
	refs.GetSpec().GetVideoGenerate().Options.Resolution = "1080p"
	if _, err := full.MapRequest(target, refs, nil, CloudMediaStreamNone); err == nil {
		t.Fatal("reference 1080p admitted")
	}
	lite, liteTarget := cloudMediaDriverTarget(t, "xai", XAIVideo15LiteModel, "video.generate")
	if _, err := lite.MapRequest(liteTarget, xaiVideoRequest(XAIVideo15LiteModel, runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, 0, 0, 1), nil, CloudMediaStreamNone); err == nil {
		t.Fatal("Lite reference mode admitted")
	}
	old, oldTarget := cloudMediaDriverTarget(t, "xai", XAIVideo1Model, "video.generate")
	legacy := xaiVideoRequest(XAIVideo1Model, runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, 0, 0, 7)
	legacy.GetSpec().GetVideoGenerate().Options.DurationSec = proto.Int32(11)
	if _, err := old.MapRequest(oldTarget, legacy, nil, CloudMediaStreamNone); err == nil {
		t.Fatal("old reference duration clamped")
	}
}
