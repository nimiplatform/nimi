package capabilitydriver

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// geminiImageMaxReferenceImages is the documented reference-image limit for
// the admitted Gemini image generateContent contract.
const geminiImageMaxReferenceImages = 14
const geminiProImageMaxReferenceImages = 1

// geminiImageAspectRatios lists the imageConfig aspect ratios each admitted
// Gemini image target documents for generateContent. A target absent from this
// table has no admitted request contract.
// @nimi-authority: rule.nimi.runtime.ai-provider.r051
var geminiImageAspectRatios = map[string]map[string]struct{}{
	"gemini-3.1-flash-image":      geminiImageRatioSet("1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"),
	"gemini-3.1-flash-lite-image": geminiImageRatioSet("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"),
	"gemini-3-pro-image":          geminiImageRatioSet("1:1", "16:9"),
}

func geminiImageRatioSet(values ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}

// validateGeminiImageRequest admits only the combinations the Gemini image
// transport actually honors: one image from a prompt, optional reference
// images, and a documented aspect ratio. Options the transport would ignore
// fail before Job publication instead of returning a different result.
func validateGeminiImageRequest(spec *runtimev1.ImageGenerateScenarioSpec, model string) error {
	ratios, admitted := geminiImageAspectRatios[model]
	if !admitted {
		return cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("gemini image target %q has no admitted request contract", model))
	}
	format := strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	maxReferences := geminiImageMaxReferenceImages
	if model == "gemini-3-pro-image" {
		maxReferences = geminiProImageMaxReferenceImages
	}
	unsupported := spec.GetN() > 1 || strings.TrimSpace(spec.GetNegativePrompt()) != "" ||
		strings.TrimSpace(spec.GetSize()) != "" || strings.TrimSpace(spec.GetQuality()) != "" ||
		strings.TrimSpace(spec.GetStyle()) != "" || spec.Seed != nil ||
		strings.TrimSpace(spec.GetMask()) != "" || strings.TrimSpace(spec.GetMaskArtifactId()) != "" ||
		spec.Strength != nil || (format != "" && format != "b64_json" && format != "base64") ||
		len(spec.GetReferenceImages()) > maxReferences
	if ratio := strings.TrimSpace(spec.GetAspectRatio()); ratio != "" {
		if _, ok := ratios[ratio]; !ok {
			unsupported = true
		}
	}
	if unsupported {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Gemini image generation supports one image from a prompt, the target's admitted reference count and aspect ratios; count, size, seed, negative prompt, quality, style, mask, and URL output are unsupported",
			ActionHint: "use_supported_gemini_image_options",
		})
	}
	return nil
}
