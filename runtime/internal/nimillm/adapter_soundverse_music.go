package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func soundverseOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func validSoundverseID(id string) bool {
	if len(id) == 0 || len(id) > 128 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}
func soundverseQueryPath(model string) string { return "/" + model + "/status?job_id={task_id}" }
func soundverseBackend(ctx context.Context, cfg MediaAdapterConfig) (*Backend, error) {
	u, err := url.Parse(cfg.BaseURL)
	if err != nil || strings.EqualFold(u.Hostname(), "api.soundverse.ai") {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, grpcerr.ReasonOptions{Message: "Current Soundverse uses apiv2.soundverse.ai and its own platform API key. Reconfigure the connection explicitly; legacy endpoint credentials are not migrated", ActionHint: "configure_soundverse_apiv2_connection"})
	}
	b, err := nativeMediaBackend(ctx, cfg, "soundverse")
	if err != nil {
		return nil, err
	}
	b.baseURL = strings.TrimRight(cfg.BaseURL, "/")
	return b, nil
}
func soundverseRequest(ctx context.Context, b *Backend, method, path string, body any, idempotency string) (*http.Response, error) {
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	}
	req, err := b.newRequest(ctx, method, b.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Del("x-api-key")
	req.Header.Set("Authorization", "Bearer "+b.apiKey)
	req.Header.Set("Content-Type", "application/json")
	if idempotency != "" {
		req.Header.Set("Idempotency-Key", idempotency)
	}
	response, err := b.do(req)
	if err != nil {
		return nil, markNativeCreateResponseUnavailable(ctx, MapProviderRequestError(err))
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&failure)
		reason := runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
		switch failure.Error {
		case "InvalidGenerationInput":
			reason = runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID
		case "UnknownTool", "ToolNotPriced":
			reason = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
		}
		if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
		}
		return nil, MapProviderHTTPError(response.StatusCode, nil)
	}
	return response, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.soundverse-current-music
func ExecuteSoundverseMusic(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model, privateJobID string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if !capabilitydriver.IsSoundverseMusicModel(model) || req.GetSpec().GetMusicGenerate() == nil || !validSoundverseID(privateJobID) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	ctx = nativeCreateRequest(mediaAdapterEndpointPolicyContext(ctx, cfg))
	b, err := soundverseBackend(ctx, cfg)
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetMusicGenerate()
	operation := "song"
	if s.GetInstrumental() {
		operation = "music"
	}
	body := map[string]any{"prompt": s.GetPrompt(), "parameters": map[string]any{"versions": 1}}
	if s.GetLyrics() != "" {
		body["lyrics"] = s.GetLyrics()
	}
	response, err := soundverseRequest(ctx, b, http.MethodPost, "/"+model+"/generate/"+operation, body, privateJobID)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var out struct {
		ID     string `json:"job_id"`
		Status string `json:"status"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, err)
	}
	if response.StatusCode != http.StatusCreated || !validSoundverseID(out.ID) || out.Status != "queued" {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, soundverseOutputError())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterSoundverseMusic, TaskID: out.ID, Model: model, QueryPathTemplate: soundverseQueryPath(model), Artifact: BinaryArtifact("application/octet-stream", nil, map[string]any{"adapter": AdapterSoundverseMusic})})
	return nil, nil, out.ID, err
}

func observeSoundverseMusic(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	b, err := soundverseBackend(ctx, cfg)
	if err != nil {
		return nil, false, err
	}
	defer b.client.CloseIdleConnections()
	response, err := soundverseRequest(ctx, b, http.MethodGet, strings.ReplaceAll(r.QueryPathTemplate, "{task_id}", r.TaskID), nil, "")
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	var out struct {
		ID     string `json:"job_id"`
		Status string `json:"status"`
		Output *struct {
			Assets []struct {
				FileID string `json:"file_id"`
			} `json:"assets"`
		} `json:"output"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, false, err
	}
	if out.ID != r.TaskID {
		return nil, false, soundverseOutputError()
	}
	switch out.Status {
	case "queued", "processing":
		return nil, false, nil
	case "failed":
		return nil, true, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	case "completed":
	default:
		return nil, false, soundverseOutputError()
	}
	if out.Output == nil || len(out.Output.Assets) != 1 || !validSoundverseID(out.Output.Assets[0].FileID) {
		return nil, false, soundverseOutputError()
	}
	a := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	a.Uri = "soundverse-file:" + out.Output.Assets[0].FileID
	// The durable descriptor has a known opaque container until the authorized
	// file endpoint supplies its MIME. No guessed audio format is persisted.
	a.MimeType = "application/octet-stream"
	a.Sha256 = ""
	a.SizeBytes = 0
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{a}}, true, nil
}
func openSoundverseMusic(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt, observation *NativeTaskObservation) (map[string]*MediaArtifactBody, error) {
	if observation == nil || len(observation.Artifacts) != 1 || observation.Artifacts[0].GetArtifactId() != r.Artifact.GetArtifactId() {
		return nil, soundverseOutputError()
	}
	return detachMediaArtifactBodiesWithOpener(ctx, observation.Artifacts, func(ctx context.Context, locator string) (io.ReadCloser, string, int64, error) {
		fileID, ok := strings.CutPrefix(locator, "soundverse-file:")
		if !ok || !validSoundverseID(fileID) {
			return nil, "", -1, soundverseOutputError()
		}
		b, err := soundverseBackend(ctx, cfg)
		if err != nil {
			return nil, "", -1, err
		}
		defer b.client.CloseIdleConnections()
		response, err := soundverseRequest(ctx, b, http.MethodGet, "/v1/files/"+fileID+"/url", nil, "")
		if err != nil {
			return nil, "", -1, err
		}
		defer response.Body.Close()
		var out struct {
			ID      string `json:"file_id"`
			URL     string `json:"url"`
			MIME    string `json:"mime_type"`
			Expires string `json:"expires_at"`
		}
		if err := DecodeResponseJSON(response, &out); err != nil {
			return nil, "", -1, err
		}
		expires, err := time.Parse(time.RFC3339Nano, out.Expires)
		if err != nil || !expires.After(time.Now()) || out.ID != fileID || !validNativeVideoArtifactURL(out.URL) || out.MIME != "audio/mpeg" && out.MIME != "audio/wav" && out.MIME != "audio/flac" {
			return nil, "", -1, soundverseOutputError()
		}
		observation.Artifacts[0].MimeType = out.MIME
		stream, _, size, err := openBinaryArtifactStream(ctx, out.URL)
		return stream, out.MIME, size, err
	})
}
func (p *CloudProvider) probeSoundverseConnector(ctx context.Context, endpoint, key string, headers map[string]string) error {
	b, err := soundverseBackend(ctx, MediaAdapterConfig{BaseURL: endpoint, APIKey: key, Headers: headers, AllowLoopbackEndpoint: p.allowLoopbackEndpoint})
	if err != nil {
		return err
	}
	defer b.client.CloseIdleConnections()
	response, err := soundverseRequest(ctx, b, http.MethodGet, "/v1/account/balance", nil, "")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var out struct {
		Total *int64 `json:"total_effective"`
		Base  *int64 `json:"base_effective"`
		Extra *int64 `json:"extra_tokens"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return err
	}
	if out.Total == nil || out.Base == nil || out.Extra == nil {
		return soundverseOutputError()
	}
	return nil
}
