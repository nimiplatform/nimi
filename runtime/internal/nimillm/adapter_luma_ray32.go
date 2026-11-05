package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strconv"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const AdapterLumaRay32 = "luma_ray32_adapter"

// @nimi-authority: rule.nimi.runtime.ai-provider.luma-ray32-video
func ExecuteLumaRay32(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = originalControlRequest(mediaAdapterEndpointPolicyContext(ctx, cfg))
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	payload, err := lumaRay32Payload(ctx, req.GetSpec().GetVideoGenerate())
	if err != nil {
		return nil, nil, "", err
	}
	response := map[string]any{}
	err = DoJSONRequestWithHeaders(nativeCreateRequest(ctx), http.MethodPost, JoinURL(lumaAgentsBaseURL(cfg.BaseURL), "/v1/generations"), key, payload, &response, cfg.Headers)
	if err != nil {
		return nil, nil, "", err
	}
	id := ValueAsString(response["id"])
	if id == "" || ValueAsString(response["model"]) != capabilitydriver.LumaRay32Model || ValueAsString(response["type"]) != "video" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterLumaRay32, TaskID: id, Model: capabilitydriver.LumaRay32Model, QueryPathTemplate: lumaAgentsQueryPath, Artifact: BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterLumaRay32})})
	return nil, nil, id, err
}

func lumaRay32Payload(ctx context.Context, s *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	duration := s.GetOptions().GetDurationSec()
	video := map[string]any{"duration": strconv.Itoa(int(duration)) + "s"}
	p := map[string]any{"model": capabilitydriver.LumaRay32Model, "type": "video", "prompt": capabilitydriver.VideoPrompt(s), "video": video}
	if s.GetOptions().GetRatio() != "" {
		p["aspect_ratio"] = s.GetOptions().GetRatio()
	}
	if s.GetOptions().GetResolution() != "" {
		video["resolution"] = s.GetOptions().GetResolution()
	}
	references, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	byIndex := map[int]CapturedMediaReference{}
	for _, r := range references {
		byIndex[r.ContentIndex] = r.Reference
	}
	frames := []map[string]any{}
	positions := []int{}
	for _, role := range []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME} {
		for i, item := range s.GetContent() {
			if item.GetRole() != role {
				continue
			}
			input := map[string]any{}
			if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
				r, ok := byIndex[i]
				if !ok || r.ArtifactID != item.GetArtifactRef().GetArtifactId() {
					return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
				}
				input["data"], input["media_type"] = base64.StdEncoding.EncodeToString(r.Bytes), r.MIMEType
			} else {
				input["url"] = item.GetImageUrl().GetUrl()
			}
			frames = append(frames, input)
			position := 0
			if role == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME {
				position = int(duration) * 24
			}
			positions = append(positions, position)
		}
	}
	// The current keyframe grid supports both 5s and 10s. Do not mix it with
	// the older start_frame/end_frame shape, which rejects 10s generation.
	if len(frames) > 0 {
		video["keyframes"], video["keyframe_indexes"] = frames, positions
	}
	return p, nil
}
