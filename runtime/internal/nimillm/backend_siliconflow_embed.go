package nimillm

import (
	"context"
	"encoding/json"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-output-contract
func (b *Backend) EmbedSiliconFlow(ctx context.Context, model string, inputs []string, dimensions *uint32) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	width := capabilitydriver.SiliconFlowEmbedDimensions(model)
	if dimensions != nil {
		width = *dimensions
	}
	body := map[string]any{"model": model, "input": inputs, "encoding_format": "float", "dimensions": width}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/embeddings", body)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
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
		Usage *struct {
			Input  *int64 `json:"prompt_tokens"`
			Output *int64 `json:"completion_tokens"`
			Total  *int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	invalid := func() ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if json.Unmarshal(raw, &out) != nil || out.Model != model || len(out.Data) != len(inputs) {
		return invalid()
	}
	vectors := make([]*structpb.ListValue, len(inputs))
	for _, entry := range out.Data {
		if entry.Index == nil || *entry.Index < 0 || *entry.Index >= len(vectors) || vectors[*entry.Index] != nil || len(entry.Embedding) != int(width) {
			return invalid()
		}
		values := make([]*structpb.Value, len(entry.Embedding))
		for i, n := range entry.Embedding {
			values[i] = structpb.NewNumberValue(n)
		}
		vectors[*entry.Index] = &structpb.ListValue{Values: values}
	}
	var usage *runtimev1.UsageStats
	if u := out.Usage; u != nil {
		if u.Input != nil && *u.Input < 0 || u.Output != nil && *u.Output < 0 || u.Total != nil && *u.Total < 0 {
			return invalid()
		}
		if u.Input != nil && u.Output != nil {
			usage = &runtimev1.UsageStats{InputTokens: *u.Input, OutputTokens: *u.Output}
		} else if u.Input != nil && u.Total != nil {
			if *u.Total < *u.Input {
				return invalid()
			}
			usage = &runtimev1.UsageStats{InputTokens: *u.Input, OutputTokens: *u.Total - *u.Input}
		}
	}
	return vectors, usage, nil
}
