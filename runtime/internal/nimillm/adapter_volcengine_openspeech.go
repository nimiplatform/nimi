package nimillm

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// AdapterBytedanceOpenSpeech is the adapter identifier for Bytedance OpenSpeech TTS/STT.
const AdapterBytedanceOpenSpeech = "bytedance_openspeech_adapter"

const bytedanceOpenSpeechMaxInlineAudioBytes = 10 << 20

// ExecuteBytedanceOpenSpeech handles TTS and STT scenario jobs via the Bytedance
// OpenSpeech API. It replaces the former Service.executeBytedanceOpenSpeech
// method, accepting a MediaAdapterConfig instead of reading from service config.
func ExecuteBytedanceOpenSpeech(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_TTS:
		spec := scenarioSpeechSynthesizeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload := map[string]any{
			"model":       modelResolved,
			"text":        spec.GetText(),
			"voice":       scenarioVoiceRef(spec),
			"language":    spec.GetLanguage(),
			"emotion":     spec.GetEmotion(),
			"speed":       spec.GetSpeed(),
			"pitch":       spec.GetPitch(),
			"volume":      spec.GetVolume(),
			"sample_rate": spec.GetSampleRateHz(),
		}
		if spec.GetAudioFormat() != "" {
			payload["format"] = spec.GetAudioFormat()
		}
		if opts := scenarioExtensionPayloadForScenario(req); len(opts) > 0 {
			payload["extensions"] = opts
		}
		body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, "/api/v1/tts"), apiKey, payload, nil)
		if err != nil {
			return nil, nil, "", err
		}
		artifact := BinaryArtifact(ResolveSpeechArtifactMIME(spec, body.Bytes), body.Bytes, map[string]any{
			"adapter":    AdapterBytedanceOpenSpeech,
			"voice":      scenarioVoiceRef(spec),
			"language":   spec.GetLanguage(),
			"emotion":    spec.GetEmotion(),
			"extensions": scenarioExtensionPayloadForScenario(req),
			"mime_type":  body.MIME,
		})
		ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), body.Bytes, 120), "", nil

	case runtimev1.Modal_MODAL_STT:
		spec := scenarioSpeechTranscribeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, resolveErr := ResolveTranscriptionAudioSource(ctx, spec)
		if resolveErr != nil {
			return nil, nil, "", resolveErr
		}
		scenarioExtensions := scenarioExtensionPayloadForScenario(req)
		if shouldUseBytedanceOpenSpeechWS(spec, scenarioExtensions) {
			text, wsRaw, wsErr := executeBytedanceOpenSpeechWS(ctx, baseURL, apiKey, modelResolved, spec, audioBytes, mimeType, scenarioExtensions)
			if wsErr != nil {
				return nil, nil, "", wsErr
			}
			artifactMeta := map[string]any{
				"text":            text,
				"adapter":         AdapterBytedanceOpenSpeech,
				"transport":       "ws",
				"mime_type":       mimeType,
				"audio_uri":       audioURI,
				"response_format": spec.GetResponseFormat(),
				"extensions":      scenarioExtensions,
			}
			if len(wsRaw) > 0 {
				artifactMeta["ws_response"] = wsRaw
			}
			artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), artifactMeta)
			ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
			return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
		}
		payload := map[string]any{
			"model":           modelResolved,
			"mime_type":       mimeType,
			"audio_base":      base64.StdEncoding.EncodeToString(audioBytes),
			"timestamps":      spec.GetTimestamps(),
			"diarization":     spec.GetDiarization(),
			"speaker_count":   spec.GetSpeakerCount(),
			"prompt":          spec.GetPrompt(),
			"response_format": spec.GetResponseFormat(),
		}
		if spec.GetLanguage() != "" {
			payload["language"] = spec.GetLanguage()
		}
		if len(audioBytes) > bytedanceOpenSpeechMaxInlineAudioBytes {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if len(scenarioExtensions) > 0 {
			opts := scenarioExtensions
			payload["extensions"] = opts
		}
		body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, "/api/v3/auc/bigmodel/recognize/flash"), apiKey, payload, nil)
		if err != nil {
			return nil, nil, "", err
		}
		text := strings.TrimSpace(body.Text)
		if text == "" {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":            text,
			"adapter":         AdapterBytedanceOpenSpeech,
			"mime_type":       mimeType,
			"audio_uri":       audioURI,
			"response_format": spec.GetResponseFormat(),
			"extensions":      scenarioExtensions,
		})
		ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil

	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

