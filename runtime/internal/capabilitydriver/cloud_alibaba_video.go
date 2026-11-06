package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"image"
	"net/url"
	"strings"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func IsAlibabaCurrentVideoModel(model string) bool {
	switch model {
	case "wan3.0-video", "wan3.0-video-prime", "happyhorse-1.1-t2v", "happyhorse-1.1-i2v", "happyhorse-1.1-r2v":
		return true
	}
	return false
}

func AlibabaVideoImageReferenceLimit(model string) int {
	switch model {
	case "wan3.0-video", "wan3.0-video-prime":
		return 10
	case "happyhorse-1.1-i2v":
		return 1
	case "happyhorse-1.1-r2v":
		return 9
	}
	return 0
}

func SupportsCloudVideoArtifacts(provider, model string) bool {
	if provider == "together" {
		return IsTogetherVideoModel(model)
	}
	if provider == "openrouter" {
		return model == OpenRouterVideoModel
	}
	return provider == "xai" && IsXAIVideoModel(model) || provider == "luma" && model == LumaRay32Model || provider == "flux" && model == "flux-3-video" || provider == "gemini" && IsGeminiOmniVideoModel(model) || provider == "dashscope" && AlibabaVideoImageReferenceLimit(model) > 0 || provider == "volcengine" && IsCurrentSeedanceVideoModel(model) || provider == "minimax" && IsMiniMaxH3VideoModel(model)
}

func alibabaVideoUnsupported() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.alibaba-current-video
func ValidateAlibabaCurrentVideoRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	if !IsAlibabaCurrentVideoModel(model) || req == nil || req.GetSpec().GetVideoGenerate() == nil || len(req.GetExtensions()) > 0 {
		return alibabaVideoUnsupported()
	}
	spec := req.GetSpec().GetVideoGenerate()
	wan := model == "wan3.0-video" || model == "wan3.0-video-prime"
	if strings.TrimSpace(spec.GetNegativePrompt()) != "" {
		return alibabaVideoUnsupported()
	}
	first, last, images, videos, audios := 0, 0, 0, 0, 0
	prompt := strings.TrimSpace(spec.GetPrompt()) != ""
	for _, item := range spec.GetContent() {
		if item == nil {
			return alibabaVideoUnsupported()
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT || strings.TrimSpace(item.GetText()) == "" {
				return alibabaVideoUnsupported()
			}
			prompt = true
			continue
		}
		location := ""
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			if strings.TrimSpace(item.GetArtifactRef().GetArtifactId()) == "" {
				return alibabaVideoUnsupported()
			}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			location = item.GetImageUrl().GetUrl()
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL:
			if !wan || item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO {
				return alibabaVideoUnsupported()
			}
			location = item.GetVideoUrl().GetUrl()
			videos++
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL:
			if !wan || item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO {
				return alibabaVideoUnsupported()
			}
			location = item.GetAudioUrl().GetUrl()
			audios++
		default:
			return alibabaVideoUnsupported()
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL || item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			switch item.GetRole() {
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
				first++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
				last++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
				images++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO:
				if !wan || item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
					return alibabaVideoUnsupported()
				}
				videos++
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO:
				if !wan || item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
					return alibabaVideoUnsupported()
				}
				audios++
			default:
				return alibabaVideoUnsupported()
			}
		}
		if item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			if strings.HasPrefix(location, "data:") && item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL {
				parts := strings.SplitN(location, ",", 2)
				if len(parts) != 2 || !strings.HasSuffix(parts[0], ";base64") || len(parts[1]) > base64.StdEncoding.EncodedLen(20_000_000) {
					return alibabaVideoUnsupported()
				}
				data, err := base64.StdEncoding.DecodeString(parts[1])
				if err != nil {
					return alibabaVideoUnsupported()
				}
				if err = ValidateAlibabaCurrentVideoImage(model, data, strings.TrimSuffix(strings.TrimPrefix(parts[0], "data:"), ";base64")); err != nil {
					return err
				}
			} else {
				u, err := url.Parse(location)
				if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.Fragment != "" || strings.TrimSpace(location) != location {
					return alibabaVideoUnsupported()
				}
			}
		}
	}
	switch spec.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		if !prompt || first+last+images+videos+audios != 0 || !wan && model != "happyhorse-1.1-t2v" {
			return alibabaVideoUnsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		if first != 1 || last+images+videos+audios != 0 || !wan && model != "happyhorse-1.1-i2v" {
			return alibabaVideoUnsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		if !wan || first != 1 || last != 1 || images+videos+audios != 0 {
			return alibabaVideoUnsupported()
		}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		if first+last != 0 || images+videos+audios == 0 || !wan && model != "happyhorse-1.1-r2v" {
			return alibabaVideoUnsupported()
		}
		if wan {
			if images > 10 || videos > 5 || audios > 5 {
				return alibabaVideoUnsupported()
			}
		} else if !prompt || images < 1 || images > 9 || videos+audios != 0 {
			return alibabaVideoUnsupported()
		}
	default:
		return alibabaVideoUnsupported()
	}
	if !wan {
		// Conservative mixed-script budget avoids the provider's documented
		// automatic truncation (2500 Chinese / 5000 non-Chinese characters).
		cost := 0
		for _, r := range VideoPrompt(spec) {
			cost++
			if unicode.Is(unicode.Han, r) || r > 0xffff {
				cost++
			}
		}
		if cost > 5000 {
			return alibabaVideoUnsupported()
		}
	}
	o := spec.GetOptions()
	if o == nil {
		return nil
	}
	if o.Frames != nil || o.Fps != nil || o.CameraFixed != nil || o.Draft != nil || o.ReturnLastFrame != nil || o.GetServiceTier() != "" || o.GetExecutionExpiresAfterSec() != 0 || !wan && o.GenerateAudio != nil {
		return alibabaVideoUnsupported()
	}
	switch strings.ToLower(o.GetResolution()) {
	case "", "480p", "720p", "1080p":
	default:
		return alibabaVideoUnsupported()
	}
	if o.DurationSec != nil {
		d := o.GetDurationSec()
		if wan {
			if d != -1 && (d < 2 || d > 30) {
				return alibabaVideoUnsupported()
			}
		} else if d < 3 || d > 15 {
			return alibabaVideoUnsupported()
		}
	}
	if o.Seed != nil && (o.GetSeed() > 2147483647 || wan && o.GetSeed() < -1 || !wan && o.GetSeed() < 0) {
		return alibabaVideoUnsupported()
	}
	if model == "happyhorse-1.1-i2v" && o.GetRatio() != "" {
		return alibabaVideoUnsupported()
	}
	switch o.GetRatio() {
	case "", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9":
	case "adaptive":
		if !wan {
			return alibabaVideoUnsupported()
		}
	case "4:5", "5:4", "9:21":
		if wan {
			return alibabaVideoUnsupported()
		}
	default:
		return alibabaVideoUnsupported()
	}
	return nil
}

