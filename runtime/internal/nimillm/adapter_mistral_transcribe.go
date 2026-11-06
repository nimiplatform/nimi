package nimillm

import (
	"bytes"
	"context"
	"math"
	"mime/multipart"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

type mistralAudioUsage struct {
	PromptTokens       *int64   `json:"prompt_tokens"`
	CompletionTokens   *int64   `json:"completion_tokens"`
	TotalTokens        *int64   `json:"total_tokens"`
	PromptAudioSeconds *float64 `json:"prompt_audio_seconds"`
}

func (u *mistralAudioUsage) normalize() (*runtimev1.UsageStats, error) {
	if u == nil || u.PromptTokens == nil || u.CompletionTokens == nil || u.TotalTokens == nil || *u.PromptTokens < 0 || *u.CompletionTokens < 0 || *u.TotalTokens < 0 || u.PromptAudioSeconds != nil && (math.IsNaN(*u.PromptAudioSeconds) || math.IsInf(*u.PromptAudioSeconds, 0) || *u.PromptAudioSeconds < 0) {
		return nil, mistralAudioInvalidOutput()
	}
	// These are the provider's prompt/completion counters. Do not estimate
	// tokens from bytes or add a modality detail to an undocumented total.
	return &runtimev1.UsageStats{InputTokens: *u.PromptTokens, OutputTokens: *u.CompletionTokens}, nil
}
func mistralAudioInvalidOutput() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func mistralRecordingDuration(ctx context.Context, audio []byte, mimeType string) (float64, error) {
	if mimeType == "audio/wav" {
		rate, size, align, _, err := inspectFinitePCMWAV(audio)
		if err == nil {
			return float64(size) / float64(uint64(rate)*uint64(align)), nil
		}
	} else if mimeType == "audio/mpeg" {
		_, duration, valid := inspectCompleteMP3(ctx, audio)
		if valid {
			return duration, nil
		}
	}
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func (p *CloudProvider) executeMistralTranscriptions(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, model string, target *RemoteTarget) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	backend, resolved := p.ResolveMediaBackendWithTarget(model, target)
	if backend == nil || resolved == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	s := req.GetSpec().GetSpeechTranscribe()
	audio := s.GetAudioSource().GetAudioBytes()
	duration, err := mistralRecordingDuration(ctx, audio, s.GetMimeType())
	if err != nil {
		return nil, nil, "", err
	}
	fields := [][2]string{{"model", resolved}, {"stream", "false"}}
	if s.GetLanguage() != "" {
		fields = append(fields, [2]string{"language", s.GetLanguage()})
	} else {
		fields = append(fields, [2]string{"return_language", "true"})
	}
	if s.GetPrompt() != "" {
		fields = append(fields, [2]string{"context_bias", s.GetPrompt()})
	}
	if s.GetDiarization() {
		fields = append(fields, [2]string{"diarize", "true"}, [2]string{"timestamp_granularities", "segment"})
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, nil, "", err
		}
	}
	filename := "recording.wav"
	if s.GetMimeType() == "audio/mpeg" {
		filename = "recording.mp3"
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, nil, "", err
	}
	if _, err = part.Write(audio); err != nil {
		return nil, nil, "", err
	}
	if err = writer.Close(); err != nil {
		return nil, nil, "", err
	}
	request, err := backend.newRequest(ctx, http.MethodPost, JoinURL(backend.baseURL, "/v1/audio/transcriptions"), &body)
	if err != nil {
		return nil, nil, "", err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")
	response, err := backend.do(request)
	if err != nil {
		return nil, nil, "", MapProviderRequestError(err)
	}
	defer response.Body.Close()
	var out struct {
		Model    string             `json:"model"`
		Text     *string            `json:"text"`
		Language *string            `json:"language"`
		Usage    *mistralAudioUsage `json:"usage"`
		Segments []struct {
			Type      string   `json:"type"`
			Text      *string  `json:"text"`
			Start     *float64 `json:"start"`
			End       *float64 `json:"end"`
			SpeakerID *string  `json:"speaker_id"`
		} `json:"segments"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", err
	}
	// The current guide reports the major-version identifier in responses even
	// when the catalog target is an exact major.minor code.
	if out.Model != resolved && out.Model != strings.TrimSuffix(resolved, "-0") || out.Text == nil || strings.TrimSpace(*out.Text) == "" {
		return nil, nil, "", mistralAudioInvalidOutput()
	}
	usage, err := out.Usage.normalize()
	if err != nil {
		return nil, nil, "", err
	}
	transcript := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: strings.TrimSpace(*out.Text)}
	if out.Language != nil {
		if len(*out.Language) != 2 || (*out.Language)[0] < 'a' || (*out.Language)[0] > 'z' || (*out.Language)[1] < 'a' || (*out.Language)[1] > 'z' {
			return nil, nil, "", mistralAudioInvalidOutput()
		}
		transcript.Language = *out.Language
	}
	if s.GetDiarization() {
		if len(out.Segments) == 0 {
			return nil, nil, "", mistralAudioInvalidOutput()
		}
		diarization := &runtimev1.SpeechDiarization{Status: runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_DIARIZED, DurationSeconds: duration}
		for _, segment := range out.Segments {
			if segment.Type != "transcription_segment" || segment.Text == nil || segment.Start == nil || segment.End == nil || segment.SpeakerID == nil || strings.TrimSpace(*segment.SpeakerID) == "" {
				return nil, nil, "", mistralAudioInvalidOutput()
			}
			diarization.Intervals = append(diarization.Intervals, &runtimev1.SpeechSpeakerInterval{SpeakerId: *segment.SpeakerID, StartSeconds: *segment.Start, EndSeconds: *segment.End})
		}
		transcript.Diarization = diarization
	}
	if err := localexecution.ValidateSpeechTranscript(transcript, false); err != nil {
		return nil, nil, "", mistralAudioInvalidOutput()
	}
	data, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", mistralAudioInvalidOutput()
	}
	metadata := map[string]any{"adapter": "mistral_transcriptions_adapter"}
	if out.Usage.PromptAudioSeconds != nil {
		metadata["provider_usage_seconds"] = *out.Usage.PromptAudioSeconds
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, data, metadata)}, usage, "", nil
}
