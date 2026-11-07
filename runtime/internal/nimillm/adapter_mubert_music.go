package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func mubertHeaders(cfg MediaAdapterConfig) map[string]string {
	headers := cloneHeaderMap(cfg.Headers)
	if headers == nil {
		headers = map[string]string{}
	}
	customer, token := "", ""
	for k, v := range headers {
		switch {
		case strings.EqualFold(k, "customer-id"):
			if customer != "" && customer != v {
				return nil
			}
			customer = v
			delete(headers, k)
		case strings.EqualFold(k, "access-token"):
			if token != "" && token != v {
				return nil
			}
			token = v
			delete(headers, k)
		}
	}
	if customer == "" && token != "" || customer != "" && token == "" {
		return nil
	}
	if raw := strings.TrimSpace(cfg.APIKey); raw != "" {
		pair := strings.SplitN(raw, "::", 2)
		if len(pair) != 2 {
			return nil
		}
		a, b := strings.TrimSpace(pair[0]), strings.TrimSpace(pair[1])
		if customer != "" && (customer != a || token != b) {
			return nil
		}
		customer, token = a, b
	}
	if strings.TrimSpace(customer) == "" || strings.TrimSpace(token) == "" || strings.ContainsAny(customer+token, "\r\n") {
		return nil
	}
	headers["customer-id"], headers["access-token"] = customer, token
	return headers
}

const mubertCredentialFormatMessage = "Mubert requires an end-customer credential pair: enter customer-id::access-token in the API key field"

func mubertAuthError() error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, grpcerr.ReasonOptions{Message: mubertCredentialFormatMessage, ActionHint: "provide_mubert_customer_id_and_access_token"})
}
func mubertBackend(ctx context.Context, cfg MediaAdapterConfig) (*Backend, error) {
	headers := mubertHeaders(cfg)
	if headers == nil {
		return nil, mubertAuthError()
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	transport, err := securedProviderTransport(ctx, base, cfg.AllowLoopbackEndpoint)
	if err != nil {
		return nil, err
	}
	b := newBackend("cloud-mubert", base, "", headers, defaultHTTPTimeout, transport, true, cfg.AllowLoopbackEndpoint)
	if b == nil {
		transport.CloseIdleConnections()
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	b.baseURL = base
	b.client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return b, nil
}
func mubertRequest(ctx context.Context, b *Backend, method, path string, body any) (*http.Response, error) {
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
	req.Header.Set("Content-Type", "application/json")
	response, err := b.do(req)
	if err != nil {
		return nil, markNativeCreateResponseUnavailable(ctx, MapProviderRequestError(err))
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		return nil, MapProviderHTTPError(response.StatusCode, nil)
	}
	return response, nil
}
func validMubertID(id string) bool {
	if len(id) == 0 || len(id) > 256 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

type mubertGeneration struct {
	ID     string `json:"session_id"`
	Format string `json:"format"`
	Status string `json:"status"`
	URL    string `json:"url"`
}
type mubertTrackEnvelope struct {
	Data *struct {
		ID          string             `json:"id"`
		Generations []mubertGeneration `json:"generations"`
	} `json:"data"`
}

func mubertOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func ExecuteMubertMusic(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if model != capabilitydriver.MubertTrackModel || req.GetSpec().GetMusicGenerate() == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	ctx = nativeCreateRequest(mediaAdapterEndpointPolicyContext(ctx, cfg))
	b, err := mubertBackend(ctx, cfg)
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetMusicGenerate()
	response, err := mubertRequest(ctx, b, http.MethodPost, "/public/tracks", map[string]any{"prompt": s.GetPrompt(), "duration": s.GetDurationSeconds(), "format": "mp3", "mode": "track"})
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var out mubertTrackEnvelope
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, err)
	}
	if out.Data == nil || !validMubertID(out.Data.ID) {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, mubertOutputError())
	}
	var generation *mubertGeneration
	for i := range out.Data.Generations {
		g := &out.Data.Generations[i]
		if g.Format == "mp3" {
			if generation != nil || !validMubertID(g.ID) {
				return nil, nil, "", markNativeCreateResponseUnavailable(ctx, mubertOutputError())
			}
			generation = g
		}
	}
	if generation == nil {
		return nil, nil, "", markNativeCreateResponseUnavailable(ctx, mubertOutputError())
	}
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterMubertMusic, TaskID: out.Data.ID, Model: model, MubertGenerationID: generation.ID, QueryPathTemplate: "/public/tracks/{task_id}", Artifact: BinaryArtifact("audio/mpeg", nil, map[string]any{"adapter": AdapterMubertMusic})})
	return nil, nil, out.Data.ID, err
}
func observeMubertTrack(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	b, err := mubertBackend(ctx, cfg)
	if err != nil {
		return nil, false, err
	}
	defer b.client.CloseIdleConnections()
	response, err := mubertRequest(ctx, b, http.MethodGet, "/public/tracks/"+r.TaskID, nil)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	var out mubertTrackEnvelope
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, false, err
	}
	if out.Data == nil || out.Data.ID != r.TaskID {
		return nil, false, mubertOutputError()
	}
	var generation *mubertGeneration
	for i := range out.Data.Generations {
		g := &out.Data.Generations[i]
		if g.ID == r.MubertGenerationID {
			if generation != nil || g.Format != "mp3" {
				return nil, false, mubertOutputError()
			}
			generation = g
		}
	}
	if generation == nil {
		return nil, false, mubertOutputError()
	}
	switch generation.Status {
	case "processing":
		return nil, false, nil
	case "failed", "error":
		return nil, true, providerTaskFailedError(generation.Status, nil)
	case "done":
	default:
		return nil, false, mubertOutputError()
	}
	if !validNativeVideoArtifactURL(generation.URL) {
		return nil, false, mubertOutputError()
	}
	artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	artifact.Uri = generation.URL
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}}, true, nil
}
func (p *CloudProvider) probeMubertConnector(ctx context.Context, endpoint, key string, headers map[string]string) error {
	b, err := mubertBackend(ctx, MediaAdapterConfig{BaseURL: endpoint, APIKey: key, Headers: headers, AllowLoopbackEndpoint: p.allowLoopbackEndpoint})
	if err != nil {
		return err
	}
	defer b.client.CloseIdleConnections()
	response, err := mubertRequest(ctx, b, http.MethodGet, "/public/playlists", nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var out struct {
		Data *[]json.RawMessage `json:"data"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return err
	}
	if out.Data == nil {
		return mubertOutputError()
	}
	return nil
}
