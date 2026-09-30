package capabilitydriver

import (
	"regexp"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const CloudMediaAdapterOpenAIImages = "openai_images_adapter"

type openAIImageModelRules struct {
	customSizes bool
	edits       bool
	qualities   map[string]bool
}

var openAIImageCurrentQualities = map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true, "auto": true}

// openAIImageModels are the Images API models this cell admits. The previous
// gpt-image-1.5 takes only the recommended sizes and qualities up to high, and
// its edits are not admitted.
var openAIImageModels = map[string]openAIImageModelRules{
	"gpt-image-2.5-flare":    {customSizes: true, edits: true, qualities: openAIImageCurrentQualities},
	"gpt-image-2.5-sunburst": {customSizes: true, edits: true, qualities: openAIImageCurrentQualities},
	"gpt-image-1.5":          {qualities: map[string]bool{"low": true, "medium": true, "high": true, "auto": true}},
}

var openAIImageRecommendedSizes = map[string]bool{"1024x1024": true, "1536x1024": true, "1024x1536": true}

var openAIImageSizePattern = regexp.MustCompile(`^([1-9][0-9]{1,3})x([1-9][0-9]{1,3})$`)

// openAIImageSizeValid applies the documented custom size rules: both edges
// multiples of 16 and at most 3840 pixels, an aspect ratio within 1:3 and
// 3:1, and between 655,360 and 8,294,400 pixels in total.
func openAIImageSizeValid(size string) bool {
	match := openAIImageSizePattern.FindStringSubmatch(size)
	if match == nil {
		return false
	}
	width, _ := strconv.Atoi(match[1])
	height, _ := strconv.Atoi(match[2])
	pixels := width * height
	return width%16 == 0 && height%16 == 0 && width <= 3840 && height <= 3840 &&
		width <= 3*height && height <= 3*width && pixels >= 655_360 && pixels <= 8_294_400
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// validateOpenAIImageRequest admits one PNG from a prompt with an optional
// documented size and quality. The 2.5 models also edit one HTTPS reference
// image, optionally through an HTTPS mask. Other options the Images API does
// not define fail before Job publication.
func validateOpenAIImageRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	spec := request.GetSpec().GetImageGenerate()
	rules, admitted := openAIImageModels[model]
	format := strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	size := strings.TrimSpace(spec.GetSize())
	quality := strings.TrimSpace(spec.GetQuality())
	references := spec.GetReferenceImages()
	mask := strings.TrimSpace(spec.GetMask())
	sizeAdmitted := size == "" || openAIImageRecommendedSizes[size] || (rules.customSizes && openAIImageSizeValid(size))
	inputsAdmitted := (len(references) == 0 && mask == "") ||
		(rules.edits && len(references) == 1 && openAIImageHTTPS(references[0]) && (mask == "" || openAIImageHTTPS(mask)))
	if spec == nil || !admitted || len(request.GetExtensions()) > 0 ||
		(spec.N != nil && spec.GetN() != 1) || strings.TrimSpace(spec.GetNegativePrompt()) != "" ||
		strings.TrimSpace(spec.GetAspectRatio()) != "" || strings.TrimSpace(spec.GetStyle()) != "" ||
		spec.Seed != nil || spec.Strength != nil || !inputsAdmitted ||
		strings.TrimSpace(spec.GetReferenceImageArtifactId()) != "" ||
		strings.TrimSpace(spec.GetMaskArtifactId()) != "" || (format != "" && format != "b64_json" && format != "base64") ||
		!sizeAdmitted || (quality != "" && !rules.qualities[quality]) {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "OpenAI image generation currently supports one PNG from a prompt with an optional size and quality, and for GPT-Image-2.5 one HTTPS reference image with an optional HTTPS mask; more references, count, negative prompt, aspect ratio, style, seed, strength and URL output are unavailable",
			ActionHint: "use_supported_openai_image_options",
		})
	}
	return nil
}

func openAIImageModelAdmitted(model string) bool {
	_, admitted := openAIImageModels[model]
	return admitted
}

func openAIImageHTTPS(location string) bool {
	return strings.HasPrefix(strings.TrimSpace(location), "https://")
}
