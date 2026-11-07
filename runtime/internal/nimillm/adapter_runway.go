package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const AdapterRunwayTask = "runway_task_adapter"
const runwayAPIVersion = "2024-11-06"
const runwayQueryPath = "/v1/tasks/{task_id}"

var runwayTaskIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func runwayInvalidOutput() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func runwayRequestHeaders(extra map[string]string) map[string]string {
	headers := cloneMediaHeaders(extra)
	if headers == nil {
		headers = map[string]string{}
	}
	for name := range headers {
		if strings.EqualFold(name, "X-Runway-Version") {
			delete(headers, name)
		}
	}
	headers["X-Runway-Version"] = runwayAPIVersion
	return headers
}
func runwayBackend(ctx context.Context, cfg MediaAdapterConfig) (*Backend, error) {
	cfg.Headers = runwayRequestHeaders(cfg.Headers)
	return nativeMediaBackend(ctx, cfg, "runway")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r108
func ExecuteRunwayTask(ctx context.Context, cfg MediaAdapterConfig, _ JobStateUpdater, _ string, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := runwayBackend(ctx, cfg)
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	if !capabilitydriver.IsRunwayVideoModel(model) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	s := req.GetSpec().GetVideoGenerate()
	o := s.GetOptions()
	body := map[string]any{"model": model, "ratio": o.GetRatio()}
	if o.DurationSec != nil {
		body["duration"] = o.GetDurationSec()
	}
	if prompt := capabilitydriver.VideoPrompt(s); prompt != "" {
		body["promptText"] = prompt
	}
	if o.Seed != nil {
		body["seed"] = o.GetSeed()
	}
	if model == "gen4.5" {
		body["outputFormat"] = "mp4"
	}
	path := "/v1/text_to_video"
	if s.GetMode() == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME {
		path = "/v1/image_to_video"
		refs, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
		byIndex := map[int]CapturedMediaReference{}
		for _, r := range refs {
			byIndex[r.ContentIndex] = r.Reference
		}
		for i, item := range s.GetContent() {
			if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
				continue
			}
			uri := item.GetImageUrl().GetUrl()
			if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
				ref, ok := byIndex[i]
				if !ok || ref.ArtifactID != item.GetArtifactRef().GetArtifactId() {
					return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
				}
				uri = "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)
			}
			body["promptImage"] = []any{map[string]any{"uri": uri, "position": "first"}}
		}
	}
	ctx = nativeCreateRequest(ctx)
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, path, body)
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	var out struct {
		ID string `json:"id"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, err)
	}
	if !runwayTaskIDPattern.MatchString(out.ID) {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, runwayInvalidOutput())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterRunwayTask, Model: model, TaskID: out.ID, QueryPathTemplate: runwayQueryPath, Artifact: BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterRunwayTask})})
	return nil, nil, out.ID, err
}

func observeRunwayTask(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	b, err := runwayBackend(ctx, cfg)
	if err != nil {
		return nil, false, err
	}
	defer b.client.CloseIdleConnections()
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, ResolveTaskQueryPath(runwayQueryPath, r.TaskID), nil)
	if err != nil {
		return nil, false, err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	var out struct {
		ID          string   `json:"id"`
		Status      string   `json:"status"`
		Output      []string `json:"output"`
		FailureCode string   `json:"failureCode"`
		Cost        *struct {
			Credits *int64 `json:"credits"`
		} `json:"cost"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, false, err
	}
	if out.ID != r.TaskID {
		return nil, false, runwayInvalidOutput()
	}
	switch out.Status {
	case "PENDING", "THROTTLED", "RUNNING":
		return nil, false, nil
	case "CANCELLED":
		return nil, true, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED)
	case "FAILED":
		if strings.HasPrefix(out.FailureCode, "SAFETY.") || out.FailureCode == "INPUT_PREPROCESSING.SAFETY.TEXT" {
			return nil, true, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
		}
		if out.FailureCode == "ASSET.INVALID" {
			return nil, true, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		return nil, true, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	case "SUCCEEDED":
	default:
		return nil, false, runwayInvalidOutput()
	}
	if len(out.Output) != 1 || !validNativeVideoArtifactURL(out.Output[0]) || out.Cost == nil || out.Cost.Credits == nil || *out.Cost.Credits > 9007199254740991 || *out.Cost.Credits < -9007199254740991 {
		return nil, false, runwayInvalidOutput()
	}
	a := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	a.Uri = out.Output[0]
	a.Metadata = ToStruct(map[string]any{"adapter": AdapterRunwayTask, "provider_cost_credits": strconv.FormatInt(*out.Cost.Credits, 10)})
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{a}}, true, nil
}

// Runway explicitly says cancellation/deletion acknowledgment does not prove
// generation stopped or credits were refunded. A missing task is not proof.
func cancelRunwayTask(ctx context.Context, id string, cfg MediaAdapterConfig) (ProviderTaskCleanupOutcome, error) {
	if !runwayTaskIDPattern.MatchString(id) {
		return ProviderTaskCleanupFailed, runwayInvalidOutput()
	}
	b, err := runwayBackend(ctx, cfg)
	if err != nil {
		return ProviderTaskCleanupFailed, err
	}
	defer b.client.CloseIdleConnections()
	response, err := sendNativeMediaRequest(ctx, b, http.MethodDelete, ResolveTaskQueryPath(runwayQueryPath, id), "application/json", nil)
	if err != nil {
		return ProviderTaskCleanupUnconfirmed, err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	if response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusNotFound {
		return ProviderTaskCleanupUnconfirmed, nil
	}
	return ProviderTaskCleanupFailed, MapProviderHTTPError(response.StatusCode, nil)
}
