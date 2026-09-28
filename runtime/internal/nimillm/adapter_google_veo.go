package nimillm

import (
	"context"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGoogleVeoOperation = "google_veo_operation_adapter"
const googleVeoFastModel = "veo-3.1-fast-generate-preview"

// @nimi-authority: rule.nimi.runtime.ai-provider.r049
// ExecuteGoogleVeoOperation invokes one exact Google Fast text-to-video dialect.
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
	if model != googleVeoFastModel || spec.GetMode() != runtimev1.VideoMode_VIDEO_MODE_T2V {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	prompt := VideoPrompt(spec)
	if prompt == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	payload := map[string]any{
		"instances":  []map[string]any{{"prompt": prompt}},
		"parameters": map[string]any{"aspectRatio": "16:9", "durationSeconds": 4, "resolution": "720p"},
	}
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
