package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// This projection consumes already captured bytes, never an App selector.
// Original content positions are resolved before the canonical prompt helper
// can insert or deduplicate its top-level prompt mirror.
func cloudVideoNativeContent(ctx context.Context, spec *runtimev1.VideoGenerateScenarioSpec) ([]map[string]any, error) {
	material, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	byIndex := make(map[int]CapturedMediaReference, len(material))
	for _, ref := range material {
		byIndex[ref.ContentIndex] = ref.Reference
	}
	cloned := proto.Clone(spec).(*runtimev1.VideoGenerateScenarioSpec)
	for i, item := range cloned.GetContent() {
		if item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			continue
		}
		ref, ok := byIndex[i]
		if !ok || ref.ArtifactID != item.GetArtifactRef().GetArtifactId() {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		location := "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)
		item.ArtifactRef = nil
		if item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO {
			item.Type = runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL
			item.AudioUrl = &runtimev1.VideoContentAudioURL{Url: location}
		} else if item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO {
			item.Type = runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL
			item.VideoUrl = &runtimev1.VideoContentVideoURL{Url: location}
		} else {
			item.Type = runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL
			item.ImageUrl = &runtimev1.VideoContentImageURL{Url: location}
		}
	}
	if cloned.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
		var ordered []*runtimev1.VideoContentItem
		for _, role := range []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME} {
			for _, item := range cloned.GetContent() {
				if item.GetRole() == role {
					ordered = append(ordered, item)
				}
			}
		}
		cloned.Content = ordered
	}
	return VideoContentPayload(cloned), nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.seedance-current-video
func buildSeedanceVideoPayload(ctx context.Context, model string, spec *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	content, err := cloudVideoNativeContent(ctx, spec)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"model": model, "content": content}
	if o := spec.GetOptions(); o != nil {
		if o.GetResolution() != "" {
			body["resolution"] = o.GetResolution()
		}
		if o.GetRatio() != "" {
			body["ratio"] = o.GetRatio()
		}
		if o.DurationSec != nil {
			body["duration"] = o.GetDurationSec()
		}
		if o.GenerateAudio != nil {
			body["generate_audio"] = o.GetGenerateAudio()
		}
		if o.Watermark != nil {
			body["watermark"] = o.GetWatermark()
		}
		if o.ReturnLastFrame != nil {
			body["return_last_frame"] = o.GetReturnLastFrame()
		}
		if o.Draft != nil {
			body["draft"] = o.GetDraft()
		}
		if o.GetServiceTier() != "" {
			body["service_tier"] = o.GetServiceTier()
		}
		if o.GetExecutionExpiresAfterSec() != 0 {
			body["execution_expires_after"] = o.GetExecutionExpiresAfterSec()
		}
	}
	raw, err := json.Marshal(body)
	if err != nil || len(raw) > 64_000_000 {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	return body, nil
}

func validateSeedanceCapturedMedia(model string, spec *runtimev1.VideoGenerateScenarioSpec, references []CloudVideoMediaReference) error {
	for _, r := range references {
		item := spec.GetContent()[r.ContentIndex]
		if item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO {
			if len(r.Reference.Bytes) > 15_000_000 {
				return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
			}
			if r.Reference.MIMEType != "audio/wav" && r.Reference.MIMEType != "audio/mpeg" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
			}
		} else if !strings.HasPrefix(r.Reference.MIMEType, "image/") {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
		}
	}
	_, err := buildSeedanceVideoPayload(WithCloudVideoMediaReferences(context.Background(), references), model, spec)
	return err
}
