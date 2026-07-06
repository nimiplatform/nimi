package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"golang.org/x/net/websocket"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestNativeOriginURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "strip compatible-mode path",
			input: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			want:  "https://dashscope.aliyuncs.com",
		},
		{
			name:  "already origin only",
			input: "https://dashscope.aliyuncs.com",
			want:  "https://dashscope.aliyuncs.com",
		},
		{
			name:  "custom host with port and path",
			input: "https://custom.host:8080/some/path",
			want:  "https://custom.host:8080",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := nativeOriginURL(tc.input)
			if got != tc.want {
				t.Fatalf("nativeOriginURL(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestExecuteAlibabaNativeTTSPreservesRequestedVoice(t *testing.T) {
	var capturedVoice string
	var capturedInstructions string
	var capturedOptimizeInstructions bool
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/aigc/multimodal-generation/generation" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		capturedPayload = payload
		input, _ := payload["input"].(map[string]any)
		capturedVoice = strings.TrimSpace(toString(input["voice"]))
		parameters, _ := payload["parameters"].(map[string]any)
		capturedInstructions = strings.TrimSpace(toString(parameters["instructions"]))
		capturedOptimizeInstructions = ValueAsBool(parameters["optimize_instructions"])
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("dashscope-tts-bytes"))
	}))
	defer func() { server.Close() }()

	artifacts, _, _, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{
			BaseURL:               server.URL,
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		nil,
		"job-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			Extensions: []*runtimev1.ScenarioExtension{
				{
					Namespace: "nimi.scenario.speech_synthesize.request",
					Payload: mustStructPBForNimillmTest(t, map[string]any{
						"instruct":              "Speak as a calm fantasy storyteller.",
						"optimize_instructions": true,
					}),
				},
			},
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
					SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
						Text: "hello",
						VoiceRef: &runtimev1.VoiceReference{
							Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
							Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
								ProviderVoiceRef: "alloy",
							},
						},
					},
				},
			},
		},
		"qwen3-tts-instruct-flash-2026-01-26",
	)
	if err != nil {
		t.Fatalf("ExecuteAlibabaNative tts failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if capturedVoice != "alloy" {
		t.Fatalf("expected requested voice alloy, got=%q", capturedVoice)
	}
	if capturedInstructions != "Speak as a calm fantasy storyteller." {
		t.Fatalf("expected instruct extension to map to parameters.instructions, got=%q", capturedInstructions)
	}
	if !capturedOptimizeInstructions {
		t.Fatal("expected optimize_instructions extension to map to parameters.optimize_instructions")
	}
	parameters, _ := capturedPayload["parameters"].(map[string]any)
	if _, ok := parameters["sample_rate"]; ok {
		t.Fatalf("unset sample rate must be omitted from dashscope parameters: %#v", parameters["sample_rate"])
	}
	if _, ok := capturedPayload["sample_rate_hz"]; ok {
		t.Fatalf("unset sample rate must be omitted from dashscope payload: %#v", capturedPayload["sample_rate_hz"])
	}
}

