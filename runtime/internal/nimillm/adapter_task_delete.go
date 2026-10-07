package nimillm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type ProviderTaskCleanupOutcome string

const (
	ProviderTaskCleanupCanceled      ProviderTaskCleanupOutcome = "confirmed_canceled"
	ProviderTaskCleanupNotCancelable ProviderTaskCleanupOutcome = "not_cancelable"
	ProviderTaskCleanupUnconfirmed   ProviderTaskCleanupOutcome = "unconfirmed"
	ProviderTaskCleanupUnsupported   ProviderTaskCleanupOutcome = "unsupported"
	ProviderTaskCleanupFailed        ProviderTaskCleanupOutcome = "failed"
)

// DeleteProviderAsyncTask reports the provider's observed cleanup outcome.
// A successful HTTP request alone does not establish that computation stopped.
func DeleteProviderAsyncTask(ctx context.Context, adapter string, providerJobID string, cfg MediaAdapterConfig) (ProviderTaskCleanupOutcome, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	switch strings.TrimSpace(adapter) {
	case AdapterBytedanceARKTask:
		if err := deleteBytedanceARKTask(ctx, providerJobID, cfg); err != nil {
			return ProviderTaskCleanupFailed, err
		}
		return ProviderTaskCleanupUnconfirmed, nil
	case AdapterSpaitialNative:
		return cancelSpaitialTask(ctx, providerJobID, cfg)
	case AdapterAlibabaNative:
		return cancelAlibabaTask(ctx, providerJobID, cfg)
	default:
		return ProviderTaskCleanupUnsupported, nil
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r075
// DashScope's official SDK joins tasks/{id}/cancel and POSTs it. Only queued
// tasks can be canceled; RUNNING may report UnsupportedOperation.
func cancelAlibabaTask(ctx context.Context, taskID string, cfg MediaAdapterConfig) (ProviderTaskCleanupOutcome, error) {
	baseURL := nativeOriginURL(cfg.BaseURL)
	if baseURL == "" || taskID == "" || taskID != strings.TrimSpace(taskID) {
		return ProviderTaskCleanupFailed, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodPost, JoinURL(baseURL, "/api/v1/tasks/"+url.PathEscape(taskID)+"/cancel"), nil)
	if err != nil {
		return ProviderTaskCleanupFailed, err
	}
	request.Header.Set("Accept", "application/json")
	applyProviderRequestHeaders(request, cfg.Headers)
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	response, err := client.Do(request)
	if err != nil {
		return ProviderTaskCleanupFailed, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	var payload map[string]any
	decodeErr := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload)
	if response.StatusCode == http.StatusBadRequest && payload["code"] == "UnsupportedOperation" {
		return ProviderTaskCleanupNotCancelable, MapProviderHTTPError(response.StatusCode, payload)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ProviderTaskCleanupFailed, MapProviderHTTPError(response.StatusCode, payload)
	}
	if decodeErr != nil || (payload["code"] != nil && payload["code"] != "") {
		return ProviderTaskCleanupUnconfirmed, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	output, _ := payload["output"].(map[string]any)
	if output["task_id"] == taskID && output["task_status"] == "CANCELED" {
		return ProviderTaskCleanupCanceled, nil
	}
	// The documented POST response contains only request_id. Confirm the task
	// once within the same cleanup deadline; acknowledgment is not a terminal state.
	state := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(baseURL, "/api/v1/tasks/"+url.PathEscape(taskID)), cfg.APIKey, nil, &state, cfg.Headers); err != nil {
		return ProviderTaskCleanupUnconfirmed, err
	}
	output, _ = state["output"].(map[string]any)
	if (state["code"] != nil && state["code"] != "") || output["task_id"] != taskID || output["task_status"] != "CANCELED" {
		return ProviderTaskCleanupUnconfirmed, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return ProviderTaskCleanupCanceled, nil
}

func deleteBytedanceARKTask(ctx context.Context, providerJobID string, cfg MediaAdapterConfig) error {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	taskID := strings.TrimSpace(providerJobID)
	if baseURL == "" || taskID == "" {
		return nil
	}
	targetURL := JoinURL(baseURL, ResolveTaskQueryPath(resolveBytedanceARKVideoQueryPathTemplate(), taskID))
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodDelete, targetURL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	applyProviderRequestHeaders(request, cfg.Headers)
	if trimmedAPIKey := strings.TrimSpace(cfg.APIKey); trimmedAPIKey != "" {
		request.Header.Set("Authorization", "Bearer "+trimmedAPIKey)
	}
	response, err := client.Do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()

	switch response.StatusCode {
	case http.StatusOK, http.StatusAccepted, http.StatusNoContent, http.StatusNotFound, http.StatusConflict:
		return nil
	default:
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
}
