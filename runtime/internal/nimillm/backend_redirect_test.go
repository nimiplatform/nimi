package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textwire"
)

func TestCapturedTextControlDoesNotFollowRedirects(t *testing.T) {
	for _, status := range []int{http.StatusFound, http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		for _, destination := range []string{"same-origin", "other-port", "forbidden"} {
			t.Run(http.StatusText(status)+"/"+destination, func(t *testing.T) {
				var initialCalls, targetCalls atomic.Int32
				target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { targetCalls.Add(1); w.WriteHeader(400) }))
				defer target.Close()
				location := target.URL + "/redirected"
				if destination == "forbidden" {
					location = "http://169.254.169.254/redirected"
				}
				initial := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					initialCalls.Add(1)
					if r.URL.Path != "/v1/chat/completions" {
						w.WriteHeader(400)
						return
					}
					w.Header().Set("Location", location)
					w.WriteHeader(status)
				}))
				defer initial.Close()
				if destination == "same-origin" {
					location = initial.URL + "/redirected"
				}
				provider := NewCloudProvider(CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true})
				captured := &RemoteTarget{ProviderType: "openai", ProviderModelID: "captured-model", Endpoint: initial.URL, APIKey: "fixture", AllowLoopback: true}
				spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "fixture request"}}}
				_, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "captured-model", spec, "", captured, textwire.Directives{})
				if err == nil || initialCalls.Load() != 1 || targetCalls.Load() != 0 {
					t.Fatalf("control redirect followed: initial=%d target=%d err=%v", initialCalls.Load(), targetCalls.Load(), err)
				}
			})
		}
	}
}

func TestFiniteSpeechPreservesCapturedProxyRequestTarget(t *testing.T) {
	for _, consumer := range []string{"tts", "asr"} {
		t.Run(consumer, func(t *testing.T) {
			seen := make(chan string, 1)
			peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen <- r.RequestURI; w.WriteHeader(400) }))
			defer peer.Close()
			captured := peer.URL + "/gateway%2Ftenant/compatible-mode/v1?workspace=team&route=a%2Fb"
			var err error
			if consumer == "tts" {
				backend := NewSecuredBackend("cloud-dashscope", captured, "fixture", time.Second, true)
				if backend == nil {
					t.Fatal("captured endpoint rejected")
				}
				_, _, err = backend.streamDashScopeRealtimeTTS(context.Background(), "cosyvoice-v3-flash", &runtimev1.SpeechSynthesizeScenarioSpec{Text: "fixture"}, nil, func(SpeechStreamChunk) error { return nil })
			} else {
				_, _, _, err = executeDashScopeFiniteASR(context.Background(), MediaAdapterConfig{BaseURL: captured, APIKey: "fixture", AllowLoopbackEndpoint: true}, finiteASRTestRequest(finiteASRTestWAV()), "qwen-audio-3.0-asr-flash-streaming")
			}
			if err == nil {
				t.Fatal("fixture rejects handshake; no provider success expected")
			}
			select {
			case got := <-seen:
				if got != "/gateway%2Ftenant/api-ws/v1/inference?workspace=team&route=a%2Fb" {
					t.Fatalf("captured route changed: %s", got)
				}
			case <-time.After(time.Second):
				t.Fatal("no handshake")
			}
		})
	}
}
