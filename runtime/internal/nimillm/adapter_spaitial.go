package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	updater.UpdatePollState(jobID, id, 0, timestamppb.New(time.Now().UTC().Add(providerPollDelay(0))), "pending")
	providerTerminal := false
	defer func() {
		if !providerTerminal && (errors.Is(ctx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.DeadlineExceeded)) {
			bestEffortDeleteProviderAsyncTask(ctx, AdapterSpaitialNative, cfg.BaseURL, cfg.APIKey, id)
		}
	}()
	var retries int32
	for {
		if ctx.Err() != nil {
			return MediaExecutionResult{ProviderJobID: id}, providerPollContextError(ctx.Err())
		}
		retries++
		state := map[string]any{}
		if err := retryWorldProviderRead(ctx, func() error {
			state = map[string]any{}
			return spaitialJSON(ctx, cfg, http.MethodGet, "/v1/worlds/requests/"+id+"/status", nil, "", &state)
		}); err != nil {
			return MediaExecutionResult{ProviderJobID: id}, err
		}
		if responseID, present := state["request_id"]; present && responseID != id {
			return MediaExecutionResult{ProviderJobID: id}, spaitialOutputError("status identity mismatch")
		}
		switch state["status"] {
		case "COMPLETED":
			providerTerminal = true
			result := map[string]any{}
			if err := retryWorldProviderRead(ctx, func() error {
				result = map[string]any{}
				return spaitialJSON(ctx, cfg, http.MethodGet, "/v1/worlds/requests/"+id, nil, "", &result)
			}); err != nil {
				return MediaExecutionResult{ProviderJobID: id}, err
			}
			return normalizeSpaitialWorldResponse(ctx, cfg, result, id, model)
		case "FAILED":
			providerTerminal = true
			return MediaExecutionResult{ProviderJobID: id}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		case "CANCELLED":
			providerTerminal = true
			return MediaExecutionResult{ProviderJobID: id}, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_ACTION_EXECUTED)
		case "PENDING", "PROCESSING":
			if providerPollRetryLimitReached(ctx, retries) {
				return MediaExecutionResult{ProviderJobID: id}, providerPollTimeoutError()
			}
			delay := providerPollDelay(retries)
			updater.UpdatePollState(jobID, id, retries, timestamppb.New(time.Now().UTC().Add(delay)), strings.ToLower(state["status"].(string)))
			if err := sleepWithContext(ctx, delay); err != nil {
				return MediaExecutionResult{ProviderJobID: id}, providerPollContextError(err)
			}
		default:
			return MediaExecutionResult{ProviderJobID: id}, spaitialOutputError("unrecognized provider status")
		}
	}
}

// A transport failure may occur after the provider accepted the work. Its
// documented 24-hour idempotency key permits bounded receipt retrieval for
// the exact same captured body. This stays inside one executing Nimi Job;
// it never reopens a terminal Job or creates a new image upload.
func submitSpaitialWorld(ctx context.Context, cfg MediaAdapterConfig, payload map[string]any, key string, submitted *map[string]any) error {
	for attempt := int32(0); ; attempt++ {
		err := spaitialJSON(ctx, cfg, http.MethodPost, "/v1/worlds", payload, key, submitted)
		if err == nil || ctx.Err() != nil || !spaitialReceiptRetryable(err) || attempt == 2 {
			return err
		}
		if err := sleepWithContext(ctx, providerPollDelay(attempt)); err != nil {
			return providerPollContextError(err)
		}
	}
}

func spaitialReceiptRetryable(err error) bool {
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		if raw, present := metadata["provider_http_status"]; present {
			code, parseErr := strconv.Atoi(raw)
			if parseErr != nil || code < 100 || code > 599 || (code >= 400 && code < 500 && code != http.StatusRequestTimeout) {
				return false
			}
		}
	}
	return isTransientPollError(err)
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
		return MapProviderRequestError(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload)
		return MapProviderHTTPError(resp.StatusCode, payload)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(target); err != nil {
		return providerResponseDecodeError(err)
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
func normalizeSpaitialWorldResponse(ctx context.Context, cfg MediaAdapterConfig, result map[string]any, id, model string) (MediaExecutionResult, error) {
	failure := MediaExecutionResult{ProviderJobID: id}
	world, ok := result["world"].(map[string]any)
	if !ok || result["request_id"] != id || result["status"] != "COMPLETED" || result["model"] != model || world["splat_format"] != "spz" {
		return failure, spaitialOutputError("completed result identity or format invalid")
	}
	worldID, ok := world["id"].(string)
	if !ok || !validSpaitialID(worldID) {
		return failure, spaitialOutputError("world identity missing")
	}
	title, titleOK := world["title"].(string)
	caption, captionOK := world["description"].(string)
	if (world["title"] != nil && !titleOK) || (world["description"] != nil && !captionOK) {
		return failure, spaitialOutputError("world display metadata invalid")
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
			return failure, spaitialOutputError("panorama availability invalid")
		}
		if strings.TrimSpace(uri) != "" {
			metadata.PanoramaPath = "panorama.image"
			assets = append(assets, worldArchiveAsset{Name: "panorama.image", Open: func(inner context.Context) (io.ReadCloser, error) {
				body, _, _, err := openSpaitialArtifactStream(inner, cfg, id, "panorama")
				return body, err
			}})
		}
	}
	stream, err := streamWorldArchive(ctx, metadata, assets)
	if err != nil {
		return failure, err
	}
	raw, err := json.Marshal(map[string]any{"world_id": worldID, "display_name": title, "caption": caption})
	if err != nil {
		_ = stream.Close()
		return failure, fmt.Errorf("encode SpAItial world identity: %w", err)
	}
	manifest := BinaryArtifact(worldLabsManifestMIME, raw, map[string]any{"adapter": AdapterSpaitialNative, "world_id": worldID})
	// The Host/Driver handoff owns bytes only in ArtifactBodies, like the
	// common detached-body path; the public descriptor cannot duplicate them.
	manifest.Bytes = nil
	bundle := BinaryArtifact(WorldBundleMIME, nil, map[string]any{"adapter": AdapterSpaitialNative, "world_id": worldID, "calibration_state": "uncalibrated"})
	bundle.Sha256 = ""
	return MediaExecutionResult{ProviderJobID: id, Artifacts: []*runtimev1.ScenarioArtifact{manifest, bundle}, ArtifactBodies: map[string]*MediaArtifactBody{
		manifest.GetArtifactId(): {Bytes: raw}, bundle.GetArtifactId(): {Stream: stream},
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
