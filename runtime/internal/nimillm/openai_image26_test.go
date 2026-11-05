package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func image26GIF(t *testing.T, frames, delay int) []byte {
	t.Helper()
	animation := &gif.GIF{}
	for i := 0; i < frames; i++ {
		frame := image.NewPaletted(image.Rect(0, 0, 8, 4), color.Palette{color.Black, color.White})
		frame.SetColorIndex(i%8, 0, 1)
		animation.Image = append(animation.Image, frame)
		animation.Delay = append(animation.Delay, delay)
	}
	var b bytes.Buffer
	if err := gif.EncodeAll(&b, animation); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestSVGAuthorUsageIsSeparateAndBoundToTheConfiguredModel(t *testing.T) {
	for _, test := range []struct {
		name, usage string
		valid       bool
	}{
		{"reported", `,"svg_usage":{"model":"gpt-6.1-sol","input_tokens":4,"output_tokens":9,"reasoning_tokens":3,"total_tokens":13}`, true},
		{"absent", "", true},
		{"wrong model", `,"svg_usage":{"model":"other","input_tokens":4,"output_tokens":9,"reasoning_tokens":3,"total_tokens":13}`, false},
		{"bad total", `,"svg_usage":{"model":"gpt-6.1-sol","input_tokens":4,"output_tokens":9,"reasoning_tokens":3,"total_tokens":99}`, false},
		{"missing quantity", `,"svg_usage":{"model":"gpt-6.1-sol","output_tokens":9}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var body map[string]any
			svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><path d="M0 0L8 4"/></svg>`)
			server := openAIImageTestServer(t, &body, func() string {
				return `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(svg) + `"}],"usage":{"input_tokens":11,"output_tokens":27}` + test.usage + `}`
			})
			defer server.Close()
			provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.6-flare")
			target.SVGAuthorModelID = "gpt-6.1-sol"
			job := openAIImageTestJob("", "low")
			job.GetSpec().GetImageGenerate().OutputFormat = "svg"
			var observed []*runtimev1.DesktopAIModelUsage
			ctx := WithModelUsageObserver(context.Background(), func(values []*runtimev1.DesktopAIModelUsage) { observed = values })
			artifacts, primary, _, err := provider.executeOpenAIImage(ctx, job, "gpt-image-2.6-flare", target)
			if (err == nil) != test.valid {
				t.Fatalf("result: %v", err)
			}
			if !test.valid {
				return
			}
			if len(artifacts) != 1 || primary.GetInputTokens() != 11 || primary.GetOutputTokens() != 27 || len(observed) != 2 || observed[1].Model.ModelId != "gpt-6.1-sol" {
				t.Fatal("primary and author attribution merged or lost")
			}
			if test.usage == "" {
				if observed[1].Usage != nil {
					t.Fatal("missing usage fabricated")
				}
			} else if observed[1].Usage.OutputTokens != 9 || artifacts[0].Metadata.GetFields()["svg_usage"].GetStructValue().GetFields()["model"].GetStringValue() != "gpt-6.1-sol" {
				t.Fatal("native author usage lost")
			}
		})
	}
}

func TestFiniteSVGResultCustodyRetainsPrimaryUsageWithoutRepeatingGeneration(t *testing.T) {
	var body map[string]any
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><path d="M0 0L8 4"/></svg>`)
	hits := 0
	server := openAIImageTestServer(t, &body, func() string {
		hits++
		return `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(svg) + `"}],"usage":{"input_tokens":11,"output_tokens":27}}`
	})
	defer server.Close()
	provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.6-flare")
	target.SVGAuthorModelID = "gpt-6.1-sol"
	request := openAIImageTestJob("", "low")
	request.GetSpec().GetImageGenerate().OutputFormat = "svg"
	retained := false
	ctx := WithFiniteMediaResultOwner(context.Background(), func(artifacts []*runtimev1.ScenarioArtifact, usage *runtimev1.UsageStats) error {
		retained = len(artifacts) == 1 && usage.GetOutputTokens() == 27
		return nil
	})
	result, err := provider.ExecuteMediaAdapter(ctx, adapterOpenAIImages, "trace", request, "gpt-image-2.6-flare", target, noopJobStateUpdater{})
	if !errors.Is(err, ErrFiniteMediaResultOwned) || !retained || hits != 1 || result.Usage.GetOutputTokens() != 27 {
		t.Fatalf("lost retained finite evidence: %v %v hits=%d", result, err, hits)
	}
}

