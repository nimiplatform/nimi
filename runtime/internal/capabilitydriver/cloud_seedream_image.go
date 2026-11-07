package capabilitydriver

import (
	"net/url"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

const CloudMediaAdapterSeedreamImage = "volcengine_seedream_image_v1_adapter"
const Seedream5ProModel = "doubao-seedream-5-0-pro-260628"
const Seedream5FlashModel = "doubao-seedream-5-0-flash-260915"
const Seedream5Model = "doubao-seedream-5-0-260128"
const Seedream45Model = "doubao-seedream-4-5-251128"

func IsSeedreamImageModel(model string) bool {
	return model == Seedream5ProModel || model == Seedream5FlashModel || model == Seedream5Model || model == Seedream45Model
}
func SeedreamProFlash(model string) bool {
	return model == Seedream5ProModel || model == Seedream5FlashModel
}
func SeedreamImageDimensions(size string) (int, int, bool) {
	a, b, ok := strings.Cut(size, "x")
	if !ok {
		return 0, 0, false
	}
	w, e := strconv.Atoi(a)
	h, f := strconv.Atoi(b)
	return w, h, e == nil && f == nil && w > 0 && h > 0 && w <= 32768 && h <= 32768 && strconv.Itoa(w)+"x"+strconv.Itoa(h) == size
}
func SeedreamImageGeometryAllowed(model string, w, h int) bool {
	minPixels, maxPixels := int64(3686400), int64(16777216)
	if SeedreamProFlash(model) {
		minPixels, maxPixels = 921600, 4624220
	}
	pixels := int64(w) * int64(h)
	return IsSeedreamImageModel(model) && w > 0 && h > 0 && w <= 32768 && h <= 32768 && pixels >= minPixels && pixels <= maxPixels && w <= 16*h && h <= 16*w
}
func seedreamUnsupported() error {
	return nativeCloudSpeechUnsupported("The selected Seedream model requires one image result, a supported native size and optional image references. Mask, seed, negative prompt, separate aspect ratio, style and quality controls are unsupported")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateSeedreamImageRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := req.GetSpec().GetImageGenerate()
	if !IsSeedreamImageModel(model) || s == nil || len(req.GetExtensions()) != 0 || strings.TrimSpace(s.GetPrompt()) == "" || s.GetNegativePrompt() != "" || s.GetAspectRatio() != "" || s.GetQuality() != "" || s.GetStyle() != "" || s.Seed != nil || s.Strength != nil || s.GetMask() != "" || s.GetMaskArtifactId() != "" || s.GetComplexity() != "" || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.FrameCount != nil || s.FrameDurationMs != nil || s.N != nil && s.GetN() != 1 {
		return seedreamUnsupported()
	}
	s.N = proto.Int32(1)
	if s.Size == "" {
		s.Size = "2K"
	}
	tier := strings.ToUpper(s.GetSize())
	if tier == "1K" || tier == "1.5K" || tier == "2K" || tier == "3K" || tier == "4K" {
		allowed := tier == "2K" || SeedreamProFlash(model) && (tier == "1K" || tier == "1.5K") || model == Seedream5Model && (tier == "3K" || tier == "4K") || model == Seedream45Model && tier == "4K"
		if !allowed {
			return seedreamUnsupported()
		}
		s.Size = tier
	} else {
		w, h, ok := SeedreamImageDimensions(s.GetSize())
		if !ok || !SeedreamImageGeometryAllowed(model, w, h) {
			return seedreamUnsupported()
		}
	}
	if s.ResponseFormat == "" {
		s.ResponseFormat = "b64_json"
	}
	if s.GetResponseFormat() != "url" && s.GetResponseFormat() != "b64_json" {
		return seedreamUnsupported()
	}
	if s.OutputFormat == "" {
		s.OutputFormat = "jpeg"
	}
	if s.GetOutputFormat() != "jpeg" && !(model != Seedream45Model && s.GetOutputFormat() == "png") {
		return seedreamUnsupported()
	}
	maxRefs := 14
	if SeedreamProFlash(model) {
		maxRefs = 10
	}
	if len(s.GetReferenceImages()) > maxRefs {
		return seedreamUnsupported()
	}
	for _, raw := range s.GetReferenceImages() {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return seedreamUnsupported()
		}
	}
	return nil
}
