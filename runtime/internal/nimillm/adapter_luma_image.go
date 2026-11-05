package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const AdapterLumaUniImage = "luma_uni_image_adapter"

// @nimi-authority: rule.nimi.runtime.ai-provider.luma-uni-image
func ExecuteLumaUniImage(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = originalControlRequest(mediaAdapterEndpointPolicyContext(ctx, cfg))
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	if err = requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	s := req.GetSpec().GetImageGenerate()
	payload := map[string]any{"model": model, "type": "image", "prompt": s.GetPrompt(), "output_format": s.GetOutputFormat(), "web_search": false}
	if s.GetAspectRatio() != "" {
		payload["aspect_ratio"] = s.GetAspectRatio()
	}
	if s.GetStyle() != "" {
		payload["style"] = s.GetStyle()
	}
	kind := "image"
	if s.GetReferenceImageArtifactId() != "" {
		reference, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if reference == nil || reference.ArtifactID != s.GetReferenceImageArtifactId() {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		payload["source"] = map[string]any{"data": base64.StdEncoding.EncodeToString(reference.Bytes), "media_type": reference.MIMEType}
		kind = "image_edit"
	} else if len(s.GetReferenceImages()) > 0 {
		payload["source"] = map[string]any{"url": s.GetReferenceImages()[0]}
		if len(s.GetReferenceImages()) > 1 {
			references := make([]map[string]any, 0, len(s.GetReferenceImages())-1)
			for _, u := range s.GetReferenceImages()[1:] {
				references = append(references, map[string]any{"url": u})
			}
			payload["image_ref"] = references
		}
		kind = "image_edit"
	}
	payload["type"] = kind
	response := map[string]any{}
	if err = DoJSONRequestWithHeaders(nativeCreateRequest(ctx), http.MethodPost, JoinURL(lumaAgentsBaseURL(cfg.BaseURL), "/v1/generations"), key, payload, &response, cfg.Headers); err != nil {
		return nil, nil, "", err
	}
	id := ValueAsString(response["id"])
	if id == "" || ValueAsString(response["model"]) != model || ValueAsString(response["type"]) != kind {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterLumaUniImage, TaskID: id, Model: model, LumaGenerationType: kind, QueryPathTemplate: lumaAgentsQueryPath, Artifact: BinaryArtifact("image/"+s.GetOutputFormat(), nil, map[string]any{"adapter": AdapterLumaUniImage})})
	return nil, nil, id, err
}
