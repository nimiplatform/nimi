package nimillm

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// NativeTaskReceipt is the secret-free protocol data for one original task.
// It is Runtime-private and can never be projected as an App phase or handle.
type NativeTaskReceipt struct {
	Version             int                         `json:"version"`
	Adapter             string                      `json:"adapter"`
	TaskID              string                      `json:"task_id"`
	Model               string                      `json:"model,omitempty"`
	QueryPathTemplate   string                      `json:"query_path_template"`
	PollingURL          string                      `json:"polling_url,omitempty"`
	Artifact            *runtimev1.ScenarioArtifact `json:"artifact_template"`
	GeminiInteractionID string                      `json:"gemini_interaction_id,omitempty"`
	LumaGenerationType  string                      `json:"luma_generation_type,omitempty"`
	Usage               *runtimev1.UsageStats       `json:"usage,omitempty"`
}

// NativeTaskObservation is a private body-acquisition plan. Provider control
// payloads never become artifact metadata or public Job phases.
type NativeTaskObservation struct {
	Artifacts    []*runtimev1.ScenarioArtifact `json:"artifacts"`
	WorldPayload json.RawMessage               `json:"world_payload,omitempty"`
	Usage        *runtimev1.UsageStats         `json:"usage,omitempty"`
}

func (o *NativeTaskObservation) GetArtifacts() []*runtimev1.ScenarioArtifact {
	if o == nil {
		return nil
	}
	return o.Artifacts
}

func CloneNativeTaskObservation(o *NativeTaskObservation) *NativeTaskObservation {
	if o == nil {
		return nil
	}
	cloned := &NativeTaskObservation{WorldPayload: append(json.RawMessage(nil), o.WorldPayload...)}
	if o.Usage != nil {
		cloned.Usage = proto.Clone(o.Usage).(*runtimev1.UsageStats)
	}
	for _, artifact := range o.Artifacts {
		if artifact == nil {
			cloned.Artifacts = append(cloned.Artifacts, nil)
		} else {
			cloned.Artifacts = append(cloned.Artifacts, proto.Clone(artifact).(*runtimev1.ScenarioArtifact))
		}
	}
	return cloned
}

var ErrNativeTaskYielded = errors.New("native task receipt durably handed to Job owner")

type nativeTaskPublisherKey struct{}

// WithNativeTaskPublisher gives one submitted execution a durable receipt sink.
// A finite query does not receive a publisher and cannot create another task.
func WithNativeTaskPublisher(ctx context.Context, publish func(*NativeTaskReceipt) error) context.Context {
	return context.WithValue(ctx, nativeTaskPublisherKey{}, publish)
}

func publishNativeTask(ctx context.Context, r *NativeTaskReceipt) (bool, error) {
	publish, ok := ctx.Value(nativeTaskPublisherKey{}).(func(*NativeTaskReceipt) error)
	if !ok || publish == nil {
		return false, fmt.Errorf("native execution has no durable Job receipt owner")
	}
	if err := ValidateNativeTaskReceipt(r); err != nil {
		return true, err
	}
	if err := publish(r); err != nil {
		return true, err
	}
	return true, ErrNativeTaskYielded
}

func requireNativeTaskPublisher(ctx context.Context) error {
	if publish, ok := ctx.Value(nativeTaskPublisherKey{}).(func(*NativeTaskReceipt) error); !ok || publish == nil {
		return fmt.Errorf("native execution has no durable Job receipt owner")
	}
	return nil
}

