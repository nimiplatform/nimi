package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"net/http"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGoogleVeoOperation = "google_veo_operation_adapter"
const (
	googleVeoFastModel     = "veo-3.1-fast-generate-preview"
	googleVeoStandardModel = "veo-3.1-generate-preview"
	googleVeoLiteModel     = "veo-3.1-lite-generate-preview"
)

func googleVeoOperationModelAllowed(model string) bool {
	switch model {
	case googleVeoFastModel, googleVeoStandardModel, googleVeoLiteModel:
		return true
	default:
		return false
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r049
// ExecuteGoogleVeoOperation invokes the exact Google Veo 3.1 preview dialect and Fast HTTPS first-frame input.
// Operation identity and the protected file URI remain Host-private until the
// artifact body is detached into Runtime custody.
func ExecuteGoogleVeoOperation(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	if scenarioModal(req) != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioVideoSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	model := strings.TrimSpace(modelResolved)
	if model == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODEL_ID_REQUIRED)
	}
	if !googleVeoOperationModelAllowed(model) || (spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_T2V && (model != googleVeoFastModel || spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME)) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	prompt := VideoPrompt(spec)
	if prompt == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	firstFrames := 0
	for _, item := range spec.GetContent() {
		if item == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT && (item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT || item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED) {
			continue
		}
		if spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME || item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL || item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		firstFrames++
	}
	if spec.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME && firstFrames != 1 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	instance := map[string]any{"prompt": prompt}
	parameters := map[string]any{"aspectRatio": "16:9", "durationSeconds": 4, "resolution": "720p"}
	if spec.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
		firstFrame, err := googleVeoFirstFrame(ctx, VideoFirstFrameURI(spec))
		if err != nil {
			return nil, nil, "", err
		}
		instance["image"] = firstFrame
		parameters["personGeneration"] = "allow_adult"
	}
	payload := map[string]any{"instances": []map[string]any{instance}, "parameters": parameters}
	headers := map[string]string{"x-goog-api-key": apiKey}
	submitResp := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, "/v1beta/models/"+model+":predictLongRunning"), "", payload, &submitResp, headers); err != nil {
		return nil, nil, "", err
	}
	providerJobID := strings.TrimSpace(ValueAsString(submitResp["name"]))
	if !validGoogleVeoOperationName(providerJobID, model) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	initialDelay := providerPollDelay(0)
	updater.UpdatePollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(initialDelay)), "")
	retryCount := int32(0)
	consecutiveErrors := int32(0)
	detached := isDetachedPollContext(ctx)
	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, providerPollContextError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollURL := JoinURL(baseURL, "/v1beta/"+providerJobID)
		if err := DoJSONRequestWithHeaders(ctx, http.MethodGet, pollURL, "", nil, &pollResp, headers); err != nil {
			if detached && ctx.Err() == nil && isTransientPollError(err) {
				consecutiveErrors++
				if consecutiveErrors >= maxDetachedPollConsecutiveErrors {
					updater.UpdatePollState(jobID, providerJobID, retryCount, nil, err.Error())
					return nil, nil, providerJobID, err
				}
				delay := providerPollDelay(retryCount)
				updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), err.Error())
				if sleepErr := sleepWithContext(ctx, delay); sleepErr != nil {
					return nil, nil, providerJobID, providerPollContextError(sleepErr)
				}
				continue
			}
			return nil, nil, providerJobID, err
		}
		consecutiveErrors = 0
		if _, failed := pollResp["error"]; failed {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "failed")
			return nil, nil, providerJobID, providerTaskFailedError("failed", pollResp)
		}
		if !ValueAsBool(pollResp["done"]) {
			if providerPollRetryLimitReached(ctx, retryCount) {
				updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
				return nil, nil, providerJobID, providerPollTimeoutError()
			}
			delay := providerPollDelay(retryCount)
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), "")
			if err := sleepWithContext(ctx, delay); err != nil {
				return nil, nil, providerJobID, providerPollContextError(err)
			}
			continue
		}
		uri := googleVeoVideoURI(pollResp)
		if !validGoogleVeoArtifactURL(uri) {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		artifact := BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterGoogleVeoOperation})
		artifact.Uri = uri
		ApplyVideoSpecMetadata(artifact, spec)
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.ScenarioArtifact{artifact}, nil, providerJobID, nil
	}
}

func validGoogleVeoOperationName(name string, model string) bool {
	prefix := "models/" + model + "/operations/"
	if !strings.HasPrefix(name, prefix) {
		return false
	}
	id := strings.TrimPrefix(name, prefix)
	if len(id) == 0 || len(id) > 128 {
		return false
	}
	for _, char := range id {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func googleVeoVideoURI(payload map[string]any) string {
	response := MapField(payload["response"], "generateVideoResponse")
	samples, ok := MapField(response, "generatedSamples").([]any)
	if !ok || len(samples) != 1 {
		return ""
	}
	return strings.TrimSpace(ValueAsString(MapField(MapField(samples[0], "video"), "uri")))
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
// Only an existing HTTPS input is read. No artifact bridge or upstream Files
// upload is introduced; the declared Cloud input travels in this request body.
func googleVeoFirstFrame(ctx context.Context, location string) (map[string]any, error) {
	parsed, err := url.Parse(location)
	invalid := func() (map[string]any, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return invalid()
	}
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodGet, location, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, MapProviderHTTPError(response.StatusCode, nil)
	}
	payload, err := readLimitedResponseBody(response.Body, 20*1024*1024)
	if err != nil || len(payload) == 0 {
		return invalid()
	}
	return googleVeoInlineFirstFrame(payload)
}

func googleVeoInlineFirstFrame(payload []byte) (map[string]any, error) {
	invalid := func() (map[string]any, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(payload) == 0 || len(payload) > 20*1024*1024 {
		return invalid()
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(payload))
	if err != nil || (format != "png" && format != "jpeg") || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 16<<20 {
		return invalid()
	}
	if _, _, err := image.Decode(bytes.NewReader(payload)); err != nil {
		return invalid()
	}
	mimeType := "image/png"
	if format == "jpeg" {
		mimeType = "image/jpeg"
	}
	return map[string]any{"bytesBase64Encoded": base64.StdEncoding.EncodeToString(payload), "mimeType": mimeType}, nil
}
