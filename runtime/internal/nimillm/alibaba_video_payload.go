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

// @nimi-authority: rule.nimi.runtime.ai-provider.alibaba-current-video
// The Driver has admitted the exact controls. This transport projection consumes
// captured image bytes; it never resolves an App artifact identifier itself.
func buildAlibabaCurrentVideoPayload(ctx context.Context, model string, spec *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	input := map[string]any{}
	if prompt := capabilitydriver.VideoPrompt(spec); prompt != "" {
		input["prompt"] = prompt
	}
	references, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	byIndex := map[int]CapturedMediaReference{}
	for _, r := range references {
		byIndex[r.ContentIndex] = r.Reference
	}
	indices := []int{}
	if spec.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
		for _, role := range []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME} {
			for i, item := range spec.GetContent() {
				if item.GetRole() == role {
					indices = append(indices, i)
				}
			}
		}
	} else {
		for i, item := range spec.GetContent() {
			if item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
				indices = append(indices, i)
			}
		}
	}
	media := []map[string]any{}
	for _, i := range indices {
		item := spec.GetContent()[i]
		location := ""
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			location = item.GetImageUrl().GetUrl()
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL:
			location = item.GetVideoUrl().GetUrl()
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL:
			location = item.GetAudioUrl().GetUrl()
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF:
			ref, ok := byIndex[i]
			if !ok || ref.ArtifactID != item.GetArtifactRef().GetArtifactId() {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
			location = "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		kind := map[runtimev1.VideoContentRole]string{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME: "first_frame", runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME: "last_frame", runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE: "reference_image", runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO: "reference_video", runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO: "reference_audio"}[item.GetRole()]
		if kind == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		media = append(media, map[string]any{"type": kind, "url": location})
	}
	if len(media) > 0 {
		input["media"] = media
	}
	parameters := map[string]any{}
	if o := spec.GetOptions(); o != nil {
		if o.GetResolution() != "" {
			parameters["resolution"] = strings.ToUpper(o.GetResolution())
		}
		if o.GetRatio() != "" {
			parameters["ratio"] = o.GetRatio()
		}
		if o.DurationSec != nil {
			parameters["duration"] = o.GetDurationSec()
		}
		if o.Seed != nil {
			parameters["seed"] = o.GetSeed()
		}
		if o.Watermark != nil {
			parameters["watermark"] = o.GetWatermark()
		}
		if o.GenerateAudio != nil {
			parameters["audio"] = o.GetGenerateAudio()
		}
	}
	return map[string]any{"model": model, "input": input, "parameters": parameters}, nil
}