func TestExecuteAlibabaNativeCosyVoiceTTSUsesSpeechSynthesizerContract(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/SpeechSynthesizer" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{
				"audio": map[string]any{
					"data": base64.StdEncoding.EncodeToString([]byte("cosyvoice-tts-bytes")),
				},
			},
		})
	}))
	defer func() { server.Close() }()

	artifacts, _, _, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{
			BaseURL:               server.URL + "/compatible-mode/v1",
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		nil,
		"job-cosyvoice-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			Extensions: []*runtimev1.ScenarioExtension{
				{
					Namespace: "nimi.scenario.speech_synthesize.request",
					Payload: mustStructPBForNimillmTest(t, map[string]any{
						"instruction":            "用温柔的语气，语速稍慢。",
						"word_timestamp_enabled": true,
						"seed":                   17,
					}),
				},
			},
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
					SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
						Text:         "你好，Nimi。",
						Language:     "zh",
						AudioFormat:  "wav",
						SampleRateHz: 24000,
						Speed:        0.9,
						Pitch:        1.1,
						Volume:       50,
						TimingMode:   runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD,
						VoiceRef: &runtimev1.VoiceReference{
							Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
							Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
								ProviderVoiceRef: "longanyang",
							},
						},
					},
				},
			},
		},
		"cosyvoice-v3-flash",
	)
	if err != nil {
		t.Fatalf("ExecuteAlibabaNative cosyvoice tts failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "cosyvoice-tts-bytes" {
		t.Fatalf("unexpected artifact bytes: %q", got)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "cosyvoice-v3-flash" {
		t.Fatalf("unexpected model: %q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input payload, got=%T", capturedPayload["input"])
	}
	if _, exists := capturedPayload["parameters"]; exists {
		t.Fatalf("cosyvoice payload must not use qwen parameters envelope: %#v", capturedPayload["parameters"])
	}
	if got := strings.TrimSpace(toString(input["text"])); got != "你好，Nimi。" {
		t.Fatalf("unexpected text: %q", got)
	}
	if got := strings.TrimSpace(toString(input["voice"])); got != "longanyang" {
		t.Fatalf("unexpected voice: %q", got)
	}
	if got := strings.TrimSpace(toString(input["format"])); got != "wav" {
		t.Fatalf("unexpected format: %q", got)
	}
	if got := ValueAsInt64(input["sample_rate"]); got != 24000 {
		t.Fatalf("unexpected sample_rate: %#v", input["sample_rate"])
	}
	if got := ValueAsFloat64(input["rate"]); got != 0.9 {
		t.Fatalf("unexpected rate: %#v", input["rate"])
	}
	if got := ValueAsFloat64(input["pitch"]); got != 1.1 {
		t.Fatalf("unexpected pitch: %#v", input["pitch"])
	}
	if got := ValueAsFloat64(input["volume"]); got != 50 {
		t.Fatalf("unexpected volume: %#v", input["volume"])
	}
	if got := strings.TrimSpace(toString(input["instruction"])); got != "用温柔的语气，语速稍慢。" {
		t.Fatalf("unexpected instruction: %q", got)
	}
	if !ValueAsBool(input["word_timestamp_enabled"]) {
		t.Fatalf("expected word_timestamp_enabled=true, got=%#v", input["word_timestamp_enabled"])
	}
	hints, ok := input["language_hints"].([]any)
	if !ok || len(hints) != 1 || strings.TrimSpace(toString(hints[0])) != "zh" {
		t.Fatalf("unexpected language_hints: %#v", input["language_hints"])
	}
}

func TestBackendStreamSynthesizeSpeechDashScopeCosyVoiceUsesWebSocketProtocol(t *testing.T) {
	type capture struct {
		authHeader string
		actions    []string
		run        map[string]any
		continue_  map[string]any
		finish     map[string]any
	}
	captureCh := make(chan capture, 1)
	errCh := make(chan error, 1)
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		var got capture
		got.authHeader = strings.TrimSpace(conn.Request().Header.Get("Authorization"))
		receive := func(label string) (map[string]any, bool) {
			var payload map[string]any
			if err := websocket.JSON.Receive(conn, &payload); err != nil {
				errCh <- fmt.Errorf("receive %s: %w", label, err)
				return nil, false
			}
			header, _ := payload["header"].(map[string]any)
			got.actions = append(got.actions, strings.TrimSpace(ValueAsString(header["action"])))
			return payload, true
		}

		var ok bool
		if got.run, ok = receive("run-task"); !ok {
			return
		}
		runHeader, _ := got.run["header"].(map[string]any)
		if err := websocket.JSON.Send(conn, map[string]any{
			"header": map[string]any{
				"task_id": strings.TrimSpace(ValueAsString(runHeader["task_id"])),
				"event":   "task-started",
			},
			"payload": map[string]any{},
		}); err != nil {
			errCh <- fmt.Errorf("send task-started: %w", err)
			return
		}
		if got.continue_, ok = receive("continue-task"); !ok {
			return
		}
		if err := websocket.JSON.Send(conn, map[string]any{
			"header": map[string]any{"event": "result-generated"},
			"payload": map[string]any{
				"output": map[string]any{"type": "sentence-synthesis"},
			},
		}); err != nil {
			errCh <- fmt.Errorf("send result-generated: %w", err)
			return
		}
		if err := websocket.Message.Send(conn, []byte("dashscope-native-audio-1")); err != nil {
			errCh <- fmt.Errorf("send binary audio 1: %w", err)
			return
		}
		if got.finish, ok = receive("finish-task"); !ok {
			return
		}
		if err := websocket.JSON.Send(conn, map[string]any{
			"header": map[string]any{"event": "result-generated"},
			"payload": map[string]any{
				"output": map[string]any{"type": "sentence-synthesis"},
			},
		}); err != nil {
			errCh <- fmt.Errorf("send final result-generated: %w", err)
			return
		}
		if err := websocket.Message.Send(conn, []byte("dashscope-native-audio-2")); err != nil {
			errCh <- fmt.Errorf("send binary audio 2: %w", err)
			return
		}
		if err := websocket.JSON.Send(conn, map[string]any{
			"header":  map[string]any{"event": "task-finished"},
			"payload": map[string]any{"usage": map[string]any{"characters": 12}},
		}); err != nil {
			errCh <- fmt.Errorf("send task-finished: %w", err)
			return
		}
		captureCh <- got
	}))
	defer func() { server.Close() }()

	backend := newBackend("cloud-dashscope", server.URL, "test-api-key", nil, 10*time.Second, nil, false, true)
	var chunks [][]byte
	usage, finish, err := backend.StreamSynthesizeSpeech(context.Background(), "cosyvoice-v3-flash", &runtimev1.SpeechSynthesizeScenarioSpec{
		Text:         "你好，Nimi。",
		Language:     "zh",
		AudioFormat:  "mp3",
		SampleRateHz: 24000,
		Speed:        0.9,
		Pitch:        1.1,
		Volume:       50,
		VoiceRef: &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
			Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
				ProviderVoiceRef: "dashscope-custom-voice",
			},
		},
	}, map[string]any{
		"instruction": "温柔但清晰。",
	}, func(chunk SpeechStreamChunk) error {
		chunks = append(chunks, append([]byte(nil), chunk.Bytes...))
		if chunk.MIMEType != "audio/mpeg" {
			return fmt.Errorf("chunk MIME=%q, want audio/mpeg", chunk.MIMEType)
		}
		if chunk.SampleRateHz != 24000 {
			return fmt.Errorf("chunk sample rate=%d, want 24000", chunk.SampleRateHz)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("StreamSynthesizeSpeech dashscope websocket: %v", err)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("finish=%s, want STOP", finish.String())
	}
	if usage == nil || usage.GetInputTokens() <= 0 || usage.GetOutputTokens() <= 0 {
		t.Fatalf("usage must include estimated input/output, got %#v", usage)
	}
	if len(chunks) != 2 || string(chunks[0]) != "dashscope-native-audio-1" || string(chunks[1]) != "dashscope-native-audio-2" {
		t.Fatalf("unexpected chunks: %#v", chunks)
	}

	select {
	case handlerErr := <-errCh:
		t.Fatalf("websocket handler error: %v", handlerErr)
	default:
	}
	var got capture
	select {
	case got = <-captureCh:
	case <-time.After(2 * time.Second):
		t.Fatal("websocket handler did not capture request")
	}
	if got.authHeader != "Bearer test-api-key" {
		t.Fatalf("authorization header=%q", got.authHeader)
	}
	if strings.Join(got.actions, ",") != "run-task,continue-task,finish-task" {
		t.Fatalf("actions=%v", got.actions)
	}
	runPayload, _ := got.run["payload"].(map[string]any)
	params, _ := runPayload["parameters"].(map[string]any)
	if gotModel := strings.TrimSpace(ValueAsString(runPayload["model"])); gotModel != "cosyvoice-v3-flash" {
		t.Fatalf("run model=%q", gotModel)
	}
	if gotVoice := strings.TrimSpace(ValueAsString(params["voice"])); gotVoice != "dashscope-custom-voice" {
		t.Fatalf("run voice=%q", gotVoice)
	}
	if gotFormat := strings.TrimSpace(ValueAsString(params["format"])); gotFormat != "mp3" {
		t.Fatalf("run format=%q", gotFormat)
	}
	if gotRate := ValueAsInt64(params["sample_rate"]); gotRate != 24000 {
		t.Fatalf("run sample_rate=%d", gotRate)
	}
	if gotInstruction := strings.TrimSpace(ValueAsString(params["instruction"])); gotInstruction != "温柔但清晰。" {
		t.Fatalf("run instruction=%q", gotInstruction)
	}
	continuePayload, _ := got.continue_["payload"].(map[string]any)
	continueInput, _ := continuePayload["input"].(map[string]any)
	if gotText := strings.TrimSpace(ValueAsString(continueInput["text"])); gotText != "你好，Nimi。" {
		t.Fatalf("continue text=%q", gotText)
	}
	finishHeader, _ := got.finish["header"].(map[string]any)
	if gotAction := strings.TrimSpace(ValueAsString(finishHeader["action"])); gotAction != "finish-task" {
		t.Fatalf("finish action=%q", gotAction)
	}
}

