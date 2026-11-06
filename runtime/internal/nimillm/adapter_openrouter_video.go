package nimillm

import (
	"bufio"
	"context"
	"encoding/base64"
	"io"
	"mime"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func ExecuteOpenRouterVideo(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	b, err := nativeMediaBackend(ctx, cfg, "openrouter")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetVideoGenerate()
	o := s.GetOptions()
	body := map[string]any{"model": model, "prompt": capabilitydriver.VideoPrompt(s), "duration": o.GetDurationSec(), "resolution": o.GetResolution(), "aspect_ratio": o.GetRatio(), "generate_audio": true}
	if o.GetResolution() == "4k" {
		body["resolution"] = "4K"
	}
	refs, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	byIndex := map[int]CapturedMediaReference{}
	for _, ref := range refs {
		byIndex[ref.ContentIndex] = ref.Reference
	}
	frames := []any{}
	for i, c := range s.GetContent() {
		if c.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		ref, ok := byIndex[i]
		if !ok || ref.ArtifactID != c.GetArtifactRef().GetArtifactId() {
			return nil, nil, "", openRouterOutputError()
		}
		frame := "first_frame"
		if c.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME {
			frame = "last_frame"
		}
		frames = append(frames, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)}, "frame_type": frame})
	}
	if len(frames) > 0 {
		body["frame_images"] = frames
	}
	ctx = nativeCreateRequest(ctx)
	resp, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/videos", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer resp.Body.Close()
	var out struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := DecodeResponseJSON(resp, &out); err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, err)
	}
	if !validOpenRouterTaskID(out.ID) || out.Status != "pending" && out.Status != "in_progress" && out.Status != "completed" {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, openRouterOutputError())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterOpenRouterVideo, Model: model, TaskID: out.ID, QueryPathTemplate: openRouterVideoQueryPath, Artifact: BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterOpenRouterVideo})})
	return nil, nil, out.ID, err
}
func validOpenRouterTaskID(id string) bool {
	return id != "" && len(id) <= 128 && strings.IndexFunc(id, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_')
	}) < 0
}
func observeOpenRouterVideo(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	b, err := nativeMediaBackend(ctx, cfg, "openrouter")
	if err != nil {
		return nil, false, err
	}
	defer b.client.CloseIdleConnections()
	resp, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, ResolveTaskQueryPath(openRouterVideoQueryPath, r.TaskID), nil)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	var out struct {
		ID     string   `json:"id"`
		Status string   `json:"status"`
		URLs   []string `json:"unsigned_urls"`
		Usage  *struct {
			Cost *float64 `json:"cost"`
		} `json:"usage"`
	}
	if err := DecodeResponseJSON(resp, &out); err != nil {
		return nil, false, err
	}
	if out.ID != r.TaskID {
		return nil, false, openRouterOutputError()
	}
	switch out.Status {
	case "pending", "in_progress":
		return nil, false, nil
	case "cancelled":
		return nil, true, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED)
	case "failed":
		return nil, true, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	case "completed":
	default:
		return nil, false, openRouterOutputError()
	}
	if len(out.URLs) != 1 {
		return nil, false, openRouterOutputError()
	}
	a := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	// The original task id selects the authenticated content operation. A
	// provider-returned URL can never choose where credentials are forwarded.
	a.Uri = b.baseURL + "/v1/videos/" + r.TaskID + "/content?index=0"
	meta := map[string]any{"adapter": AdapterOpenRouterVideo}
	if out.Usage != nil && out.Usage.Cost != nil {
		if *out.Usage.Cost < 0 {
			return nil, false, openRouterOutputError()
		}
		meta["provider_cost_usd"] = *out.Usage.Cost
	}
	a.Metadata = ToStruct(meta)
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{a}}, true, nil
}
func openOpenRouterVideo(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt, uri string) (io.ReadCloser, string, int64, error) {
	b, err := nativeMediaBackend(ctx, cfg, "openrouter")
	if err != nil {
		return nil, "", 0, err
	}
	defer b.client.CloseIdleConnections()
	path := "/v1/videos/" + r.TaskID + "/content?index=0"
	if uri != b.baseURL+path {
		return nil, "", 0, openRouterOutputError()
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, path, nil)
	if err != nil {
		return nil, "", 0, err
	}
	mediaType, _, parseErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if parseErr != nil || mediaType != "video/mp4" || response.ContentLength == 0 || response.ContentLength > maxStreamedMediaArtifactBytes {
		response.Body.Close()
		return nil, "", 0, openRouterOutputError()
	}
	buffered := bufio.NewReaderSize(response.Body, 512)
	head, err := buffered.Peek(12)
	if err != nil || string(head[4:8]) != "ftyp" {
		response.Body.Close()
		return nil, "", 0, openRouterOutputError()
	}
	return &boundedMediaArtifactStream{ReadCloser: &peekedMediaArtifactStream{Reader: buffered, Closer: response.Body}, remaining: maxStreamedMediaArtifactBytes + 1}, "video/mp4", response.ContentLength, nil
}
