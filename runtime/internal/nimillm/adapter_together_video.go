package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const AdapterTogetherVideo = capabilitydriver.CloudMediaAdapterTogetherVideo
const togetherVideoQueryPath = "/v2/videos/{task_id}"

func validTogetherVideoID(id string) bool {
	return id != "" && len(id) <= 128 && strings.IndexFunc(id, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_')
	}) < 0
}
func ExecuteTogetherVideo(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	b, err := nativeMediaBackend(ctx, cfg, "together")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetVideoGenerate()
	o := s.GetOptions()
	body := map[string]any{"model": model, "prompt": capabilitydriver.VideoPrompt(s), "seconds": strconv.Itoa(int(o.GetDurationSec())), "resolution": strings.ToUpper(o.GetResolution()), "ratio": o.GetRatio(), "fps": 30, "generate_audio": true, "output_format": "MP4"}
	if s.GetNegativePrompt() != "" {
		body["negative_prompt"] = s.GetNegativePrompt()
	}
	if o.Seed != nil {
		body["seed"] = o.GetSeed()
	}
	refs, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	byIndex := map[int]CapturedMediaReference{}
	for _, r := range refs {
		byIndex[r.ContentIndex] = r.Reference
	}
	frames := []any{}
	for i, item := range s.GetContent() {
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		ref, ok := byIndex[i]
		if !ok || ref.ArtifactID != item.GetArtifactRef().GetArtifactId() {
			return nil, nil, "", togetherOutputError()
		}
		frame := "first"
		if item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME {
			frame = "last"
		}
		frames = append(frames, map[string]any{"input_image": base64.StdEncoding.EncodeToString(ref.Bytes), "frame": frame})
	}
	if len(frames) > 0 {
		body["media"] = map[string]any{"frame_images": frames}
	}
	ctx = nativeCreateRequest(ctx)
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v2/videos", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var out struct {
		ID     string `json:"id"`
		Model  string `json:"model"`
		Status string `json:"status"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, err)
	}
	if !validTogetherVideoID(out.ID) || out.Model != model || out.Status != "in_progress" && out.Status != "completed" && out.Status != "failed" {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, togetherOutputError())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterTogetherVideo, Model: model, TaskID: out.ID, QueryPathTemplate: togetherVideoQueryPath, Artifact: BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterTogetherVideo})})
	return nil, nil, out.ID, err
}
func observeTogetherVideo(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	b, err := nativeMediaBackend(ctx, cfg, "together")
	if err != nil {
		return nil, false, err
	}
	defer b.client.CloseIdleConnections()
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, ResolveTaskQueryPath(togetherVideoQueryPath, r.TaskID), nil)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	var out struct {
		ID      string `json:"id"`
		Model   string `json:"model"`
		Status  string `json:"status"`
		Outputs *struct {
			URL string `json:"video_url"`
		} `json:"outputs"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, false, err
	}
	if out.ID != r.TaskID || out.Model != r.Model {
		return nil, false, togetherOutputError()
	}
	switch out.Status {
	case "in_progress":
		return nil, false, nil
	case "failed":
		return nil, true, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	case "completed":
	default:
		return nil, false, togetherOutputError()
	}
	if out.Outputs == nil || out.Outputs.URL == "" {
		return nil, false, togetherOutputError()
	}
	a := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	a.Uri = out.Outputs.URL
	// The shared artifact receiver validates and streams the returned URL without
	// the provider credential. There is no provider cancellation API on this path.
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{a}}, true, nil
}
