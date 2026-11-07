package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func loudlyOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func loudlyBackend(ctx context.Context, cfg MediaAdapterConfig) (*Backend, error) {
	b, err := nativeMediaBackend(ctx, cfg, "loudly")
	if err != nil {
		return nil, err
	}
	// This API has no versioned service-base suffix; /v1 may be a proxy prefix.
	b.baseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	return b, nil
}
func loudlyRequest(ctx context.Context, b *Backend, method, path, contentType string, body *bytes.Buffer) (*http.Response, error) {
	var req *http.Request
	var err error
	if body == nil {
		req, err = b.newRequest(ctx, method, b.baseURL+path, nil)
	} else {
		req, err = b.newRequest(ctx, method, b.baseURL+path, body)
	}
	if err != nil {
		return nil, err
	}
	req.Header.Del("Authorization")
	req.Header.Del("X-Api-Key")
	req.Header.Set("API-KEY", b.apiKey)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
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

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func ExecuteLoudlyMusic(ctx context.Context, cfg MediaAdapterConfig, request *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if model != "VEGA_2" || request.GetSpec().GetMusicGenerate() == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	b, err := loudlyBackend(ctx, cfg)
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := request.GetSpec().GetMusicGenerate()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for _, field := range [][2]string{{"model", model}, {"prompt", s.GetPrompt()}, {"duration", strconv.FormatInt(int64(s.GetDurationSeconds()), 10)}} {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, nil, "", err
	}
	response, err := loudlyRequest(nativeCreateRequest(ctx), b, http.MethodPost, "/api/ai/prompt/songs", writer.FormDataContentType(), body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var song struct {
		ID       string          `json:"id"`
		Model    string          `json:"model"`
		Duration *int64          `json:"duration"`
		MP3      string          `json:"music_file_path_mp3"`
		Error    json.RawMessage `json:"error"`
	}
	if err := DecodeResponseJSON(response, &song); err != nil {
		return nil, nil, "", err
	}
	if song.ID == "" || len(song.ID) > 128 || song.ID != strings.TrimSpace(song.ID) || song.Model != "" && song.Model != model || song.Duration == nil || *song.Duration <= 0 || !validNativeVideoArtifactURL(song.MP3) || len(song.Error) > 0 && string(song.Error) != "null" {
		return nil, nil, "", loudlyOutputError()
	}
	// Credential-free bytes enter the existing music codec owner, which alone
	// measures and commits the canonical PCM mix. Reported milliseconds and the
	// requested duration never become measured output facts.
	data, _, err := fetchBinaryArtifact(ctx, song.MP3)
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact("audio/mpeg", data, map[string]any{"adapter": AdapterLoudlyMusic})}, nil, "", nil
}

func (p *CloudProvider) probeLoudlyConnector(ctx context.Context, endpoint, key string, headers map[string]string) error {
	b, err := loudlyBackend(ctx, MediaAdapterConfig{BaseURL: endpoint, APIKey: key, Headers: headers, AllowLoopbackEndpoint: p.allowLoopbackEndpoint})
	if err != nil {
		return err
	}
	defer b.client.CloseIdleConnections()
	response, err := loudlyRequest(ctx, b, http.MethodGet, "/api/account/credits", "", nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var balance struct {
		ID           string `json:"id"`
		Payg         *int64 `json:"payg_credits"`
		Subscription *int64 `json:"subscription_credits"`
	}
	if err := DecodeResponseJSON(response, &balance); err != nil {
		return err
	}
	if balance.ID == "" || balance.Payg == nil || balance.Subscription == nil {
		return loudlyOutputError()
	}
	return nil
}
