package capabilitydriver

import (
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// Azure admission is independent of the direct OpenAI catalog. In particular,
// Image 2.6 controls cannot be inferred from a compatible Images wire protocol.
var azureImageModels = map[string]openAIImageModelRules{
	"gpt-image-2.5-flare":    {customSizes: true, edits: true, ownedInputs: true, qualities: openAIImageCurrentQualities},
	"gpt-image-2.5-sunburst": {customSizes: true, edits: true, ownedInputs: true, qualities: openAIImageCurrentQualities},
	"gpt-image-1.5":          {edits: true, ownedInputs: true, qualities: map[string]bool{"low": true, "medium": true, "high": true, "auto": true}},
}

func IsAzureGPTImageModel(model string) bool {
	_, admitted := azureImageModels[model]
	return admitted
}

func SupportsGPTImageOwnedInputs(provider, model string) bool {
	return provider == "openai" && IsOpenAIImage26(model) || provider == "azure" && IsAzureGPTImageModel(model)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateAzureImageRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	rules, admitted := azureImageModels[model]
	s := request.GetSpec().GetImageGenerate()
	if utf8.RuneCountInString(s.GetPrompt()) > 32000 || s.GetComplexity() != "" || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.FrameCount != nil || s.FrameDurationMs != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	switch s.GetOutputFormat() {
	// Azure's guide explicitly excludes WebP despite the shared REST enum.
	// Keep that disputed format closed until Azure acceptance resolves it.
	case "", "png", "jpeg":
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return validateGPTImageRequest(request, model, rules, admitted)
}
