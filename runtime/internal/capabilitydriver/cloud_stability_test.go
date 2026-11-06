package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"math"
	"strings"
	"testing"
)

func TestStabilityNativeImageMapping(t *testing.T) {
	for _, model := range []string{"stable-image-core", "stable-image-ultra", "stable-diffusion-3.5-large", "stable-diffusion-3.5-large-turbo", "stable-diffusion-3.5-medium"} {
		t.Run(model, func(t *testing.T) {
			driver, target := cloudMediaDriverTarget(t, "stability", model, "image.generate")
			request := geminiImageRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "lighthouse", OutputFormat: "webp", Style: "photographic"})
			mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
			if err != nil {
				t.Fatal(err)
			}
			spec := mapped.Request().GetSpec().GetImageGenerate()
			if spec.GetSeed() < 1 || spec.GetSeed() > math.MaxInt32 || spec.GetOutputFormat() != "webp" || request.GetSpec().GetImageGenerate().Seed != nil {
				t.Fatalf("immutable image capture: %+v", spec)
			}
			if model != "stable-image-core" {
				request.GetSpec().GetImageGenerate().ReferenceImageArtifactId = "owned-source"
				mapped, err = driver.MapRequest(target, request, nil, CloudMediaStreamNone)
				if err != nil || mapped.Request().GetSpec().GetImageGenerate().GetStrength() != 0.5 {
					t.Fatalf("owned image: %v %v", mapped, err)
				}
			}
		})
	}
	driver, target := cloudMediaDriverTarget(t, "stability", "stable-image-ultra", "image.generate")
	base := geminiImageRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "lighthouse"})
	for name, change := range map[string]func(*runtimev1.ImageGenerateScenarioSpec){
		"ignored quality": func(s *runtimev1.ImageGenerateScenarioSpec) { s.Quality = "high" },
		"foreign URL": func(s *runtimev1.ImageGenerateScenarioSpec) {
			s.ReferenceImages = []string{"https://example.org/source.png"}
		},
		"mask":                   func(s *runtimev1.ImageGenerateScenarioSpec) { s.MaskArtifactId = "mask" },
		"native random zero":     func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(0) },
		"unrepresentable seed":   func(s *runtimev1.ImageGenerateScenarioSpec) { s.Seed = proto.Int64(4294967294) },
		"arbitrary style":        func(s *runtimev1.ImageGenerateScenarioSpec) { s.Style = "vivid" },
		"SVG":                    func(s *runtimev1.ImageGenerateScenarioSpec) { s.OutputFormat = "svg" },
		"strength without input": func(s *runtimev1.ImageGenerateScenarioSpec) { s.Strength = proto.Float32(0.5) },
		"aspect and reference": func(s *runtimev1.ImageGenerateScenarioSpec) {
			s.ReferenceImageArtifactId = "source"
			s.AspectRatio = "16:9"
		},
	} {
		t.Run(name, func(t *testing.T) {
			r := proto.Clone(base).(*runtimev1.SubmitScenarioJobRequest)
			change(r.GetSpec().GetImageGenerate())
			if _, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("unsupported combination accepted")
			}
		})
	}
}

func TestStabilityMusicCapturesExactLimitsAndSeed(t *testing.T) {
	for _, model := range []string{"stable-audio-2", "stable-audio-2.5", "stable-audio-3"} {
		driver, target := cloudMediaDriverTarget(t, "stability", model, "music.generate")
		request := geminiLyriaClipRequest(&runtimev1.MusicGenerateScenarioSpec{Prompt: "calm piano"})
		mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
		if err != nil {
			t.Fatal(err)
		}
		spec := mapped.Request().GetSpec().GetMusicGenerate()
		if spec.GetDurationSeconds() != 190 || spec.Seed == nil || spec.GetSeed() == 0 || spec.GetSeed() == math.MaxUint32 || request.GetSpec().GetMusicGenerate().Seed != nil {
			t.Fatal("defaults not captured exactly once")
		}
		profiles := CloudMusicInputCapabilities("stability", model, "music.generate").GetGeneration()
		if len(profiles) != 1 || !profiles[0].GetSupportsAudioReference() || !profiles[0].GetSupportsSeed() || profiles[0].GetMaxDurationSeconds() != uint32(StabilityMusicMaxDuration(model)) {
			t.Fatal("input limits missing")
		}
		for name, change := range map[string]func(*runtimev1.MusicGenerateScenarioSpec){
			"maximum":             func(s *runtimev1.MusicGenerateScenarioSpec) { s.DurationSeconds = StabilityMusicMaxDuration(model) + 1 },
			"negative prompt":     func(s *runtimev1.MusicGenerateScenarioSpec) { s.NegativePrompt = "drums" },
			"lyrics":              func(s *runtimev1.MusicGenerateScenarioSpec) { s.Lyrics = "hello" },
			"instrumental toggle": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Instrumental = true },
			"style":               func(s *runtimev1.MusicGenerateScenarioSpec) { s.Style = "jazz" },
			"score":               func(s *runtimev1.MusicGenerateScenarioSpec) { s.ReturnGeneratedScore = true },
			"seed range":          func(s *runtimev1.MusicGenerateScenarioSpec) { s.Seed = proto.Uint32(math.MaxUint32) },
			"prompt characters":   func(s *runtimev1.MusicGenerateScenarioSpec) { s.Prompt = strings.Repeat("a", 10001) },
		} {
			t.Run(model+"/"+name, func(t *testing.T) {
				r := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
				change(r.GetSpec().GetMusicGenerate())
				if _, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
					t.Fatal("unsupported input accepted")
				}
			})
		}
	}
}
