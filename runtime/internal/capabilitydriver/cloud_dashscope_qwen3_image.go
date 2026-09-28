package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const dashscopeQwen3ImageModel = "qwen-image-3.0"

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateDashscopeQwen3ImageRequest(spec *runtimev1.ImageGenerateScenarioSpec) error {
	if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	format := strings.TrimSpace(spec.GetResponseFormat())
	unsupported := spec.N != nil && spec.GetN() != 1 ||
		strings.TrimSpace(spec.GetNegativePrompt()) != "" || strings.TrimSpace(spec.GetSize()) != "" ||
		strings.TrimSpace(spec.GetAspectRatio()) != "" || strings.TrimSpace(spec.GetQuality()) != "" ||
		strings.TrimSpace(spec.GetStyle()) != "" || spec.Seed != nil ||
		strings.TrimSpace(spec.GetMask()) != "" || strings.TrimSpace(spec.GetMaskArtifactId()) != "" ||
		spec.Strength != nil || strings.TrimSpace(spec.GetReferenceImageArtifactId()) != "" ||
		(format != "" && format != "url") || len(spec.GetReferenceImages()) > 1
	for _, reference := range spec.GetReferenceImages() {
		if !strings.HasPrefix(strings.TrimSpace(reference), "https://") {
			unsupported = true
		}
	}
	if unsupported {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Qwen Image 3.0 currently supports one image from a text prompt, optionally with one HTTPS reference; other controls require a separately verified mode",
			ActionHint: "reset_image_parameters_or_select_another_model",
		})
	}
	return nil
}
