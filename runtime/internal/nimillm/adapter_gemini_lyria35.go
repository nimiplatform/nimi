package nimillm

import (
	"context"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const geminiLyria35Model = "lyria-3.5"
const geminiLyria35OutputBudgetSeconds = 300
const AdapterGeminiLyria35GenerateContent = "gemini_lyria35_generate_content_adapter"

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
// The selected native GenerateContent call returns inline MP3 media. It owns
// no provider Files resource or retained Interaction identity.
func ExecuteGeminiLyria35GenerateContent(
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
	if model != geminiLyria35Model || spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" ||
		spec.GetDurationSeconds() != geminiLyria35OutputBudgetSeconds {
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
	return []*runtimev1.ScenarioArtifact{BinaryArtifact("audio/mpeg", audio, map[string]any{"adapter": AdapterGeminiLyria35GenerateContent})}, nil, "", nil
}
