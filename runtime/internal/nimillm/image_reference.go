package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// CapturedMediaReference contains owner-authorized execution material captured before
// Job publication. It is never an App input or a provider file handle.
type CapturedMediaReference struct {
	ArtifactID string `json:"artifact_id"`
	MIMEType   string `json:"mime_type"`
	SHA256     string `json:"sha256"`
	Bytes      []byte `json:"bytes"`
}

type imageReferenceContextKey struct{}

func WithImageReference(ctx context.Context, reference *CapturedMediaReference) context.Context {
	if reference == nil {
		return ctx
	}
	copy := *reference
	copy.Bytes = bytes.Clone(reference.Bytes)
	return context.WithValue(ctx, imageReferenceContextKey{}, &copy)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-owned-image-reference
func ValidateImageReference(reference *CapturedMediaReference, artifactID string) error {
	if err := validateCapturedMediaReferenceIdentity(reference, artifactID); err != nil {
		return err
	}
	_, format, valid := decodedMediaImageConfig(reference.Bytes)
	if !valid || reference.MIMEType != "image/"+format {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	return nil
}

func validateCapturedMediaReferenceIdentity(reference *CapturedMediaReference, artifactID string) error {
	if reference == nil || artifactID == "" || reference.ArtifactID != artifactID || len(reference.Bytes) == 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if len(reference.Bytes) > 32<<20 {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	digest := sha256.Sum256(reference.Bytes)
	if reference.SHA256 != hex.EncodeToString(digest[:]) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	return nil
}

func geminiOwnedImagePart(reference *CapturedMediaReference) map[string]any {
	return map[string]any{"inlineData": map[string]any{
		"mimeType": reference.MIMEType, "data": base64.StdEncoding.EncodeToString(reference.Bytes),
	}}
}

func geminiImageGeneratePayload(spec *runtimev1.ImageGenerateScenarioSpec, references []map[string]any) (map[string]any, error) {
	config := map[string]any{"responseModalities": []string{"IMAGE"}}
	if ratio := strings.TrimSpace(spec.GetAspectRatio()); ratio != "" {
		config["imageConfig"] = map[string]any{"aspectRatio": ratio}
	}
	// Only the exact Nano Banana 2.1 Driver admits nonempty size on this path.
	if strings.TrimSpace(spec.GetSize()) != "" {
		size, err := capabilitydriver.GeminiNanoBanana21ImageSize(spec)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		imageConfig := map[string]any{"imageSize": size}
		ratio := strings.TrimSpace(spec.GetAspectRatio())
		if ratio != "" {
			imageConfig["aspectRatio"] = ratio
		}
		config["imageConfig"] = imageConfig
	}
	parts := append([]map[string]any{{"text": strings.TrimSpace(spec.GetPrompt())}}, references...)
	return map[string]any{"contents": []map[string]any{{"parts": parts}}, "generationConfig": config}, nil
}

func validateGeminiImagePayloadSize(payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil || len(raw) > 20_000_000 {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	return nil
}

// ValidateGeminiImageReferenceRequest applies the same serialization budget at
// admission and dispatch, without credentials, provider calls or artifact reads.
func ValidateGeminiImageReferenceRequest(spec *runtimev1.ImageGenerateScenarioSpec, reference *CapturedMediaReference) error {
	if spec == nil || len(spec.GetReferenceImages()) != 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if err := ValidateImageReference(reference, spec.GetReferenceImageArtifactId()); err != nil {
		return err
	}
	payload, err := geminiImageGeneratePayload(spec, []map[string]any{geminiOwnedImagePart(reference)})
	if err != nil {
		return err
	}
	return validateGeminiImagePayloadSize(payload)
}

func ValidateCloudImageReferenceRequest(provider, model string, spec *runtimev1.ImageGenerateScenarioSpec, reference *CapturedMediaReference) error {
	if provider == "openrouter" && capabilitydriver.IsOpenRouterImageModel(model) {
		return validateCapturedRasterReference(reference, spec.GetReferenceImageArtifactId(), 16<<20, 8000)
	}
	if provider == "xai" && model == capabilitydriver.XAIImage2Model {
		return validateCapturedXAIImage(reference, spec.GetReferenceImageArtifactId())
	}
	if provider == "stability" && capabilitydriver.StabilityImageReferenceSupported(model) {
		if err := validateCapturedRasterReference(reference, spec.GetReferenceImageArtifactId(), 16384*16384, 16384); err != nil {
			return err
		}
		geometry, _, _ := image.DecodeConfig(bytes.NewReader(reference.Bytes))
		if geometry.Width < 64 || geometry.Height < 64 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		return nil
	}
	if provider == "luma" && capabilitydriver.IsLumaUniImageModel(model) {
		return validateCapturedRasterReference(reference, spec.GetReferenceImageArtifactId(), 16<<20, 8000)
	}
	if provider == "ideogram" && model == capabilitydriver.Ideogram45Model {
		return ValidateIdeogram45OwnedSource(spec, reference)
	}
	if capabilitydriver.SupportsGPTImageOwnedInputs(provider, model) {
		if err := validateCapturedMediaReferenceIdentity(reference, spec.GetReferenceImageArtifactId()); err != nil {
			return err
		}
		_, err := validateOpenAIInputImage(reference.Bytes, reference.MIMEType)
		return err
	}
	if provider == "gemini" {
		return ValidateGeminiImageReferenceRequest(spec, reference)
	}
	if provider == "flux" && capabilitydriver.IsFlux3ImageModel(model) && spec != nil && len(spec.GetReferenceImages()) == 0 {
		return validateFlux3Reference(reference, spec.GetReferenceImageArtifactId())
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
}

func validateCapturedXAIImage(reference *CapturedMediaReference, id string) error {
	if err := validateCapturedMediaReferenceIdentity(reference, id); err != nil {
		return err
	}
	geometry, format, err := image.DecodeConfig(bytes.NewReader(reference.Bytes))
	if err != nil || geometry.Width <= 0 || geometry.Height <= 0 || (format != "png" && format != "jpeg" && format != "webp") || reference.MIMEType != "image/"+format {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	return nil
}

// Reviewed raster callers choose finite decoder geometry without changing custody.
func validateCapturedRasterReference(reference *CapturedMediaReference, id string, maxPixels int64, maxSide int) error {
	if err := validateCapturedMediaReferenceIdentity(reference, id); err != nil {
		return err
	}
	c, format, err := image.DecodeConfig(bytes.NewReader(reference.Bytes))
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	if err != nil || (format != "png" && format != "jpeg" && format != "webp") || reference.MIMEType != "image/"+format || c.Width <= 0 || c.Height <= 0 || c.Width > maxSide || c.Height > maxSide || int64(c.Width)*int64(c.Height) > maxPixels {
		return invalid
	}
	if _, _, err = image.Decode(bytes.NewReader(reference.Bytes)); err != nil {
		return invalid
	}
	return nil
}
