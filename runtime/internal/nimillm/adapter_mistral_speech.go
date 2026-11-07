package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func mistralSpeechPayload(model string, s *runtimev1.SpeechSynthesizeScenarioSpec, stream bool) map[string]any {
	return map[string]any{"model": model, "input": s.GetText(), "voice_id": scenarioVoiceRef(s), "response_format": s.GetAudioFormat(), "stream": stream}
}
func mistralSpeechAudio(ctx context.Context, audio []byte, format string) (string, int64, error) {
	if len(audio) == 0 || len(audio) > maxJSONOrBinaryResponseBytes {
		return "", 0, mistralAudioInvalidOutput()
	}
	if format == "wav" {
		rate, size, align, channels, err := inspectFinitePCMWAV(audio)
		if err == nil && rate == 24000 && channels == 1 {
			return "audio/wav", int64(size) * 1000 / int64(uint64(rate)*uint64(align)), nil
		}
	} else if format == "mp3" {
		rate, duration, valid := inspectCompleteMP3(ctx, audio)
		if valid && rate == 24000 {
			return "audio/mpeg", int64(duration * 1000), nil
		}
	}
	if ctx.Err() != nil {
		return "", 0, ctx.Err()
	}
	return "", 0, mistralAudioInvalidOutput()
}
func (p *CloudProvider) executeMistralSpeech(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, model string, target *RemoteTarget) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	backend, resolved := p.ResolveMediaBackendWithTarget(model, target)
	if backend == nil || resolved == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	s := req.GetSpec().GetSpeechSynthesize()
	var response struct {
		AudioData *string `json:"audio_data"`
	}
	if err := backend.postJSON(ctx, "/v1/audio/speech", mistralSpeechPayload(resolved, s, false), &response); err != nil {
		return nil, nil, "", err
	}
	if response.AudioData == nil || base64.StdEncoding.DecodedLen(len(*response.AudioData)) > maxJSONOrBinaryResponseBytes {
		return nil, nil, "", mistralAudioInvalidOutput()
	}
	audio, err := base64.StdEncoding.Strict().DecodeString(*response.AudioData)
	if err != nil {
		return nil, nil, "", mistralAudioInvalidOutput()
	}
	mimeType, duration, err := mistralSpeechAudio(ctx, audio, s.GetAudioFormat())
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact(mimeType, audio, map[string]any{"adapter": "mistral_speech_adapter"})
	artifact.SampleRateHz, artifact.DurationMs = 24000, duration
	if s.GetAudioFormat() == "wav" {
		artifact.Channels = 1
	}
	// SpeechResponse contains audio_data only. No token or audio-time usage is
	// invented for the nonstream API.
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

// StreamMistralSpeech is chosen by the frozen media adapter, never inferred from
// a caller model string. Native chunks concatenate to one file, with success
// requiring speech.audio.done and a valid complete audio payload.
func (b *Backend) StreamMistralSpeech(ctx context.Context, model string, s *runtimev1.SpeechSynthesizeScenarioSpec, _ map[string]any, onChunk func(SpeechStreamChunk) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	fail := func(err error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	if b == nil || s == nil || onChunk == nil {
		return fail(grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID))
	}
	payload, err := json.Marshal(mistralSpeechPayload(model, s, true))
	if err != nil {
		return fail(err)
	}
	request, err := b.newRequest(ctx, http.MethodPost, JoinURL(b.baseURL, "/v1/audio/speech"), bytes.NewReader(payload))
	if err != nil {
		return fail(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	response, err := b.do(request)
	if err != nil {
		return fail(MapProviderRequestError(err))
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	if response.StatusCode != http.StatusOK {
		_, err := providerHTTPErrorFromResponse(response, request.URL.String())
		return fail(err)
	}
	contentType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || contentType != "text/event-stream" {
		return fail(mistralAudioInvalidOutput())
	}
	limited := &io.LimitedReader{R: response.Body, N: 2*maxJSONOrBinaryResponseBytes + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), maxJSONOrBinaryResponseBytes)
	var complete []byte
	var data strings.Builder
	var eventName string
	var sequence uint64
	var usage *runtimev1.UsageStats
	done := false
	consume := func() error {
		if data.Len() == 0 {
			eventName = ""
			return nil
		}
		var event struct {
			Type      string             `json:"type"`
			AudioData *string            `json:"audio_data"`
			Usage     *mistralAudioUsage `json:"usage"`
		}
		if json.Unmarshal([]byte(data.String()), &event) != nil || eventName != "" && eventName != event.Type {
			return mistralAudioInvalidOutput()
		}
		data.Reset()
		eventName = ""
		switch event.Type {
		case "speech.audio.delta":
			if event.AudioData == nil || len(*event.AudioData) == 0 || len(*event.AudioData) > base64.StdEncoding.EncodedLen(maxJSONOrBinaryResponseBytes-len(complete)) {
				return mistralAudioInvalidOutput()
			}
			audio, err := base64.StdEncoding.Strict().DecodeString(*event.AudioData)
			if err != nil || len(audio) == 0 || len(audio) > maxJSONOrBinaryResponseBytes-len(complete) {
				return mistralAudioInvalidOutput()
			}
			complete = append(complete, audio...)
			sequence++
			mimeType := "audio/wav"
			if s.GetAudioFormat() == "mp3" {
				mimeType = "audio/mpeg"
			}
			return onChunk(SpeechStreamChunk{Sequence: sequence, Bytes: audio, MIMEType: mimeType, SampleRateHz: 24000})
		case "speech.audio.done":
			if _, _, err := mistralSpeechAudio(ctx, complete, s.GetAudioFormat()); err != nil {
				return err
			}
			var err error
			usage, err = event.Usage.normalize()
			if err != nil {
				return err
			}
			done = true
			return nil
		case "error":
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		default:
			return mistralAudioInvalidOutput()
		}
	}
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return fail(err)
		}
		if limited.N <= 0 {
			return fail(mistralAudioInvalidOutput())
		}
		line := scanner.Text()
		if line == "" {
			if err := consume(); err != nil {
				return fail(err)
			}
			if done {
				return usage, runtimev1.FinishReason_FINISH_REASON_STOP, nil
			}
		} else if strings.HasPrefix(line, "data:") {
			if data.Len() != 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
			if data.Len() > maxJSONOrBinaryResponseBytes {
				return fail(mistralAudioInvalidOutput())
			}
		} else if strings.HasPrefix(line, "event:") {
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if !strings.HasPrefix(line, ":") && !strings.HasPrefix(line, "id:") && !strings.HasPrefix(line, "retry:") {
			return fail(mistralAudioInvalidOutput())
		}
	}
	if ctx.Err() != nil {
		return fail(ctx.Err())
	}
	// The final SSE event may end at EOF rather than a trailing blank line.
	if scanner.Err() == nil && limited.N > 0 {
		if err := consume(); err != nil {
			return fail(err)
		}
		if done {
			return usage, runtimev1.FinishReason_FINISH_REASON_STOP, nil
		}
	}
	return fail(grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_STREAM_BROKEN))
}
