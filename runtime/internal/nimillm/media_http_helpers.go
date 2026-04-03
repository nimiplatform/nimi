package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// JSONOrBinaryBody holds a parsed HTTP response body that may be JSON text,
// base64-decoded binary, or raw binary bytes.
type JSONOrBinaryBody struct {
	Bytes []byte
	Text  string
	MIME  string
}

const maxJSONOrBinaryResponseBytes = 32 << 20

func requireProviderAPIKey(raw string) (string, error) {
	apiKey := strings.TrimSpace(raw)
	if apiKey == "" {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED)
	}
	return apiKey, nil
}

func allowProviderRequestHeader(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "authorization", "proxy-authorization", "host", "cookie", "set-cookie", "content-length", "transfer-encoding", "connection":
		return false
	default:
		return true
	}
}

func applyProviderRequestHeaders(request *http.Request, headers map[string]string) {
	for key, value := range headers {
		headerName := strings.TrimSpace(key)
		if !allowProviderRequestHeader(headerName) {
			continue
		}
		headerValue := strings.TrimSpace(value)
		if headerValue == "" {
			continue
		}
		request.Header.Set(headerName, headerValue)
	}
}

// DoJSONOrBinaryRequest performs an HTTP request with a JSON body and returns
// the response parsed as either JSON (extracting text/audio fields) or raw
// binary bytes.
func DoJSONOrBinaryRequest(ctx context.Context, method, targetURL, apiKey string, body any, headers map[string]string) (*JSONOrBinaryBody, error) {
	requestBody, err := marshalJSONRequestBody(body)
	if err != nil {
		return nil, err
	}
	client, request, err := newSecuredHTTPRequest(ctx, method, targetURL, bytes.NewReader(requestBody))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	applyProviderRequestHeaders(request, headers)
	if trimmedAPIKey := strings.TrimSpace(apiKey); trimmedAPIKey != "" {
		request.Header.Set("Authorization", "Bearer "+trimmedAPIKey)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()
	return decodeJSONOrBinaryResponse(response)
}

func decodeJSONOrBinaryResponse(response *http.Response) (*JSONOrBinaryBody, error) {
	if response == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, MapProviderHTTPError(response.StatusCode, payload)
	}
	raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	looksLikeJSON := len(raw) > 0 && (raw[0] == '{' || raw[0] == '[')
	if strings.Contains(contentType, "application/json") || looksLikeJSON {
		parsed := map[string]any{}
		if unmarshalErr := json.Unmarshal(raw, &parsed); unmarshalErr == nil {
			if text := strings.TrimSpace(FirstNonEmpty(
				ValueAsString(parsed["text"]),
				ValueAsString(MapField(parsed["result"], "text")),
			)); text != "" {
				return &JSONOrBinaryBody{Bytes: []byte(text), Text: text, MIME: contentType}, nil
			}
			if b64 := strings.TrimSpace(FirstNonEmpty(
				ValueAsString(parsed["audio"]),
				ValueAsString(parsed["audio_base64"]),
				ValueAsString(parsed["b64_json"]),
				ValueAsString(MapField(parsed["result"], "audio")),
				ValueAsString(MapField(parsed["result"], "audio_base64")),
				ValueAsString(MapField(parsed["data"], "audio")),
				ValueAsString(MapField(parsed["data"], "audio_base64")),
				ValueAsString(MapField(parsed["output"], "audio")),
			)); b64 != "" {
				decoded, ok := DecodeBase64ArtifactPayload(b64)
				if ok {
					return &JSONOrBinaryBody{Bytes: decoded, MIME: contentType}, nil
				}
			}
		}
	}
	return &JSONOrBinaryBody{Bytes: raw, MIME: contentType}, nil
}

func marshalJSONRequestBody(body any) ([]byte, error) {
	if body == nil {
		return nil, nil
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	return raw, nil
}

func readLimitedResponseBody(reader io.Reader, limit int64) ([]byte, error) {
	if limit <= 0 {
		return io.ReadAll(reader)
	}
	raw, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, io.ErrUnexpectedEOF
	}
	return raw, nil
}

