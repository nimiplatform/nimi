package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const geminiLyriaClipModel = "lyria-3-clip-preview"
const maxGeminiLyriaInlineBase64Bytes = 24 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
// The native GenerateContent request returns inline media and creates no Files
// resource or retained provider operation for Runtime to reconcile.
func ExecuteGeminiLyriaClipGenerateContent(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	model string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveGeminiNativeBaseURL(cfg.BaseURL)
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	spec := req.GetSpec().GetMusicGenerate()
	if model != geminiLyriaClipModel || spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" || spec.GetDurationSeconds() != 35 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	payload := map[string]any{"contents": []map[string]any{{"parts": []map[string]any{{"text": spec.GetPrompt()}}}}}
	response := map[string]any{}
	if err := DoJSONRequestWithHeadersAndTimeout(
		ctx, http.MethodPost, JoinURL(baseURL, "/models/"+model+":generateContent"), "", payload, &response,
		map[string]string{"x-goog-api-key": apiKey}, resolveGeminiGenerateContentHTTPTimeout(req),
	); err != nil {
		if ctx.Err() != nil {
			return nil, nil, "", providerPollContextError(ctx.Err())
		}
		return nil, nil, "", err
	}
	audio, err := geminiLyriaInlineMP3(response)
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact("audio/mpeg", audio, map[string]any{"adapter": "gemini_lyria_clip_generate_content_adapter"})}, nil, "", nil
}

func geminiLyriaInlineMP3(response map[string]any) ([]byte, error) {
	invalid := func() error { return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID) }
	candidates, ok := response["candidates"].([]any)
	if !ok || len(candidates) != 1 {
		return nil, invalid()
	}
	parts, ok := MapField(MapField(candidates[0], "content"), "parts").([]any)
	if !ok {
		return nil, invalid()
	}
	var audio []byte
	for _, item := range parts {
		part := MapField(item, "inlineData")
		if part == nil {
			part = MapField(item, "inline_data")
		}
		if part == nil {
			continue
		}
		mime := strings.ToLower(strings.TrimSpace(ValueAsString(MapField(part, "mimeType"))))
		if mime == "" {
			mime = strings.ToLower(strings.TrimSpace(ValueAsString(MapField(part, "mime_type"))))
		}
		encoded := ValueAsString(MapField(part, "data"))
		if (mime != "audio/mpeg" && mime != "audio/mp3") || len(encoded) == 0 || len(encoded) > maxGeminiLyriaInlineBase64Bytes || len(audio) > 0 {
			return nil, invalid()
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(decoded) == 0 {
			return nil, invalid()
		}
		audio = decoded
	}
	if len(audio) == 0 {
		return nil, invalid()
	}
	return audio, nil
}
