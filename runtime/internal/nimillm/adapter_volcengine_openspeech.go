package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

const AdapterBytedanceOpenSpeech = "bytedance_openspeech_adapter"
const bytedanceOpenSpeechMaxInlineAudioBytes = 32 << 20

func openSpeechError(code string) error {
	switch code {
	case "45000001", "45000002", "45000151":
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	case "40402003":
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	default:
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}
func openSpeechOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func openSpeechBackend(ctx context.Context, cfg MediaAdapterConfig) (*Backend, error) {
	b, err := nativeMediaBackend(ctx, cfg, "volcengine_openspeech")
	if err != nil {
		return nil, err
	}
	b.baseURL = strings.TrimSuffix(strings.TrimRight(cfg.BaseURL, "/"), "/api/v1")
	return b, nil
}
func openSpeechRequest(ctx context.Context, b *Backend, resource, path string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	r, err := b.newRequest(ctx, http.MethodPost, b.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	r.Header.Del("Authorization")
	r.Header.Del("X-Api-App-Key")
	r.Header.Del("X-Api-Access-Key")
	r.Header.Set("X-Api-Key", b.apiKey)
	r.Header.Set("X-Api-Resource-Id", resource)
	r.Header.Set("X-Api-Request-Id", uuid.NewString())
	r.Header.Set("Content-Type", "application/json")
	if resource == capabilitydriver.OpenSpeechFlashASR {
		r.Header.Set("X-Api-Sequence", "-1")
	}
	response, err := b.do(r)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
		return nil, MapProviderHTTPError(response.StatusCode, nil)
	}
	return response, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func ExecuteBytedanceOpenSpeech(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := openSpeechBackend(ctx, cfg)
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	if s := req.GetSpec().GetSpeechSynthesize(); s != nil {
		if len(capabilitydriver.OpenSpeechVoices(model)) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		audio := map[string]any{"format": s.GetAudioFormat(), "sample_rate": s.GetSampleRateHz()}
		if s.Speed != nil {
			audio["speech_rate"] = (float64(s.GetSpeed()) - 1) * 100
		}
		params := map[string]any{"text": s.GetText(), "speaker": s.GetVoiceRef().GetPresetVoiceId(), "audio_params": audio}
		if s.GetLanguage() != "" {
			language := s.GetLanguage()
			if language == "zh" {
				language = "zh-cn"
			}
			extra, _ := json.Marshal(map[string]string{"explicit_language": language})
			params["additions"] = string(extra)
		}
		response, err := openSpeechRequest(ctx, b, model, "/api/v3/tts/unidirectional/sse", map[string]any{"user": map[string]string{"uid": "nimi-runtime"}, "req_params": params})
		if err != nil {
			return nil, nil, "", err
		}
		defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
		if !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
			return nil, nil, "", openSpeechOutputError()
		}
		raw, err := readOpenSpeechSSE(response.Body)
		if err != nil {
			return nil, nil, "", err
		}
		artifact, err := nativeSpeechArtifact(ctx, raw, s.GetAudioFormat(), s.GetSampleRateHz(), map[string]any{"adapter": AdapterBytedanceOpenSpeech})
		if err != nil {
			return nil, nil, "", err
		}
		return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
	}
	if s := req.GetSpec().GetSpeechTranscribe(); s != nil {
		if model != capabilitydriver.OpenSpeechFlashASR {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		source := s.GetAudioSource().GetAudioBytes()
		if len(source) == 0 || len(source) > bytedanceOpenSpeechMaxInlineAudioBytes {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		duration, err := nativeSpeechRecordingDuration(ctx, source, s.GetMimeType())
		if err != nil {
			return nil, nil, "", err
		}
		if duration <= 0 || duration > 7200 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		audio := map[string]any{"data": base64.StdEncoding.EncodeToString(source), "format": map[string]string{"audio/wav": "wav", "audio/mpeg": "mp3"}[s.GetMimeType()]}
		if s.GetLanguage() != "" {
			audio["language"] = s.GetLanguage()
		}
		request := map[string]any{"model_name": "bigmodel"}
		if s.GetTimestamps() {
			request["show_utterances"] = true
		}
		response, err := openSpeechRequest(ctx, b, model, "/api/v3/auc/bigmodel/recognize/flash", map[string]any{"user": map[string]string{"uid": "nimi-runtime"}, "audio": audio, "request": request})
		if err != nil {
			return nil, nil, "", err
		}
		defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
		raw, err := readLimitedResponseBody(response.Body, 32<<20)
		if err != nil {
			return nil, nil, "", err
		}
		transcript, err := parseOpenSpeechTranscript(raw, response.Header.Get("X-Api-Status-Code"), s.GetTimestamps(), duration)
		if err != nil {
			return nil, nil, "", err
		}
		data, err := protojson.Marshal(transcript)
		if err != nil {
			return nil, nil, "", err
		}
		return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, data, map[string]any{"adapter": AdapterBytedanceOpenSpeech})}, nil, "", nil
	}
	return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func readOpenSpeechSSE(body io.Reader) ([]byte, error) {
	limited := &io.LimitedReader{R: body, N: (64 << 20) + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 64<<10), 48<<20)
	var output []byte
	var data strings.Builder
	event := ""
	done := false
	flush := func() error {
		if data.Len() == 0 {
			event = ""
			return nil
		}
		if done {
			return openSpeechOutputError()
		}
		var packet struct {
			Code *int64  `json:"code"`
			Data *string `json:"data"`
		}
		if json.Unmarshal([]byte(data.String()), &packet) != nil || packet.Code == nil {
			return openSpeechOutputError()
		}
		switch *packet.Code {
		case 0:
			if event != "352" && event != "351" {
				return openSpeechOutputError()
			}
			if packet.Data != nil && *packet.Data != "" {
				if event != "352" {
					return openSpeechOutputError()
				}
				chunk, err := base64.StdEncoding.Strict().DecodeString(*packet.Data)
				if err != nil || len(output)+len(chunk) > 32<<20 {
					return openSpeechOutputError()
				}
				output = append(output, chunk...)
			}
		case 20000000:
			if event != "152" || packet.Data != nil && *packet.Data != "" || len(output) == 0 {
				return openSpeechOutputError()
			}
			done = true
		default:
			return openSpeechError(strconv.FormatInt(*packet.Code, 10))
		}
		data.Reset()
		event = ""
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if strings.HasPrefix(line, "data:") {
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
			continue
		}
		if strings.HasPrefix(line, "id:") {
			continue
		}
		return nil, openSpeechOutputError()
	}
	if err := scanner.Err(); err != nil {
		return nil, providerResponseReadError(err)
	}
	if limited.N == 0 {
		return nil, openSpeechOutputError()
	}
	if data.Len() > 0 {
		if err := flush(); err != nil {
			return nil, err
		}
	}
	if !done {
		return nil, openSpeechOutputError()
	}
	return output, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func parseOpenSpeechTranscript(data []byte, code string, timing bool, duration float64) (*runtimev1.SpeechTranscript, error) {
	if code != "20000000" && code != "20000003" {
		return nil, openSpeechError(code)
	}
	var out struct {
		Result *struct {
			Text       *string `json:"text"`
			Utterances []struct {
				Words []struct {
					Text  string `json:"text"`
					Start *int64 `json:"start_time"`
					End   *int64 `json:"end_time"`
				} `json:"words"`
			} `json:"utterances"`
		} `json:"result"`
	}
	if json.Unmarshal(data, &out) != nil {
		return nil, openSpeechOutputError()
	}
	result := &runtimev1.SpeechTranscript{}
	if code == "20000003" {
		if out.Result != nil && (out.Result.Text != nil && strings.TrimSpace(*out.Result.Text) != "" || len(out.Result.Utterances) > 0) {
			return nil, openSpeechOutputError()
		}
		result.Status = runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH
	} else {
		if out.Result == nil || out.Result.Text == nil || strings.TrimSpace(*out.Result.Text) == "" {
			return nil, openSpeechOutputError()
		}
		result.Status = runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED
		result.Text = strings.TrimSpace(*out.Result.Text)
		if timing {
			for _, utterance := range out.Result.Utterances {
				for _, word := range utterance.Words {
					if word.Start == nil || word.End == nil || *word.Start < 0 || *word.End < *word.Start || float64(*word.End)/1000 > duration+.001 {
						return nil, openSpeechOutputError()
					}
					result.Words = append(result.Words, &runtimev1.SpeechTranscriptWord{Text: word.Text, StartSeconds: float64(*word.Start) / 1000, EndSeconds: float64(*word.End) / 1000})
				}
			}
			if len(result.Words) == 0 {
				return nil, openSpeechOutputError()
			}
		}
	}
	if err := localexecution.ValidateSpeechTranscript(result, timing); err != nil {
		return nil, openSpeechOutputError()
	}
	return result, nil
}
