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

// DecodeMedia decodes base64 or downloads from URL.
func (b *Backend) DecodeMedia(b64Data string, mediaURL string) ([]byte, error) {
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
		request, err := b.newRequest(context.Background(), http.MethodGet, mediaURL, nil)
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
		payload, err := io.ReadAll(response.Body)
		if err != nil {
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
		OutputTokens: EstimateTokens(string(artifactBytes)),
		ComputeMs:    computeMs,
	}
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

// WordCount counts words in input text.
func WordCount(input string) int {
	return len(strings.Fields(input))
}

// VowelCount counts vowels in input text.
func VowelCount(input string) int {
	count := 0
	for _, r := range strings.ToLower(input) {
		switch r {
		case 'a', 'e', 'i', 'o', 'u':
			count++
		}
	}
	return count
}

// ConsonantCount counts consonants in input text.
func ConsonantCount(input string) int {
	count := 0
	for _, r := range strings.ToLower(input) {
		if r >= 'a' && r <= 'z' {
			switch r {
			case 'a', 'e', 'i', 'o', 'u':
			default:
				count++
			}
		}
	}
	return count
}

// FallbackEmbed returns deterministic fallback embeddings.
func FallbackEmbed(inputs []string) []*structpb.ListValue {
	vectors := make([]*structpb.ListValue, 0, len(inputs))
	for _, input := range inputs {
		trimmed := strings.TrimSpace(input)
		vector := &structpb.ListValue{
			Values: []*structpb.Value{
				structpb.NewNumberValue(float64(len(trimmed))),
				structpb.NewNumberValue(float64(WordCount(trimmed))),
				structpb.NewNumberValue(float64(VowelCount(trimmed))),
				structpb.NewNumberValue(float64(ConsonantCount(trimmed))),
			},
		}
		vectors = append(vectors, vector)
	}
	return vectors
}

// CheckModelAvailabilityWithScope validates model availability for a given route.
func CheckModelAvailabilityWithScope(modelID string, route runtimev1.RoutePolicy) error {
	lower := strings.ToLower(modelID)
	switch {
	case strings.Contains(lower, "missing"), strings.Contains(lower, "not-found"):
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
	case strings.Contains(lower, "not-ready"), strings.Contains(lower, "warming"):
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_NOT_READY)
	case strings.Contains(lower, "provider-down"), strings.Contains(lower, "provider-unavailable"), strings.Contains(lower, "unavailable"):
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	case strings.Contains(lower, "provider-timeout"), strings.Contains(lower, "timeout"):
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	case strings.Contains(lower, "content-filter"), strings.Contains(lower, "blocked"):
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}

	if route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME && strings.Contains(lower, "cloud-only") {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API && strings.Contains(lower, "local-only") {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return nil
}
