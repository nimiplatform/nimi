package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const AdapterPikaTask = "pika_task_adapter"
const pikaQueryPath = "/v1/media/jobs/{task_id}"

type pikaJob struct {
	ID        string   `json:"id"`
	Status    string   `json:"status"`
	DeletedAt *float64 `json:"deleted_at"`
	Output    *struct {
		MediaType string `json:"media_type"`
		Video     *struct {
			URL string `json:"url"`
		} `json:"video"`
	} `json:"output"`
	Error *struct {
		Code string `json:"code"`
	} `json:"error"`
	Usage *struct {
		Input         *int64   `json:"input_tokens"`
		Output        *int64   `json:"output_tokens"`
		VideoOutput   *int64   `json:"video_output_tokens"`
		OutputSeconds *float64 `json:"output_seconds"`
	} `json:"usage"`
	Billing *struct {
		State  string `json:"state"`
		Charge *int64 `json:"charge_micro_usd"`
	} `json:"billing"`
}

func validPikaTaskID(id string) bool {
	return id != "" && len(id) <= 128 && strings.IndexFunc(id, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_')
	}) < 0
}
func pikaOutputInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func pikaJobStatus(status string) bool {
	switch status {
	case "queued", "running", "completed", "failed", "cancelled":
		return true
	default:
		return false
	}
}
func pikaFailure(out pikaJob) error {
	if out.Error != nil {
		switch out.Error.Code {
		case "content_moderation":
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
		case "invalid_input":
			return MapProviderHTTPError(http.StatusBadRequest, nil)
		case "insufficient_balance", "membership_required", "cycle_limit_exceeded":
			return MapProviderHTTPError(http.StatusPaymentRequired, nil)
		case "rate_limited":
			return MapProviderHTTPError(http.StatusTooManyRequests, nil)
		}
	}
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

func ExecutePikaTask(ctx context.Context, cfg MediaAdapterConfig, _ JobStateUpdater, _ string, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "pika")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	if !capabilitydriver.IsPikaVideoModel(model) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	s := req.GetSpec().GetVideoGenerate()
	o := s.GetOptions()
	flex := strings.HasPrefix(model, "pika/pika-h3-flex/")
	body := map[string]any{"prompt": capabilitydriver.VideoPrompt(s), "resolution": o.GetResolution()}
	if flex {
		body["duration"] = o.GetDurationSec()
		body["rewrite"] = false
		body["output_mode"] = "video"
	} else {
		body["duration_s"] = o.GetDurationSec()
		if s.GetNegativePrompt() != "" {
			body["negative_prompt"] = s.GetNegativePrompt()
		}
	}
	if o.GetRatio() != "" {
		body["aspect_ratio"] = o.GetRatio()
	}
	if o.Seed != nil {
		body["seed"] = o.GetSeed()
	}
	refs := []any{}
	uploads, _ := ctx.Value(pikaPreparedInputsKey{}).([]PikaInputUpload)
	byIndex := map[int]PikaInputUpload{}
	for _, upload := range uploads {
		byIndex[upload.ContentIndex] = upload
	}
	for index, item := range s.GetContent() {
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		location := item.GetImageUrl().GetUrl()
		kind := "image"
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL {
			location = item.GetVideoUrl().GetUrl()
			kind = "video"
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL {
			location = item.GetAudioUrl().GetUrl()
			kind = "audio"
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			upload, ok := byIndex[index]
			if !ok || !upload.PutComplete {
				return nil, nil, "", pikaCapturedInputError()
			}
			location = upload.URL
			switch item.GetRole() {
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO:
				kind = "video"
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO:
				kind = "audio"
			}
		}
		switch item.GetRole() {
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
			body["image"] = location
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
			body["last_frame_image"] = location
		default:
			refs = append(refs, map[string]any{"type": kind, "url": location})
		}
	}
	if len(refs) > 0 {
		body["references"] = refs
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, nil, "", err
	}
	ctx = nativeCreateRequest(ctx)
	response, err := sendNativeMediaRequest(ctx, b, http.MethodPost, "/v1/media/"+model, "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	data, err = readLimitedResponseBody(response.Body, 1<<20)
	if err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, err)
	}
	var out pikaJob
	decodeErr := json.Unmarshal(data, &out)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Rejected admission may still have a durable failed job, including the
		// quota and rate-limit responses. Preserve it rather than resubmitting.
		if decodeErr != nil || !validPikaTaskID(out.ID) || out.Status != "failed" || (response.StatusCode != http.StatusForbidden && response.StatusCode != http.StatusTooManyRequests) {
			return nil, nil, "", MapProviderHTTPError(response.StatusCode, nil)
		}
	} else if decodeErr != nil || !validPikaTaskID(out.ID) || !pikaJobStatus(out.Status) {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, pikaOutputInvalid())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterPikaTask, Model: model, TaskID: out.ID, QueryPathTemplate: pikaQueryPath, Artifact: BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterPikaTask})})
	return nil, nil, out.ID, err
}

