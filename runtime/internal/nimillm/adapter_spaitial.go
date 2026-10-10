package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const AdapterSpaitialNative = "spaitial_world_adapter"

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// @nimi-authority: rule.nimi.runtime.ai-provider.r029
func ExecuteSpaitialWorld(ctx context.Context, cfg MediaAdapterConfig, updater JobStateUpdater, jobID string, req *runtimev1.SubmitScenarioJobRequest, model string) (MediaExecutionResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	if req == nil || model != "default" || jobID == "" {
		return MediaExecutionResult{}, spaitialOutputError("invalid captured target")
	}
	spec := scenarioWorldGenerateSpec(req)
	if err := ValidateCloudWorldRequestFields("spaitial", spec); err != nil {
		return MediaExecutionResult{}, err
	}
	if _, err := spaitialControlOrigin(ctx, cfg.BaseURL); err != nil {
		return MediaExecutionResult{}, err
	}
	if _, err := requireProviderAPIKey(cfg.APIKey); err != nil {
		return MediaExecutionResult{}, err
	}
	ctx = originalControlRequest(ctx)
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return MediaExecutionResult{}, err
	}
	fileID := ""
	if spec.GetImagePrompt() != nil {
		var err error
		fileID, err = uploadSpaitialImage(ctx, cfg, spec)
		if err != nil {
			return MediaExecutionResult{}, err
		}
	}
	input := map[string]any{"type": "text", "prompt": spec.GetTextPrompt()}
	if fileID != "" {
		input = map[string]any{"type": "file_id", "file_id": fileID, "is_pano": spec.GetImagePrompt().GetProjection() == runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_EQUIRECTANGULAR_360}
	}
	payload := map[string]any{"input": input, "model": model, "output_format": "spz", "visibility": map[string]any{"is_public": false, "is_listed": false}}
	if spec.GetDisplayName() != "" {
		payload["title"] = spec.GetDisplayName()
	}
	submitted := map[string]any{}
	// All receipt attempts retain this Nimi Job's key, captured request body
	// and prepared file identity; none constructs another generation intent.
	if err := submitSpaitialWorld(ctx, cfg, payload, "nimi-world-"+jobID, &submitted); err != nil {
		return MediaExecutionResult{}, err
	}
	id, ok := submitted["request_id"].(string)
	if !ok || !validSpaitialID(id) {
		return MediaExecutionResult{}, spaitialOutputError("request identity missing")
	}
	artifact := BinaryArtifact(worldLabsManifestMIME, nil, map[string]any{"adapter": AdapterSpaitialNative})
	_, err := publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterSpaitialNative, TaskID: id, Model: model, QueryPathTemplate: "/v1/worlds/requests/{task_id}/status", Artifact: artifact})
	return MediaExecutionResult{ProviderJobID: id}, err
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// A lost create response may hide an accepted operation. Even an upstream
// idempotency key does not authorize Runtime to replay an unknown create.
func submitSpaitialWorld(ctx context.Context, cfg MediaAdapterConfig, payload map[string]any, key string, submitted *map[string]any) error {
	return spaitialJSON(nativeCreateRequest(ctx), cfg, http.MethodPost, "/v1/worlds", payload, key, submitted)
}

func validSpaitialID(id string) bool {
	if id == "" || len(id) > 200 {
		return false
	}
	for _, ch := range id {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '_' || ch == '-') {
			return false
		}
	}
	return true
}

func spaitialControlOrigin(ctx context.Context, raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.RawPath != "" {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
	}
	if u.Scheme != "https" || u.Host != "api.spaitial.ai" {
		if !allowLoopbackProviderEndpointFromContext(ctx) || (u.Scheme != "http" && u.Scheme != "https") || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
			return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
		}
	}
	return u.Scheme + "://" + u.Host, nil
}

