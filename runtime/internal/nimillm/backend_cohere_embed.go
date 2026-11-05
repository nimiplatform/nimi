package nimillm

import (
	"context"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.cohere5-native-embedding
func (b *Backend) EmbedCohereV2(ctx context.Context, model string, inputs []string, dimensions *uint32, purpose runtimev1.TextEmbedPurpose) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	base := strings.TrimRight(b.baseURL, "/")
	switch {
	// Backend construction already removes a trailing /v1 from the captured
	// endpoint. Preserve any explicit gateway prefix while changing protocol.
	case strings.HasSuffix(base, "/compatibility"):
		base = strings.TrimSuffix(base, "/compatibility") + "/v2"
	case strings.HasSuffix(base, "/v2"):
	default:
		parsed, err := url.Parse(base)
		if err != nil || parsed.Path != "" {
			return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
		}
		base += "/v2"
	}
	inputType := "search_document"
	if purpose == runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY {
		inputType = "search_query"
	}
	texts := make([]map[string]any, 0, len(inputs))
	for _, input := range inputs {
		texts = append(texts, map[string]any{"content": []map[string]any{{"type": "text", "text": input}}})
	}
	body := map[string]any{"model": model, "inputs": texts, "input_type": inputType, "embedding_types": []string{"float"}, "truncate": "NONE"}
	if dimensions != nil {
		body["output_dimension"] = *dimensions
	}
	var response struct {
		Embeddings struct {
			Float [][]any `json:"float"`
		} `json:"embeddings"`
		Meta *struct {
			Tokens *struct {
				Input  *int64 `json:"input_tokens"`
				Output *int64 `json:"output_tokens"`
			} `json:"tokens"`
		} `json:"meta"`
	}
	native := b.WithRequestOverridesAndHeadersWithPolicy(base, b.apiKey, b.headers, b.allowLoopbackEndpoint)
	if err := native.postJSON(ctx, "/embed", body, &response); err != nil {
		return nil, nil, err
	}
	vectors := make([]*structpb.ListValue, 0, len(response.Embeddings.Float))
	for _, values := range response.Embeddings.Float {
		list, err := structpb.NewList(values)
		if err != nil {
			return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		vectors = append(vectors, list)
	}
	var usage *runtimev1.UsageStats
	if response.Meta != nil && response.Meta.Tokens != nil {
		tokens := response.Meta.Tokens
		if (tokens.Input != nil && *tokens.Input < 0) || (tokens.Output != nil && *tokens.Output < 0) {
			return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if tokens.Input != nil && tokens.Output != nil {
			usage = &runtimev1.UsageStats{InputTokens: *tokens.Input, OutputTokens: *tokens.Output}
		}
	}
	return vectors, usage, nil
}
