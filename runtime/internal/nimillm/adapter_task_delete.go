package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// DeleteProviderAsyncTask best-effort deletes or cancels a provider-managed async task.
// A nil error means the provider task is either cleaned up or the provider does not
// expose a stronger cancel semantic for the observed state.
func DeleteProviderAsyncTask(ctx context.Context, adapter string, providerJobID string, cfg MediaAdapterConfig) error {
	switch strings.TrimSpace(adapter) {
	case AdapterBytedanceARKTask:
		return deleteBytedanceARKTask(ctx, providerJobID, cfg)
	default:
		return nil
	}
}

func deleteBytedanceARKTask(ctx context.Context, providerJobID string, cfg MediaAdapterConfig) error {
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
	defer response.Body.Close()

	switch response.StatusCode {
	case http.StatusOK, http.StatusAccepted, http.StatusNoContent, http.StatusNotFound, http.StatusConflict:
		return nil
	default:
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
}