func TestExecuteAlibabaNativeRejectsMissingAPIKey(t *testing.T) {
	_, _, _, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"},
		nil,
		"job-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat"},
				},
			},
		},
		"qwen-image-2.0-pro",
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("expected AI_PROVIDER_AUTH_FAILED, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}

func TestExecuteDashScopeTranscribeUsesCompatibleChatPath(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/compatible-mode/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"content": "dashscope transcript",
					},
				},
			},
		})
	}))
	defer func() { server.Close() }()

	artifacts, _, _, err := ExecuteDashScopeTranscribe(
		context.Background(),
		MediaAdapterConfig{
			BaseURL:               server.URL + "/compatible-mode/v1",
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
					SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
						Language: "en",
						Prompt:   "Domain terms: Nimi Realm",
						AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
							Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
								AudioBytes: []byte("RIFF...."),
							},
						},
						MimeType: "audio/wav",
					},
				},
			},
		},
		"qwen3-asr-flash",
	)
	if err != nil {
		t.Fatalf("ExecuteDashScopeTranscribe failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "dashscope transcript" {
		t.Fatalf("unexpected artifact text: %q", got)
	}
	messages, ok := captured["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("expected system+user messages, got=%T len=%d", captured["messages"], len(messages))
	}
	systemMessage, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("expected system message map, got=%T", messages[0])
	}
	systemContent, ok := systemMessage["content"].([]any)
	if !ok || len(systemContent) != 1 {
		t.Fatalf("expected system content text array, got=%T len=%d", systemMessage["content"], len(systemContent))
	}
	systemText, ok := systemContent[0].(map[string]any)
	if !ok {
		t.Fatalf("expected system text item map, got=%T", systemContent[0])
	}
	if got := strings.TrimSpace(ValueAsString(systemText["type"])); got != "text" {
		t.Fatalf("expected system text item type=text, got=%q", got)
	}
	if got := strings.TrimSpace(ValueAsString(systemText["text"])); !strings.Contains(got, "Domain terms: Nimi Realm") {
		t.Fatalf("expected system text context, got=%q", got)
	}
	userMessage, ok := messages[1].(map[string]any)
	if !ok {
		t.Fatalf("expected user message map, got=%T", messages[1])
	}
	content, ok := userMessage["content"].([]any)
	if !ok || len(content) != 1 {
		t.Fatalf("expected audio-only content, got=%T len=%d", userMessage["content"], len(content))
	}
	audioItem, ok := content[0].(map[string]any)
	if !ok {
		t.Fatalf("expected audio item map, got=%T", content[0])
	}
	inputAudio, ok := audioItem["input_audio"].(map[string]any)
	if !ok {
		t.Fatalf("expected input_audio payload, got=%T", audioItem["input_audio"])
	}
	if _, exists := inputAudio["format"]; exists {
		t.Fatalf("dashscope qwen3-asr input_audio must not include format field: %#v", inputAudio["format"])
	}
	if got := strings.TrimSpace(ValueAsString(inputAudio["data"])); !strings.HasPrefix(got, "data:audio/wav;base64,") {
		t.Fatalf("expected inline audio data url, got=%q", got)
	}
	if _, exists := captured["extra_body"]; exists {
		t.Fatalf("dashscope qwen3-asr REST payload must not include extra_body: %#v", captured["extra_body"])
	}
	asrOptions, ok := captured["asr_options"].(map[string]any)
	if !ok {
		t.Fatalf("expected top-level asr_options payload, got=%T", captured["asr_options"])
	}
	if got := strings.TrimSpace(ValueAsString(asrOptions["language"])); got != "en" {
		t.Fatalf("expected language hint, got=%q", got)
	}
}

