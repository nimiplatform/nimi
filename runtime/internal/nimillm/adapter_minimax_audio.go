package nimillm

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func miniMaxAudioOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

func miniMaxNativeAudioError(code int) error {
	if code == 0 {
		return nil
	}
	status := http.StatusServiceUnavailable
	switch code {
	case 1001:
		status = http.StatusGatewayTimeout
	case 1002, 1039:
		status = http.StatusTooManyRequests
	case 1004:
		status = http.StatusUnauthorized
	case 1042, 2013:
		status = http.StatusBadRequest
	}
	return MapProviderHTTPError(status, nil)
}

type miniMaxAudioEnvelope struct {
	Model string `json:"model"`
	Data  *struct {
		Audio  string `json:"audio"`
		Status *int   `json:"status"`
	} `json:"data"`
	Base *struct {
		Code *int `json:"status_code"`
	} `json:"base_resp"`
	Extra *struct {
		Rate     *int32 `json:"audio_sample_rate"`
		Format   string `json:"audio_format"`
		Size     *int64 `json:"audio_size"`
		Channels *int32 `json:"audio_channel"`
	} `json:"extra_info"`
}

func readMiniMaxAudio(response *http.Response, model string) ([]byte, *miniMaxAudioEnvelope, error) {
	raw, err := readLimitedResponseBody(response.Body, 64<<20)
	if err != nil {
		return nil, nil, err
	}
	var out miniMaxAudioEnvelope
	if json.Unmarshal(raw, &out) != nil || out.Base == nil || out.Base.Code == nil {
		return nil, nil, miniMaxAudioOutputError()
	}
	if *out.Base.Code != 0 {
		return nil, nil, miniMaxNativeAudioError(*out.Base.Code)
	}
	if out.Model != "" && out.Model != model || out.Data == nil || out.Data.Status == nil || *out.Data.Status != 2 || len(out.Data.Audio) == 0 || len(out.Data.Audio) > 64<<20 {
		return nil, nil, miniMaxAudioOutputError()
	}
	audio, err := hex.DecodeString(out.Data.Audio)
	if err != nil || len(audio) == 0 || len(audio) > 32<<20 {
		return nil, nil, miniMaxAudioOutputError()
	}
	return audio, &out, nil
}

// The native system-voice list is read-only and does not infer model access or
// hydrate the reviewed catalog. It shares the captured account credential.
func (p *CloudProvider) probeMiniMaxConnector(ctx context.Context, endpoint, key string, headers map[string]string) error {
	b, err := nativeMediaBackend(ctx, MediaAdapterConfig{BaseURL: endpoint, APIKey: key, Headers: headers, AllowLoopbackEndpoint: p.allowLoopbackEndpoint}, "minimax-audio")
	if err != nil {
		return err
	}
	defer b.client.CloseIdleConnections()
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/get_voice", map[string]any{"voice_type": "system"})
	if err != nil {
		return err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	var out struct {
		Voices *[]json.RawMessage `json:"system_voice"`
		Base   *struct {
			Code *int `json:"status_code"`
		} `json:"base_resp"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return err
	}
	if out.Base == nil || out.Base.Code == nil {
		return miniMaxAudioOutputError()
	}
	if err := miniMaxNativeAudioError(*out.Base.Code); err != nil {
		return err
	}
	if out.Voices == nil {
		return miniMaxAudioOutputError()
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func ExecuteMiniMaxSpeech(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "minimax-audio")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetSpeechSynthesize()
	voice := map[string]any{"voice_id": s.GetVoiceRef().GetPresetVoiceId()}
	if s.Speed != nil {
		voice["speed"] = s.GetSpeed()
	}
	if s.Pitch != nil {
		voice["pitch"] = int32(s.GetPitch())
	}
	if s.Volume != nil {
		voice["vol"] = s.GetVolume()
	}
	if s.GetEmotion() != "" {
		voice["emotion"] = s.GetEmotion()
	}
	format := s.GetAudioFormat()
	switch format {
	case "mulaw":
		format = "pcmu_raw"
	case "wav_mulaw":
		format = "pcmu_wav"
	}
	body := map[string]any{"model": model, "text": s.GetText(), "stream": false, "output_format": "hex", "voice_setting": voice, "audio_setting": map[string]any{"format": format, "sample_rate": s.GetSampleRateHz(), "channel": 1}}
	if s.GetLanguage() != "" {
		body["language_boost"] = map[string]string{"zh": "Chinese", "en": "English", "ja": "Japanese", "yue": "Chinese,Yue"}[s.GetLanguage()]
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/t2a_v2", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	audio, out, err := readMiniMaxAudio(response, model)
	if err != nil {
		return nil, nil, "", err
	}
	if e := out.Extra; e != nil {
		if e.Rate != nil && *e.Rate != s.GetSampleRateHz() || e.Format != "" && e.Format != format || e.Size != nil && *e.Size != int64(len(audio)) || e.Channels != nil && *e.Channels != 1 {
			return nil, nil, "", miniMaxAudioOutputError()
		}
	}
	artifact, err := nativeSpeechArtifact(ctx, audio, s.GetAudioFormat(), s.GetSampleRateHz(), map[string]any{"adapter": capabilitydriver.CloudMediaAdapterMiniMaxSpeech})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func ExecuteMiniMaxMusic(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "minimax-audio")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetMusicGenerate()
	body := map[string]any{"model": model, "prompt": s.GetPrompt(), "is_instrumental": s.GetInstrumental(), "lyrics_optimizer": false, "stream": false, "output_format": "hex", "audio_setting": map[string]any{"sample_rate": 44100, "format": "mp3", "bitrate": 256000}}
	if s.GetLyrics() != "" {
		body["lyrics"] = s.GetLyrics()
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/music_generation", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	audio, _, err := readMiniMaxAudio(response, model)
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact("audio/mpeg", audio, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterMiniMaxMusic})}, nil, "", nil
}
