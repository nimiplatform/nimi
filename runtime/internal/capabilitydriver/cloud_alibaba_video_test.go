package capabilitydriver

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func alibabaVideoTestRequest(mode runtimev1.VideoMode, parts ...*runtimev1.VideoContentItem) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: mode, Prompt: "A boat.", Content: parts, Options: &runtimev1.VideoGenerationOptions{Resolution: "480p", DurationSec: proto.Int32(3)}}}}}
}
func alibabaVideoTestImage(role runtimev1.VideoContentRole) *runtimev1.VideoContentItem {
	return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: role, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://media.example.test/image.png"}}
}

func TestAlibabaCurrentVideoMapsOnlyExactModelsAndNativeModes(t *testing.T) {
	for _, model := range []string{"wan3.0-video", "wan3.0-video-prime"} {
		for _, req := range []*runtimev1.SubmitScenarioJobRequest{
			alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_T2V),
			alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME)),
			alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME), alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME)),
			alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO, VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://media.example.test/clip.mp4"}}),
			alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://media.example.test/voice.wav"}}),
		} {
			s := req.GetSpec().GetVideoGenerate()
			s.Options.DurationSec = proto.Int32(-1)
			s.Options.Ratio = "adaptive"
			s.Options.GenerateAudio = proto.Bool(false)
			s.Options.Watermark = proto.Bool(false)
			if err := ValidateAlibabaCurrentVideoRequest(req, model); err != nil {
				t.Fatalf("%s %v: %v", model, s.Mode, err)
			}
			bad := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
			bad.GetSpec().GetVideoGenerate().Options.Fps = proto.Int32(30)
			if err := ValidateAlibabaCurrentVideoRequest(bad, model); err == nil {
				t.Fatal("fixed native fps accepted as a control")
			}
		}
	}
	for model, mode := range map[string]runtimev1.VideoMode{"happyhorse-1.1-t2v": runtimev1.VideoMode_VIDEO_MODE_T2V, "happyhorse-1.1-i2v": runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, "happyhorse-1.1-r2v": runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE} {
		req := alibabaVideoTestRequest(mode)
		s := req.GetSpec().GetVideoGenerate()
		if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
			s.Content = []*runtimev1.VideoContentItem{alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME)}
			s.Prompt = ""
		}
		if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE {
			for i := 0; i < 9; i++ {
				s.Content = append(s.Content, alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE))
			}
		}
		if mode != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
			s.Options.Ratio = "4:5"
		}
		if err := ValidateAlibabaCurrentVideoRequest(req, model); err != nil {
			t.Fatal(err)
		}
		s.Options.GenerateAudio = proto.Bool(false)
		if err := ValidateAlibabaCurrentVideoRequest(req, model); err == nil {
			t.Fatal("HappyHorse audio control invented")
		}
	}
	if err := ValidateAlibabaCurrentVideoRequest(alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_T2V), "wan3.0-unreviewed"); err == nil {
		t.Fatal("unreviewed target admitted")
	}
}

func TestAlibabaCurrentVideoRejectsMixedFramesOversizedReferencesAndTruncatingPrompts(t *testing.T) {
	req := alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME), alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE))
	if err := ValidateAlibabaCurrentVideoRequest(req, "wan3.0-video"); err == nil {
		t.Fatal("frame/reference modes mixed")
	}
	req = alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE)
	for i := 0; i < 11; i++ {
		req.GetSpec().GetVideoGenerate().Content = append(req.GetSpec().GetVideoGenerate().Content, alibabaVideoTestImage(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE))
	}
	if err := ValidateAlibabaCurrentVideoRequest(req, "wan3.0-video"); err == nil {
		t.Fatal("eleventh reference admitted")
	}
	req = alibabaVideoTestRequest(runtimev1.VideoMode_VIDEO_MODE_T2V)
	s := req.GetSpec().GetVideoGenerate()
	s.Prompt = strings.Repeat("x", 3000)
	s.Content = []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: s.Prompt}}
	if err := ValidateAlibabaCurrentVideoRequest(req, "happyhorse-1.1-t2v"); err != nil {
		t.Fatal("SDK prompt mirror charged twice")
	}
	s.Content = append(s.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: s.Prompt})
	if err := ValidateAlibabaCurrentVideoRequest(req, "happyhorse-1.1-t2v"); err == nil {
		t.Fatal("later intentional repeated prompt ignored")
	}
}

func TestAlibabaCurrentVideoOwnedImageGeometryAndTransparency(t *testing.T) {
	for _, test := range []struct {
		model         string
		width, height int
		alpha         uint8
		ok            bool
	}{{"wan3.0-video", 240, 240, 255, true}, {"wan3.0-video", 239, 300, 255, false}, {"wan3.0-video", 240, 8001, 255, false}, {"wan3.0-video", 300, 300, 128, false}, {"happyhorse-1.1-i2v", 300, 750, 255, true}, {"happyhorse-1.1-i2v", 300, 751, 255, false}, {"happyhorse-1.1-r2v", 399, 600, 255, false}, {"happyhorse-1.1-r2v", 400, 400, 255, true}} {
		img := image.NewNRGBA(image.Rect(0, 0, test.width, test.height))
		draw.Draw(img, img.Bounds(), &image.Uniform{C: color.NRGBA{R: 25, B: 200, A: test.alpha}}, image.Point{}, draw.Src)
		var b bytes.Buffer
		if err := png.Encode(&b, img); err != nil {
			t.Fatal(err)
		}
		err := ValidateAlibabaCurrentVideoImage(test.model, b.Bytes(), "image/png")
		if (err == nil) != test.ok {
			t.Fatalf("%+v: %v", test, err)
		}
	}
}