func TestOpenAIImage26FormatsAndNativeControls(t *testing.T) {
	var jpegBytes bytes.Buffer
	if err := jpeg.Encode(&jpegBytes, image.NewGray(image.Rect(0, 0, 8, 4)), nil); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		format   string
		data     []byte
		mime     string
		duration int64
	}{
		{"jpeg", jpegBytes.Bytes(), "image/jpeg", 0},
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><path d="M0 0L8 4"/></svg>`), "image/svg+xml", 0},
		{"gif", image26GIF(t, 3, 4), "image/gif", 120},
	} {
		t.Run(tt.format, func(t *testing.T) {
			var body map[string]any
			server := openAIImageTestServer(t, &body, func() string {
				return `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(tt.data) + `"}],"usage":{"input_tokens":11,"output_tokens":27},"svg_usage":{"model":"gpt-6.1-sol","input_tokens":101,"output_tokens":999,"reasoning_tokens":500,"total_tokens":1100}}`
			})
			defer server.Close()
			provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.6-flare")
			if tt.format == "svg" {
				target.SVGAuthorModelID = "gpt-6.1-sol"
			}
			job := openAIImageTestJob("", "low")
			s := job.GetSpec().GetImageGenerate()
			s.Complexity = "high"
			s.OutputFormat = tt.format
			if tt.format == "gif" {
				s.FrameCount = proto.Int32(3)
				s.FrameDurationMs = proto.Int32(36)
			}
			artifacts, usage, _, err := provider.executeOpenAIImage(context.Background(), job, "gpt-image-2.6-flare", target)
			if err != nil {
				t.Fatal(err)
			}
			a := artifacts[0]
			if len(artifacts) != 1 || a.GetMimeType() != tt.mime || a.GetWidth() != 8 || a.GetHeight() != 4 || a.GetDurationMs() != tt.duration || !bytes.Equal(a.GetBytes(), tt.data) {
				t.Fatalf("incorrect output metadata: %v", a)
			}
			if body["complexity"] != "high" || body["quality"] != "low" || body["output_format"] != tt.format {
				t.Fatal(body)
			}
			if tt.format == "svg" {
				if body["svg"].(map[string]any)["model"] != "gpt-6.1-sol" || body["n"] != float64(1) {
					t.Fatal("missing captured author")
				}
			} else if _, ok := body["svg"]; ok {
				t.Fatal("author added to non-SVG request")
			}
			if tt.format == "gif" && (body["frame_count"] != float64(3) || body["frame_duration_ms"] != float64(36)) {
				t.Fatal(body)
			}
			if usage.GetOutputTokens() != 27 {
				t.Fatal("invented aggregate secondary usage", usage)
			}
		})
	}
}

func TestOpenAIImage26OutputBoundsAndTiming(t *testing.T) {
	s := &runtimev1.ImageGenerateScenarioSpec{OutputFormat: "gif", FrameCount: proto.Int32(2), FrameDurationMs: proto.Int32(200)}
	valid := image26GIF(t, 2, 20)
	if _, err := validateOpenAIImageOutput(valid, s); err != nil {
		t.Fatal(err)
	}
	oversized := bytes.Clone(valid)
	binary.LittleEndian.PutUint16(oversized[6:], 65535)
	binary.LittleEndian.PutUint16(oversized[8:], 65535)
	for name, data := range map[string][]byte{"one frame": image26GIF(t, 1, 20), "wrong count": image26GIF(t, 3, 20), "wrong timing": image26GIF(t, 2, 21), "frame bound": image26GIF(t, 65, 20), "allocation bound": oversized, "truncated": valid[:len(valid)-1], "trailing": append(bytes.Clone(valid), 1)} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateOpenAIImageOutput(data, s); err == nil {
				t.Fatal("invalid animation admitted")
			}
		})
	}
	if _, err := validateOpenAIImageOutput(image26GIF(t, 9, 20), &runtimev1.ImageGenerateScenarioSpec{OutputFormat: "gif"}); err != nil {
		t.Fatal("documented default", err)
	}
	if _, err := validateOpenAIImageOutput(valid, &runtimev1.ImageGenerateScenarioSpec{OutputFormat: "png"}); err == nil {
		t.Fatal("format mismatch admitted")
	}
}

func TestOpenAIImage26OwnedMarkupMultipart(t *testing.T) {
	source := openAIImageTestPNG(8, 4)
	overlay := image.NewNRGBA(image.Rect(0, 0, 8, 4))
	overlay.SetNRGBA(2, 2, color.NRGBA{R: 255, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, overlay); err != nil {
		t.Fatal(err)
	}
	markup := b.Bytes()
	var uploads = map[string][]byte{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("wrong route %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		reader, err := r.MultipartReader()
		if err != nil {
			t.Error(err)
			return
		}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Error(err)
				return
			}
			data, _ := io.ReadAll(part)
			uploads[part.FormName()] = data
		}
		_, _ = io.WriteString(w, `{"data":[{"b64_json":"`+base64.StdEncoding.EncodeToString(source)+`"}]}`)
	}))
	defer server.Close()
	provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.6-sunburst")
	job := openAIImageTestJob("", "medium")
	s := job.GetSpec().GetImageGenerate()
	s.ReferenceImageArtifactId = "source"
	s.MarkupArtifactId = "markup"
	s.Complexity = "low"
	ctx := WithImageReference(context.Background(), &CapturedMediaReference{ArtifactID: "source", MIMEType: "image/png", Bytes: source})
	ctx = WithImageMarkupReference(ctx, &CapturedMediaReference{ArtifactID: "markup", MIMEType: "image/png", Bytes: markup})
	if _, _, _, err := provider.executeOpenAIImage(ctx, job, "gpt-image-2.6-sunburst", target); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(uploads["image[]"], source) || !bytes.Equal(uploads["markup"], markup) || string(uploads["complexity"]) != "low" {
		t.Fatal("lost source, overlay or control")
	}
	if _, ok := uploads["markup_artifact_id"]; ok {
		t.Fatal("opaque custody ID leaked to provider")
	}
	if _, err := validateOpenAIMarkup(openAIImageTestMask(8, 4), "image/png"); err == nil {
		t.Fatal("opaque overlay admitted")
	}
	s.MarkupArtifactId = "another-subject-artifact"
	if _, _, _, err := provider.executeOpenAIImage(ctx, job, "gpt-image-2.6-sunburst", target); err == nil {
		t.Fatal("mismatched captured overlay admitted")
	}
}