func ValidateNativeTaskReceipt(r *NativeTaskReceipt) error {
	if r != nil && r.Adapter == AdapterRunwayTask && (!runwayTaskIDPattern.MatchString(r.TaskID) || !capabilitydriver.IsRunwayVideoModel(r.Model) || r.Artifact == nil || r.Artifact.GetMimeType() != "video/mp4") {
		return fmt.Errorf("invalid Runway original task identity")
	}
	if r != nil && r.Adapter == AdapterPikaTask && (!validPikaTaskID(r.TaskID) || !capabilitydriver.IsPikaVideoModel(r.Model) || r.Artifact == nil || r.Artifact.GetMimeType() != "video/mp4") {
		return fmt.Errorf("invalid Pika original task identity")
	}
	if r != nil && r.Adapter == AdapterKlingTask {
		query, mime := klingVideoQueryPath, "video/mp4"
		if capabilitydriver.IsKlingImageModel(r.Model) {
			query, mime = klingImageQueryPath, "image/png"
			if r.Model == "kling-v3-omni" {
				query = klingOmniImageQueryPath
			}
		}
		if !validKlingTaskID(r.TaskID) || !capabilitydriver.IsKlingVideoModel(r.Model) && !capabilitydriver.IsKlingImageModel(r.Model) || r.QueryPathTemplate != query || r.Artifact == nil || r.Artifact.GetMimeType() != mime {
			return fmt.Errorf("invalid Kling original task identity")
		}
	}
	if r != nil && r.Adapter == AdapterOpenRouterVideo && (!validOpenRouterTaskID(r.TaskID) || r.Model != capabilitydriver.OpenRouterVideoModel || r.Artifact == nil || r.Artifact.GetMimeType() != "video/mp4") {
		return fmt.Errorf("invalid OpenRouter original video identity")
	}
	if r != nil && r.Adapter == AdapterTogetherVideo && (!validTogetherVideoID(r.TaskID) || !capabilitydriver.IsTogetherVideoModel(r.Model) || r.Artifact == nil || r.Artifact.GetMimeType() != "video/mp4") {
		return fmt.Errorf("invalid Together original video identity")
	}
	if r != nil && (r.Adapter == AdapterXAIImage || r.Adapter == AdapterXAIVideo) {
		if !validXAITaskID(r.TaskID) || r.Artifact == nil || r.Adapter == AdapterXAIImage && (!capabilitydriver.IsXAIImageModel(r.Model) || r.Artifact.GetMimeType() != "image/jpeg") || r.Adapter == AdapterXAIVideo && (!capabilitydriver.IsXAIVideoModel(r.Model) || r.Artifact.GetMimeType() != "video/mp4") {
			return fmt.Errorf("xAI original media task identity invalid")
		}
	}
	if r != nil && r.Adapter == AdapterStabilityMusic && (r.Model != "stable-audio-3" || !validStabilityTaskID(r.TaskID) || r.Artifact == nil || r.Artifact.GetMimeType() != "audio/wav") {
		return fmt.Errorf("Stable Audio original task identity invalid")
	}
	if r != nil && r.Adapter == AdapterLumaUniImage {
		if !capabilitydriver.IsLumaUniImageModel(r.Model) || (r.LumaGenerationType != "image" && r.LumaGenerationType != "image_edit") || r.Artifact == nil || (r.Artifact.GetMimeType() != "image/png" && r.Artifact.GetMimeType() != "image/jpeg") {
			return fmt.Errorf("Luma original image identity invalid")
		}
	} else if r != nil && r.LumaGenerationType != "" {
		return fmt.Errorf("native receipt contains inapplicable Luma image type")
	}
	if r != nil && r.Adapter == AdapterLumaRay32 && r.Model != capabilitydriver.LumaRay32Model {
		return fmt.Errorf("Luma original model identity invalid")
	}
	if r != nil && r.Adapter == AdapterIdeogramNative && r.Model != capabilitydriver.Ideogram45Model {
		return fmt.Errorf("Ideogram original model identity invalid")
	}
	if r != nil && r.Adapter == AdapterMiniMaxH3Video && !capabilitydriver.IsMiniMaxH3VideoModel(r.Model) {
		return fmt.Errorf("MiniMax H3 original model identity invalid")
	}
	if r != nil && r.Adapter == AdapterBytedanceARKTask && !capabilitydriver.IsCurrentSeedanceVideoModel(r.Model) {
		return fmt.Errorf("Seedance original model identity invalid")
	}
	if r != nil && r.Adapter == AdapterGeminiOmniVideo {
		if !validGeminiInteractionID(r.GeminiInteractionID) || !capabilitydriver.IsGeminiOmniVideoModel(r.Model) || !validGeminiVideoArtifactURL("https://generativelanguage.googleapis.com/v1beta/files/"+r.TaskID+":download?alt=media") {
			return fmt.Errorf("Gemini original resource identity invalid")
		}
	} else if r != nil && (r.GeminiInteractionID != "" || r.Usage != nil) {
		return fmt.Errorf("native receipt contains inapplicable Gemini facts")
	}
	if r != nil && r.Usage != nil && (r.Usage.GetInputTokens() < 0 || r.Usage.GetOutputTokens() < 0) {
		return fmt.Errorf("native receipt usage invalid")
	}
	if r == nil || r.Version != 1 || strings.TrimSpace(r.Adapter) == "" || strings.TrimSpace(r.TaskID) == "" || strings.TrimSpace(r.QueryPathTemplate) == "" || r.Artifact == nil || len(r.Artifact.GetBytes()) != 0 {
		return fmt.Errorf("invalid original native task receipt")
	}
	if !nativeTaskQueryPathAllowed(r.Adapter, r.QueryPathTemplate) {
		return fmt.Errorf("native receipt query does not belong to its original protocol")
	}
	if r.Artifact.GetArtifactId() == "" || r.Artifact.GetArtifactId() != strings.TrimSpace(r.Artifact.GetArtifactId()) || len(r.Artifact.GetArtifactId()) > 128 {
		return fmt.Errorf("native receipt output slot identity invalid")
	}
	if r.PollingURL != "" && r.Adapter != AdapterFluxNative {
		return fmt.Errorf("native receipt contains an inapplicable polling URL")
	}
	encoded, err := json.Marshal(r)
	if err != nil || len(encoded) > maxJSONOrBinaryResponseBytes {
		return fmt.Errorf("original native task receipt exceeds its control envelope")
	}
	return nil
}