// DoJSONRequest performs an HTTP request expecting a JSON response. If body is
// nil no request body is sent. If target is nil the response body is discarded.
func DoJSONRequest(ctx context.Context, method, targetURL, apiKey string, body any, target *map[string]any) error {
	var requestBody io.Reader
	if body != nil {
		raw, err := marshalJSONRequestBody(body)
		if err != nil {
			return err
		}
		requestBody = bytes.NewReader(raw)
	}
	client, request, err := newSecuredHTTPRequest(ctx, method, targetURL, requestBody)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if trimmedAPIKey := strings.TrimSpace(apiKey); trimmedAPIKey != "" {
		request.Header.Set("Authorization", "Bearer "+trimmedAPIKey)
	}
	response, err := client.Do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		if raw, _ := json.Marshal(payload); len(raw) > 0 {
			slog.Warn("[provider-http-debug] error response", "status", response.StatusCode, "url", targetURL, "body", string(raw))
		}
		return MapProviderHTTPError(response.StatusCode, payload)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}

// DoJSONRequestWithHeaders performs a JSON request like DoJSONRequest, with
// optional extra headers for provider-native auth/routing requirements.
func DoJSONRequestWithHeaders(
	ctx context.Context,
	method string,
	targetURL string,
	apiKey string,
	body any,
	target *map[string]any,
	headers map[string]string,
) error {
	return DoJSONRequestWithHeadersAndTimeout(ctx, method, targetURL, apiKey, body, target, headers, 0)
}

func DoJSONRequestWithHeadersAndTimeout(
	ctx context.Context,
	method string,
	targetURL string,
	apiKey string,
	body any,
	target *map[string]any,
	headers map[string]string,
	timeout time.Duration,
) error {
	var requestBody io.Reader
	if body != nil {
		raw, err := marshalJSONRequestBody(body)
		if err != nil {
			return err
		}
		requestBody = bytes.NewReader(raw)
	}
	client, request, err := newSecuredHTTPRequest(ctx, method, targetURL, requestBody)
	if err != nil {
		return err
	}
	if timeout > 0 {
		client.Timeout = timeout
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	applyProviderRequestHeaders(request, headers)
	if trimmedAPIKey := strings.TrimSpace(apiKey); trimmedAPIKey != "" {
		request.Header.Set("Authorization", "Bearer "+trimmedAPIKey)
	}
	response, err := client.Do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}

func doJSONRequestWithBackendAndHeaders(
	ctx context.Context,
	backend *Backend,
	method string,
	targetURL string,
	body any,
	target *map[string]any,
	headers map[string]string,
) error {
	if backend == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
	}
	requestBody, err := marshalJSONRequestBody(body)
	if err != nil {
		return err
	}
	request, err := backend.newRequest(ctx, method, targetURL, bytes.NewReader(requestBody))
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	applyProviderRequestHeaders(request, headers)
	if backend.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+backend.apiKey)
	}
	response, err := backend.do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}

func doJSONOrBinaryRequestWithBackend(
	ctx context.Context,
	backend *Backend,
	method string,
	targetURL string,
	body any,
	headers map[string]string,
) (*JSONOrBinaryBody, error) {
	if backend == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
	}
	requestBody, err := marshalJSONRequestBody(body)
	if err != nil {
		return nil, err
	}
	request, err := backend.newRequest(ctx, method, targetURL, bytes.NewReader(requestBody))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	applyProviderRequestHeaders(request, headers)
	if backend.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+backend.apiKey)
	}
	response, err := backend.do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()
	return decodeJSONOrBinaryResponse(response)
}

// JoinURL joins a base URL with a suffix path. If the suffix is already an
// absolute URL it is returned as-is.
func JoinURL(baseURL string, suffix string) string {
	base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return ""
	}
	suffixPath := strings.TrimSpace(suffix)
	if suffixPath == "" {
		return base
	}
	if strings.HasPrefix(suffixPath, "http://") || strings.HasPrefix(suffixPath, "https://") {
		return suffixPath
	}
	if !strings.HasPrefix(suffixPath, "/") {
		suffixPath = "/" + suffixPath
	}
	return base + suffixPath
}