func mustStructPBForNimillmTest(t *testing.T, values map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(values)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}

func TestExecuteDashScopeTranscribeRejectsUnsupportedAdvancedOptions(t *testing.T) {
	_, _, _, err := ExecuteDashScopeTranscribe(
		context.Background(),
		MediaAdapterConfig{BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
					SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
						Diarization: true,
						AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
							Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
								AudioBytes: []byte("audio"),
							},
						},
					},
				},
			},
		},
		"qwen3-asr-flash",
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}

func TestBuildAlibabaImageSubmitRequestDashScopeQwenImageUsesSyncMultimodalContract(t *testing.T) {
	submitPath, queryPathTemplate, payload, headers := buildAlibabaImageSubmitRequest(
		"qwen-image-2.0-pro",
		&runtimev1.ImageGenerateScenarioSpec{
			Prompt:         "一只穿宇航服的橘猫，电影感，细节丰富",
			NegativePrompt: "low quality, blurry",
			N:              1,
			Size:           "1024x1024",
		},
		nil,
	)

	if submitPath != "/api/v1/services/aigc/multimodal-generation/generation" {
		t.Fatalf("unexpected submitPath: %q", submitPath)
	}
	if queryPathTemplate != "/api/v1/tasks/{task_id}" {
		t.Fatalf("unexpected queryPathTemplate: %q", queryPathTemplate)
	}
	if len(headers) != 0 {
		t.Fatalf("expected sync request without async headers, got=%v", headers)
	}
	if got := strings.TrimSpace(toString(payload["model"])); got != "qwen-image-2.0-pro" {
		t.Fatalf("unexpected model: %q", got)
	}

	input, ok := payload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input payload, got=%T", payload["input"])
	}
	messages, ok := input["messages"].([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("expected one input message, got=%T len=%d", input["messages"], len(messages))
	}
	message, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("expected message map, got=%T", messages[0])
	}
	content, ok := message["content"].([]any)
	if !ok || len(content) != 1 {
		t.Fatalf("expected one content item, got=%T len=%d", message["content"], len(content))
	}
	textItem, ok := content[0].(map[string]any)
	if !ok {
		t.Fatalf("expected content map, got=%T", content[0])
	}
	if got := strings.TrimSpace(toString(textItem["text"])); got != "一只穿宇航服的橘猫，电影感，细节丰富" {
		t.Fatalf("unexpected prompt text: %q", got)
	}

	parameters, ok := payload["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("expected parameters payload, got=%T", payload["parameters"])
	}
	if got := strings.TrimSpace(toString(parameters["negative_prompt"])); got != "low quality, blurry" {
		t.Fatalf("unexpected negative prompt: %q", got)
	}
	if got := strings.TrimSpace(toString(parameters["size"])); got != "1024*1024" {
		t.Fatalf("unexpected size: %q", got)
	}
}