func ValidateAlibabaCurrentVideoImage(model string, payload []byte, mime string) error {
	if !IsAlibabaCurrentVideoModel(model) || len(payload) == 0 || len(payload) > 20_000_000 || (mime != "image/png" && mime != "image/jpeg" && mime != "image/webp") {
		return alibabaVideoUnsupported()
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(payload))
	if err != nil || "image/"+format != mime || config.Width <= 0 || config.Height <= 0 {
		return alibabaVideoUnsupported()
	}
	wan := model == "wan3.0-video" || model == "wan3.0-video-prime"
	maxPixels := int64(16 << 20)
	if wan {
		maxPixels = 64_000_000
		if config.Width < 240 || config.Height < 240 || config.Width > 8000 || config.Height > 8000 || config.Width > 8*config.Height || config.Height > 8*config.Width {
			return alibabaVideoUnsupported()
		}
	}
	if int64(config.Width)*int64(config.Height) > maxPixels {
		return alibabaVideoUnsupported()
	}
	if model == "happyhorse-1.1-i2v" && (config.Width < 300 || config.Height < 300 || 2*config.Width > 5*config.Height || 2*config.Height > 5*config.Width) {
		return alibabaVideoUnsupported()
	}
	if model == "happyhorse-1.1-r2v" && (config.Width < 400 || config.Height < 400) {
		return alibabaVideoUnsupported()
	}
	decoded, _, err := image.Decode(bytes.NewReader(payload))
	if err != nil {
		return alibabaVideoUnsupported()
	}
	if wan {
		if opaque, ok := decoded.(interface{ Opaque() bool }); ok && !opaque.Opaque() {
			return alibabaVideoUnsupported()
		}
	}
	return nil
}
