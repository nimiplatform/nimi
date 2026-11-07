package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-output-contract
func (b *Backend) EmbedOpenRouter(ctx context.Context, model string, inputs []string, dimensions *uint32, purpose runtimev1.TextEmbedPurpose) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	width := capabilitydriver.OpenRouterEmbedDimensions(model)
	if dimensions != nil {
		width = *dimensions
	}
	body := map[string]any{"model": model, "input": inputs, "encoding_format": "float", "dimensions": width, "provider": map[string]any{"allow_fallbacks": false}}
	if strings.HasPrefix(model, "cohere/") {
		kind := "search_document"
		if purpose == runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY {
			kind = "search_query"
		}
		body["input_type"] = kind
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/embeddings", body)
	if err != nil {
		return nil, nil, err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	raw, err := readLimitedResponseBody(response.Body, 32<<20)
	if err != nil {
		return nil, nil, err
	}
	var out struct {
		Model string `json:"model"`
		Data  []struct {
			Index     *int      `json:"index"`
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
		Usage *openRouterUsage `json:"usage"`
	}
	if json.Unmarshal(raw, &out) != nil || out.Model != "" && out.Model != model && out.Model != capabilitydriver.OpenRouterEmbeddingNativeModel(model) || len(out.Data) != len(inputs) {
		return nil, nil, openRouterOutputError()
	}
	vectors := make([]*structpb.ListValue, len(inputs))
	for _, entry := range out.Data {
		if entry.Index == nil || *entry.Index < 0 || *entry.Index >= len(vectors) || vectors[*entry.Index] != nil || len(entry.Embedding) != int(width) {
			return nil, nil, openRouterOutputError()
		}
		values := make([]*structpb.Value, len(entry.Embedding))
		for i, n := range entry.Embedding {
			values[i] = structpb.NewNumberValue(n)
		}
		vectors[*entry.Index] = &structpb.ListValue{Values: values}
	}
	usage, err := out.Usage.stats()
	return vectors, usage, err
}