func observePikaTask(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	b, err := nativeMediaBackend(ctx, cfg, "pika")
	if err != nil {
		return nil, false, err
	}
	defer b.client.CloseIdleConnections()
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, ResolveTaskQueryPath(pikaQueryPath, r.TaskID), nil)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	var out pikaJob
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, false, err
	}
	if out.ID != r.TaskID || !pikaJobStatus(out.Status) {
		return nil, false, pikaOutputInvalid()
	}
	switch out.Status {
	case "queued", "running":
		return nil, false, nil
	case "failed":
		return nil, true, pikaFailure(out)
	case "cancelled":
		return nil, true, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED)
	}
	if out.DeletedAt != nil || out.Output == nil || out.Output.MediaType != "video" || out.Output.Video == nil || !validNativeVideoArtifactURL(out.Output.Video.URL) {
		return nil, false, pikaOutputInvalid()
	}
	a := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	a.Uri = out.Output.Video.URL
	meta := map[string]any{"adapter": AdapterPikaTask}
	var usage *runtimev1.UsageStats
	if u := out.Usage; u != nil {
		if u.Input != nil && *u.Input < 0 || u.Output != nil && *u.Output < 0 || u.VideoOutput != nil && *u.VideoOutput < 0 || u.OutputSeconds != nil && (*u.OutputSeconds < 0 || math.IsNaN(*u.OutputSeconds) || math.IsInf(*u.OutputSeconds, 0)) {
			return nil, false, pikaOutputInvalid()
		}
		if u.Input != nil && u.Output != nil {
			usage = &runtimev1.UsageStats{InputTokens: *u.Input, OutputTokens: *u.Output}
		}
		if u.VideoOutput != nil {
			meta["provider_video_output_tokens"] = strconv.FormatInt(*u.VideoOutput, 10)
		}
		if u.OutputSeconds != nil {
			meta["provider_output_seconds"] = *u.OutputSeconds
		}
	}
	if billing := out.Billing; billing != nil {
		switch billing.State {
		case "settled":
			if billing.Charge == nil || *billing.Charge < 0 {
				return nil, false, pikaOutputInvalid()
			}
			meta["provider_charge_micro_usd"] = strconv.FormatInt(*billing.Charge, 10)
		case "pending", "unavailable":
		default:
			return nil, false, pikaOutputInvalid()
		}
		meta["provider_billing_state"] = billing.State
	}
	a.Metadata = ToStruct(meta)
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{a}, Usage: usage}, true, nil
}

// Acknowledged intent and confirmed cancellation remain different outcomes.
func cancelPikaTask(ctx context.Context, id string, cfg MediaAdapterConfig) (ProviderTaskCleanupOutcome, error) {
	if !validPikaTaskID(id) {
		return ProviderTaskCleanupFailed, pikaOutputInvalid()
	}
	b, err := nativeMediaBackend(ctx, cfg, "pika")
	if err != nil {
		return ProviderTaskCleanupFailed, err
	}
	defer b.client.CloseIdleConnections()
	response, err := sendNativeMediaRequest(ctx, b, http.MethodPost, ResolveTaskQueryPath(pikaQueryPath, id)+"/cancel", "application/json", nil)
	if err != nil {
		return ProviderTaskCleanupUnconfirmed, err
	}
	defer response.Body.Close()
	var out struct {
		pikaJob
		CancellationStatus string `json:"cancellation_status"`
		Code               string `json:"code"`
	}
	data, err := readLimitedResponseBody(response.Body, 1<<20)
	if err != nil {
		return ProviderTaskCleanupUnconfirmed, err
	}
	decodeErr := json.Unmarshal(data, &out)
	if response.StatusCode == http.StatusConflict {
		return ProviderTaskCleanupNotCancelable, nil
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted {
		return ProviderTaskCleanupFailed, MapProviderHTTPError(response.StatusCode, nil)
	}
	if decodeErr != nil || out.ID != id || !pikaJobStatus(out.Status) {
		return ProviderTaskCleanupUnconfirmed, pikaOutputInvalid()
	}
	if response.StatusCode == http.StatusOK && out.Status == "cancelled" && out.CancellationStatus == "cancelled" {
		return ProviderTaskCleanupCanceled, nil
	}
	return ProviderTaskCleanupUnconfirmed, nil
}
