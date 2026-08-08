package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExecuteElevenLabsTTSKeepsDefaultVoiceSettingsWithoutHints(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("audio"))
	}))
	defer func() { server.Close() }()

	_, _, _, err := ExecuteElevenLabsTTS(context.Background(), MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "test-key",
	}, newTTSSecurityJob("hello", "voice-1"), "eleven_multilingual_v2")
	if err != nil {
		t.Fatalf("ExecuteElevenLabsTTS: %v", err)
	}
	settings, ok := captured["voice_settings"].(map[string]any)
	if !ok {
		t.Fatalf("voice_settings=%T, want object", captured["voice_settings"])
	}
	if got := ValueAsFloat64(settings["stability"]); got != 0.5 {
		t.Fatalf("stability=%v, want default 0.5", settings["stability"])
	}
	if got := ValueAsFloat64(settings["similarity_boost"]); got != 0.75 {
		t.Fatalf("similarity_boost=%v, want default 0.75", settings["similarity_boost"])
	}
}

func TestExecuteElevenLabsTTSMapsVoiceRenderHints(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("audio"))
	}))
	defer func() { server.Close() }()

	req := newTTSSecurityJob("hello", "voice-1")
	spec := req.GetSpec().GetSpeechSynthesize()
	spec.Speed = testFloat32(0.8)
	spec.VoiceRenderHints = &runtimev1.VoiceRenderHints{
		Stability:       0.61,
		SimilarityBoost: 0.82,
		Style:           0.27,
		UseSpeakerBoost: true,
		Speed:           1.15,
	}

	_, _, _, err := ExecuteElevenLabsTTS(context.Background(), MediaAdapterConfig{
		BaseURL:               server.URL,
		AllowLoopbackEndpoint: true,
		APIKey:                "test-key",
	}, req, "eleven_multilingual_v2")
	if err != nil {
		t.Fatalf("ExecuteElevenLabsTTS: %v", err)
	}

	settings, ok := captured["voice_settings"].(map[string]any)
	if !ok {
		t.Fatalf("voice_settings=%T, want object", captured["voice_settings"])
	}
	for key, want := range map[string]float64{
		"stability":        0.61,
		"similarity_boost": 0.82,
		"style":            0.27,
		"speed":            1.15,
	} {
		if got := ValueAsFloat64(settings[key]); got != want {
			t.Fatalf("voice_settings[%q]=%v, want %v", key, settings[key], want)
		}
	}
	if !ValueAsBool(settings["use_speaker_boost"]) {
		t.Fatalf("use_speaker_boost=%v, want true", settings["use_speaker_boost"])
	}
}
