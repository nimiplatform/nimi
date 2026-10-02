package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const adapterOpenAIImages = "openai_images_adapter"
const maxOpenAIImageEditInputBytes = 50 * 1024 * 1024

// openAIImageEditUploadNames are the input image types the edits endpoint
// accepts, keyed by the sniffed MIME type.
var openAIImageEditUploadNames = map[string]string{"image/png": "image.png", "image/jpeg": "image.jpg", "image/webp": "image.webp"}

// executeOpenAIImage generates one PNG through the OpenAI Images API, or edits
// one reference image, and keeps the image and token usage it reports.
func (p *CloudProvider) executeOpenAIImage(
	ctx context.Context,
	request *runtimev1.SubmitScenarioJobRequest,
	modelID string,
	target *RemoteTarget,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if p == nil || target == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend, backendModelID := p.ResolveMediaBackendWithTarget(modelID, target)
	if backend == nil || strings.TrimSpace(backendModelID) == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	var spec *runtimev1.ImageGenerateScenarioSpec
	if request != nil {
		spec = request.GetSpec().GetImageGenerate()
	}
	// Reference and mask downloads follow the target's endpoint policy.
	ctx = mediaAdapterEndpointPolicyContext(ctx, MediaAdapterConfig{AllowLoopbackEndpoint: target.AllowLoopback})
	image, width, height, usage, err := backend.generateOpenAIImage(ctx, backendModelID, spec)
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact("image/png", image, map[string]any{"adapter": adapterOpenAIImages, "width": width, "height": height})
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

func (b *Backend) generateOpenAIImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerateScenarioSpec) ([]byte, int32, int32, *runtimev1.UsageStats, error) {
	prompt := strings.TrimSpace(spec.GetPrompt())
	references := spec.GetReferenceImages()
	if b == nil || prompt == "" || len(references) > 1 || (len(references) == 0 && strings.TrimSpace(spec.GetMask()) != "") {
		return nil, 0, 0, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	fields := [][2]string{{"model", modelID}, {"prompt", prompt}}
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		fields = append(fields, [2]string{"size", size})
	}
	if quality := strings.TrimSpace(spec.GetQuality()); quality != "" {
		fields = append(fields, [2]string{"quality", quality})
	}
	var out openAIImageResponse
	if len(references) == 1 {
		if err := b.postOpenAIImageEdit(ctx, fields, references[0], strings.TrimSpace(spec.GetMask()), &out); err != nil {
			return nil, 0, 0, nil, err
		}
	} else {
		payload := make(map[string]any, len(fields))
		for _, field := range fields {
			payload[field[0]] = field[1]
		}
		if err := b.postJSON(ctx, "/v1/images/generations", payload, &out); err != nil {
			return nil, 0, 0, nil, err
		}
	}
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	if len(out.Data) != 1 || out.Data[0].B64JSON == "" {
		return nil, 0, 0, nil, invalid
	}
	image, err := base64.StdEncoding.DecodeString(out.Data[0].B64JSON)
	if err != nil {
		return nil, 0, 0, nil, invalid
	}
	width, height, ok := pngDimensions(image)
	if !ok {
		return nil, 0, 0, nil, invalid
	}
	var usage *runtimev1.UsageStats
	if reported := out.Usage; reported != nil && reported.InputTokens != nil && reported.OutputTokens != nil &&
		*reported.InputTokens >= 0 && *reported.OutputTokens >= 0 {
		usage = &runtimev1.UsageStats{InputTokens: *reported.InputTokens, OutputTokens: *reported.OutputTokens}
	}
	return image, width, height, usage, nil
}

type openAIImageResponse struct {
	Data []struct {
		B64JSON string `json:"b64_json"`
	} `json:"data"`
	Usage *struct {
		InputTokens  *int64 `json:"input_tokens"`
		OutputTokens *int64 `json:"output_tokens"`
	} `json:"usage"`
}

// postOpenAIImageEdit uploads one reference image, and an optional mask of the
// same PNG size, to the edits endpoint.
func (b *Backend) postOpenAIImageEdit(ctx context.Context, fields [][2]string, reference string, mask string, out *openAIImageResponse) error {
	unsupported := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	image, _, err := resolveReferenceImageBytes(ctx, reference)
	if err != nil {
		return err
	}
	imageType := http.DetectContentType(image)
	imageName := openAIImageEditUploadNames[imageType]
	if imageName == "" || len(image) >= maxOpenAIImageEditInputBytes {
		return unsupported
	}
	var maskImage []byte
	if mask != "" {
		if maskImage, _, err = resolveReferenceImageBytes(ctx, mask); err != nil {
			return err
		}
		imageWidth, imageHeight, imageOK := pngDimensions(image)
		maskWidth, maskHeight, maskOK := pngDimensions(maskImage)
		if !imageOK || !maskOK || imageWidth != maskWidth || imageHeight != maskHeight || len(maskImage) >= maxOpenAIImageEditInputBytes {
			return unsupported
		}
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return MapProviderRequestError(err)
		}
	}
	if err := writeOpenAIImagePart(writer, "image[]", imageName, imageType, image); err != nil {
		return err
	}
	if maskImage != nil {
		if err := writeOpenAIImagePart(writer, "mask", "mask.png", "image/png", maskImage); err != nil {
			return err
		}
	}
	if err := writer.Close(); err != nil {
		return MapProviderRequestError(err)
	}
	request, err := b.newRequest(ctx, http.MethodPost, b.baseURL+"/v1/images/edits", body)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := b.do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	return DecodeResponseJSON(response, out)
}

func writeOpenAIImagePart(writer *multipart.Writer, field string, filename string, mimeType string, payload []byte) error {
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, field, filename))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return MapProviderRequestError(err)
	}
	if _, err := part.Write(payload); err != nil {
		return MapProviderRequestError(err)
	}
	return nil
}

// pngDimensions validates the complete PNG before exposing its dimensions.
// Bound decoded pixel allocation separately from the HTTP body's byte limit.
func pngDimensions(payload []byte) (int32, int32, bool) {
	config, format, ok := decodedMediaImageConfig(payload)
	if !ok || format != "png" {
		return 0, 0, false
	}
	return int32(config.Width), int32(config.Height), true
}
