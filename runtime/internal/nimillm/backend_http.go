package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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

func (b *Backend) getJSON(ctx context.Context, path string, responseBody any) error {
	endpoint := b.baseURL + path
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return MapProviderRequestError(err)
	}
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
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if len(body) == 0 {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
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
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}
