package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const mistralTestVoiceID = "e3382729-55e6-409e-aa7f-a3fc3974f4d3"

func mistralTestVoiceResult() map[string]any {
	return map[string]any{"id": mistralTestVoiceID, "type": "custom", "name": "Nimi fixture", "created_at": "2026-11-06T00:00:00Z", "user_id": "workspace-user", "retention_notice": 30, "kind": "ivc"}
}
func TestMistralStoredVoiceNativeCreateInspectDelete(t *testing.T) {
	var creates, gets, deletes atomic.Int32
	audio := testGeminiTTSWAV()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("voice credential missing")
		}
		if r.Method == "POST" {
			creates.Add(1)
			if r.URL.Path != "/gateway/v1/audio/voices" {
				t.Errorf("create path %s", r.URL.Path)
			}
			var payload map[string]any
			json.NewDecoder(r.Body).Decode(&payload)
			decoded, err := base64.StdEncoding.DecodeString(ValueAsString(payload["sample_audio"]))
			if err != nil || !bytes.Equal(decoded, audio) || payload["name"] != "Nimi fixture" || payload["sample_filename"] != "voice.wav" || payload["retention_notice"] != nil || payload["model"] != nil || payload["voice"] != nil {
				t.Errorf("native create payload fields invalid")
			}
		} else {
			if r.URL.Path != "/gateway/v1/audio/voices/"+mistralTestVoiceID {
				t.Errorf("resource path %s", r.URL.Path)
			}
			if r.Method == "GET" {
				gets.Add(1)
			} else if r.Method == "DELETE" {
				deletes.Add(1)
			} else {
				t.Error("unexpected method")
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mistralTestVoiceResult())
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL + "/gateway/v1", APIKey: "fixture", AllowLoopbackEndpoint: true}
	request := VoiceWorkflowRequest{Provider: "mistral", WorkflowType: "reference_audio", WorkflowModelID: capabilitydriver.MistralVoiceWorkflow, ModelID: capabilitydriver.MistralVoxtralTTS3, Payload: map[string]any{"input": map[string]any{"preferred_name": "Nimi fixture", "reference_audio_mime": "audio/wav", "reference_audio_base64": base64.StdEncoding.EncodeToString(audio), "language_hints": []any{"zh"}}}}
	result, err := ExecuteVoiceWorkflowAdapter(context.Background(), capabilitydriver.CloudMediaAdapterMistralVoiceWorkflow, request, cfg)
	if err != nil || result.ProviderVoiceRef != mistralTestVoiceID || !result.ExpiresAt.IsZero() || result.Usage != nil || len(result.PreviewAudio) != 0 {
		t.Fatalf("created voice invented facts: %+v %v", result, err)
	}
	inspected, found, err := InspectProviderVoiceAdapter(context.Background(), capabilitydriver.CloudMediaAdapterMistralVoiceInspect, "mistral", mistralTestVoiceID, cfg)
	if err != nil || !found || !inspected.ExpiresAt.IsZero() {
		t.Fatalf("inspection %+v %v", inspected, err)
	}
	if err := DeleteProviderVoiceAdapter(context.Background(), capabilitydriver.CloudMediaAdapterMistralVoiceDelete, "mistral", mistralTestVoiceID, cfg); err != nil {
		t.Fatal(err)
	}
	if creates.Load() != 1 || gets.Load() != 1 || deletes.Load() != 1 {
		t.Fatal("voice operation repeated")
	}
}
func TestMistralVoiceDeleteRequiresOriginalResourceReceipt(t *testing.T) {
	for _, mode := range []string{"missing", "unauthorized", "empty", "wrong-id", "preset"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "missing":
					w.WriteHeader(404)
					return
				case "unauthorized":
					w.WriteHeader(401)
					return
				case "empty":
					w.WriteHeader(204)
					return
				}
				payload := mistralTestVoiceResult()
				if mode == "wrong-id" {
					payload["id"] = "9ce6442c-e8df-400e-bcb4-101c119449c9"
				} else {
					payload["type"] = "preset"
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(payload)
			}))
			defer server.Close()
			cfg := MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}
			err := DeleteProviderVoiceAdapter(context.Background(), capabilitydriver.CloudMediaAdapterMistralVoiceDelete, "mistral", mistralTestVoiceID, cfg)
			if (err == nil) != (mode == "missing") {
				t.Fatalf("delete %s %v", mode, err)
			}
			_, found, err := InspectProviderVoiceAdapter(context.Background(), capabilitydriver.CloudMediaAdapterMistralVoiceInspect, "mistral", mistralTestVoiceID, cfg)
			if found || mode == "missing" && err != nil || mode != "missing" && err == nil {
				t.Fatalf("inspection %s %v %v", mode, found, err)
			}
		})
	}
	invalid := mistralTestVoiceResult()
	invalid["created_at"] = "invalid"
	result, err := parseMistralStoredVoice(invalid, "")
	if err == nil || result.ProviderVoiceRef != mistralTestVoiceID || !result.ExpiresAt.Equal(time.Time{}) {
		t.Fatal("known unpublished handle lost on validation failure")
	}
}
