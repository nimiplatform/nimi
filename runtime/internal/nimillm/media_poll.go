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

// maxDetachedPollConsecutiveErrors is the number of consecutive transient poll
// request failures tolerated for detached (cancel-only) polling before the job
// gives up. At 30 s backoff per retry this tolerates ~5 minutes of provider
// endpoint downtime. Only applies when the context has no deadline.
const maxDetachedPollConsecutiveErrors int32 = 10

type providerPollWait func(context.Context, time.Duration) error

type providerPollWaitContextKey struct{}

// WithProviderPollWait installs an internal owner seam for deterministic poll
// scheduling. Production callers do not set it and retain the real timer path.
func WithProviderPollWait(ctx context.Context, wait func(context.Context, time.Duration) error) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if wait == nil {
		return ctx
	}
	return context.WithValue(ctx, providerPollWaitContextKey{}, providerPollWait(wait))
}

// isDetachedPollContext returns true when the context has no deadline, meaning
// the caller intended the poll to run indefinitely until a provider terminal
// state or an explicit cancel. In this mode, transient per-request failures
// should be retried rather than immediately terminating the job.
func isDetachedPollContext(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	_, hasDeadline := ctx.Deadline()
	return !hasDeadline
}

// isTransientPollError returns true when an error from DoJSONRequest represents
// a transient infrastructure failure that is safe to retry during detached
// polling. Only network-level and server-side failures qualify:
//   - AI_PROVIDER_TIMEOUT  (HTTP client timeout, gateway timeout)
//   - AI_PROVIDER_UNAVAILABLE (connection refused, 502, 503)
//   - AI_PROVIDER_INTERNAL (500)
//
// Permanent provider errors (auth, not-found, bad-request, content-filter,
// rate-limit, output-invalid) are NOT transient and must fail the job
// immediately even in detached mode.
func isTransientPollError(err error) bool {
	if err == nil {
		return false
	}
	reasonCode, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		// Cannot classify — treat as non-transient to fail fast.
		return false
	}
	switch reasonCode {
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		runtimev1.ReasonCode_AI_PROVIDER_INTERNAL:
		return true
	default:
		return false
	}
}

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
		return grpcerr.WrapWithReasonCode(
			codes.Canceled,
			runtimev1.ReasonCode_ACTION_EXECUTED,
			err,
			grpcerr.ReasonOptions{Message: "provider polling was canceled"},
		)
	case errors.Is(err, context.DeadlineExceeded):
		return grpcerr.WrapWithReasonCode(
			codes.DeadlineExceeded,
			runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			err,
			grpcerr.ReasonOptions{Message: "provider polling timed out"},
		)
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
	if wait, ok := ctx.Value(providerPollWaitContextKey{}).(providerPollWait); ok && wait != nil {
		return wait(ctx, delay)
	}
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

func bestEffortDeleteProviderAsyncTask(ctx context.Context, adapter string, baseURL string, apiKey string, providerJobID string) {
	if strings.TrimSpace(adapter) == "" || strings.TrimSpace(providerJobID) == "" {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = DeleteProviderAsyncTask(cleanupCtx, adapter, providerJobID, MediaAdapterConfig{
		BaseURL:               baseURL,
		APIKey:                apiKey,
		AllowLoopbackEndpoint: allowLoopbackProviderEndpointFromContext(ctx),
	})
}

func providerTaskFailedError(statusText string, payload map[string]any) error {
	metadata := map[string]string{}
	if status := strings.TrimSpace(statusText); status != "" {
		metadata["provider_task_status"] = status
	}
	providerMessage := normalizeProviderErrorMessage(ProviderTaskFailureMessage(payload))
	if IsContentFilterMessage(strings.ToLower(providerMessage)) {
		return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED, grpcerr.ReasonOptions{
			ActionHint: "revise_prompt_or_policy_sensitive_inputs",
			Message:    "provider task failed",
			Metadata:   metadata,
		})
	}
	if providerTaskFailureLooksLikeRequestIssue(providerMessage) {
		grpcCode, reasonCode, actionHint := classifyProviderBadRequest(providerMessage)
		return grpcerr.WithReasonCodeOptions(grpcCode, reasonCode, grpcerr.ReasonOptions{
			ActionHint: actionHint,
			Message:    "provider task failed",
			Metadata:   metadata,
		})
	}
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		ActionHint: "check_provider_endpoint_or_live_task_status",
		Message:    "provider task failed",
		Metadata:   metadata,
	})
}

func providerTaskFailureLooksLikeRequestIssue(providerMessage string) bool {
	normalized := strings.ToLower(strings.TrimSpace(providerMessage))
	if normalized == "" {
		return false
	}
	return containsAnyToken(
		normalized,
		"paid plan",
		"subscription",
		"payment required",
		"insufficient balance",
		"insufficient credits",
		"quota",
		"limit",
		"api key",
		"auth",
		"model not found",
		"unknown model",
		"model does not exist",
		"model is not available",
		"invalid model",
		"unsupported",
		"not supported",
		"invalid",
		"required",
		"requires",
		"must be",
		"out of range",
		"resolution",
		"ratio",
		"duration",
		"size",
	)
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
	consecutiveErrors := int32(0)
	detached := isDetachedPollContext(ctx)
	for {
		if ctx.Err() != nil {
			bestEffortDeleteProviderAsyncTask(ctx, adapter, baseURL, apiKey, providerJobID)
			return nil, nil, providerJobID, providerPollContextError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := ResolveTaskQueryPath(queryPathTemplate, providerJobID)
		if err := DoJSONRequest(ctx, http.MethodGet, JoinURL(baseURL, pollPath), apiKey, nil, &pollResp); err != nil {
			// For detached polling (cancel-only ctx), transient infrastructure
			// failures (timeout, 5xx, connection errors) are retried with
			// backoff. Permanent provider errors (auth, not-found, bad-request,
			// content-filter) fail the job immediately.
			if detached && ctx.Err() == nil && isTransientPollError(err) {
				consecutiveErrors++
				if consecutiveErrors >= maxDetachedPollConsecutiveErrors {
					updater.UpdatePollState(jobID, providerJobID, retryCount, nil, err.Error())
					return nil, nil, providerJobID, err
				}
				delay := providerPollDelay(retryCount)
				updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), err.Error())
				if sleepErr := sleepWithContext(ctx, delay); sleepErr != nil {
					bestEffortDeleteProviderAsyncTask(ctx, adapter, baseURL, apiKey, providerJobID)
					return nil, nil, providerJobID, providerPollContextError(sleepErr)
				}
				continue
			}
			return nil, nil, providerJobID, err
		}
		consecutiveErrors = 0
		statusText := ResolveAsyncTaskStatus(pollResp)
		if IsAsyncTaskPendingStatus(statusText) {
			if providerPollRetryLimitReached(ctx, retryCount) {
				updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
				return nil, nil, providerJobID, providerPollTimeoutError()
			}
			delay := providerPollDelay(retryCount)
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), "")
			if err := sleepWithContext(ctx, delay); err != nil {
				bestEffortDeleteProviderAsyncTask(ctx, adapter, baseURL, apiKey, providerJobID)
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
			return nil, nil, providerJobID, providerTaskFailedError(statusText, pollResp)
		}
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(ctx, pollResp)
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
