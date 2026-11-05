package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func h3VideoRequest(mode runtimev1.VideoMode, content ...*runtimev1.VideoContentItem) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: mode, Prompt: "A calm lake.", Content: content}}}}
}

func TestMiniMaxH3DriverCapturesRequiredDefaultsWithoutMutatingCaller(t *testing.T) {
	for _, model := range []string{"MiniMax-H3", "MiniMax-H3-Highspeed", "MiniMax-H3-Lite", "MiniMax-H3-Max"} {
		raw, _ := structpb.NewStruct(map[string]any{"provider": "minimax", "providerModelId": model, "remoteModelCatalogId": "catalog-h3"})
		driver, target, err := NewProductionCloudMediaRegistry().Resolve(Identity{ImplementationID: "cloud.video.generate.minimax", DriverID: "nimi.runtime.driver.minimax", DriverDialect: "provider/media-v1"}, raw, "video.generate")
		if err != nil {
			t.Fatal(err)
		}
		request := h3VideoRequest(runtimev1.VideoMode_VIDEO_MODE_T2V)
		mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
		if err != nil {
			t.Fatal(model, err)
		}
		options := mapped.Request().GetSpec().GetVideoGenerate().GetOptions()
		if mapped.Adapter() != CloudMediaAdapterMiniMaxH3Video || options.GetResolution() != "768p" || options.GetDurationSec() != 5 || options.GetRatio() != "16:9" || request.GetSpec().GetVideoGenerate().Options != nil {
			t.Fatalf("default capture or caller isolation failed for %s: %v", model, options)
		}
	}
}

func TestMiniMaxH3RejectsIgnoredControlsAndHonorsVariantLimits(t *testing.T) {
	for _, model := range []string{"MiniMax-H3", "MiniMax-H3-Highspeed", "MiniMax-H3-Lite", "MiniMax-H3-Max"} {
		for _, mutate := range []func(*runtimev1.VideoGenerationOptions){
			func(o *runtimev1.VideoGenerationOptions) { o.GenerateAudio = proto.Bool(false) },
			func(o *runtimev1.VideoGenerationOptions) { o.GenerateAudio = proto.Bool(true) },
			func(o *runtimev1.VideoGenerationOptions) { o.CameraFixed = proto.Bool(false) },
			func(o *runtimev1.VideoGenerationOptions) { o.ReturnLastFrame = proto.Bool(false) },
			func(o *runtimev1.VideoGenerationOptions) { o.Draft = proto.Bool(false) },
			func(o *runtimev1.VideoGenerationOptions) { o.Seed = proto.Int64(0) },
			func(o *runtimev1.VideoGenerationOptions) { o.Fps = proto.Int32(0) },
			func(o *runtimev1.VideoGenerationOptions) { o.Frames = proto.Int32(0) },
			func(o *runtimev1.VideoGenerationOptions) { o.DurationSec = proto.Int32(-1) },
		} {
			req := h3VideoRequest(runtimev1.VideoMode_VIDEO_MODE_T2V)
			s := req.GetSpec().GetVideoGenerate()
			s.Options = &runtimev1.VideoGenerationOptions{}
			mutate(s.Options)
			if normalizeMiniMaxH3VideoRequest(req, model) == nil {
				t.Fatalf("ignored control admitted for %s: %v", model, s.Options)
			}
		}
		req := h3VideoRequest(runtimev1.VideoMode_VIDEO_MODE_T2V)
		s := req.GetSpec().GetVideoGenerate()
		s.Options = &runtimev1.VideoGenerationOptions{Resolution: "2K", DurationSec: proto.Int32(4)}
		if err := normalizeMiniMaxH3VideoRequest(req, model); (err == nil) != (model == "MiniMax-H3") {
			t.Fatalf("variant2k/4s %s: %v", model, err)
		}
	}
}

func TestMiniMaxH3OwnedMediaModesCountsAndRatio(t *testing.T) {
	ref := func(role runtimev1.VideoContentRole) *runtimev1.VideoContentItem {
		return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: role, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: "owned"}}
	}
	req := h3VideoRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE)
	s := req.GetSpec().GetVideoGenerate()
	for range 9 {
		s.Content = append(s.Content, ref(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE))
	}
	for range 3 {
		s.Content = append(s.Content, ref(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO), ref(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO))
	}
	if err := normalizeMiniMaxH3VideoRequest(req, "MiniMax-H3"); err != nil {
		t.Fatal(err)
	}
	s.Content = append(s.Content, ref(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE))
	if normalizeMiniMaxH3VideoRequest(req, "MiniMax-H3") == nil {
		t.Fatal("tenth image admitted")
	}
	req = h3VideoRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, ref(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME))
	s = req.GetSpec().GetVideoGenerate()
	s.Options = &runtimev1.VideoGenerationOptions{Ratio: "16:9"}
	if normalizeMiniMaxH3VideoRequest(req, "MiniMax-H3") == nil {
		t.Fatal("ignored frame ratio admitted")
	}
	s.Options.Ratio = "adaptive"
	if err := normalizeMiniMaxH3VideoRequest(req, "MiniMax-H3"); err != nil {
		t.Fatal(err)
	}
	s.Content = append(s.Content, ref(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO))
	if normalizeMiniMaxH3VideoRequest(req, "MiniMax-H3") == nil {
		t.Fatal("mixed frame and reference roles")
	}
	req = h3VideoRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, ref(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO))
	if err := normalizeMiniMaxH3VideoRequest(req, "MiniMax-H3-Lite"); err != nil {
		t.Fatal(err)
	}
	if req.GetSpec().GetVideoGenerate().GetOptions().GetRatio() != "16:9" {
		t.Fatal("required Lite ratio not captured")
	}
	req.GetSpec().GetVideoGenerate().Options.Ratio = "adaptive"
	if normalizeMiniMaxH3VideoRequest(req, "MiniMax-H3-Lite") == nil {
		t.Fatal("unsupported Lite adaptive ratio")
	}
}
