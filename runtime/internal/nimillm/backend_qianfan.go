package nimillm

import (
	"context"
	"encoding/json"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func (b *Backend) probeQianfanConnector(ctx context.Context) error {
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, resolveNativeV2Path(b.baseURL, "/models"), nil)
	if err != nil {
		return err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	var out struct {
		Data  *[]json.RawMessage `json:"data"`
		Error json.RawMessage    `json:"error"`
		Code  json.RawMessage    `json:"code"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return err
	}
	if out.Data == nil || len(out.Error) > 0 && string(out.Error) != "null" || len(out.Code) > 0 && string(out.Code) != "null" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-output-contract
func (b *Backend) EmbedQianfan(ctx context.Context, model string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, resolveNativeV2Path(b.baseURL, "/embeddings"), map[string]any{"model": model, "input": inputs})
	if err != nil {
		return nil, nil, err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	raw, err := readLimitedResponseBody(response.Body, 32<<20)
	if err != nil {
		return nil, nil, err
	}
	var out struct {
		Model string          `json:"model"`
		Error json.RawMessage `json:"error"`
		Code  json.RawMessage `json:"code"`
		Data  []struct {
			Index     *int       `json:"index"`
			Embedding []*float64 `json:"embedding"`
		} `json:"data"`
		Usage *struct {
			Input *int64 `json:"prompt_tokens"`
			Total *int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	invalid := func() ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if json.Unmarshal(raw, &out) != nil || out.Model != model || len(out.Data) != len(inputs) || len(out.Error) > 0 && string(out.Error) != "null" || len(out.Code) > 0 && string(out.Code) != "null" {
		return invalid()
	}
	vectors := make([]*structpb.ListValue, len(inputs))
	for _, entry := range out.Data {
		if entry.Index == nil || *entry.Index < 0 || *entry.Index >= len(vectors) || vectors[*entry.Index] != nil || len(entry.Embedding) != 384 {
			return invalid()
		}
		values := make([]*structpb.Value, 384)
		for i, n := range entry.Embedding {
			if n == nil {
				return invalid()
			}
			values[i] = structpb.NewNumberValue(*n)
		}
		vectors[*entry.Index] = &structpb.ListValue{Values: values}
	}
	var usage *runtimev1.UsageStats
	if u := out.Usage; u != nil {
		if u.Input != nil && *u.Input < 0 || u.Total != nil && *u.Total < 0 || u.Input != nil && u.Total != nil && *u.Input != *u.Total {
			return invalid()
		}
		if u.Input != nil && u.Total != nil {
			usage = &runtimev1.UsageStats{InputTokens: *u.Input}
		}
	}
	return vectors, usage, nil
}
