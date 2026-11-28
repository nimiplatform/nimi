package capabilitydriver

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const DashscopeZImageTurbo = "z-image-turbo"

// DashscopeZImageGeometryAllowed checks the documented total pixel range.
func DashscopeZImageGeometryAllowed(width, height int) bool {
	return width > 0 && height > 0 && width <= (2048*2048)/height && width*height >= 512*512
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateDashscopeZImage(req *runtimev1.SubmitScenarioJobRequest) error {
	s := req.GetSpec().GetImageGenerate()
	if utf8.RuneCountInString(s.GetPrompt()) > 800 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(req.GetExtensions()) != 0 || s.N != nil && s.GetN() != 1 || s.GetNegativePrompt() != "" ||
		len(s.GetReferenceImages()) != 0 || s.GetReferenceImageArtifactId() != "" || s.GetMask() != "" || s.GetMaskArtifactId() != "" ||
		s.GetAspectRatio() != "" || s.GetStyle() != "" || s.GetQuality() != "" || s.Strength != nil || s.ControlImage != nil ||
		s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.GetComplexity() != "" || s.FrameCount != nil || s.FrameDurationMs != nil ||
		s.GetOutputFormat() != "" && s.GetOutputFormat() != "png" || s.GetResponseFormat() != "" && s.GetResponseFormat() != "url" ||
		s.GetSeed() < 0 || s.GetSeed() > math.MaxInt32 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if size := strings.TrimSpace(s.GetSize()); size != "" {
		size = strings.NewReplacer("*", "x", "×", "x", "X", "x").Replace(size)
		if strings.EqualFold(size, "2k") {
			size = "2048x2048"
		}
		a, b, ok := strings.Cut(size, "x")
		width, errW := strconv.Atoi(a)
		height, errH := strconv.Atoi(b)
		if !ok || errW != nil || errH != nil || !DashscopeZImageGeometryAllowed(width, height) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		s.Size = strconv.Itoa(width) + "x" + strconv.Itoa(height)
	}
	return nil
}
