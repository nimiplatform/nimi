package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
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
			return nil, grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				err,
				grpcerr.ReasonOptions{
					ActionHint: "retry_or_check_provider_response",
					Message:    "provider response media could not be decoded",
				},
			)
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
		defer func() { _ = response.Body.Close() }()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, MapProviderHTTPError(response.StatusCode, nil)
		}
		payload, err := io.ReadAll(io.LimitReader(response.Body, maxDecodedMediaURLBytes+1))
		if err != nil {
			return nil, providerResponseReadError(err)
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

// @nimi-authority: rule.nimi.runtime.ai-provider.r087
// reportedChatCompletionUsage keeps provider token counts distinct from absent
// reports. Explicit completion zero is never replaced by a total or an estimate.
func reportedChatCompletionUsage(payload map[string]any) *runtimev1.UsageStats {
	raw := payload["usage"]
	if raw == nil {
		return nil
	}
	var reported struct {
		Prompt     *int64 `json:"prompt_tokens"`
		Completion *int64 `json:"completion_tokens"`
		Total      *int64 `json:"total_tokens"`
	}
	encoded, err := json.Marshal(raw)
	if err != nil || json.Unmarshal(encoded, &reported) != nil ||
		(reported.Prompt != nil && *reported.Prompt < 0) ||
		(reported.Completion != nil && *reported.Completion < 0) ||
		(reported.Total != nil && *reported.Total < 0) || reported.Prompt == nil {
		return nil
	}
	output := reported.Completion
	if output == nil && reported.Total != nil && *reported.Total >= *reported.Prompt {
		derived := *reported.Total - *reported.Prompt
		output = &derived
	}
	if output == nil {
		return nil
	}
	return &runtimev1.UsageStats{InputTokens: *reported.Prompt, OutputTokens: *output}
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