func spaitialRequest(ctx context.Context, cfg MediaAdapterConfig, method, path string, body io.Reader, contentType, key string, target *map[string]any) error {
	origin, err := spaitialControlOrigin(ctx, cfg.BaseURL)
	if err != nil {
		return err
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return err
	}
	client, req, err := newSecuredHTTPRequest(ctx, method, origin+path, body)
	if err != nil {
		return err
	}
	client.Timeout = 30 * time.Second
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	req, obs := observeProviderHTTP(AdapterSpaitialNative, 0, req)
	resp, err := client.Do(req)
	obs.finish(resp, err)
	if err != nil {
		return markNativeCreateResponseUnavailable(ctx, MapProviderRequestError(err))
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload)
		return MapProviderHTTPError(resp.StatusCode, payload)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(target); err != nil {
		return markNativeCreateResponseUnavailable(ctx, providerResponseDecodeError(err))
	}
	return nil
}

func spaitialJSON(ctx context.Context, cfg MediaAdapterConfig, method, path string, payload any, key string, target *map[string]any) error {
	var reader io.Reader
	ct := ""
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode SpAItial request: %w", err)
		}
		reader = bytes.NewReader(raw)
		ct = "application/json"
	}
	return spaitialRequest(ctx, cfg, method, path, reader, ct, key, target)
}

