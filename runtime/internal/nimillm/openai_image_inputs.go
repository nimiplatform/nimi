package nimillm

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/mediaimage"
	"google.golang.org/grpc/codes"
	"image"
	"image/color"
	"image/png"
	"net/http"
)

type imageMarkupReferenceContextKey struct{}

func WithImageMarkupReference(ctx context.Context, r *CapturedMediaReference) context.Context {
	if r == nil {
		return ctx
	}
	clone := *r
	clone.Bytes = bytes.Clone(r.Bytes)
	return context.WithValue(ctx, imageMarkupReferenceContextKey{}, &clone)
}

func validateOpenAIInputImage(data []byte, mimeType string) (mediaimage.Info, error) {
	info, err := mediaimage.Inspect(data, 32<<20, 16<<20)
	if err != nil || info.Format != "png" && info.Format != "jpeg" && info.Format != "webp" || mimeType != "image/"+info.Format {
		return mediaimage.Info{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	return info, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-image26
func openAIAlphaMask(data []byte, mimeType string, width, height uint32) ([]byte, error) {
	info, raster, err := mediaimage.Decode(data, 32<<20, 16<<20)
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	if err != nil || info.Format != "png" || mimeType != "image/png" || info.Orientation != 1 || info.Width != width || info.Height != height {
		return nil, invalid
	}
	mask := image.NewNRGBA(image.Rect(0, 0, int(width), int(height)))
	editable := false
	for y := 0; y < int(height); y++ {
		for x := 0; x < int(width); x++ {
			r, g, b, a := raster.At(x, y).RGBA()
			if a != 65535 || r != g || g != b || r != 0 && r != 65535 {
				return nil, invalid
			}
			alpha := uint8(255)
			if r == 65535 {
				alpha = 0
				editable = true
			}
			mask.SetNRGBA(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: alpha})
		}
	}
	if !editable {
		return nil, invalid
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, mask); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}

func validateOpenAIMarkup(data []byte, mimeType string) (mediaimage.Info, error) {
	info, raster, err := mediaimage.Decode(data, 32<<20, 16<<20)
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	if err != nil || info.Format != "png" || mimeType != "image/png" {
		return mediaimage.Info{}, invalid
	}
	bounds := raster.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, a := raster.At(x, y).RGBA()
			if a < 65535 {
				return info, nil
			}
		}
	}
	return mediaimage.Info{}, invalid
}

func ValidateCloudImageMaskReference(provider, model string, s *runtimev1.ImageGenerateScenarioSpec, source, mask *CapturedMediaReference) error {
	if provider == "ideogram" && model == capabilitydriver.Ideogram45Model {
		return ValidateIdeogram45OwnedMask(s, source, mask)
	}
	if provider != "openai" || !capabilitydriver.IsOpenAIImage26(model) || source == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if err := validateCapturedMediaReferenceIdentity(mask, s.GetMaskArtifactId()); err != nil {
		return err
	}
	info, err := validateOpenAIInputImage(source.Bytes, source.MIMEType)
	if err != nil {
		return err
	}
	_, err = openAIAlphaMask(mask.Bytes, mask.MIMEType, info.Width, info.Height)
	return err
}

func ValidateCloudImageMarkupReference(provider, model string, s *runtimev1.ImageGenerateScenarioSpec, source, markup *CapturedMediaReference) error {
	if provider != "openai" || !capabilitydriver.IsOpenAIImage26(model) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if err := validateCapturedMediaReferenceIdentity(markup, s.GetMarkupArtifactId()); err != nil {
		return err
	}
	info, err := validateOpenAIMarkup(markup.Bytes, markup.MIMEType)
	if err != nil {
		return err
	}
	if source != nil {
		original, err := validateOpenAIInputImage(source.Bytes, source.MIMEType)
		if err != nil {
			return err
		}
		if original.Width != info.Width || original.Height != info.Height {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	}
	return nil
}

type openAIEditInputs struct {
	source, mask, markup []byte
	mimeType             string
}

func resolveOpenAIEditInputs(ctx context.Context, s *runtimev1.ImageGenerateScenarioSpec) (openAIEditInputs, error) {
	var input openAIEditInputs
	var err error
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	if id := s.GetReferenceImageArtifactId(); id != "" {
		ref, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if ref == nil || ref.ArtifactID != id {
			return input, invalid
		}
		input.source, input.mimeType = ref.Bytes, ref.MIMEType
	} else if len(s.GetReferenceImages()) == 1 {
		input.source, _, err = resolveReferenceImageBytes(ctx, s.GetReferenceImages()[0])
		if err != nil {
			return input, err
		}
		input.mimeType = http.DetectContentType(input.source)
	} else {
		return input, invalid
	}
	info, err := validateOpenAIInputImage(input.source, input.mimeType)
	if err != nil {
		return input, err
	}
	if s.GetMask() != "" || s.GetMaskArtifactId() != "" {
		var mask []byte
		mimeType := ""
		if id := s.GetMaskArtifactId(); id != "" {
			ref, _ := ctx.Value(imageMaskReferenceContextKey{}).(*CapturedMediaReference)
			if ref == nil || ref.ArtifactID != id {
				return input, invalid
			}
			mask, mimeType = ref.Bytes, ref.MIMEType
		} else {
			mask, _, err = resolveReferenceImageBytes(ctx, s.GetMask())
			if err != nil {
				return input, err
			}
			mimeType = http.DetectContentType(mask)
		}
		input.mask, err = openAIAlphaMask(mask, mimeType, info.Width, info.Height)
		if err != nil {
			return input, err
		}
	}
	if s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" {
		mimeType := ""
		if id := s.GetMarkupArtifactId(); id != "" {
			ref, _ := ctx.Value(imageMarkupReferenceContextKey{}).(*CapturedMediaReference)
			if ref == nil || ref.ArtifactID != id {
				return input, invalid
			}
			input.markup, mimeType = ref.Bytes, ref.MIMEType
		} else {
			input.markup, _, err = resolveReferenceImageBytes(ctx, s.GetMarkup())
			if err != nil {
				return input, err
			}
			mimeType = http.DetectContentType(input.markup)
		}
		overlay, err := validateOpenAIMarkup(input.markup, mimeType)
		if err != nil {
			return input, err
		}
		if overlay.Width != info.Width || overlay.Height != info.Height {
			return input, invalid
		}
	}
	return input, nil
}
