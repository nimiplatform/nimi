package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"
)

const (
	dashScopeRealtimeTTSPath           = "/api-ws/v1/inference"
	dashScopeRealtimeTTSDefaultTimeout = 45 * time.Second
)

func (b *Backend) shouldUseDashScopeRealtimeTTS(modelID string) bool {
	if b == nil || !b.isDashScopeBackend() {
		return false
	}
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	return strings.HasPrefix(normalized, "cosyvoice-")
}

func (b *Backend) isDashScopeBackend() bool {
	if b == nil {
		return false
	}
	name := strings.ToLower(strings.TrimSpace(b.Name))
	if strings.Contains(name, "dashscope") {
		return true
	}
	parsed, err := url.Parse(strings.TrimSpace(b.baseURL))
	if err != nil || parsed == nil {
		return false
	}
	return strings.Contains(strings.ToLower(parsed.Hostname()), "dashscope") ||
		strings.Contains(strings.ToLower(parsed.Hostname()), "maas.aliyuncs.com")
}

func (b *Backend) streamDashScopeRealtimeTTS(
	ctx context.Context,
	modelID string,
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	scenarioExtensions map[string]any,
	onChunk func(SpeechStreamChunk) error,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if b == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if spec == nil || strings.TrimSpace(spec.GetText()) == "" {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if onChunk == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	apiKey, err := requireProviderAPIKey(b.apiKey)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	targetURL := resolveDashScopeRealtimeTTSWebSocketURL(b.baseURL)
	if targetURL == "" {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err := validateDashScopeRealtimeTTSWebSocketURL(ctx, targetURL, b.allowLoopbackEndpoint); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	config, err := websocket.NewConfig(targetURL, websocketOrigin(targetURL))
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "provider streaming endpoint configuration is invalid"},
		)
	}
	config.Header = http.Header{}
	for key, value := range b.headers {
		headerName := strings.TrimSpace(key)
		headerValue := strings.TrimSpace(value)
		if headerName == "" || headerValue == "" || !allowProviderRequestHeader(headerName) {
			continue
		}
		config.Header.Set(headerName, headerValue)
	}
	config.Header.Set("Authorization", "Bearer "+apiKey)

	connection, err := websocket.DialConfig(config)
	if err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}
	defer func() { _ = connection.Close() }()
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = connection.Close()
		case <-done:
		}
	}()
	defer close(done)

	startedAt := time.Now()
	taskID := strings.ToLower(ulid.Make().String())
	if err := websocket.JSON.Send(connection, dashScopeRealtimeTTSRunTaskPayload(taskID, modelID, spec, scenarioExtensions)); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}
	if err := dashScopeRealtimeTTSWaitForTaskStarted(ctx, connection); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	if err := websocket.JSON.Send(connection, dashScopeRealtimeTTSContinueTaskPayload(taskID, spec.GetText())); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}
	if err := websocket.JSON.Send(connection, dashScopeRealtimeTTSFinishTaskPayload(taskID)); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, MapProviderRequestError(err)
	}

	mimeType := ResolveSpeechArtifactMIME(spec, nil)
	readTimeout := dashScopeRealtimeTTSReadTimeout(scenarioExtensions)
	var sequence uint64
	var totalBytes int64
	var usageCharacters int64
	for {
		payload, event, binary, err := receiveDashScopeRealtimeTTSFrame(ctx, connection, readTimeout)
		if err != nil {
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
		}
		if len(binary) > 0 {
			sequence++
			totalBytes += int64(len(binary))
			if err := onChunk(SpeechStreamChunk{
				Sequence:     sequence,
				MIMEType:     mimeType,
				SampleRateHz: spec.GetSampleRateHz(),
				TraceID:      strings.TrimSpace(ValueAsString(MapField(event.header, "request_uuid"))),
				Bytes:        append([]byte(nil), binary...),
			}); err != nil {
				return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
			}
			continue
		}
		switch event.name {
		case "task-finished":
			usageCharacters = dashScopeRealtimeTTSUsageCharacters(payload)
			if sequence == 0 || totalBytes == 0 {
				return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			usage := &runtimev1.UsageStats{
				InputTokens:  MaxInt64(EstimateTokens(spec.GetText()), usageCharacters),
				OutputTokens: MaxInt64(1, (totalBytes+3)/4),
				ComputeMs:    time.Since(startedAt).Milliseconds(),
			}
			return usage, runtimev1.FinishReason_FINISH_REASON_STOP, nil
		case "task-failed":
			return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, dashScopeRealtimeTTSError(event.header)
		case "", "result-generated":
			continue
		default:
			continue
		}
	}
}