// ---------------------------------------------------------------------------
// WebSocket-based STT helpers (package-private)
// ---------------------------------------------------------------------------

func shouldUseBytedanceOpenSpeechWS(spec *runtimev1.SpeechTranscribeScenarioSpec, scenarioExtensions map[string]any) bool {
	if spec == nil {
		return false
	}
	if ValueAsBool(FirstNonNil(scenarioExtensions["prefer_ws"], scenarioExtensions["use_ws"], scenarioExtensions["websocket"])) {
		return true
	}
	transport := strings.ToLower(strings.TrimSpace(ValueAsString(scenarioExtensions["transport"])))
	if transport == "ws" || transport == "websocket" {
		return true
	}
	if source := spec.GetAudioSource(); source != nil {
		if chunks := source.GetAudioChunks(); chunks != nil && len(chunks.GetChunks()) > 0 {
			return true
		}
	}
	return false
}

func executeBytedanceOpenSpeechWS(
	ctx context.Context,
	baseURL string,
	apiKey string,
	modelResolved string,
	spec *runtimev1.SpeechTranscribeScenarioSpec,
	audioBytes []byte,
	mimeType string,
	scenarioExtensions map[string]any,
) (string, map[string]any, error) {
	targetURL := resolveBytedanceOpenSpeechWSURL(baseURL, scenarioExtensions)
	if targetURL == "" {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	config, err := websocket.NewConfig(targetURL, websocketOrigin(targetURL))
	if err != nil {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	config.Header = http.Header{}
	config.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		config.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	connection, err := websocket.DialConfig(config)
	if err != nil {
		return "", nil, MapProviderRequestError(err)
	}
	defer connection.Close()

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = connection.Close()
		case <-done:
		}
	}()
	defer close(done)

	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}

	chunks := transcriptionAudioChunks(spec)
	if len(chunks) == 0 {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	startPayload := map[string]any{
		"event":           "start",
		"model":           modelResolved,
		"mime_type":       mimeType,
		"language":        strings.TrimSpace(spec.GetLanguage()),
		"timestamps":      spec.GetTimestamps(),
		"diarization":     spec.GetDiarization(),
		"speaker_count":   spec.GetSpeakerCount(),
		"prompt":          strings.TrimSpace(spec.GetPrompt()),
		"response_format": strings.TrimSpace(spec.GetResponseFormat()),
		"extensions":      scenarioExtensions,
	}
	if err := websocket.JSON.Send(connection, startPayload); err != nil {
		return "", nil, MapProviderRequestError(err)
	}
	for index, chunk := range chunks {
		if len(chunk) == 0 {
			continue
		}
		frame := map[string]any{
			"event":        "audio",
			"seq":          index + 1,
			"audio_base64": base64.StdEncoding.EncodeToString(chunk),
		}
		if err := websocket.JSON.Send(connection, frame); err != nil {
			return "", nil, MapProviderRequestError(err)
		}
	}
	if err := websocket.JSON.Send(connection, map[string]any{"event": "finish"}); err != nil {
		return "", nil, MapProviderRequestError(err)
	}

	readTimeout := 4 * time.Second
	if rawTimeout := ValueAsInt64(FirstNonNil(scenarioExtensions["ws_read_timeout_ms"], scenarioExtensions["read_timeout_ms"])); rawTimeout > 0 {
		readTimeout = time.Duration(rawTimeout) * time.Millisecond
	}
	messageCount := 0
	lastStatus := ""
	finalText := ""
	var deltaBuilder strings.Builder
	responsePayload := map[string]any{}

	for {
		if ctx.Err() != nil {
			return "", responsePayload, MapProviderRequestError(ctx.Err())
		}
		_ = connection.SetReadDeadline(computeWSReadDeadline(ctx, readTimeout))
		var payload map[string]any
		if receiveErr := websocket.JSON.Receive(connection, &payload); receiveErr != nil {
			if errors.Is(receiveErr, io.EOF) {
				break
			}
			if isNetworkTimeout(receiveErr) {
				if finalText != "" || strings.TrimSpace(deltaBuilder.String()) != "" {
					break
				}
				return "", responsePayload, grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
			}
			return "", responsePayload, MapProviderRequestError(receiveErr)
		}
		messageCount++
		responsePayload = payload

		errorMessage := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(payload["error"]),
			ValueAsString(payload["error_message"]),
			ValueAsString(MapField(payload["error"], "message")),
			ValueAsString(MapField(payload["result"], "error")),
		))
		if errorMessage != "" {
			return "", responsePayload, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		if delta := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(payload["delta"]),
			ValueAsString(payload["partial_text"]),
			ValueAsString(MapField(payload["result"], "delta")),
		)); delta != "" {
			deltaBuilder.WriteString(delta)
		}
		if text := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(payload["text"]),
			ValueAsString(payload["final_text"]),
			ValueAsString(MapField(payload["result"], "text")),
		)); text != "" {
			finalText = text
		}
		lastStatus = strings.ToLower(strings.TrimSpace(FirstNonEmpty(
			ValueAsString(payload["status"]),
			ValueAsString(MapField(payload["result"], "status")),
		)))
		doneFlag := ValueAsBool(FirstNonNil(payload["done"], MapField(payload["result"], "done")))
		if lastStatus == "failed" || lastStatus == "error" {
			return "", responsePayload, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		if doneFlag || lastStatus == "completed" || lastStatus == "finished" || lastStatus == "done" {
			break
		}
	}

	if strings.TrimSpace(finalText) == "" {
		finalText = strings.TrimSpace(deltaBuilder.String())
	}
	if finalText == "" {
		return "", responsePayload, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return finalText, map[string]any{
		"status":        lastStatus,
		"message_count": messageCount,
		"transport":     "ws",
		"response":      responsePayload,
	}, nil
}

