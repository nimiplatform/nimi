package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// Captured media endpoints own credentials. Neither redirects nor returned
// media URLs may choose where a Bearer credential is sent.
func nativeMediaBackend(ctx context.Context, cfg MediaAdapterConfig, provider string) (*Backend, error) {
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, err
	}
	base := strings.TrimSuffix(strings.TrimRight(cfg.BaseURL, "/"), "/v1")
	transport, err := securedProviderTransport(ctx, base, cfg.AllowLoopbackEndpoint)
	if err != nil {
		return nil, err
	}
	b := newBackend("cloud-"+provider, base, key, cfg.Headers, 5*time.Minute, transport, true, cfg.AllowLoopbackEndpoint)
	if b == nil {
		transport.CloseIdleConnections()
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	b.client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return b, nil
}
func nativeMediaJSONRequest(ctx context.Context, b *Backend, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		if len(data) > 96<<20 {
			return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
		}
		reader = bytes.NewReader(data)
	}
	return nativeMediaHTTPRequest(ctx, b, method, path, "application/json", reader)
}
func nativeMediaHTTPRequest(ctx context.Context, b *Backend, method, path, contentType string, body io.Reader) (*http.Response, error) {
	response, err := sendNativeMediaRequest(ctx, b, method, path, contentType, body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
		var e map[string]any
		_ = json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&e)
		return nil, MapProviderHTTPError(response.StatusCode, e)
	}
	return response, nil
}

// Some native APIs return an original, failed Job in a non-2xx envelope.
// Keep transport/authentication shared while that protocol owns its status body.
func sendNativeMediaRequest(ctx context.Context, b *Backend, method, path, contentType string, body io.Reader) (*http.Response, error) {
	r, err := b.newRequest(ctx, method, b.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	r.Header.Del("x-api-key")
	r.Header.Set("Authorization", "Bearer "+b.apiKey)
	r.Header.Set("Content-Type", contentType)
	response, err := b.do(r)
	if err != nil {
		return nil, markNativeCreateResponseUnavailable(ctx, MapProviderRequestError(err))
	}
	return response, nil
}
