package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// ImageReference contains owner-authorized execution material captured before
// Job publication. It is never an App input or a provider file handle.
type ImageReference struct {
	ArtifactID string `json:"artifact_id"`
	MIMEType   string `json:"mime_type"`
	SHA256     string `json:"sha256"`
	Bytes      []byte `json:"bytes"`
}

type imageReferenceContextKey struct{}

func WithImageReference(ctx context.Context, reference *ImageReference) context.Context {
	if reference == nil {
		return ctx
	}
	copy := *reference
	copy.Bytes = bytes.Clone(reference.Bytes)
	return context.WithValue(ctx, imageReferenceContextKey{}, &copy)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-owned-image-reference
func ValidateImageReference(reference *ImageReference, artifactID string) error {
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
	_, format, valid := decodedMediaImageConfig(reference.Bytes)
	if !valid || reference.MIMEType != "image/"+format {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	return nil
}

func geminiOwnedImagePart(reference *ImageReference) map[string]any {
	return map[string]any{"inlineData": map[string]any{
		"mimeType": reference.MIMEType, "data": base64.StdEncoding.EncodeToString(reference.Bytes),
	}}
}

func geminiImageGeneratePayload(spec *runtimev1.ImageGenerateScenarioSpec, references []map[string]any) map[string]any {
	config := map[string]any{"responseModalities": []string{"IMAGE"}}
	if ratio := resolveGeminiImageAspectRatio(spec); ratio != "" {
		config["imageConfig"] = map[string]any{"aspectRatio": ratio}
	}
	parts := append([]map[string]any{{"text": strings.TrimSpace(spec.GetPrompt())}}, references...)
	return map[string]any{"contents": []map[string]any{{"parts": parts}}, "generationConfig": config}
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
func ValidateGeminiImageReferenceRequest(spec *runtimev1.ImageGenerateScenarioSpec, reference *ImageReference) error {
	if spec == nil || len(spec.GetReferenceImages()) != 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if err := ValidateImageReference(reference, spec.GetReferenceImageArtifactId()); err != nil {
		return err
	}
	return validateGeminiImagePayloadSize(geminiImageGeneratePayload(spec, []map[string]any{geminiOwnedImagePart(reference)}))
}
