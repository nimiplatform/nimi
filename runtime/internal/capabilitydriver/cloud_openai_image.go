package capabilitydriver

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const CloudMediaAdapterOpenAIImages = "openai_images_adapter"

type openAIImageModelRules struct {
	customSizes bool
	autoSize    bool
	ownedInputs bool
	edits       bool
	qualities   map[string]bool
}

var openAIImageCurrentQualities = map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true, "auto": true}

// openAIImageModels are the Images API models this cell admits. The previous
// gpt-image-1.5 takes only the recommended sizes and qualities up to high, and
// its edits are not admitted.
var openAIImageModels = map[string]openAIImageModelRules{
	"gpt-image-2.6-flare":    {autoSize: true, edits: true, ownedInputs: true, qualities: map[string]bool{"low": true, "medium": true, "high": true, "auto": true}},
	"gpt-image-2.6-sunburst": {autoSize: true, edits: true, ownedInputs: true, qualities: map[string]bool{"low": true, "medium": true, "high": true, "auto": true}},
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
// validateOpenAIImageRequest admits the exact model's documented generation and
// single-source edit controls. Unsupported combinations fail before publication.
func validateOpenAIImageRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	rules, admitted := openAIImageModels[model]
	return validateGPTImageRequest(request, model, rules, admitted)
}

func validateGPTImageRequest(request *runtimev1.SubmitScenarioJobRequest, model string, rules openAIImageModelRules, admitted bool) error {
	spec := request.GetSpec().GetImageGenerate()
	format := strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	size := strings.TrimSpace(spec.GetSize())
	quality := strings.TrimSpace(spec.GetQuality())
	references := spec.GetReferenceImages()
	mask := strings.TrimSpace(spec.GetMask())
	sizeAdmitted := size == "" || rules.autoSize && size == "auto" || openAIImageRecommendedSizes[size] || (rules.customSizes && openAIImageSizeValid(size))
	sourceCount := len(references)
	if spec.GetReferenceImageArtifactId() != "" {
		sourceCount++
	}
	inputsAdmitted := sourceCount == 0 && mask == "" && spec.GetMaskArtifactId() == "" || rules.edits && sourceCount == 1 && ((len(references) == 1 && openAIImageHTTPS(references[0])) || (rules.ownedInputs && spec.GetReferenceImageArtifactId() != "")) && (mask == "" || openAIImageHTTPS(mask)) && (spec.GetMaskArtifactId() == "" || rules.ownedInputs && spec.GetReferenceImageArtifactId() != "")
	if IsOpenAIImage26(model) {
		if err := ValidateImageControls(spec); err != nil {
			return err
		}
		if (spec.GetOutputFormat() == "svg" || spec.GetOutputFormat() == "gif") && sourceCount > 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetOutputFormat() == "gif" {
			if spec.FrameCount == nil {
				spec.FrameCount = proto.Int32(9)
			}
			if spec.FrameDurationMs == nil {
				spec.FrameDurationMs = proto.Int32(200)
			}
			sizeAdmitted = size == "" || size == "auto"
		}
	}

	if spec == nil || !admitted || len(request.GetExtensions()) > 0 ||
		(spec.N != nil && spec.GetN() != 1) || strings.TrimSpace(spec.GetNegativePrompt()) != "" ||
		strings.TrimSpace(spec.GetAspectRatio()) != "" || strings.TrimSpace(spec.GetStyle()) != "" ||
		spec.Seed != nil || spec.Strength != nil || !inputsAdmitted ||
		(!rules.ownedInputs && (strings.TrimSpace(spec.GetReferenceImageArtifactId()) != "" || strings.TrimSpace(spec.GetMaskArtifactId()) != "")) || (format != "" && format != "b64_json" && format != "base64") ||
		!sizeAdmitted || (quality != "" && !rules.qualities[quality]) {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "The selected image target does not support this combination of rendering controls, source images, masks or output delivery",
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
	u, err := url.Parse(location)
	return err == nil && len(location) <= 2048 && strings.TrimSpace(location) == location && u.Scheme == "https" && u.Host != "" && u.User == nil && u.Fragment == ""
}
