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

// executeOpenAIImage generates or edits one image through the OpenAI Images API
// and retains the validated output format, dimensions, timing and reported usage.
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
	output, usage, err := backend.generateOpenAIImageWithAuthor(ctx, backendModelID, spec, target.SVGAuthorModelID)
	if err != nil {
		return nil, nil, "", err
	}
	metadata := map[string]any{"adapter": adapterOpenAIImages, "width": output.width, "height": output.height, "duration_ms": output.durationMs}
	if output.svgUsage != nil {
		metadata["svg_usage"] = map[string]any{"model": output.svgUsage.Model, "input_tokens": *output.svgUsage.InputTokens, "output_tokens": *output.svgUsage.OutputTokens, "reasoning_tokens": *output.svgUsage.ReasoningTokens, "total_tokens": *output.svgUsage.TotalTokens}
	}
	artifact := BinaryArtifact(output.mimeType, output.bytes, metadata)
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

type openAIImageOutput struct {
	svgUsage      *openAISVGUsage
	bytes         []byte
	mimeType      string
	width, height int32
	durationMs    int64
}

func (b *Backend) generateOpenAIImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerateScenarioSpec) (*openAIImageOutput, *runtimev1.UsageStats, error) {
	return b.generateOpenAIImageWithAuthor(ctx, modelID, spec, "")
}

func (b *Backend) generateOpenAIImageWithAuthor(ctx context.Context, modelID string, spec *runtimev1.ImageGenerateScenarioSpec, authorModel string) (*openAIImageOutput, *runtimev1.UsageStats, error) {
	if b == nil || spec == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	fields := map[string]any{"model": modelID, "prompt": strings.TrimSpace(spec.GetPrompt())}
	if spec.GetOutputFormat() == "svg" {
		if authorModel == "" {
			return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		fields["svg"] = map[string]string{"model": authorModel}
		fields["n"] = 1
	}
	for key, value := range map[string]string{"size": spec.GetSize(), "quality": spec.GetQuality(), "complexity": spec.GetComplexity(), "output_format": spec.GetOutputFormat()} {
		if value != "" {
			fields[key] = value
		}
	}
	if spec.FrameCount != nil {
		fields["frame_count"] = spec.GetFrameCount()
	}
	if spec.FrameDurationMs != nil {
		fields["frame_duration_ms"] = spec.GetFrameDurationMs()
	}
	var out openAIImageResponse
	if len(spec.GetReferenceImages()) > 0 || spec.GetReferenceImageArtifactId() != "" {
		inputs, err := resolveOpenAIEditInputs(ctx, spec)
		if err != nil {
			return nil, nil, err
		}
		if err := b.postOpenAIImageEdit(ctx, fields, inputs, &out); err != nil {
			return nil, nil, err
		}
	} else {
		if err := b.postJSON(ctx, "/v1/images/generations", fields, &out); err != nil {
			return nil, nil, err
		}
	}
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	var usage *runtimev1.UsageStats
	if reported := out.Usage; reported != nil && reported.InputTokens != nil && reported.OutputTokens != nil && *reported.InputTokens >= 0 && *reported.OutputTokens >= 0 {
		usage = &runtimev1.UsageStats{InputTokens: *reported.InputTokens, OutputTokens: *reported.OutputTokens}
	}
	if spec.GetOutputFormat() == "svg" {
		if usage != nil && (usage.InputTokens > 1<<50 || usage.OutputTokens > 1<<50) {
			return nil, nil, invalid
		}
		var svgUsage *runtimev1.UsageStats
		if value := out.SVGUsage; value != nil {
			if value.Model != authorModel || value.InputTokens == nil || value.OutputTokens == nil || value.ReasoningTokens == nil || value.TotalTokens == nil || *value.InputTokens < 0 || *value.OutputTokens < 0 || *value.ReasoningTokens < 0 || *value.ReasoningTokens > *value.OutputTokens || *value.InputTokens > 1<<50 || *value.OutputTokens > 1<<50 || *value.TotalTokens != *value.InputTokens+*value.OutputTokens {
				return nil, nil, invalid
			}
			svgUsage = &runtimev1.UsageStats{InputTokens: *value.InputTokens, OutputTokens: *value.OutputTokens, ReasoningOutputTokens: *value.ReasoningTokens}
		}
		reportModelUsage(ctx, []*runtimev1.DesktopAIModelUsage{
			{Model: &runtimev1.DesktopAIExecutionModel{ProviderId: "openai", ModelId: modelID, DisplayName: modelID, Role: "image-render"}, Usage: usage},
			{Model: &runtimev1.DesktopAIExecutionModel{ProviderId: "openai", ModelId: authorModel, DisplayName: authorModel, Role: "svg-author"}, Usage: svgUsage},
		})
	}
	if len(out.Data) != 1 || out.Data[0].B64JSON == "" {
		return nil, nil, invalid
	}
	data, err := base64.StdEncoding.DecodeString(out.Data[0].B64JSON)
	if err != nil {
		return nil, nil, invalid
	}
	output, err := validateOpenAIImageOutput(data, spec)
	if err != nil {
		return nil, nil, err
	}
	if spec.GetOutputFormat() == "svg" {
		output.svgUsage = out.SVGUsage
	}
	return output, usage, nil
}

type openAISVGUsage struct {
	Model           string `json:"model"`
	InputTokens     *int64 `json:"input_tokens"`
	OutputTokens    *int64 `json:"output_tokens"`
	ReasoningTokens *int64 `json:"reasoning_tokens"`
	TotalTokens     *int64 `json:"total_tokens"`
}

type openAIImageResponse struct {
	SVGUsage *openAISVGUsage `json:"svg_usage"`
	Data     []struct {
		B64JSON string `json:"b64_json"`
	} `json:"data"`
	Usage *struct {
		InputTokens  *int64 `json:"input_tokens"`
		OutputTokens *int64 `json:"output_tokens"`
	} `json:"usage"`
}

// postOpenAIImageEdit uploads one reference image, and an optional mask of the
// same PNG size, to the edits endpoint.
func (b *Backend) postOpenAIImageEdit(ctx context.Context, fields map[string]any, input openAIEditInputs, out *openAIImageResponse) error {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, value := range fields {
		if err := writer.WriteField(key, fmt.Sprint(value)); err != nil {
			return MapProviderRequestError(err)
		}
	}
	if err := writeMediaImagePart(writer, "image[]", openAIImageEditUploadNames[input.mimeType], input.mimeType, input.source); err != nil {
		return err
	}
	if input.mask != nil {
		if err := writeMediaImagePart(writer, "mask", "mask.png", "image/png", input.mask); err != nil {
			return err
		}
	}
	if input.markup != nil {
		if err := writeMediaImagePart(writer, "markup", "markup.png", "image/png", input.markup); err != nil {
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
	defer response.Body.Close()
	return DecodeResponseJSON(response, out)
}

func writeMediaImagePart(writer *multipart.Writer, field string, filename string, mimeType string, payload []byte) error {
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
