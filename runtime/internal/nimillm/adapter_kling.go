package nimillm

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const AdapterKlingTask = "kling_task_adapter"
const klingVideoQueryPath = "/tasks?task_ids={task_id}"
const klingImageQueryPath = "/v1/images/generations/{task_id}"
const klingOmniImageQueryPath = "/v1/images/omni-image/{task_id}"

func validKlingTaskID(id string) bool {
	return id != "" && len(id) <= 128 && strings.IndexFunc(id, func(r rune) bool {
		return !(r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '-' || r == '_')
	}) < 0
}
func klingOutputInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func klingServiceError(code *int) error {
	if code == nil {
		return klingOutputInvalid()
	}
	if *code == 0 {
		return nil
	}
	status := http.StatusServiceUnavailable
	switch {
	case *code >= 1000 && *code <= 1004:
		status = http.StatusUnauthorized
	case *code == 1103:
		status = http.StatusForbidden
	case *code == 1100 || *code == 1302 || *code == 1303:
		status = http.StatusTooManyRequests
	case *code == 1101 || *code == 1102:
		status = http.StatusPaymentRequired
	case *code >= 1200 && *code <= 1203:
		status = http.StatusBadRequest
	case *code == 1300 || *code == 1301:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	return MapProviderHTTPError(status, map[string]any{"code": *code})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func ExecuteKlingTask(ctx context.Context, cfg MediaAdapterConfig, _ JobStateUpdater, _ string, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "kling")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	var body map[string]any
	path, query, mime := "", klingVideoQueryPath, "video/mp4"
	if capabilitydriver.IsKlingVideoModel(model) {
		s := req.GetSpec().GetVideoGenerate()
		o := s.GetOptions()
		settings := map[string]any{"resolution": o.GetResolution(), "duration": o.GetDurationSec()}
		body = map[string]any{"settings": settings}
		path = "/text-to-video/" + model
		if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_T2V {
			body["prompt"] = capabilitydriver.VideoPrompt(s)
			settings["aspect_ratio"] = o.GetRatio()
		} else {
			path = "/image-to-video/" + model
			parts := []any{map[string]any{"type": "prompt", "text": capabilitydriver.VideoPrompt(s)}}
			refs, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
			byIndex := map[int]CapturedMediaReference{}
			for _, r := range refs {
				byIndex[r.ContentIndex] = r.Reference
			}
			// Native keyframes are ordered by role, independently of App input order.
			for _, role := range []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME} {
				for i, item := range s.GetContent() {
					if item.GetRole() != role {
						continue
					}
					location := item.GetImageUrl().GetUrl()
					if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
						ref, ok := byIndex[i]
						if !ok || ref.ArtifactID != item.GetArtifactRef().GetArtifactId() {
							return nil, nil, "", klingOutputInvalid()
						}
						location = base64.StdEncoding.EncodeToString(ref.Bytes)
					}
					name := "first_frame"
					if role == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME {
						name = "last_frame"
					}
					parts = append(parts, map[string]any{"type": name, "url": location, "id": name})
				}
			}
			body["contents"] = parts
		}
	} else if capabilitydriver.IsKlingImageModel(model) {
		s := req.GetSpec().GetImageGenerate()
		path = "/v1/images/generations"
		query = klingImageQueryPath
		mime = "image/png"
		body = map[string]any{"model_name": model, "prompt": s.GetPrompt(), "n": s.GetN(), "resolution": s.GetSize(), "aspect_ratio": s.GetAspectRatio()}
		if s.GetNegativePrompt() != "" {
			body["negative_prompt"] = s.GetNegativePrompt()
		}
		inputs := append([]string(nil), s.GetReferenceImages()...)
		if s.GetReferenceImageArtifactId() != "" {
			ref, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
			if ref == nil || ref.ArtifactID != s.GetReferenceImageArtifactId() {
				return nil, nil, "", klingOutputInvalid()
			}
			inputs = append(inputs, base64.StdEncoding.EncodeToString(ref.Bytes))
		}
		if model == "kling-v3-omni" {
			path = "/v1/images/omni-image"
			query = klingOmniImageQueryPath
			body["result_type"] = "single"
			if len(inputs) > 0 {
				list := []any{}
				for _, v := range inputs {
					list = append(list, map[string]any{"image": v})
				}
				body["image_list"] = list
			}
		} else if len(inputs) > 0 {
			body["image"] = inputs[0]
		}
	} else {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	ctx = nativeCreateRequest(ctx)
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, path, body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var out struct {
		Code *int `json:"code"`
		Data struct {
			ID         string `json:"id"`
			Status     string `json:"status"`
			TaskID     string `json:"task_id"`
			TaskStatus string `json:"task_status"`
		} `json:"data"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, err)
	}
	if out.Code == nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, klingOutputInvalid())
	}
	if err := klingServiceError(out.Code); err != nil {
		return nil, nil, "", err
	}
	id, state := out.Data.ID, out.Data.Status
	success := "succeeded"
	if capabilitydriver.IsKlingImageModel(model) {
		id, state = out.Data.TaskID, out.Data.TaskStatus
		success = "succeed"
	}
	if !validKlingTaskID(id) || state != "submitted" && state != "processing" && state != success && state != "failed" {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, klingOutputInvalid())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterKlingTask, Model: model, TaskID: id, QueryPathTemplate: query, Artifact: BinaryArtifact(mime, nil, map[string]any{"adapter": AdapterKlingTask})})
	return nil, nil, id, err
}

func observeKlingTask(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	b, err := nativeMediaBackend(ctx, cfg, "kling")
	if err != nil {
		return nil, false, err
	}
	defer b.client.CloseIdleConnections()
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, ResolveTaskQueryPath(r.QueryPathTemplate, r.TaskID), nil)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	var urls []string
	if capabilitydriver.IsKlingVideoModel(r.Model) {
		var out struct {
			Code *int `json:"code"`
			Data []struct {
				ID      string `json:"id"`
				Status  string `json:"status"`
				Outputs []struct {
					Type string `json:"type"`
					URL  string `json:"url"`
				} `json:"outputs"`
			} `json:"data"`
		}
		if err := DecodeResponseJSON(response, &out); err != nil {
			return nil, false, err
		}
		if err := klingServiceError(out.Code); err != nil {
			return nil, false, err
		}
		if len(out.Data) != 1 || out.Data[0].ID != r.TaskID {
			return nil, false, klingOutputInvalid()
		}
		item := out.Data[0]
		switch item.Status {
		case "submitted", "processing":
			return nil, false, nil
		case "failed":
			return nil, true, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		case "succeeded":
		default:
			return nil, false, klingOutputInvalid()
		}
		if len(item.Outputs) != 1 || item.Outputs[0].Type != "video" {
			return nil, false, klingOutputInvalid()
		}
		urls = []string{item.Outputs[0].URL}
	} else {
		var out struct {
			Code *int `json:"code"`
			Data struct {
				ID     string `json:"task_id"`
				Status string `json:"task_status"`
				Result struct {
					Images []struct {
						URL string `json:"url"`
					} `json:"images"`
				} `json:"task_result"`
			} `json:"data"`
		}
		if err := DecodeResponseJSON(response, &out); err != nil {
			return nil, false, err
		}
		if err := klingServiceError(out.Code); err != nil {
			return nil, false, err
		}
		if out.Data.ID != r.TaskID {
			return nil, false, klingOutputInvalid()
		}
		switch out.Data.Status {
		case "submitted", "processing":
			return nil, false, nil
		case "failed":
			return nil, true, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		case "succeed":
		default:
			return nil, false, klingOutputInvalid()
		}
		if len(out.Data.Result.Images) < 1 || len(out.Data.Result.Images) > 9 {
			return nil, false, klingOutputInvalid()
		}
		for _, item := range out.Data.Result.Images {
			urls = append(urls, item.URL)
		}
	}
	observed := &NativeTaskObservation{}
	for i, uri := range urls {
		if !validNativeVideoArtifactURL(uri) {
			return nil, false, klingOutputInvalid()
		}
		a := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
		if i > 0 {
			a.ArtifactId = fmt.Sprintf("%s-%d", a.ArtifactId, i)
		}
		a.Uri = uri
		observed.Artifacts = append(observed.Artifacts, a)
	}
	// The existing receiver validates image count and owns complete bytes and
	// measured facts. Billing duration is not the measured artifact duration.
	return observed, true, nil
}
