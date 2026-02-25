package ai

import (
	"bytes"
	"context"
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"io"
	"net/http"
)

func (b *openAIBackend) postJSON(ctx context.Context, path string, requestBody any, responseBody any) error {
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return mapProviderRequestError(err)
	}

	endpoint := b.baseURL + path
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return mapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.client.Do(request)
	if err != nil {
		return mapProviderRequestError(err)
	}
	defer response.Body.Close()

	return decodeResponseJSON(response, responseBody)
}

func (b *openAIBackend) postRaw(ctx context.Context, path string, requestBody any) ([]byte, error) {
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return nil, mapProviderRequestError(err)
	}

	endpoint := b.baseURL + path
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, mapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.client.Do(request)
	if err != nil {
		return nil, mapProviderRequestError(err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, mapProviderHTTPError(response.StatusCode, payload)
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	if len(body) == 0 {
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	return body, nil
}

func decodeResponseJSON(response *http.Response, target any) error {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return mapProviderHTTPError(response.StatusCode, payload)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	return nil
}
