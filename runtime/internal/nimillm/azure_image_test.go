package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAzureNativeImageGenerationAndOwnedMaskUseCapturedDeployment(t *testing.T) {
	for _, model := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-1.5"} {
		t.Run(model, func(t *testing.T) {
			source, mask := openAIImageTestPNG(1024, 1024), openAIImageTestMask(1024, 1024)
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "POST" || r.Header.Get("api-key") != "azure-test-key" || r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" {
					t.Error("incorrect native Azure request")
				}
				switch r.URL.Path {
				case "/openai/v1/images/generations":
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body["model"] != "captured-images" || body["response_format"] != nil || body["output_format"] != "png" {
						t.Error("incorrect Azure image mapping", body)
					}
				case "/openai/v1/images/edits":
					if err := r.ParseMultipartForm(8 << 20); err != nil {
						t.Error(err)
						return
					}
					defer func(cleanup func() error) { _ = cleanup() }(r.MultipartForm.RemoveAll)
					if r.FormValue("model") != "captured-images" || r.FormValue("response_format") != "" {
						t.Error("wrong edit fields")
					}
					read := func(name string) []byte {
						f, _, err := r.FormFile(name)
						if err != nil {
							t.Error(err)
							return nil
						}
						defer func(cleanup func() error) { _ = cleanup() }(f.Close)
						data, _ := io.ReadAll(f)
						return data
					}
					if !bytes.Equal(read("image[]"), source) {
						t.Error("source bytes changed")
					}
					alpha, err := png.Decode(bytes.NewReader(read("mask")))
					if err != nil {
						t.Error(err)
						return
					}
					_, _, _, edit := alpha.At(0, 0).RGBA()
					_, _, _, keep := alpha.At(1023, 0).RGBA()
					if edit != 0 || keep != 65535 {
						t.Error("canonical mask meaning changed")
					}
				default:
					t.Error("wrong native image path", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(source)}}, "usage": map[string]int{"input_tokens": 12, "output_tokens": 34}})
			}))
			defer server.Close()
			provider := NewCloudProvider(CloudConfig{AllowLoopbackEndpoint: true})
			target := &RemoteTarget{ProviderType: "azure", ProviderModelID: model, Endpoint: server.URL, APIKey: "azure-test-key", AzureDeploymentName: "captured-images", AllowLoopback: true}
			job := openAIImageTestJob("1024x1024", "low")
			spec := job.GetSpec().GetImageGenerate()
			spec.OutputFormat = "png"
			ctx := context.Background()
			for _, edit := range []bool{false, true} {
				if edit {
					capture := func(id string, data []byte) *CapturedMediaReference {
						digest := sha256.Sum256(data)
						return &CapturedMediaReference{ArtifactID: id, MIMEType: "image/png", SHA256: hex.EncodeToString(digest[:]), Bytes: data}
					}
					spec.ReferenceImageArtifactId, spec.MaskArtifactId = "source", "mask"
					sourceRef, maskRef := capture("source", source), capture("mask", mask)
					if err := ValidateCloudImageReferenceRequest("azure", model, spec, sourceRef); err != nil {
						t.Fatal(err)
					}
					if err := ValidateCloudImageMaskReference("azure", model, spec, sourceRef, maskRef); err != nil {
						t.Fatal(err)
					}
					ctx = WithImageMaskReference(WithImageReference(ctx, sourceRef), maskRef)
				}
				artifacts, usage, _, err := provider.executeOpenAIImage(ctx, job, model, target)
				if err != nil || len(artifacts) != 1 || !bytes.Equal(artifacts[0].GetBytes(), source) || artifacts[0].GetWidth() != 1024 || usage.GetInputTokens() != 12 || usage.GetOutputTokens() != 34 {
					t.Fatalf("edit=%v: artifacts=%d usage=%v error=%v", edit, len(artifacts), usage, err)
				}
			}
			if calls != 2 {
				t.Fatal("unexpected dispatch count", calls)
			}
		})
	}
}
