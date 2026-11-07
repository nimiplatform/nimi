package capabilitydriver

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func seedanceVideoRequest(mode runtimev1.VideoMode, content ...*runtimev1.VideoContentItem) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: mode, Prompt: "A slow camera move.", Content: content, Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(4), Resolution: "720p"}}}}}
}

func TestSeedanceExactReferenceCountsAndAnchors(t *testing.T) {
	imageRef := &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: "owned-image"}}
	audio := &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: "owned-audio"}}
	video := &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO, VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://media.example.test/video.mp4"}}
	req := seedanceVideoRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE)
	s := req.GetSpec().GetVideoGenerate()
	s.Prompt = ""
	for range 30 {
		s.Content = append(s.Content, proto.Clone(imageRef).(*runtimev1.VideoContentItem))
	}
	for range 10 {
		s.Content = append(s.Content, proto.Clone(video).(*runtimev1.VideoContentItem), proto.Clone(audio).(*runtimev1.VideoContentItem))
	}
	s.Options.DurationSec = proto.Int32(-1)
	s.Options.GenerateAudio = proto.Bool(false)
	s.Options.ReturnLastFrame = proto.Bool(true)
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance25VideoModel); err != nil {
		t.Fatal(err)
	}
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance20VideoModel); err == nil {
		t.Fatal("2.0 inherited 2.5 reference counts")
	}
	s.Content = append(s.Content, imageRef)
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance25VideoModel); err == nil {
		t.Fatal("31st image admitted")
	}
	s.Content = []*runtimev1.VideoContentItem{audio}
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance25VideoModel); err != nil {
		t.Fatal("audio-only 2.5", err)
	}
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance20VideoModel); err == nil {
		t.Fatal("2.0 audio-only admitted")
	}
	s.Content = []*runtimev1.VideoContentItem{video, audio}
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance20VideoModel); err != nil {
		t.Fatal("2.0 video anchor", err)
	}
	video.Type = runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF
	video.VideoUrl = nil
	video.ArtifactRef = &runtimev1.VideoContentArtifactRef{ArtifactId: "owned-video"}
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance25VideoModel); err == nil {
		t.Fatal("invented owned-video upload admitted")
	}
}

func TestSeedanceFastMiniKeepExactResolutionAndReferenceBoundaries(t *testing.T) {
	for _, model := range []string{Seedance20FastVideoModel, Seedance20MiniVideoModel} {
		t.Run(model, func(t *testing.T) {
			req := seedanceVideoRequest(runtimev1.VideoMode_VIDEO_MODE_T2V)
			for _, resolution := range []string{"480p", "720p"} {
				req.GetSpec().GetVideoGenerate().Options.Resolution = resolution
				if err := ValidateCurrentSeedanceVideoRequest(req, model); err != nil {
					t.Fatal(err)
				}
			}
			for _, resolution := range []string{"1080p", "4k"} {
				req.GetSpec().GetVideoGenerate().Options.Resolution = resolution
				if ValidateCurrentSeedanceVideoRequest(req, model) == nil {
					t.Fatal("inherited full-model resolution", resolution)
				}
			}
			s := req.GetSpec().GetVideoGenerate()
			s.Options.Resolution = "720p"
			s.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE
			s.Content = []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://example.test/audio.wav"}}}
			if ValidateCurrentSeedanceVideoRequest(req, model) == nil {
				t.Fatal("inherited2.5 audio-only mode")
			}
			for range 9 {
				s.Content = append(s.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.test/image.png"}})
			}
			if err := ValidateCurrentSeedanceVideoRequest(req, model); err != nil {
				t.Fatal("valid2.0-family references rejected", err)
			}
			s.Content = append(s.Content, proto.Clone(s.Content[1]).(*runtimev1.VideoContentItem))
			if ValidateCurrentSeedanceVideoRequest(req, model) == nil {
				t.Fatal("tenth image admitted")
			}
		})
	}
}

func TestSeedanceRejectsIgnoredControlsAndMixedModes(t *testing.T) {
	for _, model := range []string{Seedance20VideoModel, Seedance25VideoModel, Seedance20FastVideoModel, Seedance20MiniVideoModel} {
		req := seedanceVideoRequest(runtimev1.VideoMode_VIDEO_MODE_T2V)
		for _, mutate := range []func(*runtimev1.VideoGenerationOptions){
			func(o *runtimev1.VideoGenerationOptions) { o.Seed = proto.Int64(0) },
			func(o *runtimev1.VideoGenerationOptions) { o.CameraFixed = proto.Bool(false) },
			func(o *runtimev1.VideoGenerationOptions) { o.Frames = proto.Int32(0) },
			func(o *runtimev1.VideoGenerationOptions) { o.Fps = proto.Int32(0) },
			func(o *runtimev1.VideoGenerationOptions) { o.ServiceTier = "default" },
			func(o *runtimev1.VideoGenerationOptions) { o.DurationSec = proto.Int32(3) },
			func(o *runtimev1.VideoGenerationOptions) { o.ExecutionExpiresAfterSec = 3599 },
		} {
			next := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
			mutate(next.GetSpec().GetVideoGenerate().Options)
			if err := ValidateCurrentSeedanceVideoRequest(next, model); err == nil {
				t.Fatalf("ignored control admitted for %s: %v", model, next.GetSpec().GetVideoGenerate().Options)
			}
		}
	}
	frame := &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://media.example.test/first.jpg"}}
	req := seedanceVideoRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, frame)
	s := req.GetSpec().GetVideoGenerate()
	s.Prompt = ""
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance25VideoModel); err != nil {
		t.Fatal(err)
	}
	s.Options.Ratio = "16:9"
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance25VideoModel); err == nil {
		t.Fatal("ignored frame ratio admitted")
	}
	s.Options.Ratio = "adaptive"
	s.Content = append(s.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://media.example.test/voice.wav"}})
	if err := ValidateCurrentSeedanceVideoRequest(req, Seedance25VideoModel); err == nil {
		t.Fatal("mixed frame and reference mode admitted")
	}
}

func TestSeedanceOwnedImageActualDecodeAndGeometry(t *testing.T) {
	for _, tc := range []struct {
		width, height int
		valid         bool
	}{{300, 300, true}, {300, 750, true}, {299, 300, false}, {300, 751, false}} {
		picture := image.NewRGBA(image.Rect(0, 0, tc.width, tc.height))
		draw.Draw(picture, picture.Bounds(), image.NewUniform(color.RGBA{B: 200, A: 255}), image.Point{}, draw.Src)
		var data bytes.Buffer
		if err := png.Encode(&data, picture); err != nil {
			t.Fatal(err)
		}
		err := ValidateSeedanceVideoImage(Seedance25VideoModel, data.Bytes(), "image/png")
		if (err == nil) != tc.valid {
			t.Fatalf("%dx%d valid=%v: %v", tc.width, tc.height, tc.valid, err)
		}
		if err := ValidateSeedanceVideoImage(Seedance25VideoModel, data.Bytes()[:len(data.Bytes())/2], "image/png"); err == nil {
			t.Fatal("truncated image admitted")
		}
	}
}
