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

// PollProviderTaskForArtifact polls a provider's async task endpoint until
// the task completes and returns the resulting artifact.
func PollProviderTaskForArtifact(
	ctx context.Context,
	updater JobStateUpdater,
	jobID string,
	baseURL string,
	apiKey string,
	adapter string,
	providerJobID string,
	submitPath string,
	queryPathTemplate string,
	defaultMIME string,
	computeMs int64,
	prompt string,
	applyMetadata func(*runtimev1.ScenarioArtifact),
	extraArtifactMeta map[string]any,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	updater.UpdatePollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
	retryCount := int32(0)
	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, MapProviderRequestError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := ResolveTaskQueryPath(queryPathTemplate, providerJobID)
		if err := DoJSONRequest(ctx, http.MethodGet, JoinURL(baseURL, pollPath), apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		statusText := ResolveAsyncTaskStatus(pollResp)
		if IsAsyncTaskPendingStatus(statusText) {
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if IsAsyncTaskCanceledStatus(statusText) {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_ACTION_EXECUTED)
		}
		if IsAsyncTaskExpiredStatus(statusText) {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		}
		if IsAsyncTaskFailedStatus(statusText) {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if strings.TrimSpace(mimeType) == "" {
			mimeType = strings.TrimSpace(defaultMIME)
			if mimeType == "" {
				mimeType = strings.TrimSpace(http.DetectContentType(artifactBytes))
			}
		}
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		artifactMeta := map[string]any{
			"adapter":         adapter,
			"submit_endpoint": submitPath,
			"query_endpoint":  queryPathTemplate,
			"response":        pollResp,
		}
		for key, value := range extraArtifactMeta {
			artifactMeta[key] = value
		}
		if artifactURI != "" {
			artifactMeta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
		if applyMetadata != nil {
			applyMetadata(artifact)
		}
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(prompt, artifactBytes, computeMs), providerJobID, nil
	}
}
