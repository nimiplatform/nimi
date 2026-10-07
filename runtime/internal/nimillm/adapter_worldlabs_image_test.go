package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func worldImageFixture(t *testing.T, projection runtimev1.WorldImageProjection) (*runtimev1.WorldGenerateScenarioSpec, *ImageReference) {
	t.Helper()
	var out bytes.Buffer
	if err := png.Encode(&out, image.NewRGBA(image.Rect(0, 0, 8, 4))); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(out.Bytes())
	return &runtimev1.WorldGenerateScenarioSpec{Conditioning: &runtimev1.WorldGenerateScenarioSpec_ImagePrompt{ImagePrompt: &runtimev1.WorldGenerateImagePrompt{
		Content: &runtimev1.WorldGenerateAssetSource{Source: &runtimev1.WorldGenerateAssetSource_ArtifactId{ArtifactId: "owned-image"}}, Projection: projection,
	}}}, &ImageReference{ArtifactID: "owned-image", MIMEType: "image/png", Bytes: out.Bytes(), SHA256: hex.EncodeToString(digest[:])}
}

func TestWorldImageSignedUploadPreservesCaptureAndNeverForwardsControlCredentials(t *testing.T) {
	for _, projection := range []runtimev1.WorldImageProjection{runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY, runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360} {
		t.Run(projection.String(), func(t *testing.T) {
			spec, reference := worldImageFixture(t, projection)
			original := bytes.Clone(reference.Bytes)
			prepared, uploaded := 0, 0
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/marble/v1/media-assets:prepare_upload":
					prepared++
					if r.Method != http.MethodPost || r.Header.Get("WLT-Api-Key") != "control-secret" {
						t.Error("control request authentication is missing")
					}
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if body["kind"] != "image" || body["extension"] != "png" || body["file_name"] != "world-input.png" {
						t.Error("prepare input changed")
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"media_asset": map[string]any{"media_asset_id": "private-provider-id", "kind": "image"}, "upload_info": map[string]any{"upload_method": "PUT", "upload_url": server.URL + "/signed?signature=private", "required_headers": map[string]string{"Content-Type": "image/png"}}})
				case "/signed":
					uploaded++
					if r.Method != http.MethodPut || r.Header.Get("WLT-Api-Key") != "" || r.Header.Get("Authorization") != "" || r.Header.Get("X-Owner-Control") != "" {
						t.Error("control credentials or headers forwarded")
					}
					body, _ := io.ReadAll(r.Body)
					if !bytes.Equal(body, original) {
						t.Error("upload did not use immutable captured bytes")
					}
				default:
					t.Error("unexpected request")
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			ctx := WithImageReference(loopbackProviderTestContext(context.Background()), reference)
			reference.Bytes[0] ^= 0xff
			id, err := uploadWorldLabsImage(ctx, server.URL, map[string]string{"WLT-Api-Key": "control-secret", "X-Owner-Control": "private"}, spec)
			if err != nil || id != "private-provider-id" || prepared != 1 || uploaded != 1 {
				t.Fatalf("upload failed: %v", err)
			}
			payload, _, err := buildWorldLabsGeneratePayload(spec, "marble-1.1", id)
			if err != nil {
				t.Fatal(err)
			}
			prompt := payload["world_prompt"].(map[string]any)
			input := prompt["image_prompt"].(map[string]any)
			if input["source"] != "media_asset" || input["media_asset_id"] != id || input["artifact_id"] != nil || prompt["text_prompt"] != nil || prompt["is_pano"] != (projection == runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360) {
				t.Fatal("owned projection or optional text was changed")
			}
		})
	}
}

func TestWorldImageRejectsUntrustedSignedUploadBeforeAnyUpload(t *testing.T) {
	for _, headers := range []map[string]string{{"Authorization": "secret"}, {"WLT-Api-Key": "secret"}, {"Cookie": "secret"}, {"Content-Type": "image/jpeg"}, {"Content-Type": "image/png", "content-type": "image/png"}} {
		spec, reference := worldImageFixture(t, runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY)
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			_ = json.NewEncoder(w).Encode(map[string]any{"media_asset": map[string]any{"media_asset_id": "private", "kind": "image"}, "upload_info": map[string]any{"upload_method": "PUT", "upload_url": "https://example.invalid/signed", "required_headers": headers}})
		}))
		_, err := uploadWorldLabsImage(WithImageReference(loopbackProviderTestContext(context.Background()), reference), server.URL, map[string]string{"WLT-Api-Key": "control"}, spec)
		server.Close()
		if err == nil || calls != 1 {
			t.Fatal("untrusted signed response was admitted")
		}
	}
}

func TestWorldImageRejectsMissingProjectionBrokenCaptureAndNonPanoGeometry(t *testing.T) {
	spec, reference := worldImageFixture(t, runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_UNSPECIFIED)
	if ValidateWorldLabsImageReference(spec, reference) == nil {
		t.Fatal("missing projection admitted")
	}
	spec.GetImagePrompt().Projection = runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY
	copy := *reference
	copy.SHA256 = "wrong"
	if ValidateWorldLabsImageReference(spec, &copy) == nil {
		t.Fatal("changed capture admitted")
	}
	copy = *reference
	copy.MIMEType = "image/jpeg"
	if ValidateWorldLabsImageReference(spec, &copy) == nil {
		t.Fatal("MIME mismatch admitted")
	}
	var out bytes.Buffer
	_ = png.Encode(&out, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	digest := sha256.Sum256(out.Bytes())
	reference.Bytes = out.Bytes()
	reference.SHA256 = hex.EncodeToString(digest[:])
	spec.GetImagePrompt().Projection = runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360
	if ValidateWorldLabsImageReference(spec, reference) == nil {
		t.Fatal("square panorama admitted")
	}
	spec.GetImagePrompt().Projection = runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY
	if err := ValidateWorldLabsImageReference(spec, reference); err != nil {
		t.Fatalf("ordinary square image rejected: %v", err)
	}
}
