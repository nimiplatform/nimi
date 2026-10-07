package nimillm

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/mediaimage"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r029
// Admission and restored immutable captures use the selected Driver's bounds.
func ValidateCloudWorldRequestFields(provider string, spec *runtimev1.WorldGenerateScenarioSpec) error {
	switch provider {
	case "worldlabs":
		return ValidateWorldLabsRequestFields(spec)
	case "spaitial":
		if spec == nil || utf8.RuneCountInString(spec.GetTextPrompt()) > 2000 || utf8.RuneCountInString(spec.GetDisplayName()) > 200 || len(spec.GetTags()) != 0 || spec.GetSeed() != 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		switch spec.GetConditioning().(type) {
		case nil:
			if strings.TrimSpace(spec.GetTextPrompt()) == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
		case *runtimev1.WorldGenerateScenarioSpec_ImagePrompt:
			if strings.TrimSpace(spec.GetTextPrompt()) != "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
			}
		default:
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		return nil
	default:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func ValidateCloudWorldImageReference(provider string, spec *runtimev1.WorldGenerateScenarioSpec, reference *ImageReference) error {
	if err := ValidateCloudWorldRequestFields(provider, spec); err != nil {
		return err
	}
	switch provider {
	case "worldlabs":
		return validateWorldImageReference(spec, reference, worldLabsImageMaxBytes)
	case "spaitial":
		// The API admits at most 25 MB for generation even though the upload
		// endpoint separately accepts larger files. No resize or animation.
		return validateWorldImageReference(spec, reference, 25_000_000)
	default:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func validateWorldImageReference(spec *runtimev1.WorldGenerateScenarioSpec, reference *ImageReference, maxBytes int) error {
	image := spec.GetImagePrompt()
	id := image.GetContent().GetArtifactId()
	if image == nil || id == "" || reference == nil || reference.ArtifactID != id || len(reference.Bytes) == 0 ||
		(image.GetProjection() != runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY && image.GetProjection() != runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if len(reference.Bytes) > maxBytes {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	digest := sha256.Sum256(reference.Bytes)
	if reference.SHA256 != hex.EncodeToString(digest[:]) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	info, err := mediaimage.Inspect(reference.Bytes, maxBytes, 16<<20)
	if err != nil || (info.Format != "png" && info.Format != "jpeg" && info.Format != "webp") || reference.MIMEType != "image/"+info.Format {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	if info.Orientation != 1 || (image.GetProjection() == runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360 && info.Width != 2*info.Height) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}