func uploadSpaitialImage(ctx context.Context, cfg MediaAdapterConfig, spec *runtimev1.WorldGenerateScenarioSpec) (string, error) {
	ref, _ := ctx.Value(imageReferenceContextKey{}).(*ImageReference)
	if err := ValidateCloudWorldImageReference("spaitial", spec, ref); err != nil {
		return "", err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="world-input.`+strings.TrimPrefix(ref.MIMEType, "image/")+`"`)
	header.Set("Content-Type", ref.MIMEType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", fmt.Errorf("create SpAItial image upload: %w", err)
	}
	if _, err = part.Write(ref.Bytes); err != nil {
		return "", fmt.Errorf("write SpAItial image upload: %w", err)
	}
	if err = writer.Close(); err != nil {
		return "", fmt.Errorf("finish SpAItial image upload: %w", err)
	}
	result := map[string]any{}
	if err := spaitialRequest(ctx, cfg, http.MethodPost, "/v1/files", &body, writer.FormDataContentType(), "", &result); err != nil {
		return "", err
	}
	id, ok := result["file_id"].(string)
	if !ok || !validSpaitialID(id) {
		return "", spaitialOutputError("upload identity missing")
	}
	return id, nil
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
type spaitialWorldAcquisition struct {
	metadata  portableWorldArchiveMetadata
	assets    []worldArchiveAsset
	artifacts []*runtimev1.ScenarioArtifact
	manifest  []byte
}

// Control-plane validation is pure. Opening asset bodies is a separate step
// after the Job has reserved every required output slot.
func prepareSpaitialWorldAcquisition(cfg MediaAdapterConfig, result map[string]any, id, model string) (*spaitialWorldAcquisition, error) {
	world, ok := result["world"].(map[string]any)
	if !ok || result["request_id"] != id || result["status"] != "COMPLETED" || result["model"] != model || world["splat_format"] != "spz" {
		return nil, spaitialOutputError("completed result identity or format invalid")
	}
	worldID, ok := world["id"].(string)
	if !ok || !validSpaitialID(worldID) {
		return nil, spaitialOutputError("world identity missing")
	}
	title, titleOK := world["title"].(string)
	caption, captionOK := world["description"].(string)
	if (world["title"] != nil && !titleOK) || (world["description"] != nil && !captionOK) {
		return nil, spaitialOutputError("world display metadata invalid")
	}
	// Echo default's observed SPZ output uses RDF/OpenCV scene coordinates.
	// The container/version alone does not establish axes or calibration.
	// Preserve source bytes and declare their verified basis independently of
	// metric scale and ground, which the provider has not supplied.
	metadata := portableWorldArchiveMetadata{WorldID: worldID, DisplayName: title, Caption: caption,
		SplatCoordinateSystem: "opencv", CalibrationState: "uncalibrated", SplatPath: "world.spz"}
	assets := []worldArchiveAsset{{Name: "world.spz", Open: func(inner context.Context) (io.ReadCloser, error) {
		body, _, _, err := openSpaitialArtifactStream(inner, cfg, id, "splat")
		if err != nil {
			return nil, err
		}
		return verifiedSpaitialSPZStream(body), nil
	}}}
	if panorama, present := world["panorama_url"]; present && panorama != nil {
		uri, ok := panorama.(string)
		if !ok {
			return nil, spaitialOutputError("panorama availability invalid")
		}
		if strings.TrimSpace(uri) != "" {
			metadata.PanoramaPath = "panorama.image"
			assets = append(assets, worldArchiveAsset{Name: "panorama.image", Open: func(inner context.Context) (io.ReadCloser, error) {
				body, _, _, err := openSpaitialArtifactStream(inner, cfg, id, "panorama")
				return body, err
			}})
		}
	}
	raw, err := json.Marshal(map[string]any{"world_id": worldID, "display_name": title, "caption": caption})
	if err != nil {
		return nil, fmt.Errorf("encode SpAItial world identity: %w", err)
	}
	manifest := BinaryArtifact(worldLabsManifestMIME, raw, map[string]any{"adapter": AdapterSpaitialNative, "world_id": worldID})
	// The Host/Driver handoff owns bytes only in ArtifactBodies, like the
	// common detached-body path; the public descriptor cannot duplicate them.
	manifest.Bytes = nil
	bundle := BinaryArtifact(WorldBundleMIME, nil, map[string]any{"adapter": AdapterSpaitialNative, "world_id": worldID, "calibration_state": "uncalibrated"})
	bundle.Sha256 = ""
	return &spaitialWorldAcquisition{metadata: metadata, assets: assets, artifacts: []*runtimev1.ScenarioArtifact{manifest, bundle}, manifest: raw}, nil
}

func normalizeSpaitialWorldResponse(ctx context.Context, cfg MediaAdapterConfig, result map[string]any, id, model string) (MediaExecutionResult, error) {
	plan, err := prepareSpaitialWorldAcquisition(cfg, result, id, model)
	if err != nil {
		return MediaExecutionResult{ProviderJobID: id}, err
	}
	stream, err := streamWorldArchive(ctx, plan.metadata, plan.assets)
	if err != nil {
		return MediaExecutionResult{ProviderJobID: id}, err
	}
	return MediaExecutionResult{ProviderJobID: id, Artifacts: plan.artifacts, ArtifactBodies: map[string]*MediaArtifactBody{
		plan.artifacts[0].GetArtifactId(): {Bytes: plan.manifest}, plan.artifacts[1].GetArtifactId(): {Stream: stream},
	}}, nil
}

func spaitialOutputError(message string) error {
	return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{Message: message})
}

func cancelSpaitialTask(ctx context.Context, id string, cfg MediaAdapterConfig) (ProviderTaskCleanupOutcome, error) {
	if !validSpaitialID(id) {
		return ProviderTaskCleanupFailed, spaitialOutputError("cancel identity invalid")
	}
	ack := map[string]any{}
	if err := spaitialJSON(ctx, cfg, http.MethodPost, "/v1/worlds/requests/"+id+"/cancel", nil, "", &ack); err != nil {
		return ProviderTaskCleanupFailed, err
	}
	state := map[string]any{}
	if err := spaitialJSON(ctx, cfg, http.MethodGet, "/v1/worlds/requests/"+id+"/status", nil, "", &state); err != nil {
		return ProviderTaskCleanupUnconfirmed, err
	}
	if state["request_id"] == id && state["status"] == "CANCELLED" {
		return ProviderTaskCleanupCanceled, nil
	}
	return ProviderTaskCleanupUnconfirmed, nil
}
