package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime"
	"net/http"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/mediaimage"
	"google.golang.org/grpc/codes"
)

const worldLabsImageMaxBytes = 20_000_000

// @nimi-authority: rule.nimi.runtime.ai-provider.r029
// Both admission and dispatch validate the same captured bytes. No artifact is
// reopened by the Driver and an aspect ratio never chooses the projection.
func ValidateWorldLabsImageReference(spec *runtimev1.WorldGenerateScenarioSpec, reference *ImageReference) error {
	if err := ValidateWorldLabsRequestFields(spec); err != nil {
		return err
	}
	image := spec.GetImagePrompt()
	id := image.GetContent().GetArtifactId()
	if image == nil || id == "" || reference == nil || reference.ArtifactID != id || len(reference.Bytes) == 0 ||
		(image.GetProjection() != runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY && image.GetProjection() != runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if len(reference.Bytes) > worldLabsImageMaxBytes {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	digest := sha256.Sum256(reference.Bytes)
	if reference.SHA256 != hex.EncodeToString(digest[:]) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	info, err := mediaimage.Inspect(reference.Bytes, worldLabsImageMaxBytes, 16<<20)
	if err != nil || (info.Format != "png" && info.Format != "jpeg" && info.Format != "webp") || reference.MIMEType != "image/"+info.Format {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	if info.Orientation != 1 || (image.GetProjection() == runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360 && info.Width != 2*info.Height) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r029
func uploadWorldLabsImage(ctx context.Context, baseURL string, controlHeaders map[string]string, spec *runtimev1.WorldGenerateScenarioSpec) (string, error) {
	reference, _ := ctx.Value(imageReferenceContextKey{}).(*ImageReference)
	if err := ValidateWorldLabsImageReference(spec, reference); err != nil {
		return "", err
	}
	extension := strings.TrimPrefix(reference.MIMEType, "image/")
	if extension == "jpeg" {
		extension = "jpg"
	}
	response := map[string]any{}
	if err := doJSONRequestWithHeadersAndObservation(ctx, http.MethodPost, JoinURL(baseURL, "/marble/v1/media-assets:prepare_upload"), "",
		map[string]any{"file_name": "world-input." + extension, "extension": extension, "kind": "image"}, &response, controlHeaders, 0, AdapterWorldLabsNative); err != nil {
		return "", err
	}
	asset, _ := response["media_asset"].(map[string]any)
	info, _ := response["upload_info"].(map[string]any)
	id, ok := asset["media_asset_id"].(string)
	if !ok || strings.TrimSpace(id) != id || id == "" || len(id) > 512 || asset["kind"] != "image" {
		return "", worldLabsUploadInvalid()
	}
	target, ok := info["upload_url"].(string)
	if !ok || strings.TrimSpace(target) != target || target == "" || info["upload_method"] != http.MethodPut {
		return "", worldLabsUploadInvalid()
	}
	headers, ok := info["required_headers"].(map[string]any)
	if !ok {
		return "", worldLabsUploadInvalid()
	}
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodPut, target, bytes.NewReader(reference.Bytes))
	if err != nil {
		return "", err
	}
	// A signed destination may supply only upload headers, never control API
	// credentials or caller headers. Redirects would change the signed target.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	request.Header.Set("Content-Type", reference.MIMEType)
	seen := map[string]bool{}
	for name, raw := range headers {
		key := strings.ToLower(name)
		value, valid := raw.(string)
		if !valid || seen[key] || !utf8.ValidString(value) || strings.ContainsAny(name+value, "\r\n") || strings.TrimSpace(name) != name ||
			!(key == "content-type" || strings.HasPrefix(key, "x-goog-") || strings.HasPrefix(key, "x-amz-")) {
			return "", worldLabsUploadInvalid()
		}
		seen[key] = true
		if key == "content-type" {
			mediaType, _, parseErr := mime.ParseMediaType(value)
			if parseErr != nil || mediaType != reference.MIMEType {
				return "", worldLabsUploadInvalid()
			}
		}
		request.Header.Set(name, value)
	}
	result, err := client.Do(request)
	if err != nil {
		return "", MapProviderRequestError(err)
	}
	defer result.Body.Close()
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		return "", MapProviderHTTPError(result.StatusCode, nil)
	}
	if _, err := io.Copy(io.Discard, io.LimitReader(result.Body, 32<<10)); err != nil {
		return "", providerResponseReadError(err)
	}
	return id, nil
}

func worldLabsUploadInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r029
func ValidateWorldLabsRequestFields(spec *runtimev1.WorldGenerateScenarioSpec) error {
	if spec == nil || utf8.RuneCountInString(spec.GetTextPrompt()) > 2000 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}
