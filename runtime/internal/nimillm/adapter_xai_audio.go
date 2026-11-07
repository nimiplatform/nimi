package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

func xaiAudioOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func ExecuteXAISpeech(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "xai")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetSpeechSynthesize()
	output := map[string]any{"codec": s.GetAudioFormat(), "sample_rate": s.GetSampleRateHz()}
	if s.GetAudioFormat() == "mp3" {
		output["bit_rate"] = 128000
	}
	// The fixed operation has no native model parameter. Do not send the
	// catalog's operation identity or silently substitute a voice model.
	body := map[string]any{"text": s.GetText(), "voice_id": s.GetVoiceRef().GetPresetVoiceId(), "language": s.GetLanguage(), "output_format": output, "with_timestamps": false, "text_normalization": false}
	if s.Speed != nil {
		body["speed"] = s.GetSpeed()
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/tts", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	contentType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	expected := map[string]string{"mp3": "audio/mpeg", "wav": "audio/wav", "pcm": "audio/pcm", "mulaw": "audio/basic", "alaw": "audio/alaw"}[s.GetAudioFormat()]
	if err != nil || contentType != expected {
		return nil, nil, "", xaiAudioOutputError()
	}
	audio, err := readLimitedResponseBody(response.Body, 32<<20)
	if err != nil {
		return nil, nil, "", err
	}
	artifact, err := nativeSpeechArtifact(ctx, audio, s.GetAudioFormat(), s.GetSampleRateHz(), map[string]any{"adapter": capabilitydriver.CloudMediaAdapterXAISpeech})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func ExecuteXAITranscribe(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	s := req.GetSpec().GetSpeechTranscribe()
	audio := s.GetAudioSource().GetAudioBytes()
	duration, err := nativeSpeechRecordingDuration(ctx, audio, s.GetMimeType())
	if err != nil {
		return nil, nil, "", err
	}
	b, err := nativeMediaBackend(ctx, cfg, "xai")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := [][2]string{{"model", model}, {"diarize", strconv.FormatBool(s.GetDiarization())}, {"format", "false"}, {"multichannel", "false"}}
	if s.GetLanguage() != "" {
		fields = append(fields, [2]string{"language", s.GetLanguage()})
	}
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, nil, "", err
		}
	}
	filename := "recording.wav"
	if s.GetMimeType() == "audio/mpeg" {
		filename = "recording.mp3"
	}
	// xAI requires the file part last, after every operation parameter.
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, nil, "", err
	}
	if _, err := part.Write(audio); err != nil {
		return nil, nil, "", err
	}
	if err := writer.Close(); err != nil {
		return nil, nil, "", err
	}
	request, err := b.newRequest(ctx, http.MethodPost, JoinURL(b.baseURL, "/v1/stt"), &body)
	if err != nil {
		return nil, nil, "", err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")
	response, err := b.do(request)
	if err != nil {
		return nil, nil, "", MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, nil, "", MapProviderHTTPError(response.StatusCode, nil)
	}
	raw, err := readLimitedResponseBody(response.Body, 32<<20)
	if err != nil {
		return nil, nil, "", err
	}
	transcript, err := parseXAITranscript(raw, s.GetTimestamps(), s.GetDiarization(), duration)
	if err != nil {
		return nil, nil, "", err
	}
	data, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterXAITranscribe})}, nil, "", nil
}

func parseXAITranscript(raw []byte, timing, diarize bool, duration float64) (*runtimev1.SpeechTranscript, error) {
	var out struct {
		Text     *string           `json:"text"`
		Language string            `json:"language"`
		Duration *float64          `json:"duration"`
		Channels []json.RawMessage `json:"channels"`
		Words    []struct {
			Text    string   `json:"text"`
			Start   *float64 `json:"start"`
			End     *float64 `json:"end"`
			Speaker *int64   `json:"speaker"`
		} `json:"words"`
	}
	if json.Unmarshal(raw, &out) != nil || out.Text == nil || out.Duration == nil || !(*out.Duration > 0) || len(out.Channels) != 0 || len(out.Words) > localexecution.MaxSpeechTranscriptWords {
		return nil, xaiAudioOutputError()
	}
	result := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: strings.TrimSpace(*out.Text), Language: out.Language}
	if diarize {
		result.Diarization = &runtimev1.SpeechDiarization{Status: runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_DIARIZED, DurationSeconds: duration}
	}
	if result.Text == "" {
		if len(out.Words) != 0 {
			return nil, xaiAudioOutputError()
		}
		result.Status = runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH
		result.Language = ""
		if diarize {
			result.Diarization.Status = runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_NO_SPEAKERS
		}
	}
	// Validate the provider's alignment once before selecting the requested
	// projection. Speaker labels denote this recording's words, never identity.
	previousStart := float64(0)
	for _, word := range out.Words {
		if strings.TrimSpace(word.Text) == "" || word.Start == nil || word.End == nil || *word.Start < previousStart || *word.End < *word.Start || *word.End > duration || *word.End > *out.Duration+.01 || word.Speaker != nil && *word.Speaker < 0 {
			return nil, xaiAudioOutputError()
		}
		previousStart = *word.Start
		if timing {
			result.Words = append(result.Words, &runtimev1.SpeechTranscriptWord{Text: word.Text, StartSeconds: *word.Start, EndSeconds: *word.End})
		}
		if diarize {
			if word.Speaker == nil {
				return nil, xaiAudioOutputError()
			}
			result.Diarization.Intervals = append(result.Diarization.Intervals, &runtimev1.SpeechSpeakerInterval{SpeakerId: strconv.FormatInt(*word.Speaker, 10), StartSeconds: *word.Start, EndSeconds: *word.End})
		}
	}
	if err := localexecution.ValidateSpeechTranscript(result, timing); err != nil {
		return nil, xaiAudioOutputError()
	}
	return result, nil
}
