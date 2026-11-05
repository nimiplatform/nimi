package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type CloudVideoMediaReference struct {
	ContentIndex int                    `json:"content_index"`
	Reference    CapturedMediaReference `json:"reference"`
}
type cloudVideoMediaKey struct{}

func WithCloudVideoMediaReferences(ctx context.Context, references []CloudVideoMediaReference) context.Context {
	if len(references) == 0 {
		return ctx
	}
	cloned := append([]CloudVideoMediaReference(nil), references...)
	for i := range cloned {
		cloned[i].Reference.Bytes = bytes.Clone(cloned[i].Reference.Bytes)
	}
	return context.WithValue(ctx, cloudVideoMediaKey{}, cloned)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func ValidateCloudVideoMediaReferences(provider, model string, spec *runtimev1.VideoGenerateScenarioSpec, references []CloudVideoMediaReference) error {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	limit := 6
	if provider == "flux" || provider == "luma" {
		limit = 2
	} else if provider == "dashscope" {
		limit = capabilitydriver.AlibabaVideoImageReferenceLimit(model)
	} else if provider == "volcengine" {
		images, _, audios := capabilitydriver.SeedanceVideoReferenceLimits(model)
		limit = images + audios
	} else if provider == "minimax" {
		limit = 15
	}
	if spec == nil || !capabilitydriver.SupportsCloudVideoArtifacts(provider, model) || len(references) > limit {
		return invalid
	}
	next := 0
	total := 0
	for index, item := range spec.GetContent() {
		if item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			continue
		}
		if next >= len(references) || references[next].ContentIndex != index {
			return invalid
		}
		reference := &references[next].Reference
		if provider == "luma" {
			if err := validateCapturedRasterReference(reference, item.GetArtifactRef().GetArtifactId(), 16<<20, 8000); err != nil {
				return err
			}
		} else if provider == "flux" {
			if err := validateFlux3Reference(reference, item.GetArtifactRef().GetArtifactId()); err != nil {
				return err
			}
		} else if provider == "dashscope" || provider == "volcengine" || provider == "minimax" {
			total += len(reference.Bytes)
			if total > 64_000_000 {
				return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
			}
			if err := validateCapturedMediaReferenceIdentity(reference, item.GetArtifactRef().GetArtifactId()); err != nil {
				return err
			}
			if provider == "dashscope" {
				if err := capabilitydriver.ValidateAlibabaCurrentVideoImage(model, reference.Bytes, reference.MIMEType); err != nil {
					return err
				}
			} else if provider == "minimax" {
				switch item.GetRole() {
				case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO:
					if reference.MIMEType != "audio/wav" && reference.MIMEType != "audio/mpeg" {
						return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
					}
					if len(reference.Bytes) > 15_000_000 {
						return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
					}
				case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO:
					if reference.MIMEType != "video/mp4" {
						return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
					}
				default:
					if err := capabilitydriver.ValidateMiniMaxH3Image(reference.Bytes, reference.MIMEType); err != nil {
						return err
					}
				}
			} else if item.GetRole() != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO {
				if err := capabilitydriver.ValidateSeedanceVideoImage(model, reference.Bytes, reference.MIMEType); err != nil {
					return err
				}
			}
		} else {
			if err := ValidateImageReference(reference, item.GetArtifactRef().GetArtifactId()); err != nil {
				return err
			}
			if len(reference.Bytes) > 20<<20 {
				return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
			}
			if reference.MIMEType != "image/png" && reference.MIMEType != "image/jpeg" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
			}
		}
		next++
	}
	if next != len(references) {
		return invalid
	}
	if provider == "volcengine" {
		return validateSeedanceCapturedMedia(model, spec, references)
	}
	if provider == "minimax" {
		_, err := buildMiniMaxH3Payload(WithCloudVideoMediaReferences(context.Background(), references), model, spec)
		return err
	}
	return nil
}

func geminiOmniImageParts(ctx context.Context, spec *runtimev1.VideoGenerateScenarioSpec) ([]map[string]any, error) {
	references, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	byIndex := make(map[int]CapturedMediaReference, len(references))
	for _, reference := range references {
		byIndex[reference.ContentIndex] = reference.Reference
	}
	var roles []runtimev1.VideoContentRole
	switch spec.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		roles = []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		roles = []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME}
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		roles = []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE}
	}
	var input []map[string]any
	for _, role := range roles {
		for index, item := range spec.GetContent() {
			if item.GetRole() != role {
				continue
			}
			var data []byte
			mimeType := ""
			if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
				reference, ok := byIndex[index]
				if !ok || reference.ArtifactID != item.GetArtifactRef().GetArtifactId() {
					return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
				}
				data, mimeType = reference.Bytes, reference.MIMEType
			} else {
				var err error
				data, _, err = resolveReferenceImageBytes(ctx, item.GetImageUrl().GetUrl())
				if err != nil {
					return nil, err
				}
				if len(data) > 20<<20 {
					return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
				}
				_, format, valid := decodedMediaImageConfig(data)
				if !valid || (format != "png" && format != "jpeg") {
					return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
				}
				mimeType = "image/" + format
			}
			input = append(input, map[string]any{"type": "image", "data": base64.StdEncoding.EncodeToString(data), "mime_type": mimeType})
		}
	}
	return input, nil
}
