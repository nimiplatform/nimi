package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const AdapterXAIImage = capabilitydriver.CloudMediaAdapterXAIImage
const AdapterXAIVideo = capabilitydriver.CloudMediaAdapterXAIVideo
const xaiImageQueryPath = "/v1/images/{task_id}"
const xaiVideoQueryPath = "/v1/videos/{task_id}"
const xaiMediaRequestBytes = 96 << 20

func xaiMediaBackend(ctx context.Context, cfg MediaAdapterConfig) (*Backend, error) {
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, err
	}
	base := strings.TrimSuffix(strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"), "/v1")
	if base == "" {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	transport, err := securedProviderTransport(ctx, base, cfg.AllowLoopbackEndpoint)
	if err != nil {
		return nil, err
	}
	backend := newBackend("cloud-xai", base, key, cfg.Headers, 5*time.Minute, transport, true, cfg.AllowLoopbackEndpoint)
	if backend == nil {
		transport.CloseIdleConnections()
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend.client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return backend, nil
}
func validXAITaskID(id string) bool {
	if len(id) == 0 || len(id) > 128 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func xaiMediaInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// Both native image and video work publish one original task to the existing
// Job owner. No adapter poll loop or implicit resubmission is introduced.
func startXAIMedia(ctx context.Context, cfg MediaAdapterConfig, model, adapter, path, query, mime string, payload map[string]any) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	backend, err := xaiMediaBackend(ctx, cfg)
	if err != nil {
		return nil, nil, "", err
	}
	defer backend.client.CloseIdleConnections()
	encoded, err := marshalJSONRequestBody(payload)
	if err != nil || len(encoded) > xaiMediaRequestBytes {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	var response struct {
		RequestID string `json:"request_id"`
	}
	ctx = nativeCreateRequest(ctx)
	request, err := backend.newRequest(ctx, http.MethodPost, backend.baseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return nil, nil, "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	reply, err := backend.do(request)
	if err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, MapProviderRequestError(err))
	}
	defer func(cleanup func() error) { _ = cleanup() }(reply.Body.Close)
	if err := DecodeResponseJSON(reply, &response); err != nil {
		if reply.StatusCode >= 200 && reply.StatusCode < 300 {
			err = markNativeCreateResponseUnavailable(ctx, err)
		}
		return nil, nil, "", err
	}
	if !validXAITaskID(response.RequestID) {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, xaiMediaInvalid())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: adapter, Model: model, TaskID: response.RequestID, QueryPathTemplate: query, Artifact: BinaryArtifact(mime, nil, map[string]any{"adapter": adapter})})
	return nil, nil, response.RequestID, err
}
func ExecuteXAIImage(ctx context.Context, cfg MediaAdapterConfig, request *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	s := request.GetSpec().GetImageGenerate()
	if s == nil || !capabilitydriver.IsXAIImageModel(model) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	// Canonical image output is fully owned before success. Native deferred URLs
	// avoid buffering a ten-image base64 envelope and never escape to the App.
	payload := map[string]any{"model": model, "prompt": s.GetPrompt(), "n": s.GetN(), "deferred": true, "response_format": "url"}
	if s.GetSize() != "" {
		payload["resolution"] = s.GetSize()
	}
	if s.GetQuality() != "" {
		payload["quality"] = s.GetQuality()
	}
	if s.GetAspectRatio() != "" {
		payload["aspect_ratio"] = s.GetAspectRatio()
	}
	inputs := []map[string]any{}
	if s.GetReferenceImageArtifactId() != "" {
		ref, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if ref == nil || ref.ArtifactID != s.GetReferenceImageArtifactId() {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		inputs = append(inputs, map[string]any{"url": "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)})
	}
	for _, location := range s.GetReferenceImages() {
		inputs = append(inputs, map[string]any{"url": location})
	}
	path := "/v1/images/generations"
	if len(inputs) > 0 {
		path = "/v1/images/edits"
		if len(inputs) == 1 {
			payload["image"] = inputs[0]
		} else {
			payload["images"] = inputs
		}
	}
	return startXAIMedia(ctx, cfg, model, AdapterXAIImage, path, xaiImageQueryPath, "image/jpeg", payload)
}
func ExecuteXAIVideo(ctx context.Context, cfg MediaAdapterConfig, request *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	s := request.GetSpec().GetVideoGenerate()
	if s == nil || !capabilitydriver.IsXAIVideoModel(model) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	payload, err := buildXAIVideoPayload(ctx, model, s)
	if err != nil {
		return nil, nil, "", err
	}
	return startXAIMedia(ctx, cfg, model, AdapterXAIVideo, "/v1/videos/generations", xaiVideoQueryPath, "video/mp4", payload)
}
func buildXAIVideoPayload(ctx context.Context, model string, s *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	options := s.GetOptions()
	payload := map[string]any{"model": model, "prompt": capabilitydriver.VideoPrompt(s), "duration": options.GetDurationSec(), "resolution": options.GetResolution(), "generate_audio": options.GetGenerateAudio()}
	if capabilitydriver.VideoPrompt(s) == "" {
		delete(payload, "prompt")
	}
	if options.GetRatio() != "" {
		payload["aspect_ratio"] = options.GetRatio()
	}
	captured, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	byIndex := map[int]CapturedMediaReference{}
	for _, item := range captured {
		byIndex[item.ContentIndex] = item.Reference
	}
	references := []map[string]any{}
	for index, item := range s.GetContent() {
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		location := item.GetImageUrl().GetUrl()
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			ref, ok := byIndex[index]
			if !ok || ref.ArtifactID != item.GetArtifactRef().GetArtifactId() {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
			location = "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)
		}
		value := map[string]any{"url": location}
		switch item.GetRole() {
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
			payload["image"] = value
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
			payload["last_frame"] = value
		case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
			references = append(references, value)
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	if len(references) > 0 {
		payload["reference_images"] = references
	}
	return payload, nil
}

type xaiMediaUsage struct {
	Input  *int64 `json:"input_tokens"`
	Output *int64 `json:"output_tokens"`
	Cost   *int64 `json:"cost_in_usd_ticks"`
}

func (u *xaiMediaUsage) normalize() (*runtimev1.UsageStats, error) {
	if u == nil {
		return nil, nil
	}
	if u.Input != nil && *u.Input < 0 || u.Output != nil && *u.Output < 0 || u.Cost != nil && *u.Cost < 0 {
		return nil, xaiMediaInvalid()
	}
	if u.Input == nil || u.Output == nil {
		return nil, nil
	}
	return &runtimev1.UsageStats{InputTokens: *u.Input, OutputTokens: *u.Output}, nil
}
func (u *xaiMediaUsage) metadata(adapter string) map[string]any {
	out := map[string]any{"adapter": adapter}
	if u != nil && u.Cost != nil {
		out["provider_cost_in_usd_ticks"] = strconv.FormatInt(*u.Cost, 10)
	}
	return out
}

type xaiTaskError struct {
	Code string `json:"code"`
}

func xaiFailedTask(code string) error {
	reason, grpcCode := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, codes.Internal
	if code == "invalid_argument" {
		reason, grpcCode = runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument
	}
	if code == "service_unavailable" {
		reason, grpcCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable
	}
	// permission_denied is an engine task failure, not evidence of a bad API key.
	return grpcerr.WithReasonCodeOptions(grpcCode, reason, grpcerr.ReasonOptions{Message: "xAI generation task failed"})
}
func observeXAIMedia(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	backend, err := xaiMediaBackend(ctx, cfg)
	if err != nil {
		return nil, false, err
	}
	defer backend.client.CloseIdleConnections()
	var response struct {
		RequestID string         `json:"request_id"`
		Status    string         `json:"status"`
		Model     string         `json:"model"`
		Error     *xaiTaskError  `json:"error"`
		Usage     *xaiMediaUsage `json:"usage"`
		Data      []struct {
			URL  string `json:"url"`
			MIME string `json:"mime_type"`
		} `json:"data"`
		Video *struct {
			URL        string `json:"url"`
			Duration   *int32 `json:"duration"`
			Moderation *bool  `json:"respect_moderation"`
		} `json:"video"`
	}
	if err := backend.getJSON(ctx, ResolveTaskQueryPath(r.QueryPathTemplate, r.TaskID), &response); err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, true, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED)
		}
		return nil, false, err
	}
	if r.Adapter == AdapterXAIImage && response.RequestID != r.TaskID || response.Model != "" && response.Model != r.Model {
		return nil, false, xaiMediaInvalid()
	}
	switch response.Status {
	case "pending":
		if response.Error != nil {
			return nil, false, xaiMediaInvalid()
		}
		return nil, false, nil
	case "failed":
		if response.Error == nil {
			return nil, false, xaiMediaInvalid()
		}
		return nil, true, xaiFailedTask(response.Error.Code)
	case "done":
		if response.Error != nil {
			return nil, false, xaiMediaInvalid()
		}
	default:
		return nil, false, xaiMediaInvalid()
	}
	usage, err := response.Usage.normalize()
	if err != nil {
		return nil, false, err
	}
	observed := &NativeTaskObservation{Usage: usage}
	if r.Adapter == AdapterXAIImage {
		if len(response.Data) < 1 || len(response.Data) > 10 {
			return nil, false, xaiMediaInvalid()
		}
		for i, item := range response.Data {
			if !validNativeVideoArtifactURL(item.URL) {
				return nil, false, xaiMediaInvalid()
			}
			artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
			if i > 0 {
				artifact.ArtifactId = fmt.Sprintf("%s-%d", artifact.ArtifactId, i)
			}
			if item.MIME != "" {
				switch item.MIME {
				case "image/jpeg", "image/png", "image/webp":
					artifact.MimeType = item.MIME
				default:
					return nil, false, xaiMediaInvalid()
				}
			}
			artifact.Uri, artifact.Sha256, artifact.SizeBytes = item.URL, "", 0
			artifact.Metadata = ToStruct(response.Usage.metadata(r.Adapter))
			observed.Artifacts = append(observed.Artifacts, artifact)
		}
	} else {
		video := response.Video
		if video == nil || video.Moderation == nil || video.Duration == nil || *video.Duration < 1 || *video.Duration > 15 || !validNativeVideoArtifactURL(video.URL) {
			return nil, false, xaiMediaInvalid()
		}
		if !*video.Moderation {
			return nil, true, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
		}
		artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
		artifact.Uri, artifact.Sha256, artifact.SizeBytes = video.URL, "", 0
		artifact.DurationMs = int64(*video.Duration) * 1000
		artifact.Metadata = ToStruct(response.Usage.metadata(r.Adapter))
		observed.Artifacts = []*runtimev1.ScenarioArtifact{artifact}
	}
	return observed, true, nil
}

// Image responses may contain ten separate hosted files. Validate each raster
// header during the existing streamed custody acquisition, retaining the prefix
// for the same body reader; no extra download or whole-batch buffering.
func openXAIImageArtifacts(ctx context.Context, artifacts []*runtimev1.ScenarioArtifact) (map[string]*MediaArtifactBody, error) {
	return detachMediaArtifactBodiesWithOpener(ctx, artifacts, func(ctx context.Context, uri string) (io.ReadCloser, string, int64, error) {
		limits := defaultMediaBodyLimits()
		limits.bytes = 128 << 20
		stream, _, size, err := openBinaryArtifactStreamWithLimits(ctx, uri, limits)
		if err != nil {
			return nil, "", -1, err
		}
		var prefix bytes.Buffer
		geometry, format, err := image.DecodeConfig(io.TeeReader(io.LimitReader(stream, 32<<20), &prefix))
		if err != nil || (format != "jpeg" && format != "png" && format != "webp") || geometry.Width <= 0 || geometry.Height <= 0 || int64(geometry.Width)*int64(geometry.Height) > 16<<20 {
			_ = stream.Close()
			return nil, "", -1, xaiMediaInvalid()
		}
		mime := "image/" + format
		for _, artifact := range artifacts {
			if artifact.GetUri() == uri {
				artifact.MimeType = mime
				artifact.Width = int32(geometry.Width)
				artifact.Height = int32(geometry.Height)
			}
		}
		return &peekedMediaArtifactStream{Reader: bufio.NewReader(io.MultiReader(bytes.NewReader(prefix.Bytes()), stream)), Closer: stream}, mime, size, nil
	})
}
