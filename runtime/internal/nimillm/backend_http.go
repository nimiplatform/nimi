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
	request, err := b.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := b.do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()

	return DecodeResponseJSON(response, responseBody)
}

func (b *Backend) getJSON(ctx context.Context, path string, responseBody any) error {
	endpoint := b.baseURL + path
	return b.getJSONAbsolute(ctx, endpoint, responseBody)
}

func (b *Backend) probeGET(ctx context.Context, path string) error {
	endpoint := b.baseURL + path
	return b.probeGETAbsolute(ctx, endpoint)
}

func (b *Backend) probeGETAbsolute(ctx context.Context, endpoint string) error {
	request, err := b.newRequest(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}

	response, err := b.do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, mappedErr := providerHTTPErrorFromResponse(response, endpoint)
		return mappedErr
	}

	_, _ = io.Copy(io.Discard, response.Body)
	return nil
}

func (b *Backend) getJSONAbsolute(ctx context.Context, endpoint string, responseBody any) error {
	request, err := b.newRequest(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}

	response, err := b.do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()

	return DecodeResponseJSON(response, responseBody)
}

func (b *Backend) postRaw(ctx context.Context, path string, requestBody any) ([]byte, error) {
	payload, err := json.Marshal(requestBody)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}

	endpoint := b.baseURL + path
	request, err := b.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := b.do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, mappedErr := providerHTTPErrorFromResponse(response, endpoint)
		return nil, mappedErr
	}

	body, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
	if err != nil {
		return nil, providerResponseReadError(err)
	}
	if len(body) == 0 {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return body, nil
}

// DecodeResponseJSON decodes a JSON HTTP response, mapping errors to gRPC status.
func DecodeResponseJSON(response *http.Response, target any) error {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		targetURL := ""
		if response.Request != nil && response.Request.URL != nil {
			targetURL = response.Request.URL.String()
		}
		_, mappedErr := providerHTTPErrorFromResponse(response, targetURL)
		return mappedErr
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return providerResponseDecodeError(err)
	}
	return nil
}