type dashScopeRealtimeTTSEvent struct {
	name   string
	header map[string]any
}

func dashScopeRealtimeTTSRunTaskPayload(taskID string, modelID string, spec *runtimev1.SpeechSynthesizeScenarioSpec, scenarioExtensions map[string]any) map[string]any {
	parameters := map[string]any{
		"text_type": "PlainText",
		"voice":     strings.TrimSpace(scenarioVoiceRef(spec)),
	}
	if format := strings.TrimSpace(spec.GetAudioFormat()); format != "" {
		parameters["format"] = format
	}
	if sampleRateHz := spec.GetSampleRateHz(); sampleRateHz > 0 {
		parameters["sample_rate"] = sampleRateHz
	}
	if volume := spec.GetVolume(); volume > 0 {
		parameters["volume"] = volume
	}
	if speed := scenarioSpeechSpeed(spec); speed > 0 {
		parameters["rate"] = speed
	}
	if pitch := spec.GetPitch(); pitch > 0 {
		parameters["pitch"] = pitch
	}
	if instruction := dashScopeCosyVoiceInstruction(scenarioExtensions); instruction != "" {
		parameters["instruction"] = instruction
	}
	if hints := dashScopeCosyVoiceLanguageHints(spec, scenarioExtensions); len(hints) > 0 {
		parameters["language_hints"] = hints
	}
	if ValueAsBool(FirstNonNil(scenarioExtensions["enable_ssml"], scenarioExtensions["enableSSML"])) {
		parameters["enable_ssml"] = true
	}
	if dashScopeCosyVoiceWordTimestampsRequested(spec, scenarioExtensions) {
		parameters["word_timestamp_enabled"] = true
	}
	if seed := ValueAsInt64(scenarioExtensions["seed"]); seed > 0 {
		parameters["seed"] = seed
	}
	if bitRate := ValueAsInt64(FirstNonNil(scenarioExtensions["bit_rate"], scenarioExtensions["bitRate"])); bitRate > 0 {
		parameters["bit_rate"] = bitRate
	}
	return map[string]any{
		"header": map[string]any{
			"action":    "run-task",
			"task_id":   taskID,
			"streaming": "duplex",
		},
		"payload": map[string]any{
			"task_group": "audio",
			"task":       "tts",
			"function":   "SpeechSynthesizer",
			"model":      strings.TrimSpace(modelID),
			"parameters": parameters,
			"input":      map[string]any{},
		},
	}
}

func dashScopeRealtimeTTSContinueTaskPayload(taskID string, text string) map[string]any {
	return map[string]any{
		"header": map[string]any{
			"action":    "continue-task",
			"task_id":   strings.TrimSpace(taskID),
			"streaming": "duplex",
		},
		"payload": map[string]any{
			"input": map[string]any{
				"text": strings.TrimSpace(text),
			},
		},
	}
}

func dashScopeRealtimeTTSFinishTaskPayload(taskID string) map[string]any {
	return map[string]any{
		"header": map[string]any{
			"action":    "finish-task",
			"task_id":   strings.TrimSpace(taskID),
			"streaming": "duplex",
		},
		"payload": map[string]any{"input": map[string]any{}},
	}
}

func dashScopeRealtimeTTSWaitForTaskStarted(ctx context.Context, connection *websocket.Conn) error {
	timeout := dashScopeRealtimeTTSDefaultTimeout
	for {
		payload, event, binary, err := receiveDashScopeRealtimeTTSFrame(ctx, connection, timeout)
		if err != nil {
			return err
		}
		if len(binary) > 0 {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_STREAM_BROKEN)
		}
		switch event.name {
		case "task-started":
			return nil
		case "task-failed":
			return dashScopeRealtimeTTSError(event.header)
		default:
			if len(payload) == 0 {
				continue
			}
		}
	}
}

