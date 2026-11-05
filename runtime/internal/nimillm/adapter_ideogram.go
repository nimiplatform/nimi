package nimillm

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterIdeogramNative = "ideogram_native_adapter"

// ExecuteIdeogramImage executes an image generation scenario job against the Ideogram API.
// Exact 4.5 uses the v2 asynchronous protocol; earlier targets use their separate endpoint mapping.
func ExecuteIdeogramImage(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if modelResolved == capabilitydriver.Ideogram45Model {
		return executeIdeogram45Image(ctx, cfg, scenarioImageSpec(req))
	}
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED)
	}

	if scenarioModal(req) != runtimev1.Modal_MODAL_IMAGE {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if modelResolved != "ideogram-v3" && modelResolved != "ideogram-v2-turbo" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	imageRequest := map[string]any{
		"prompt": spec.GetPrompt(),
	}
	if negPrompt := strings.TrimSpace(spec.GetNegativePrompt()); negPrompt != "" {
		imageRequest["negative_prompt"] = negPrompt
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		if modelResolved == "ideogram-v3" {
			imageRequest["aspect_ratio"] = strings.ReplaceAll(aspectRatio, ":", "x")
		} else {
			imageRequest["aspect_ratio"] = "ASPECT_" + strings.ReplaceAll(aspectRatio, ":", "_")
		}
	}
	if style := strings.TrimSpace(spec.GetStyle()); style != "" {
		imageRequest["style_type"] = strings.ToUpper(style)
	}
	if seed := spec.GetSeed(); spec.Seed != nil {
		imageRequest["seed"] = seed
	}

	endpoint := "/generate"
	resp := map[string]any{}
	headers := cloneMediaHeaders(cfg.Headers)
	if headers == nil {
		headers = map[string]string{}
	}
	headers["Api-Key"] = apiKey
	if modelResolved == "ideogram-v3" {
		endpoint = "/v1/ideogram-v3/generate"
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for key, value := range imageRequest {
			if err := writer.WriteField(key, fmt.Sprint(value)); err != nil {
				return nil, nil, "", err
			}
		}
		if err := writer.Close(); err != nil {
			return nil, nil, "", err
		}
		if err := postIdeogramMultipart(ctx, JoinURL(baseURL, endpoint), body.Bytes(), writer.FormDataContentType(), headers, &resp); err != nil {
			return nil, nil, "", err
		}
	} else {
		imageRequest["model"] = "V_2_TURBO"
		if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, endpoint), "", map[string]any{"image_request": imageRequest}, &resp, headers); err != nil {
			return nil, nil, "", err
		}
	}
	data, ok := resp["data"].([]any)
	if !ok || len(data) != 1 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	row, ok := data[0].(map[string]any)
	if !ok {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	safe, ok := row["is_image_safe"].(bool)
	if !ok {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !safe {
		return nil, nil, "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	artifactURI := ValueAsString(row["url"])
	if !validNativeVideoArtifactURL(artifactURI) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	artifactMeta := map[string]any{
		"adapter":  AdapterIdeogramNative,
		"endpoint": endpoint,
		"prompt":   strings.TrimSpace(spec.GetPrompt()),
	}
	if artifactURI != "" {
		artifactMeta["uri"] = artifactURI
	}
	artifact := BinaryArtifact("image/png", nil, artifactMeta)
	artifact.Uri = artifactURI
	ApplyImageSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}