func computeWSReadDeadline(ctx context.Context, readTimeout time.Duration) time.Time {
	now := time.Now().UTC()
	deadline := now.Add(readTimeout)
	if ctxDeadline, hasDeadline := ctx.Deadline(); hasDeadline && ctxDeadline.Before(deadline) {
		return ctxDeadline
	}
	return deadline
}

func resolveBytedanceOpenSpeechWSURL(baseURL string, scenarioExtensions map[string]any) string {
	if explicitURL := strings.TrimSpace(ValueAsString(scenarioExtensions["ws_url"])); explicitURL != "" {
		baseParsed, baseErr := url.Parse(strings.TrimSpace(baseURL))
		explicitParsed, explicitErr := url.Parse(explicitURL)
		if baseErr != nil || explicitErr != nil || baseParsed == nil || explicitParsed == nil {
			return ""
		}
		if !explicitParsed.IsAbs() {
			return resolveBytedanceOpenSpeechWSURL(baseURL, map[string]any{"ws_path": explicitURL})
		}
		if !strings.EqualFold(strings.TrimSpace(baseParsed.Host), strings.TrimSpace(explicitParsed.Host)) {
			return ""
		}
		return explicitParsed.String()
	}
	wsPath := strings.TrimSpace(ValueAsString(scenarioExtensions["ws_path"]))
	if wsPath == "" {
		wsPath = "/api/v3/auc/bigmodel/recognize/stream"
	}
	httpURL := JoinURL(baseURL, wsPath)
	parsed, err := url.Parse(httpURL)
	if err != nil || parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return ""
	}
	switch parsed.Scheme {
	case "wss", "https":
		parsed.Scheme = "wss"
	default:
		parsed.Scheme = "ws"
	}
	return parsed.String()
}

func websocketOrigin(targetURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil || parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return "http://localhost/"
	}
	if parsed.Scheme == "wss" {
		return "https://" + parsed.Host + "/"
	}
	return "http://" + parsed.Host + "/"
}

func transcriptionAudioChunks(spec *runtimev1.SpeechTranscribeScenarioSpec) [][]byte {
	if spec != nil {
		if source := spec.GetAudioSource(); source != nil {
			if chunks := source.GetAudioChunks(); chunks != nil {
				collected := make([][]byte, 0, len(chunks.GetChunks()))
				for _, chunk := range chunks.GetChunks() {
					if len(chunk) == 0 {
						continue
					}
					collected = append(collected, append([]byte(nil), chunk...))
				}
				if len(collected) > 0 {
					return collected
				}
			}
		}
	}
	return nil
}

func isNetworkTimeout(err error) bool {
	if err == nil {
		return false
	}
	timeoutError, ok := err.(net.Error)
	return ok && timeoutError.Timeout()
}
