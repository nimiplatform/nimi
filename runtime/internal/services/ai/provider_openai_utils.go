package ai

import (
	"encoding/base64"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"io"
	"net/http"
	"strings"
)

func (b *openAIBackend) decodeMedia(b64Data string, mediaURL string) ([]byte, error) {
	b64Data = strings.TrimSpace(b64Data)
	if b64Data != "" {
		payload, err := base64.StdEncoding.DecodeString(b64Data)
		if err != nil {
			return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if len(payload) == 0 {
			return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		return payload, nil
	}
	mediaURL = strings.TrimSpace(mediaURL)
	if mediaURL != "" {
		request, err := http.NewRequest(http.MethodGet, mediaURL, nil)
		if err != nil {
			return nil, mapProviderRequestError(err)
		}
		response, err := b.client.Do(request)
		if err != nil {
			return nil, mapProviderRequestError(err)
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, mapProviderHTTPError(response.StatusCode, nil)
		}
		payload, err := io.ReadAll(response.Body)
		if err != nil {
			return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if len(payload) == 0 {
			return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		return payload, nil
	}
	return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
