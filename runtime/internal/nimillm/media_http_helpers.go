package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"

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

// DoJSONOrBinaryRequest performs an HTTP request with a JSON body and returns
// the response parsed as either JSON (extracting text/audio fields) or raw
// binary bytes.
func DoJSONOrBinaryRequest(ctx context.Context, method, targetURL, apiKey string, body any) (*JSONOrBinaryBody, error) {
	requestBody, err := json.Marshal(body)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	client, request, err := newSecuredHTTPRequest(ctx, method, targetURL, strings.NewReader(string(requestBody)))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, MapProviderHTTPError(response.StatusCode, payload)
	}
	raw, err := io.ReadAll(response.Body)
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
				decoded, decodeErr := base64.StdEncoding.DecodeString(b64)
				if decodeErr == nil {
					return &JSONOrBinaryBody{Bytes: decoded, MIME: contentType}, nil
				}
			}
		}
	}
	return &JSONOrBinaryBody{Bytes: raw, MIME: contentType}, nil
}

// DoJSONRequest performs an HTTP request expecting a JSON response. If body is
// nil no request body is sent. If target is nil the response body is discarded.
func DoJSONRequest(ctx context.Context, method, targetURL, apiKey string, body any, target *map[string]any) error {
	var requestBody io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return MapProviderRequestError(err)
		}
		requestBody = strings.NewReader(string(raw))
	}
	client, request, err := newSecuredHTTPRequest(ctx, method, targetURL, requestBody)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
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
