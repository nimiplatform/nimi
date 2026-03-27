package nimillm

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const maxDecodedMediaURLBytes = 100 * 1024 * 1024

// DecodeMedia decodes base64 or downloads from URL.
func (b *Backend) DecodeMedia(ctx context.Context, b64Data string, mediaURL string) ([]byte, error) {
	b64Data = strings.TrimSpace(b64Data)
	if b64Data != "" {
		payload, err := base64.StdEncoding.DecodeString(b64Data)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if len(payload) == 0 {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		return payload, nil
	}
	mediaURL = strings.TrimSpace(mediaURL)
	if mediaURL != "" {
		request, err := b.newRequest(ctx, http.MethodGet, mediaURL, nil)
		if err != nil {
			return nil, err
		}
		response, err := b.do(request)
		if err != nil {
			return nil, MapProviderRequestError(err)
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, MapProviderHTTPError(response.StatusCode, nil)
		}
		payload, err := io.ReadAll(io.LimitReader(response.Body, maxDecodedMediaURLBytes+1))
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if len(payload) > maxDecodedMediaURLBytes {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if len(payload) == 0 {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		return payload, nil
	}
	return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// FirstNonEmpty returns the first non-empty string.
func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// StructToMap converts a protobuf Struct to a Go map.
func StructToMap(input *structpb.Struct) map[string]any {
	if input == nil {
		return nil
	}
	fields := input.GetFields()
	if len(fields) == 0 {
		return nil
	}
	result := make(map[string]any, len(fields))
	for key, value := range fields {
		result[key] = value.AsInterface()
	}
	return result
}

// ArtifactUsage estimates usage stats for a media artifact.
func ArtifactUsage(inputText string, artifactBytes []byte, computeMs int64) *runtimev1.UsageStats {
	return &runtimev1.UsageStats{
		InputTokens:  EstimateTokens(strings.TrimSpace(inputText)),
		OutputTokens: estimateArtifactOutputTokens(artifactBytes),
		ComputeMs:    computeMs,
	}
}

func estimateArtifactOutputTokens(artifactBytes []byte) int64 {
	if len(artifactBytes) == 0 {
		return 0
	}
	contentType := strings.ToLower(strings.TrimSpace(http.DetectContentType(artifactBytes)))
	if strings.HasPrefix(contentType, "text/") || contentType == "application/json" || contentType == "application/xml" {
		return EstimateTokens(string(artifactBytes))
	}
	// Binary artifacts do not carry meaningful text tokens; estimate from size
	// so media outputs do not inherit arbitrary UTF-8 decoding artifacts.
	return MaxInt64(1, int64(len(artifactBytes)+3)/4)
}

// EstimateUsage estimates usage stats from input/output text.
func EstimateUsage(input string, output string) *runtimev1.UsageStats {
	return &runtimev1.UsageStats{
		InputTokens:  EstimateTokens(input),
		OutputTokens: EstimateTokens(output),
		ComputeMs:    MaxInt64(1, EstimateTokens(input)+EstimateTokens(output)),
	}
}

// EstimateTokens estimates token count from text.
func EstimateTokens(text string) int64 {
	if text == "" {
		return 0
	}
	runeCount := int64(len([]rune(text)))
	estimated := runeCount * 3 / 4
	if estimated < 1 {
		return 1
	}
	return estimated
}

// ComposeInputText composes system prompt and chat messages into a single text.
func ComposeInputText(systemPrompt string, input []*runtimev1.ChatMessage) string {
	var builder strings.Builder
	if prompt := strings.TrimSpace(systemPrompt); prompt != "" {
		builder.WriteString(prompt)
		builder.WriteString("\n")
	}
	for _, item := range input {
		if parts := item.GetParts(); len(parts) > 0 {
			for _, part := range parts {
				if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
					if text := strings.TrimSpace(part.GetText()); text != "" {
						builder.WriteString(text)
						builder.WriteString("\n")
					}
				}
			}
			continue
		}
		content := strings.TrimSpace(item.GetContent())
		if content == "" {
			continue
		}
		builder.WriteString(content)
		builder.WriteString("\n")
	}
	return strings.TrimSpace(builder.String())
}

// SplitText splits text into chunks of approximately chunkSize characters.
func SplitText(text string, chunkSize int) []string {
	if chunkSize <= 0 {
		chunkSize = 32
	}
	runes := []rune(text)
	if len(runes) == 0 {
		return nil
	}
	chunks := make([]string, 0, (len(runes)+chunkSize-1)/chunkSize)
	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[i:end]))
	}
	return chunks
}

// MaxInt64 returns the larger of two int64 values.
func MaxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