func TestNormalizeDashScopeImageSize(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "already provider format", input: "1024*1024", want: "1024*1024"},
		{name: "lower x separator", input: "1024x1024", want: "1024*1024"},
		{name: "upper x separator", input: "1024X1024", want: "1024*1024"},
		{name: "tester 2k shorthand", input: "2k", want: "2048*2048"},
		{name: "tester 3k shorthand", input: "3k", want: "3072*3072"},
		{name: "tester 4k shorthand", input: "4k", want: "4096*4096"},
		{name: "invalid literal preserved", input: "auto", want: "auto"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeDashScopeImageSize(tc.input); got != tc.want {
				t.Fatalf("normalizeDashScopeImageSize(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestExecuteAlibabaNativeImageWan26UsesAsyncImageGenerationContract(t *testing.T) {
	var capturedPayload map[string]any
	var capturedAsyncHeader string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/image-generation/generation":
			capturedAsyncHeader = strings.TrimSpace(r.Header.Get("X-DashScope-Async"))
			_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"task_id":     "wan-image-task-1",
					"task_status": "PENDING",
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/wan-image-task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"task_id":     "wan-image-task-1",
					"task_status": "SUCCEEDED",
					"choices": []map[string]any{
						{
							"message": map[string]any{
								"content": []map[string]any{
									{"type": "image", "image": base64.StdEncoding.EncodeToString([]byte("wan-image-bytes"))},
								},
							},
						},
					},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/artifact.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("wan-image-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	artifacts, _, providerJobID, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{
			BaseURL:               server.URL + "/compatible-mode/v1",
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		noopGeminiJobUpdater{},
		"job-image-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
						Prompt: "A tiny cinematic island floating above a calm sea.",
						Size:   "1328x1328",
					},
				},
			},
		},
		"wan2.6-t2i",
	)
	if err != nil {
		t.Fatalf("ExecuteAlibabaNative image failed: %v", err)
	}
	if providerJobID != "wan-image-task-1" {
		t.Fatalf("unexpected providerJobID: %q", providerJobID)
	}
	if capturedAsyncHeader != "enable" {
		t.Fatalf("expected X-DashScope-Async enable, got=%q", capturedAsyncHeader)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "wan2.6-t2i" {
		t.Fatalf("expected wan2.6-t2i model, got=%q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input payload, got=%T", capturedPayload["input"])
	}
	messages, ok := input["messages"].([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("expected one input message, got=%T len=%d", input["messages"], len(messages))
	}
	message, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("expected message map, got=%T", messages[0])
	}
	content, ok := message["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("expected non-empty content, got=%T len=%d", message["content"], len(content))
	}
	firstContent, ok := content[0].(map[string]any)
	if !ok {
		t.Fatalf("expected first content map, got=%T", content[0])
	}
	if got := strings.TrimSpace(toString(firstContent["text"])); got != "A tiny cinematic island floating above a calm sea." {
		t.Fatalf("unexpected prompt text: %q", got)
	}
	parameters, ok := capturedPayload["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("expected parameters payload, got=%T", capturedPayload["parameters"])
	}
	if got := strings.TrimSpace(toString(parameters["size"])); got != "1328*1328" {
		t.Fatalf("unexpected normalized size: %q", got)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one image artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "wan-image-bytes" {
		t.Fatalf("unexpected image bytes: %q", got)
	}
}

func TestExecuteAlibabaNativeVideoUsesAsyncTaskContract(t *testing.T) {
	var capturedPayload map[string]any
	var capturedAsyncHeader string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/video-generation/video-synthesis":
			capturedAsyncHeader = strings.TrimSpace(r.Header.Get("X-DashScope-Async"))
			_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"task_id":     "wan-video-task-1",
					"task_status": "PENDING",
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/wan-video-task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"task_id":     "wan-video-task-1",
					"task_status": "SUCCEEDED",
					"video_url":   server.URL + "/artifact.mp4",
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/artifact.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("wan-video-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	artifacts, _, providerJobID, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{
			BaseURL:               server.URL + "/compatible-mode/v1",
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		noopGeminiJobUpdater{},
		"job-video-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_VideoGenerate{
					VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
						Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
						Content: []*runtimev1.VideoContentItem{
							{
								Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
								Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
								Text: "A short cinematic sunrise shot.",
							},
						},
						Options: &runtimev1.VideoGenerationOptions{
							DurationSec: 4,
							Resolution:  "720p",
						},
					},
				},
			},
		},
		"wan2.7-t2v",
	)
	if err != nil {
		t.Fatalf("ExecuteAlibabaNative video failed: %v", err)
	}
	if providerJobID != "wan-video-task-1" {
		t.Fatalf("unexpected providerJobID: %q", providerJobID)
	}
	if capturedAsyncHeader != "enable" {
		t.Fatalf("expected X-DashScope-Async enable, got=%q", capturedAsyncHeader)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "wan2.7-t2v" {
		t.Fatalf("expected wan2.7-t2v model, got=%q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input payload, got=%T", capturedPayload["input"])
	}
	if got := strings.TrimSpace(toString(input["prompt"])); got != "A short cinematic sunrise shot." {
		t.Fatalf("unexpected input prompt: %q", got)
	}
	parameters, ok := capturedPayload["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("expected parameters payload, got=%T", capturedPayload["parameters"])
	}
	if got, ok := parameters["duration_sec"].(float64); !ok || got != 4 {
		t.Fatalf("unexpected duration_sec: %#v", parameters["duration_sec"])
	}
	if got := strings.TrimSpace(toString(parameters["resolution"])); got != "720p" {
		t.Fatalf("unexpected resolution: %q", got)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one video artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "wan-video-bytes" {
		t.Fatalf("unexpected video bytes: %q", got)
	}
}

func TestExecuteDashScopeVoiceWorkflowUsesCustomizationContractForClone(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{
				"voice": "dashscope-clone-voice",
			},
		})
	}))
	defer func() { server.Close() }()

	result, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "voice_clone",
		WorkflowModelID: "qwen-voice-enrollment",
		ModelID:         "qwen3-tts-vc-2026-01-22",
		Payload: map[string]any{
			"target_model_id": "qwen3-tts-vc-2026-01-22",
			"input": map[string]any{
				"reference_audio_uri": "https://example.com/reference.wav",
				"preferred_name":      "nimi-clone-voice",
			},
		},
	}, MediaAdapterConfig{
		BaseURL:               server.URL + "/compatible-mode/v1",
		AllowLoopbackEndpoint: true,
		APIKey:                "test-api-key",
	})
	if err != nil {
		t.Fatalf("executeDashScopeVoiceWorkflow clone failed: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "dashscope-clone-voice" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "qwen-voice-enrollment" {
		t.Fatalf("unexpected workflow model: %q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input map, got=%T", capturedPayload["input"])
	}
	if got := strings.TrimSpace(toString(input["action"])); got != "create" {
		t.Fatalf("unexpected action: %q", got)
	}
	if got := strings.TrimSpace(toString(input["target_model"])); got != "qwen3-tts-vc-2026-01-22" {
		t.Fatalf("unexpected target model: %q", got)
	}
	audio, ok := input["audio"].(map[string]any)
	if !ok {
		t.Fatalf("expected audio map, got=%T", input["audio"])
	}
	if got := strings.TrimSpace(toString(audio["data"])); got != "https://example.com/reference.wav" {
		t.Fatalf("unexpected reference audio data: %q", got)
	}
	if got := strings.TrimSpace(toString(input["prefix"])); got != "nimi_clone_voice" {
		t.Fatalf("unexpected prefix: %q", got)
	}
	if got := strings.TrimSpace(toString(input["preferred_name"])); got != "nimi_clone_voice" {
		t.Fatalf("unexpected preferred_name: %q", got)
	}
}

