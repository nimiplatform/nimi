package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const adapterOpenAIImages = "openai_images_adapter"

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// executeOpenAIImage generates one PNG through the OpenAI Images API and keeps
// the image and token usage it reports.
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
	image, width, height, usage, err := backend.generateOpenAIImage(ctx, backendModelID, spec)
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact("image/png", image, map[string]any{"adapter": adapterOpenAIImages, "width": width, "height": height})
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

func (b *Backend) generateOpenAIImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerateScenarioSpec) ([]byte, int32, int32, *runtimev1.UsageStats, error) {
	prompt := strings.TrimSpace(spec.GetPrompt())
	if b == nil || prompt == "" || len(spec.GetReferenceImages()) > 0 || strings.TrimSpace(spec.GetMask()) != "" {
		return nil, 0, 0, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	payload := map[string]any{"model": modelID, "prompt": prompt}
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		payload["size"] = size
	}
	if quality := strings.TrimSpace(spec.GetQuality()); quality != "" {
		payload["quality"] = quality
	}
	var out struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
		Usage *struct {
			InputTokens  *int64 `json:"input_tokens"`
			OutputTokens *int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := b.postJSON(ctx, "/v1/images/generations", payload, &out); err != nil {
		return nil, 0, 0, nil, err
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

// pngDimensions reads the width and height from a PNG's leading IHDR chunk.
func pngDimensions(image []byte) (int32, int32, bool) {
	if len(image) < 24 || !bytes.Equal(image[:8], pngSignature) || string(image[12:16]) != "IHDR" {
		return 0, 0, false
	}
	width, height := binary.BigEndian.Uint32(image[16:20]), binary.BigEndian.Uint32(image[20:24])
	if width == 0 || height == 0 || width > 1<<15 || height > 1<<15 {
		return 0, 0, false
	}
	return int32(width), int32(height), true
}
