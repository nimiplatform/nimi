package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDashScopeVoiceDesignRetainsOwnedPreviewAndCleanupHandle(t *testing.T) {
	wav := testGeminiTTSWAV()
	preview := map[string]any{"data": base64.StdEncoding.EncodeToString(wav), "sample_rate": 24000, "response_format": "wav"}
	response := map[string]any{"output": map[string]any{"voice": "voice-created", "target_model": "qwen3-tts-vd-2026-01-26", "preview_audio": preview}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" {
			t.Errorf("unexpected voice workflow endpoint: %s %s", r.Method, r.URL.Path)
		}
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if input["model"] != "qwen-voice-design" || MapField(input["parameters"], "sample_rate") != float64(24000) || MapField(input["parameters"], "response_format") != "wav" || MapField(input["input"], "preview_text") != "Hello from Nimi." {
			t.Errorf("preview request lost its explicit WAV or text: %#v", input)
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	request := VoiceWorkflowRequest{Provider: "dashscope", WorkflowType: "text_description", WorkflowModelID: "qwen-voice-design", ModelID: "qwen3-tts-vd-2026-01-26", Payload: map[string]any{
		"instruction_text": "A fictional adult narrator", "preview_text": "Hello from Nimi.", "language": "en",
	}}
	config := MediaAdapterConfig{BaseURL: server.URL, APIKey: "key", AllowLoopbackEndpoint: true}
	result, err := executeDashScopeVoiceWorkflow(context.Background(), request, config)
	if err != nil || result.ProviderVoiceRef != "voice-created" || result.PreviewMime != "audio/wav" || !bytes.Equal(result.PreviewAudio, wav) || result.Usage != nil {
		t.Fatal("actual preview bytes or handle facts were lost", result, err)
	}
	streaming, offset := cosyVoiceWAVForTest(true, true)
	preview["data"] = base64.StdEncoding.EncodeToString(streaming)
	result, err = executeDashScopeVoiceWorkflow(context.Background(), request, config)
	if err != nil || len(result.PreviewAudio) != len(streaming) || !bytes.Equal(result.PreviewAudio[offset+8:], streaming[offset+8:]) {
		t.Fatal("completed preview lost original PCM during length finalization", result, err)
	}
	for _, mutate := range []func(){
		func() { preview["data"] = "malformed" },
		func() { preview["data"] = base64.StdEncoding.EncodeToString([]byte("not WAV")) },
		func() { preview["sample_rate"] = 16000 },
		func() { preview["response_format"] = "pcm" },
	} {
		preview["data"], preview["sample_rate"], preview["response_format"] = base64.StdEncoding.EncodeToString(wav), 24000, "wav"
		mutate()
		result, err := executeDashScopeVoiceWorkflow(context.Background(), request, config)
		if err == nil || result.ProviderVoiceRef != "voice-created" || len(result.PreviewAudio) != 0 {
			t.Fatal("malformed preview published success or lost cleanup identity", result, err)
		}
	}
	delete(response["output"].(map[string]any), "preview_audio")
	result, err = executeDashScopeVoiceWorkflow(context.Background(), request, config)
	if err != nil || result.ProviderVoiceRef != "voice-created" || len(result.PreviewAudio) != 0 {
		t.Fatal("optional absent preview was fabricated or rejected", result, err)
	}
}
