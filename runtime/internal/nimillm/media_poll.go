package nimillm

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const providerPollInterval = 500 * time.Millisecond
const maxProviderPollAttempts int32 = int32(defaultHTTPTimeout / providerPollInterval)

func providerPollRetryLimitReached(ctx context.Context, retryCount int32) bool {
	if ctx == nil {
		return retryCount >= maxProviderPollAttempts
	}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		return false
	}
	return retryCount >= maxProviderPollAttempts
}

func providerPollTimeoutError() error {
	return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
}

func providerPollContextError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, context.Canceled):
		return grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_ACTION_EXECUTED)
	case errors.Is(err, context.DeadlineExceeded):
		return providerPollTimeoutError()
	default:
		return MapProviderRequestError(err)
	}
}

func providerPollDelay(retryCount int32) time.Duration {
	switch {
	case retryCount <= 1:
		return 2 * time.Second
	case retryCount <= 3:
		return 5 * time.Second
	case retryCount <= 10:
		return 10 * time.Second
	default:
		return 30 * time.Second
	}
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func bestEffortDeleteProviderAsyncTask(adapter string, baseURL string, apiKey string, providerJobID string) {
	if strings.TrimSpace(adapter) == "" || strings.TrimSpace(providerJobID) == "" {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = DeleteProviderAsyncTask(cleanupCtx, adapter, providerJobID, MediaAdapterConfig{
		BaseURL: baseURL,
		APIKey:  apiKey,
	})
}

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
	initialDelay := providerPollDelay(0)
	updater.UpdatePollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(initialDelay)), "")
	retryCount := int32(0)
	for {
		if ctx.Err() != nil {
			bestEffortDeleteProviderAsyncTask(adapter, baseURL, apiKey, providerJobID)
			return nil, nil, providerJobID, providerPollContextError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := ResolveTaskQueryPath(queryPathTemplate, providerJobID)
		if err := DoJSONRequest(ctx, http.MethodGet, JoinURL(baseURL, pollPath), apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		statusText := ResolveAsyncTaskStatus(pollResp)
		if IsAsyncTaskPendingStatus(statusText) {
			if providerPollRetryLimitReached(ctx, retryCount) {
				updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
				return nil, nil, providerJobID, providerPollTimeoutError()
			}
			delay := providerPollDelay(retryCount)
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), "")
			if err := sleepWithContext(ctx, delay); err != nil {
				bestEffortDeleteProviderAsyncTask(adapter, baseURL, apiKey, providerJobID)
				return nil, nil, providerJobID, providerPollContextError(err)
			}
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