func TestExecuteDashScopeVoiceWorkflowUsesCustomizationContractForDesign(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{
				"voice": "dashscope-design-voice",
			},
		})
	}))
	defer func() { server.Close() }()

	result, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "voice_design",
		WorkflowModelID: "qwen-voice-design",
		ModelID:         "qwen3-tts-vd-2026-01-26",
		Payload: map[string]any{
			"target_model_id": "qwen3-tts-vd-2026-01-26",
			"input": map[string]any{
				"instruction_text": "Warm, calm and natural documentary narrator voice.",
				"preview_text":     "Hello from Nimi voice design gold path.",
				"language":         "en",
				"preferred_name":   "nimi_voice",
			},
		},
	}, MediaAdapterConfig{
		BaseURL:               server.URL + "/compatible-mode/v1",
		AllowLoopbackEndpoint: true,
		APIKey:                "test-api-key",
	})
	if err != nil {
		t.Fatalf("executeDashScopeVoiceWorkflow design failed: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "dashscope-design-voice" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "qwen-voice-design" {
		t.Fatalf("unexpected workflow model: %q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input map, got=%T", capturedPayload["input"])
	}
	if got := strings.TrimSpace(toString(input["action"])); got != "create" {
		t.Fatalf("unexpected action: %q", got)
	}
	if got := strings.TrimSpace(toString(input["target_model"])); got != "qwen3-tts-vd-2026-01-26" {
		t.Fatalf("unexpected target model: %q", got)
	}
	if got := strings.TrimSpace(toString(input["voice_prompt"])); got != "Warm, calm and natural documentary narrator voice." {
		t.Fatalf("unexpected voice prompt: %q", got)
	}
	if got := strings.TrimSpace(toString(input["preview_text"])); got != "Hello from Nimi voice design gold path." {
		t.Fatalf("unexpected preview text: %q", got)
	}
	if got := strings.TrimSpace(toString(input["preferred_name"])); got != "nimi_voice" {
		t.Fatalf("unexpected preferred_name: %q", got)
	}
}