// The query selector is frozen protocol data, never an arbitrary credentialed
// URL supplied by a provider response or a recovered row.
func nativeTaskQueryPathAllowed(adapter, path string) bool {
	switch adapter {
	case AdapterOpenRouterVideo:
		return path == openRouterVideoQueryPath
	case AdapterTogetherVideo:
		return path == togetherVideoQueryPath
	case AdapterXAIImage:
		return path == xaiImageQueryPath
	case AdapterXAIVideo:
		return path == xaiVideoQueryPath
	case AdapterAlibabaNative:
		return path == resolveAlibabaTaskQueryPathTemplate()
	case AdapterBytedanceARKTask:
		return path == resolveBytedanceARKVideoQueryPathTemplate()
	case AdapterKlingTask:
		return path == klingImageQueryPath || path == klingOmniImageQueryPath || path == klingVideoQueryPath
	case AdapterRunwayTask:
		return path == runwayQueryPath
	case AdapterLumaRay32, AdapterLumaUniImage:
		return path == lumaAgentsQueryPath
	case AdapterLumaTask:
		return path == "/dream-machine/v1/generations/{task_id}"
	case AdapterPikaTask:
		return path == pikaQueryPath
	case AdapterGLMTask:
		return path == "/async-result/{task_id}" || path == "/api/paas/v4/async-result/{task_id}"
	case AdapterMiniMaxTask:
		return path == "/v1/query/video_generation?task_id={task_id}"
	case AdapterMiniMaxH3Video:
		return path == miniMaxH3QueryPath
	case AdapterIdeogramNative:
		return path == ideogram45QueryPath
	case AdapterFluxNative:
		return path == "/v1/get_result?id={task_id}"
	case AdapterGeminiOmniVideo:
		return path == "/files/{task_id}"
	case AdapterMubertMusic:
		return path == "/public/tracks/{task_id}"
	case AdapterStabilityMusic:
		return path == stabilityAudioQueryPath
	case AdapterWorldLabsNative:
		return path == "/marble/v1/operations/{task_id}"
	case AdapterSpaitialNative:
		return path == "/v1/worlds/requests/{task_id}/status"
	default:
		return false
	}
}

