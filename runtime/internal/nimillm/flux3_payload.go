package nimillm

import (
	"context"
	"encoding/base64"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.flux3-media
func validateFlux3Reference(reference *CapturedMediaReference, id string) error {
	return validateCapturedRasterReference(reference, id, 16822272, 32768)
}

func flux3ImagePayload(ctx context.Context, spec *runtimev1.ImageGenerateScenarioSpec, model string) (map[string]any, error) {
	p := map[string]any{"prompt": strings.TrimSpace(spec.GetPrompt())}
	resolution, w, h, err := capabilitydriver.Flux3ImageSize(spec, model)
	if err != nil {
		return nil, err
	}
	if resolution != "" {
		p["resolution"] = resolution
	}
	if w != 0 {
		p["width"], p["height"] = w, h
	}
	if spec.GetAspectRatio() != "" {
		p["aspect_ratio"] = spec.GetAspectRatio()
	}
	if spec.Seed != nil {
		p["seed"] = spec.GetSeed()
	}
	if len(spec.GetReferenceImages()) > 0 {
		p["images"] = spec.GetReferenceImages()
	}
	if spec.GetReferenceImageArtifactId() != "" {
		r, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if r == nil || r.ArtifactID != spec.GetReferenceImageArtifactId() {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		p["images"] = []string{base64.StdEncoding.EncodeToString(r.Bytes)}
	}
	return p, nil
}

func flux3VideoPayload(ctx context.Context, s *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	p := map[string]any{"prompt": capabilitydriver.VideoPrompt(s), "mode": "t2v"}
	if s.GetMode() != runtimev1.VideoMode_VIDEO_MODE_T2V {
		p["mode"] = "i2v"
		references, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
		byIndex := map[int]CapturedMediaReference{}
		for _, r := range references {
			byIndex[r.ContentIndex] = r.Reference
		}
		frames := []string{}
		for _, role := range []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME} {
			for i, item := range s.GetContent() {
				if item.GetRole() != role {
					continue
				}
				if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
					r, ok := byIndex[i]
					if !ok || r.ArtifactID != item.GetArtifactRef().GetArtifactId() {
						return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
					}
					frames = append(frames, base64.StdEncoding.EncodeToString(r.Bytes))
				} else {
					frames = append(frames, item.GetImageUrl().GetUrl())
				}
			}
		}
		p["keyframes"] = frames
	}
	if o := s.GetOptions(); o != nil {
		if o.DurationSec != nil {
			if o.GetDurationSec() == -1 {
				p["duration"] = "auto"
			} else {
				p["duration"] = o.GetDurationSec()
			}
		}
		if o.GetResolution() != "" {
			p["resolution"] = map[string]string{"720p": "hd", "1080p": "fhd", "1440p": "qhd", "4k": "uhd"}[strings.ToLower(o.GetResolution())]
		}
		if o.GetRatio() != "" {
			ratio := o.GetRatio()
			if ratio == "adaptive" {
				ratio = "auto"
			}
			p["aspect_ratio"] = ratio
		}
		if o.GenerateAudio != nil {
			p["generate_audio"] = o.GetGenerateAudio()
		}
		if o.Draft != nil {
			p["draft"] = o.GetDraft()
		}
	}
	return p, nil
}
