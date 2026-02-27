package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (b *Backend) postJSON(ctx context.Context, path string, requestBody any, responseBody any) error {
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return MapProviderRequestError(err)
	}

	endpoint := b.baseURL + path
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return MapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.client.Do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer response.Body.Close()

	return DecodeResponseJSON(response, responseBody)
}

func (b *Backend) postRaw(ctx context.Context, path string, requestBody any) ([]byte, error) {
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}

	endpoint := b.baseURL + path
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if b.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	response, err := b.client.Do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, MapProviderHTTPError(response.StatusCode, payload)
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

// DecodeResponseJSON decodes a JSON HTTP response, mapping errors to gRPC status.
func DecodeResponseJSON(response *http.Response, target any) error {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	return nil
}
