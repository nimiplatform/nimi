package nimillm

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"image"
	"image/color"
	"image/png"
)

type imageMaskReferenceContextKey struct{}

func WithImageMaskReference(ctx context.Context, r *CapturedMediaReference) context.Context {
	if r == nil {
		return ctx
	}
	c := *r
	c.Bytes = bytes.Clone(r.Bytes)
	return context.WithValue(ctx, imageMaskReferenceContextKey{}, &c)
}

func decodeIdeogram45Image(data []byte, mime string) (image.Image, error) {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	if len(data) == 0 || len(data) > 25_000_000 {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	c, f, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (f != "png" && f != "jpeg" && f != "webp") || mime != "image/"+f || c.Width <= 0 || c.Height <= 0 || int64(c.Width)*int64(c.Height) > 16<<20 || c.Width > 6*c.Height || c.Height > 6*c.Width {
		return nil, invalid
	}
	picture, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, invalid
	}
	return picture, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.ideogram45-image
// Canonical white edits; Ideogram black edits. Require binary opaque masks so
// no hidden rounding or alpha interpretation changes the selected region.
func ideogram45NativeMask(source image.Rectangle, data []byte, mime string) ([]byte, error) {
	mask, err := decodeIdeogram45Image(data, mime)
	if err != nil {
		return nil, err
	}
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	if mask.Bounds().Dx() != source.Dx() || mask.Bounds().Dy() != source.Dy() {
		return nil, invalid
	}
	output := image.NewGray(image.Rect(0, 0, source.Dx(), source.Dy()))
	black, white := false, false
	for y := 0; y < source.Dy(); y++ {
		for x := 0; x < source.Dx(); x++ {
			r, g, b, a := mask.At(x+mask.Bounds().Min.X, y+mask.Bounds().Min.Y).RGBA()
			if a != 65535 || r != g || g != b || (r != 0 && r != 65535) {
				return nil, invalid
			}
			v := uint8(255)
			if r == 65535 {
				v = 0
				white = true
			} else {
				black = true
			}
			output.SetGray(x, y, color.Gray{Y: v})
		}
	}
	if !black || !white {
		return nil, invalid
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, output); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}

func ValidateIdeogram45OwnedSource(s *runtimev1.ImageGenerateScenarioSpec, r *CapturedMediaReference) error {
	if err := validateCapturedMediaReferenceIdentity(r, s.GetReferenceImageArtifactId()); err != nil {
		return err
	}
	_, err := decodeIdeogram45Image(r.Bytes, r.MIMEType)
	return err
}

func ValidateIdeogram45OwnedMask(s *runtimev1.ImageGenerateScenarioSpec, source, mask *CapturedMediaReference) error {
	if source == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if err := validateCapturedMediaReferenceIdentity(mask, s.GetMaskArtifactId()); err != nil {
		return err
	}
	c, _, err := image.DecodeConfig(bytes.NewReader(source.Bytes))
	if err != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	_, err = ideogram45NativeMask(image.Rect(0, 0, c.Width, c.Height), mask.Bytes, mask.MIMEType)
	return err
}
