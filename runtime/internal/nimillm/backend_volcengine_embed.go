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
// Ark aggregates all input parts into one vector. The Driver captures a native
// batch size of one; the existing Host owns ordered, complete batch delivery.
func (b *Backend) EmbedVolcengine(ctx context.Context, model string, inputs []string, dimensions *uint32, purpose runtimev1.TextEmbedPurpose) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	if len(inputs) != 1 {
		return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	width := uint32(2048)
	if dimensions != nil {
		width = *dimensions
	}
	body := map[string]any{"model": model, "input": []map[string]string{{"type": "text", "text": inputs[0]}}, "encoding_format": "float", "dimensions": width}
	if instructions := capabilitydriver.VolcengineEmbeddingInstructions(model, purpose); instructions != "" {
		body["instructions"] = instructions
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/embeddings/multimodal", body)
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
		Data  *struct {
			Embedding []*float64 `json:"embedding"`
		} `json:"data"`
		Usage *struct {
			Prompt *int64 `json:"prompt_tokens"`
			Total  *int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	invalid := func() ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if json.Unmarshal(raw, &out) != nil || out.Model != model || out.Data == nil || len(out.Data.Embedding) != int(width) {
		return invalid()
	}
	values := make([]*structpb.Value, len(out.Data.Embedding))
	for i, n := range out.Data.Embedding {
		if n == nil {
			return invalid()
		}
		values[i] = structpb.NewNumberValue(*n)
	}
	var usage *runtimev1.UsageStats
	if u := out.Usage; u != nil {
		if u.Prompt != nil && *u.Prompt < 0 || u.Total != nil && *u.Total < 0 || u.Prompt != nil && u.Total != nil && *u.Total < *u.Prompt {
			return invalid()
		}
		if u.Prompt != nil {
			usage = &runtimev1.UsageStats{InputTokens: *u.Prompt}
		}
	}
	return []*structpb.ListValue{{Values: values}}, usage, nil
}
