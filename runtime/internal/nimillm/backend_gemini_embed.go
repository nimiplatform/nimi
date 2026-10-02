package nimillm

import (
	"context"
	"encoding/json"
	"math"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

type geminiEmbeddingConfig struct {
	AutoTruncate         bool    `json:"autoTruncate"`
	OutputDimensionality *uint32 `json:"outputDimensionality,omitempty"`
}

type geminiEmbeddingRequest struct {
	Content struct {
		Parts []struct {
			Text string `json:"text"`
		} `json:"parts"`
	} `json:"content"`
	Config geminiEmbeddingConfig `json:"embedContentConfig"`
}

type geminiEmbeddingResponse struct {
	Embedding *struct {
		Values []json.RawMessage `json:"values"`
	} `json:"embedding"`
	Usage *struct {
		PromptTokens *int64 `json:"promptTokenCount"`
	} `json:"usageMetadata"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-output-contract
// Gemini aggregates multiple parts into one vector. Each text therefore owns
// one native request; only a complete ordered set is returned to the caller.
func (b *Backend) EmbedGeminiNative(ctx context.Context, modelID string, inputs []string, dimensions *uint32) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	if modelID != capabilitydriver.GeminiEmbedding2ModelID || len(inputs) == 0 || len(inputs) > capabilitydriver.CloudEmbedMaxInputsPerRequest {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	width := capabilitydriver.GeminiEmbedding2Dimensions
	var requestedDimensions *uint32
	if dimensions != nil {
		if *dimensions < 128 || *dimensions > capabilitydriver.GeminiEmbedding2Dimensions {
			return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		value := *dimensions
		requestedDimensions, width = &value, int(value)
	}
	for _, text := range inputs {
		if strings.TrimSpace(text) == "" {
			return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	// Keep endpoint policy and the request-scoped credential opening point.
	// Native Gemini uses an API-key header, without compatible bearer auth.
	headers := make(map[string]string, len(b.headers)+1)
	for key, value := range b.headers {
		if !strings.EqualFold(key, "Authorization") && !strings.EqualFold(key, "x-goog-api-key") {
			headers[key] = value
		}
	}
	headers["x-goog-api-key"] = b.apiKey
	native := b.WithRequestOverridesAndHeadersWithPolicy(resolveGeminiNativeBaseURL(b.baseURL), "", headers, b.allowLoopbackEndpoint)
	vectors := make([]*structpb.ListValue, 0, len(inputs))
	var total int64
	completeUsage := true
	for _, text := range inputs {
		request := geminiEmbeddingRequest{Config: geminiEmbeddingConfig{AutoTruncate: false, OutputDimensionality: requestedDimensions}}
		request.Content.Parts = []struct {
			Text string `json:"text"`
		}{{Text: text}}
		var response geminiEmbeddingResponse
		if err := native.postJSON(ctx, "/models/"+url.PathEscape(modelID)+":embedContent", request, &response); err != nil {
			return nil, nil, err
		}
		if response.Embedding == nil || len(response.Embedding.Values) != width {
			return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		values := make([]*structpb.Value, 0, width)
		for _, raw := range response.Embedding.Values {
			var value *float64
			if json.Unmarshal(raw, &value) != nil || value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) {
				return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			values = append(values, structpb.NewNumberValue(*value))
		}
		vectors = append(vectors, &structpb.ListValue{Values: values})
		if response.Usage == nil || response.Usage.PromptTokens == nil || *response.Usage.PromptTokens < 0 {
			completeUsage = false
		} else {
			if *response.Usage.PromptTokens > math.MaxInt64-total {
				return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			total += *response.Usage.PromptTokens
		}
	}
	var usage *runtimev1.UsageStats
	if completeUsage {
		usage = &runtimev1.UsageStats{InputTokens: total}
	}
	return vectors, usage, nil
}