func TestExecuteDashScopeVoiceWorkflowUsesCosyVoiceEnrollmentContractForClone(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{
				"voice_id": "cosyvoice-v3-flash-nimivoice-abc123",
			},
		})
	}))
	defer func() { server.Close() }()

	result, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "voice_clone",
		WorkflowModelID: "voice-enrollment-clone",
		ModelID:         "cosyvoice-v3-flash",
		Payload: map[string]any{
			"target_model_id": "cosyvoice-v3-flash",
			"input": map[string]any{
				"reference_audio_uri": "https://example.com/reference.wav",
				"preferred_name":      "Nimi Voice 123",
				"language":            "zh",
				"sample_rate_hz":      24000,
				"response_format":     "wav",
			},
		},
	}, MediaAdapterConfig{
		BaseURL:               server.URL + "/compatible-mode/v1",
		AllowLoopbackEndpoint: true,
		APIKey:                "test-api-key",
	})
	if err != nil {
		t.Fatalf("executeDashScopeVoiceWorkflow cosyvoice clone failed: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "cosyvoice-v3-flash-nimivoice-abc123" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "voice-enrollment" {
		t.Fatalf("unexpected workflow model: %q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input map, got=%T", capturedPayload["input"])
	}
	if got := strings.TrimSpace(toString(input["action"])); got != "create_voice" {
		t.Fatalf("unexpected action: %q", got)
	}
	if got := strings.TrimSpace(toString(input["target_model"])); got != "cosyvoice-v3-flash" {
		t.Fatalf("unexpected target model: %q", got)
	}
	if got := strings.TrimSpace(toString(input["url"])); got != "https://example.com/reference.wav" {
		t.Fatalf("unexpected url: %q", got)
	}
	if _, exists := input["audio"]; exists {
		t.Fatalf("cosyvoice clone must use url, not qwen audio envelope: %#v", input["audio"])
	}
	if _, exists := input["preferred_name"]; exists {
		t.Fatalf("cosyvoice clone must use prefix, not preferred_name: %#v", input["preferred_name"])
	}
	if got := strings.TrimSpace(toString(input["prefix"])); got != "nimivoice" {
		t.Fatalf("unexpected prefix: %q", got)
	}
	hints, ok := input["language_hints"].([]any)
	if !ok || len(hints) != 1 || strings.TrimSpace(toString(hints[0])) != "zh" {
		t.Fatalf("unexpected language_hints: %#v", input["language_hints"])
	}
	parameters, ok := capturedPayload["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("expected parameters map, got=%T", capturedPayload["parameters"])
	}
	if got := ValueAsInt64(parameters["sample_rate"]); got != 24000 {
		t.Fatalf("unexpected sample_rate: %#v", parameters["sample_rate"])
	}
	if got := strings.TrimSpace(toString(parameters["response_format"])); got != "wav" {
		t.Fatalf("unexpected response_format: %q", got)
	}
}