func CloneNativeTaskReceipt(r *NativeTaskReceipt) *NativeTaskReceipt {
	if r == nil {
		return nil
	}
	cloned := *r
	if r.Artifact != nil {
		cloned.Artifact = proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	}
	if r.Usage != nil {
		cloned.Usage = proto.Clone(r.Usage).(*runtimev1.UsageStats)
	}
	return &cloned
}

func EqualNativeTaskReceipt(a, b *NativeTaskReceipt) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Version == b.Version && a.Adapter == b.Adapter && a.TaskID == b.TaskID && a.Model == b.Model && a.QueryPathTemplate == b.QueryPathTemplate && a.PollingURL == b.PollingURL && proto.Equal(a.Artifact, b.Artifact) && a.GeminiInteractionID == b.GeminiInteractionID && proto.Equal(a.Usage, b.Usage)
}

// ObserveNativeTask performs exactly one original-task query. It cannot POST,
// pick a target, sleep between polls or claim that a transport error is terminal.
// The result still needs complete Runtime-owned body custody and publication.
func ObserveNativeTask(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	if err := ValidateNativeTaskReceipt(r); err != nil {
		return nil, false, err
	}
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	ctx = originalControlRequest(ctx)
	if r.Adapter == AdapterRunwayTask {
		return observeRunwayTask(ctx, cfg, r)
	}
	if r.Adapter == AdapterPikaTask {
		return observePikaTask(ctx, cfg, r)
	}
	if r.Adapter == AdapterKlingTask {
		return observeKlingTask(ctx, cfg, r)
	}
	if r.Adapter == AdapterOpenRouterVideo {
		return observeOpenRouterVideo(ctx, cfg, r)
	}
	if r.Adapter == AdapterTogetherVideo {
		return observeTogetherVideo(ctx, cfg, r)
	}
	if r.Adapter == AdapterXAIImage || r.Adapter == AdapterXAIVideo {
		return observeXAIMedia(ctx, cfg, r)
	}
	if r.Adapter == AdapterStabilityMusic {
		return observeStabilityAudio(ctx, cfg, r)
	}
	if r.Adapter == AdapterWorldLabsNative || r.Adapter == AdapterSpaitialNative {
		return observeNativeWorld(ctx, cfg, r)
	}
	if r.Adapter == AdapterGeminiOmniVideo {
		return observeGeminiOmniVideo(ctx, cfg, r)
	}
	if r.Adapter == AdapterMiniMaxH3Video {
		return observeMiniMaxH3Video(ctx, cfg, r)
	}
	if r.Adapter == AdapterLumaRay32 {
		return observeLumaAgents(ctx, cfg, r, "video", "video")
	}
	if r.Adapter == AdapterLumaUniImage {
		return observeLumaAgents(ctx, cfg, r, r.LumaGenerationType, "image")
	}
	if r.Adapter == AdapterIdeogramNative {
		return observeIdeogram45Image(ctx, cfg, r)
	}
	if r.Adapter == AdapterMiniMaxTask {
		cfg.BaseURL = miniMaxMediaBaseURL(cfg.BaseURL)
	}
	if r.Adapter == AdapterAlibabaNative {
		cfg.BaseURL = alibabaNativeBaseURL(cfg.BaseURL)
	}
	response := map[string]any{}
	query := ResolveTaskQueryPath(r.QueryPathTemplate, r.TaskID)
	apiKey, headers := cfg.APIKey, cloneMediaHeaders(cfg.Headers)
	if r.Adapter == AdapterFluxNative {
		if !validFluxPollingURL(cfg.BaseURL, r.PollingURL, r.TaskID, cfg.AllowLoopbackEndpoint) {
			return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		query, apiKey = r.PollingURL, ""
		if headers == nil {
			headers = map[string]string{}
		}
		headers["x-key"] = cfg.APIKey
	}
	if r.Adapter == AdapterMubertMusic {
		apiKey, headers = "", mubertHeaders(cfg)
	}
	if r.Adapter == AdapterMiniMaxTask {
		query = strings.ReplaceAll(r.QueryPathTemplate, "{task_id}", url.QueryEscape(r.TaskID))
	}
	var queryErr error
	if r.Adapter == AdapterAlibabaNative && r.Artifact.GetMimeType() == "video/mp4" {
		queryErr = doJSONRequestWithHeadersAndObservation(ctx, http.MethodGet, JoinURL(cfg.BaseURL, query), apiKey, nil, &response, headers, 0, "dashscope-video")
	} else {
		queryErr = DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(cfg.BaseURL, query), apiKey, nil, &response, headers)
	}
	if err := queryErr; err != nil {
		return nil, false, err
	}
	if r.Adapter == AdapterBytedanceARKTask {
		return observeSeedanceVideoResponse(r, response)
	}
	if r.Adapter == AdapterFluxNative {
		if ValueAsString(response["id"]) != r.TaskID {
			return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		switch ValueAsString(response["status"]) {
		case "Pending", "Reasoning", "Generating":
			return nil, false, nil
		case "Request Moderated", "Content Moderated":
			return nil, true, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
		case "Task not found":
			return nil, true, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED)
		case "No Card Generated", "Error":
			return nil, true, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		case "Ready":
			if !validNativeVideoArtifactURL(ValueAsString(MapField(MapField(response, "result"), "sample"))) {
				return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
		default:
			return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
	}
	status := ResolveAsyncTaskStatus(response)
	if r.Adapter == AdapterLumaTask {
		status = strings.ToLower(strings.TrimSpace(ValueAsString(response["state"])))
	}
	if id := ExtractTaskIDFromAdapterPayload(r.Adapter, response); id != "" && id != r.TaskID {
		return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if r.Adapter == AdapterAlibabaNative && r.Artifact.GetMimeType() == "video/mp4" {
		safeStatus := "unknown"
		if IsAsyncTaskPendingStatus(status) || IsAsyncTaskCanceledStatus(status) || IsAsyncTaskExpiredStatus(status) || IsAsyncTaskFailedStatus(status) || status == "succeeded" {
			safeStatus = status
		}
		slog.Info("DashScope video task observation", "provider_task_id", providerDiagnosticID(r.TaskID), "status", safeStatus)
	}
	if r.Adapter == AdapterMubertMusic {
		generation := firstMapItem(MapField(MapField(response, "data"), "generations"))
		status = strings.ToLower(strings.TrimSpace(ValueAsString(MapField(generation, "status"))))
		if status != "done" && status != "failed" && status != "error" && !IsAsyncTaskCanceledStatus(status) && !IsAsyncTaskExpiredStatus(status) {
			return nil, false, nil
		}
		response = generation
	}
	if r.Adapter == AdapterMiniMaxTask && isMiniMaxTaskPendingStatus(status) {
		return nil, false, nil
	}
	if r.Adapter == AdapterMiniMaxTask && status == "fail" {
		status = "failed"
	}
	if IsAsyncTaskPendingStatus(status) || (r.Adapter == AdapterLumaTask && status == "dreaming") {
		return nil, false, nil
	}
	if IsAsyncTaskCanceledStatus(status) {
		return nil, true, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED)
	}
	if IsAsyncTaskExpiredStatus(status) {
		return nil, true, grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED)
	}
	if IsAsyncTaskFailedStatus(status) {
		return nil, true, providerTaskFailedError(status, response)
	}
	switch status {
	case "succeeded", "success", "succeed", "completed", "done", "ready":
	default:
		return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	sources, err := nativeArtifactSources(response)
	if r.Adapter == AdapterMiniMaxTask {
		source, retrieveErr := retrieveMiniMaxVideoSource(ctx, cfg, response)
		if retrieveErr != nil {
			return nil, false, retrieveErr
		}
		sources, err = []nativeArtifactSource{source}, nil
	}
	if err != nil || len(sources) == 0 {
		return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	observation := &NativeTaskObservation{}
	for index, source := range sources {
		artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
		if index > 0 {
			artifact.ArtifactId = fmt.Sprintf("%s-%d", r.Artifact.GetArtifactId(), index)
		}
		artifact.Bytes, artifact.Uri = source.data, source.uri
		artifact.SizeBytes = int64(len(source.data))
		artifact.Sha256 = ""
		if len(source.data) > 0 {
			digest := sha256.Sum256(source.data)
			artifact.Sha256 = fmt.Sprintf("%x", digest)
		}
		if source.mime != "" {
			artifact.MimeType = source.mime
		}
		if strings.HasPrefix(artifact.MimeType, "image/") {
			artifact.DurationMs = 0
			artifact.Fps = 0
		}
		observation.Artifacts = append(observation.Artifacts, artifact)
	}
	return observation, true, nil
}

// OpenNativeTaskArtifacts consumes only descriptors from the original-task
// observation. It does not submit or poll a generation.
func OpenNativeTaskArtifacts(ctx context.Context, cfg MediaAdapterConfig, receipt *NativeTaskReceipt, observation *NativeTaskObservation) (bodies map[string]*MediaArtifactBody, err error) {
	if err := ValidateNativeTaskReceipt(receipt); err != nil {
		return nil, err
	}
	if observation == nil {
		return nil, fmt.Errorf("native observation is unavailable")
	}
	artifacts := observation.Artifacts
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	if receipt.Adapter == AdapterOpenRouterVideo {
		if len(artifacts) != 1 || artifacts[0].GetArtifactId() != receipt.Artifact.GetArtifactId() {
			return nil, openRouterOutputError()
		}
		return detachMediaArtifactBodiesWithOpener(ctx, artifacts, func(ctx context.Context, uri string) (io.ReadCloser, string, int64, error) {
			return openOpenRouterVideo(ctx, cfg, receipt, uri)
		})
	}
	if receipt.Adapter == AdapterXAIImage {
		return openXAIImageArtifacts(ctx, artifacts)
	}
	if receipt.Adapter == AdapterStabilityMusic {
		if len(artifacts) != 1 || artifacts[0].GetArtifactId() != receipt.Artifact.GetArtifactId() {
			return nil, fmt.Errorf("Stable Audio original result slot invalid")
		}
		return detachMediaArtifactBodiesWithOpener(ctx, artifacts, func(ctx context.Context, uri string) (io.ReadCloser, string, int64, error) {
			return openStabilityAudio(ctx, cfg, receipt, uri, uint32(artifacts[0].GetMetadata().GetFields()["actual_seed"].GetNumberValue()))
		})
	}
	if receipt.Adapter == AdapterWorldLabsNative || receipt.Adapter == AdapterSpaitialNative {
		return openNativeWorld(ctx, cfg, receipt, observation)
	}
	if receipt.Adapter == AdapterAlibabaNative && receipt.Artifact.GetMimeType() == "video/mp4" {
		slog.Info("DashScope video artifact fetch started", "provider_task_id", providerDiagnosticID(receipt.TaskID), "artifact_count", len(artifacts))
		defer func() {
			slog.Info("DashScope video artifact fetch returned", "provider_task_id", providerDiagnosticID(receipt.TaskID), "opened", err == nil)
		}()
	}
	if receipt.Adapter == AdapterGeminiOmniVideo {
		return detachMediaArtifactBodiesWithOpener(ctx, artifacts, func(ctx context.Context, uri string) (io.ReadCloser, string, int64, error) {
			return openGeminiVideoArtifactStream(ctx, uri, cfg.APIKey)
		})
	}
	return detachMediaArtifactBodies(ctx, artifacts)
}
