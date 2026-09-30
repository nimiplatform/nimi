package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func openAIImageTestPNG(width uint32, height uint32) []byte {
	var image bytes.Buffer
	image.Write(pngSignature)
	_ = binary.Write(&image, binary.BigEndian, uint32(13))
	image.WriteString("IHDR")
	_ = binary.Write(&image, binary.BigEndian, width)
	_ = binary.Write(&image, binary.BigEndian, height)
	image.Write([]byte{8, 6, 0, 0, 0, 0, 0, 0, 0})
	return image.Bytes()
}

func openAIImageTestJob(size string, quality string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: " A paper lantern ", Size: size, Quality: quality, ResponseFormat: "b64_json",
		}}},
	}
}

func openAIImageTestServer(t *testing.T, body *map[string]any, response func() string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer test-key" {
			http.NotFound(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		if body != nil {
			_ = json.Unmarshal(raw, body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, response())
	}))
}

func TestOpenAIImageSendsOnlyEndpointFields(t *testing.T) {
	png := openAIImageTestPNG(1536, 1024)
	var body map[string]any
	server := openAIImageTestServer(t, &body, func() string {
		return `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(png) + `"}],"usage":{"input_tokens":9,"output_tokens":272,"total_tokens":281}}`
	})
	defer server.Close()

	provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.5-flare")
	artifacts, usage, _, err := provider.executeOpenAIImage(context.Background(), openAIImageTestJob("1536x1024", "low"), "gpt-image-2.5-flare", target)
	if err != nil {
		t.Fatalf("executeOpenAIImage: %v", err)
	}
	want := map[string]any{"model": "gpt-image-2.5-flare", "prompt": "A paper lantern", "size": "1536x1024", "quality": "low"}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("body = %v, want %v", body, want)
	}
	if len(artifacts) != 1 || artifacts[0].GetMimeType() != "image/png" || !bytes.Equal(artifacts[0].GetBytes(), png) ||
		artifacts[0].GetWidth() != 1536 || artifacts[0].GetHeight() != 1024 {
		t.Fatalf("artifacts = %+v", artifacts)
	}
	if usage.GetInputTokens() != 9 || usage.GetOutputTokens() != 272 || usage.GetComputeMs() != 0 {
		t.Fatalf("usage = %+v", usage)
	}

	body = nil
	if _, _, _, err := provider.executeOpenAIImage(context.Background(), openAIImageTestJob("", ""), "gpt-image-2.5-flare", target); err != nil {
		t.Fatalf("plain prompt: %v", err)
	}
	if want := map[string]any{"model": "gpt-image-2.5-flare", "prompt": "A paper lantern"}; !reflect.DeepEqual(body, want) {
		t.Fatalf("plain body = %v, want %v", body, want)
	}
}

func TestOpenAIImageRejectsResultsThatAreNotOnePNG(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString(openAIImageTestPNG(1024, 1024))
	for name, response := range map[string]string{
		"two images": `{"data":[{"b64_json":"` + encoded + `"},{"b64_json":"` + encoded + `"}]}`,
		"url only":   `{"data":[{"url":"https://example.com/a.png"}]}`,
		"not a png":  `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString([]byte("GIF89a-not-png-data")) + `"}]}`,
		"bad base64": `{"data":[{"b64_json":"%%%"}]}`,
	} {
		server := openAIImageTestServer(t, nil, func() string { return response })
		provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.5-flare")
		_, _, _, err := provider.executeOpenAIImage(context.Background(), openAIImageTestJob("", ""), "gpt-image-2.5-flare", target)
		server.Close()
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("%s: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
}

func TestOpenAIImageEditUploadsReferenceAndMask(t *testing.T) {
	reference := openAIImageTestPNG(1024, 1024)
	mask := append(openAIImageTestPNG(1024, 1024), 'm')
	smallMask := openAIImageTestPNG(512, 512)
	result := openAIImageTestPNG(1024, 1024)
	type upload struct {
		name        string
		contentType string
		payload     []byte
	}
	fields := map[string][]string{}
	uploads := map[string]upload{}
	var edits int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/reference.png":
			_, _ = w.Write(reference)
		case r.Method == http.MethodGet && r.URL.Path == "/mask.png":
			_, _ = w.Write(mask)
		case r.Method == http.MethodGet && r.URL.Path == "/small-mask.png":
			_, _ = w.Write(smallMask)
		case r.Method == http.MethodGet && r.URL.Path == "/not-an-image.txt":
			_, _ = io.WriteString(w, "plain text, not an image")
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/edits" && r.Header.Get("Authorization") == "Bearer test-key":
			edits++
			reader, err := r.MultipartReader()
			if err != nil {
				t.Errorf("MultipartReader: %v", err)
				return
			}
			for {
				part, err := reader.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Errorf("NextPart: %v", err)
					return
				}
				payload, _ := io.ReadAll(part)
				if part.FileName() != "" {
					uploads[part.FormName()] = upload{part.FileName(), part.Header.Get("Content-Type"), payload}
					continue
				}
				fields[part.FormName()] = append(fields[part.FormName()], string(payload))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"data":[{"b64_json":"`+base64.StdEncoding.EncodeToString(result)+`"}],"usage":{"input_tokens":300,"output_tokens":272}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.5-sunburst")
	edit := func(referencePath string, maskPath string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, error) {
		job := openAIImageTestJob("1024x1024", "low")
		spec := job.GetSpec().GetImageGenerate()
		spec.ReferenceImages = []string{server.URL + referencePath}
		if maskPath != "" {
			spec.Mask = server.URL + maskPath
		}
		artifacts, usage, _, err := provider.executeOpenAIImage(context.Background(), job, "gpt-image-2.5-sunburst", target)
		return artifacts, usage, err
	}
	artifacts, usage, err := edit("/reference.png", "/mask.png")
	if err != nil {
		t.Fatalf("masked edit: %v", err)
	}
	wantFields := map[string][]string{"model": {"gpt-image-2.5-sunburst"}, "prompt": {"A paper lantern"}, "size": {"1024x1024"}, "quality": {"low"}}
	if !reflect.DeepEqual(fields, wantFields) {
		t.Fatalf("fields = %v, want %v", fields, wantFields)
	}
	if got := uploads["image[]"]; got.name != "image.png" || got.contentType != "image/png" || !bytes.Equal(got.payload, reference) {
		t.Fatalf("image upload = %q %q %d bytes", got.name, got.contentType, len(got.payload))
	}
	if got := uploads["mask"]; got.name != "mask.png" || got.contentType != "image/png" || !bytes.Equal(got.payload, mask) || len(uploads) != 2 {
		t.Fatalf("mask upload = %q %q %d bytes, uploads=%d", got.name, got.contentType, len(got.payload), len(uploads))
	}
	if len(artifacts) != 1 || !bytes.Equal(artifacts[0].GetBytes(), result) || usage.GetInputTokens() != 300 || usage.GetOutputTokens() != 272 {
		t.Fatalf("artifacts=%+v usage=%+v", artifacts, usage)
	}

	edits = 0
	for name, paths := range map[string][2]string{
		"mask of another size": {"/reference.png", "/small-mask.png"},
		"reference not image":  {"/not-an-image.txt", ""},
	} {
		_, _, err := edit(paths[0], paths[1])
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("%s: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
	if edits != 0 {
		t.Fatalf("rejected edits reached the provider %d times", edits)
	}
}