func TestExecuteDashScopeVoiceWorkflowUsesCosyVoiceEnrollmentContractForDesign(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{
				"voice": "cosyvoice-v3p-announcer-abc123",
			},
		})
	}))
	defer func() { server.Close() }()

	result, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "voice_design",
		WorkflowModelID: "voice-enrollment-design",
		ModelID:         "cosyvoice-v3.5-plus",
		Payload: map[string]any{
			"target_model_id": "cosyvoice-v3.5-plus",
			"input": map[string]any{
				"instruction_text": "Warm documentary announcer with clear pacing.",
				"preview_text":     "Hello from the CosyVoice design contract.",
				"language":         "en",
				"preferred_name":   "announcer",
				"sample_rate":      24000,
				"response_format":  "wav",
			},
		},
	}, MediaAdapterConfig{
		BaseURL:               server.URL + "/compatible-mode/v1",
		AllowLoopbackEndpoint: true,
		APIKey:                "test-api-key",
	})
	if err != nil {
		t.Fatalf("executeDashScopeVoiceWorkflow cosyvoice design failed: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "cosyvoice-v3p-announcer-abc123" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "voice-enrollment" {
		t.Fatalf("unexpected workflow model: %q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input map, got=%T", capturedPayload["input"])
	}
	if got := strings.TrimSpace(toString(input["action"])); got != "create_voice" {
		t.Fatalf("unexpected action: %q", got)
	}
	if got := strings.TrimSpace(toString(input["target_model"])); got != "cosyvoice-v3.5-plus" {
		t.Fatalf("unexpected target model: %q", got)
	}
	if got := strings.TrimSpace(toString(input["voice_prompt"])); got != "Warm documentary announcer with clear pacing." {
		t.Fatalf("unexpected voice prompt: %q", got)
	}
	if got := strings.TrimSpace(toString(input["preview_text"])); got != "Hello from the CosyVoice design contract." {
		t.Fatalf("unexpected preview text: %q", got)
	}
	if got := strings.TrimSpace(toString(input["prefix"])); got != "announcer" {
		t.Fatalf("unexpected prefix: %q", got)
	}
	if _, exists := input["preferred_name"]; exists {
		t.Fatalf("cosyvoice design must use prefix, not preferred_name: %#v", input["preferred_name"])
	}
	if _, exists := input["language"]; exists {
		t.Fatalf("cosyvoice design must use language_hints, not language: %#v", input["language"])
	}
	hints, ok := input["language_hints"].([]any)
	if !ok || len(hints) != 1 || strings.TrimSpace(toString(hints[0])) != "en" {
		t.Fatalf("unexpected language_hints: %#v", input["language_hints"])
	}
	parameters, ok := capturedPayload["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("expected parameters map, got=%T", capturedPayload["parameters"])
	}
	if got := ValueAsInt64(parameters["sample_rate"]); got != 24000 {
		t.Fatalf("unexpected sample_rate: %#v", parameters["sample_rate"])
	}
	if got := strings.TrimSpace(toString(parameters["response_format"])); got != "wav" {
		t.Fatalf("unexpected response_format: %q", got)
	}
}

func TestExecuteDashScopeVoiceWorkflowRejectsCosyVoiceCloneBytes(t *testing.T) {
	_, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "voice_clone",
		WorkflowModelID: "voice-enrollment-clone",
		ModelID:         "cosyvoice-v3-flash",
		Payload: map[string]any{
			"target_model_id": "cosyvoice-v3-flash",
			"input": map[string]any{
				"reference_audio_base64": base64.StdEncoding.EncodeToString([]byte("RIFF....")),
				"reference_audio_mime":   "audio/wav",
				"preferred_name":         "nimi",
			},
		},
	}, MediaAdapterConfig{
		BaseURL:               "https://dashscope.aliyuncs.com/compatible-mode/v1",
		AllowLoopbackEndpoint: true,
		APIKey:                "test-api-key",
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("expected AI_INPUT_INVALID, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}

func TestBuildDashScopeCosyVoiceEnrollmentUsesEntropyForAutoGeneratedPrefix(t *testing.T) {
	payload, err := buildDashScopeVoiceWorkflowPayload(VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "voice_design",
		WorkflowModelID: "voice-enrollment-design",
		ModelID:         "cosyvoice-v3-flash",
		Payload: map[string]any{
			"target_model_id": "cosyvoice-v3-flash",
			"input": map[string]any{
				"instruction_text": "Warm natural narrator voice.",
				"preview_text":     "Hello from Nimi.",
				"preferred_name":   "nimi-voice-01ktek-live",
			},
		},
	})
	if err != nil {
		t.Fatalf("buildDashScopeVoiceWorkflowPayload: %v", err)
	}
	input, ok := payload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input map, got=%T", payload["input"])
	}
	if got := strings.TrimSpace(toString(input["prefix"])); got != "nv01ktekl" {
		t.Fatalf("unexpected auto-generated CosyVoice prefix: %q", got)
	}
}

func TestNormalizeDashScopePreferredName(t *testing.T) {
	if got := normalizeDashScopePreferredName("nimi-voice-01ABCD"); got != "nimi_voice_01abc" {
		t.Fatalf("unexpected normalized name: %q", got)
	}
	if got := normalizeDashScopePreferredName(""); got != "nimi_voice" {
		t.Fatalf("unexpected empty fallback name: %q", got)
	}
	if got := normalizeDashScopePreferredName("nimi-voice-01KQCDABCDE123456789"); len(got) > 16 {
		t.Fatalf("normalized preferred_name exceeds DashScope 16-char limit: %q", got)
	}
}

func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}
