package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type cosyVoiceWord struct {
	Text      string `json:"text"`
	BeginTime *int64 `json:"begin_time"`
	EndTime   *int64 `json:"end_time"`
}
type cosyVoiceSentence struct {
	Index *int            `json:"index"`
	Words []cosyVoiceWord `json:"words"`
}
type cosyVoiceWordEvent struct {
	RequestID string `json:"request_id"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Output    struct {
		Type         string             `json:"type"`
		FinishReason string             `json:"finish_reason"`
		Sentence     *cosyVoiceSentence `json:"sentence"`
		Audio        struct {
			Data string `json:"data"`
			URL  string `json:"url"`
		} `json:"audio"`
	} `json:"output"`
}

func invalidCosyVoiceWordOutput() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r071
func executeCosyVoiceWordSynthesis(ctx context.Context, endpoint, apiKey, model string, spec *runtimev1.SpeechSynthesizeScenarioSpec, payload any) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if err := capabilitydriver.ValidateCosyVoiceWordRequest(model, spec); err != nil {
		return nil, nil, "", err
	}
	raw, err := marshalJSONRequestBody(payload)
	if err != nil {
		return nil, nil, "", err
	}
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, nil, "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("X-DashScope-SSE", "enable")
	request.Header.Set("Authorization", "Bearer "+apiKey)
	response, err := client.Do(request)
	if err != nil {
		return nil, nil, "", MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var body map[string]any
		_ = json.NewDecoder(io.LimitReader(response.Body, maxJSONOrBinaryResponseBytes)).Decode(&body)
		return nil, nil, "", MapProviderHTTPError(response.StatusCode, body)
	}
	if !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		return nil, nil, "", invalidCosyVoiceWordOutput()
	}
	audio, alignment, url, requestID, err := readCosyVoiceWordStream(ctx, response.Body)
	if err != nil {
		return nil, nil, requestID, err
	}
	mime := ResolveSpeechArtifactMIME(spec, audio)
	if len(audio) == 0 && url != "" {
		// SSE sentence-synthesis data is the documented ordered complete audio
		// stream after a valid stop. The optional final URL is used only when
		// no inline audio was supplied, under the existing endpoint policy.
		audio, mime, err = FetchAudioFromURI(ctx, url)
		if err != nil {
			return nil, nil, requestID, err
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, requestID, MapProviderRequestError(err)
	}
	if len(audio) == 0 {
		return nil, nil, requestID, invalidCosyVoiceWordOutput()
	}
	if !strings.HasPrefix(mime, "audio/") {
		mime = ResolveSpeechArtifactMIME(spec, audio)
	}
	if mime == "audio/wav" {
		audio, err = finishCosyVoiceWordWAV(audio)
		if err != nil {
			return nil, nil, requestID, invalidCosyVoiceWordOutput()
		}
	}
	artifact := BinaryArtifact(mime, audio, map[string]any{"adapter": AdapterAlibabaNative, "request_contract": "cosyvoice_speech_synthesizer"})
	artifact.SpeechAlignment = alignment
	ApplySpeechSpecMetadata(artifact, spec)
	blankTokens := 0
	for _, token := range alignment.Tokens {
		if strings.TrimSpace(token.Token) == "" {
			blankTokens++
		}
	}
	slog.Info("finite synthesis alignment received", "model", model, "audio_bytes", len(audio), "tokens", len(alignment.Tokens), "blank_tokens", blankTokens, "alignment_valid", capabilitydriver.SpeechAlignmentValid(alignment), "audio_prefix", string(audio[:min(4, len(audio))]))
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func readCosyVoiceWordStream(ctx context.Context, body io.Reader) ([]byte, *runtimev1.SpeechAlignment, string, string, error) {
	limited := &io.LimitedReader{R: body, N: maxJSONOrBinaryResponseBytes + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), maxJSONOrBinaryResponseBytes)
	alignment := &runtimev1.SpeechAlignment{Unit: runtimev1.SpeechAlignmentUnit_SPEECH_ALIGNMENT_UNIT_WORD}
	var audio []byte
	var eventData, requestID, finalURL string
	index := -1
	open, stopped := false, false
	consume := func() error {
		if eventData == "" {
			return nil
		}
		var e cosyVoiceWordEvent
		if json.Unmarshal([]byte(eventData), &e) != nil {
			return invalidCosyVoiceWordOutput()
		}
		eventData = ""
		if e.Code != "" {
			return MapProviderHTTPError(http.StatusBadRequest, map[string]any{"code": e.Code, "message": e.Message})
		}
		if e.RequestID != "" {
			if requestID != "" && requestID != e.RequestID {
				return invalidCosyVoiceWordOutput()
			}
			requestID = e.RequestID
		}
		if stopped {
			return invalidCosyVoiceWordOutput()
		}
		switch e.Output.Type {
		case "sentence-begin":
			if open || e.Output.Sentence == nil || e.Output.Sentence.Index == nil || *e.Output.Sentence.Index != index+1 {
				return invalidCosyVoiceWordOutput()
			}
			index++
			open = true
		case "sentence-synthesis":
			if !open {
				return invalidCosyVoiceWordOutput()
			}
		case "sentence-end":
			if !open || e.Output.Sentence == nil || e.Output.Sentence.Index == nil || *e.Output.Sentence.Index != index || len(e.Output.Sentence.Words) == 0 {
				return invalidCosyVoiceWordOutput()
			}
			for wordIndex, word := range e.Output.Sentence.Words {
				if word.Text == "" || word.BeginTime == nil || word.EndTime == nil || *word.BeginTime < 0 || *word.EndTime < *word.BeginTime || *word.EndTime > 1<<53-1 {
					return invalidCosyVoiceWordOutput()
				}
				// Provider times refer to the audio timeline. Never synthesize an
				// offset from audio length, reorder units or silently retime them.
				if n := len(alignment.Tokens); n > 0 && (*word.BeginTime < alignment.Tokens[n-1].StartMs || *word.EndTime < alignment.Tokens[n-1].EndMs) {
					return invalidCosyVoiceWordOutput()
				}
				if n := len(alignment.Tokens); wordIndex == 0 && n > 0 && *word.BeginTime < alignment.Tokens[n-1].EndMs {
					return invalidCosyVoiceWordOutput()
				}
				alignment.Tokens = append(alignment.Tokens, &runtimev1.SpeechAlignmentToken{Token: word.Text, StartMs: *word.BeginTime, EndMs: *word.EndTime})
			}
			open = false
		case "":
			if e.Output.FinishReason != "stop" {
				return invalidCosyVoiceWordOutput()
			}
		default:
			return invalidCosyVoiceWordOutput()
		}
		if e.Output.Sentence != nil && (e.Output.Sentence.Index == nil || *e.Output.Sentence.Index != index) {
			return invalidCosyVoiceWordOutput()
		}
		if e.Output.Audio.Data != "" {
			decoded, err := base64.StdEncoding.Strict().DecodeString(e.Output.Audio.Data)
			if err != nil || len(decoded) == 0 || len(audio)+len(decoded) > maxJSONOrBinaryResponseBytes {
				return invalidCosyVoiceWordOutput()
			}
			audio = append(audio, decoded...)
		}
		if e.Output.FinishReason == "stop" {
			if open || len(alignment.Tokens) == 0 {
				return invalidCosyVoiceWordOutput()
			}
			stopped = true
			finalURL = e.Output.Audio.URL
		} else if e.Output.FinishReason != "" && e.Output.FinishReason != "null" {
			return invalidCosyVoiceWordOutput()
		}
		return nil
	}
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return nil, nil, "", requestID, MapProviderRequestError(err)
		}
		line := scanner.Text()
		if line == "" {
			if err := consume(); err != nil {
				return nil, nil, "", requestID, err
			}
			if stopped {
				break
			}
		} else if strings.HasPrefix(line, "data:") {
			if eventData != "" {
				eventData += "\n"
			}
			eventData += strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
		}
	}
	if scanner.Err() != nil {
		return nil, nil, "", requestID, providerResponseReadError(scanner.Err())
	}
	if limited.N <= 0 {
		return nil, nil, "", requestID, invalidCosyVoiceWordOutput()
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, "", requestID, MapProviderRequestError(err)
	}
	if eventData != "" {
		if err := consume(); err != nil {
			return nil, nil, "", requestID, err
		}
	}
	if !stopped || (len(audio) == 0 && finalURL == "") {
		return nil, nil, "", requestID, invalidCosyVoiceWordOutput()
	}
	return audio, alignment, finalURL, requestID, nil
}
