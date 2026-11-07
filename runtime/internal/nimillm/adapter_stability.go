package nimillm

import (
	"bytes"
	"context"
	"image"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const AdapterStabilityNative = "stability_native_adapter"

// Stability returns binary media, not an OpenAI image JSON envelope. Catalog
// model names map to reviewed native engines; callers cannot choose an endpoint.
func ExecuteStabilityImage(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	s := req.GetSpec().GetImageGenerate()
	engine, nativeModel := capabilitydriver.StabilityImageEngine(model)
	if s == nil || engine == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	fields := map[string]string{"prompt": s.GetPrompt(), "output_format": s.GetOutputFormat()}
	if nativeModel != "" {
		fields["model"] = nativeModel
		fields["mode"] = "text-to-image"
	}
	if s.GetNegativePrompt() != "" {
		fields["negative_prompt"] = s.GetNegativePrompt()
	}
	if s.GetAspectRatio() != "" {
		fields["aspect_ratio"] = s.GetAspectRatio()
	}
	if s.GetStyle() != "" {
		fields["style_preset"] = s.GetStyle()
	}
	if s.Seed != nil {
		fields["seed"] = strconv.FormatInt(s.GetSeed(), 10)
	}
	var reference *CapturedMediaReference
	if s.GetReferenceImageArtifactId() != "" {
		reference, _ = ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if reference == nil || reference.ArtifactID != s.GetReferenceImageArtifactId() {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		fields["strength"] = strconv.FormatFloat(float64(s.GetStrength()), 'f', -1, 32)
		if engine == "sd3" {
			fields["mode"] = "image-to-image"
		}
	}
	response, err := stabilityMultipart(ctx, cfg, "/v2beta/stable-image/generate/"+engine, "image/*", fields, func(w *multipart.Writer) error {
		if reference == nil {
			return nil
		}
		file, err := w.CreateFormFile("image", "reference."+imageExtension(reference.MIMEType))
		if err != nil {
			return err
		}
		_, err = file.Write(reference.Bytes)
		return err
	})
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	seed, err := stabilityResultHeaders(response)
	if err != nil {
		return nil, nil, "", err
	}
	if int64(seed) != s.GetSeed() {
		return nil, nil, "", stabilityInvalidOutput()
	}
	raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
	if err != nil {
		return nil, nil, "", providerResponseReadError(err)
	}
	geometry, format, err := image.DecodeConfig(bytes.NewReader(raw))
	mimeType, _, mimeErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mimeErr != nil || mimeType != "image/"+format || format != s.GetOutputFormat() || geometry.Width <= 0 || geometry.Height <= 0 {
		return nil, nil, "", stabilityInvalidOutput()
	}
	artifact := BinaryArtifact(mimeType, raw, map[string]any{"adapter": AdapterStabilityNative})
	actualSeed := int32(seed)
	artifact.Seed = &actualSeed
	artifact.Width, artifact.Height = int32(geometry.Width), int32(geometry.Height)
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func imageExtension(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return "jpeg"
	case "image/webp":
		return "webp"
	default:
		return "png"
	}
}

func stabilityInvalidOutput() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

func stabilityResultHeaders(response *http.Response) (uint32, error) {
	if response.StatusCode != http.StatusOK {
		return 0, stabilityResponseError(response)
	}
	switch response.Header.Get("finish-reason") {
	case "CONTENT_FILTERED":
		return 0, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	case "SUCCESS":
	default:
		return 0, stabilityInvalidOutput()
	}
	seed, err := strconv.ParseUint(response.Header.Get("seed"), 10, 32)
	if err != nil {
		return 0, stabilityInvalidOutput()
	}
	return uint32(seed), nil
}

func stabilityResponseError(response *http.Response) error {
	if response.StatusCode >= 200 && response.StatusCode < 400 {
		return stabilityInvalidOutput()
	}
	// Stability's native 403 is content moderation, not an invalid key.
	// Its 402 specifically identifies missing credits (401 is authentication).
	switch response.StatusCode {
	case http.StatusForbidden:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	case http.StatusPaymentRequired:
		return grpcerr.WithReasonCodeOptions(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, grpcerr.ReasonOptions{ActionHint: "replenish_provider_balance_or_adjust_quota"})
	case http.StatusRequestEntityTooLarge:
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	_, err := providerHTTPErrorFromResponse(response, "")
	return err
}

// Body ownership stays with the caller. Neither protocol follows redirects.
func stabilityMultipart(ctx context.Context, cfg MediaAdapterConfig, path, accept string, fields map[string]string, files func(*multipart.Writer) error) (*http.Response, error) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for key, value := range fields {
		if err := w.WriteField(key, value); err != nil {
			return nil, err
		}
	}
	if files != nil {
		if err := files(w); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return stabilityRequest(ctx, cfg, http.MethodPost, JoinURL(cfg.BaseURL, path), accept, w.FormDataContentType(), &body)
}

func stabilityRequest(ctx context.Context, cfg MediaAdapterConfig, method, target, accept, contentType string, body io.Reader) (*http.Response, error) {
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, err
	}
	client, request, err := newSecuredHTTPRequest(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	client.Timeout = 5 * time.Minute
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	applyProviderRequestHeaders(request, cfg.Headers)
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Accept", accept)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, markNativeCreateResponseUnavailable(ctx, MapProviderRequestError(err))
	}
	return response, nil
}