func receiveDashScopeRealtimeTTSFrame(ctx context.Context, connection *websocket.Conn, readTimeout time.Duration) (map[string]any, dashScopeRealtimeTTSEvent, []byte, error) {
	if ctx.Err() != nil {
		return nil, dashScopeRealtimeTTSEvent{}, nil, MapProviderRequestError(ctx.Err())
	}
	_ = connection.SetReadDeadline(computeWSReadDeadline(ctx, readTimeout))
	var raw []byte
	if err := websocket.Message.Receive(connection, &raw); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, dashScopeRealtimeTTSEvent{}, nil, grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_STREAM_BROKEN,
				err,
				grpcerr.ReasonOptions{Message: "provider stream ended unexpectedly"},
			)
		}
		if isNetworkTimeout(err) {
			return nil, dashScopeRealtimeTTSEvent{}, nil, grpcerr.WrapWithReasonCode(
				codes.DeadlineExceeded,
				runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
				err,
				grpcerr.ReasonOptions{Message: "provider stream timed out"},
			)
		}
		return nil, dashScopeRealtimeTTSEvent{}, nil, MapProviderRequestError(err)
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, dashScopeRealtimeTTSEvent{}, nil, nil
	}
	if trimmed[0] != '{' {
		return nil, dashScopeRealtimeTTSEvent{}, append([]byte(nil), raw...), nil
	}
	payload := map[string]any{}
	if err := json.Unmarshal(trimmed, &payload); err != nil {
		return nil, dashScopeRealtimeTTSEvent{}, nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_STREAM_BROKEN,
			err,
			grpcerr.ReasonOptions{Message: "provider stream event could not be decoded"},
		)
	}
	header, _ := payload["header"].(map[string]any)
	return payload, dashScopeRealtimeTTSEvent{
		name:   strings.ToLower(strings.TrimSpace(ValueAsString(header["event"]))),
		header: header,
	}, nil, nil
}

func resolveDashScopeRealtimeTTSWebSocketURL(baseURL string) string {
	baseParsed, _ := url.Parse(strings.TrimSpace(baseURL))
	if baseParsed == nil || strings.TrimSpace(baseParsed.Host) == "" {
		return ""
	}
	return normalizeDashScopeRealtimeTTSWebSocketURL(baseParsed)
}

func normalizeDashScopeRealtimeTTSWebSocketURL(parsed *url.URL) string {
	if parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return ""
	}
	out := *parsed
	switch strings.ToLower(strings.TrimSpace(out.Scheme)) {
	case "wss", "https":
		out.Scheme = "wss"
	default:
		out.Scheme = "ws"
	}
	out.RawQuery = ""
	out.Fragment = ""
	out.Path = strings.TrimSuffix(out.Path, "/")
	for _, suffix := range []string{"/compatible-mode/v1", "/compatible-mode", "/v1"} {
		if strings.HasSuffix(out.Path, suffix) {
			out.Path = strings.TrimSuffix(out.Path, suffix)
			break
		}
	}
	out.Path = strings.TrimSuffix(out.Path, "/") + dashScopeRealtimeTTSPath
	return out.String()
}

func validateDashScopeRealtimeTTSWebSocketURL(ctx context.Context, targetURL string, allowLoopback bool) error {
	parsed, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil {
		return grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "provider streaming endpoint could not be parsed"},
		)
	}
	if parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
	case "wss":
		parsed.Scheme = "https"
	case "ws":
		parsed.Scheme = "http"
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err := endpointsec.ValidateEndpoint(ctx, parsed.String(), allowLoopback); err != nil {
		return grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			err,
			grpcerr.ReasonOptions{Message: "provider streaming endpoint is not permitted"},
		)
	}
	return nil
}

func dashScopeRealtimeTTSReadTimeout(scenarioExtensions map[string]any) time.Duration {
	raw := ValueAsInt64(FirstNonNil(
		scenarioExtensions["dashscope_ws_read_timeout_ms"],
		scenarioExtensions["ws_read_timeout_ms"],
	))
	if raw <= 0 {
		return dashScopeRealtimeTTSDefaultTimeout
	}
	timeout := time.Duration(raw) * time.Millisecond
	if timeout < time.Second {
		return time.Second
	}
	if timeout > 2*time.Minute {
		return 2 * time.Minute
	}
	return timeout
}

func dashScopeRealtimeTTSUsageCharacters(payload map[string]any) int64 {
	payloadObject, _ := payload["payload"].(map[string]any)
	usage, _ := payloadObject["usage"].(map[string]any)
	return ValueAsInt64(usage["characters"])
}

func dashScopeRealtimeTTSError(header map[string]any) error {
	message := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(header["error_message"]),
		ValueAsString(header["error_code"]),
	))
	if message == "" {
		message = "dashscope realtime tts task failed"
	}
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{Message: message})
}
