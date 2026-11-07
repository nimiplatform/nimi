package nimillm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMubertCredentialPairIsCompleteAndUnambiguous(t *testing.T) {
	for name, cfg := range map[string]MediaAdapterConfig{"composite": {APIKey: "customer::token", Headers: map[string]string{"X-Trace": "value"}}, "headers": {Headers: map[string]string{"Customer-ID": "customer", "Access-Token": "token"}}, "same": {APIKey: "customer::token", Headers: map[string]string{"customer-id": "customer", "access-token": "token"}}} {
		t.Run(name, func(t *testing.T) {
			h := mubertHeaders(cfg)
			if h["customer-id"] != "customer" || h["access-token"] != "token" {
				t.Fatal("missing native credentials")
			}
		})
	}
	for name, cfg := range map[string]MediaAdapterConfig{"company": {APIKey: "company-token"}, "partial": {Headers: map[string]string{"customer-id": "customer"}}, "conflict": {APIKey: "other::token", Headers: map[string]string{"customer-id": "customer", "access-token": "token"}}, "empty": {APIKey: "::token"}, "newline": {APIKey: "customer::token\nvalue"}} {
		t.Run(name, func(t *testing.T) {
			if h := mubertHeaders(cfg); h != nil {
				t.Fatal("invalid native identity admitted")
			}
		})
	}
}

func TestMubertProbeUsesCustomerPlaylistRead(t *testing.T) {
	calls := 0
	status := 200
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/proxy/api/v3/public/playlists" || r.Method != "GET" || r.Header.Get("customer-id") != "customer" || r.Header.Get("access-token") != "token" || r.Header.Get("Authorization") != "" {
			t.Errorf("native probe %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		fmt.Fprint(w, `{"data":[]}`)
	}))
	defer server.Close()
	p := &CloudProvider{allowLoopbackEndpoint: true}
	if err := p.ProbeConnector(context.Background(), "mubert", server.URL+"/proxy/api/v3", "customer::token", nil); err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	status = 401
	if err := p.ProbeConnector(context.Background(), "mubert", server.URL+"/proxy/api/v3", "customer::token", nil); err == nil || calls != 2 {
		t.Fatal("auth failure hidden", err, calls)
	}
	if err := p.ProbeConnector(context.Background(), "mubert", server.URL+"/proxy/api/v3", "company-key", nil); err == nil || calls != 2 {
		t.Fatal("bad credential format dispatched", err, calls)
	}
	if outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterMubertMusic, "track-original", MediaAdapterConfig{BaseURL: server.URL, APIKey: "customer::token", AllowLoopbackEndpoint: true}); err != nil || outcome != ProviderTaskCleanupUnsupported || calls != 2 {
		t.Fatal("unreviewed native cancellation attempted", outcome, err, calls)
	}
}

func TestMubertAcceptedButIncompleteCreateNeverInventsGeneration(t *testing.T) {
	for name, body := range map[string]string{
		"missing":   `{"data":{"id":"track-original","generations":[]}}`,
		"ambiguous": `{"data":{"id":"track-original","generations":[{"session_id":"one","format":"mp3"},{"session_id":"two","format":"mp3"}]}}`,
	} {
		t.Run(name, func(t *testing.T) {
			calls, published := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "POST" || r.URL.Path != "/public/tracks" {
					t.Error("unexpected follow-up request")
				}
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			ctx := WithNativeTaskPublisher(context.Background(), func(*NativeTaskReceipt) error { published++; return nil })
			_, _, id, err := ExecuteMubertMusic(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "customer::token", AllowLoopbackEndpoint: true}, newMusicJobRequest("mubert-track-v3", "A calm cue."), "mubert-track-v3")
			if !IsNativeCreateResponseUnavailable(err) || id != "" || published != 0 || calls != 1 {
				t.Fatal("missing original identity became usable", err, id, published, calls)
			}
		})
	}
}

func TestMubertOriginalGenerationReceiptAndObservation(t *testing.T) {
	receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterMubertMusic, TaskID: "track-original", Model: "mubert-track-v3", MubertGenerationID: "generation-original", QueryPathTemplate: "/public/tracks/{task_id}", Artifact: BinaryArtifact("audio/mpeg", nil, nil)}
	if err := ValidateNativeTaskReceipt(receipt); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", "different", "../other"} {
		copy := CloneNativeTaskReceipt(receipt)
		copy.MubertGenerationID = id
		if EqualNativeTaskReceipt(copy, receipt) {
			t.Fatal("generation identity mutation lost")
		}
		if id != "different" && ValidateNativeTaskReceipt(copy) == nil {
			t.Fatal("invalid generation accepted")
		}
	}
	body := `{"data":{"id":"track-original","generations":[{"session_id":"generation-original","format":"mp3","status":"processing"}]}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/public/tracks/track-original" {
			t.Error("wrong original query")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL, APIKey: "customer::token", AllowLoopbackEndpoint: true}
	if observation, done, err := ObserveNativeTask(context.Background(), cfg, receipt); err != nil || done || observation != nil {
		t.Fatal(observation, done, err)
	}
	for name, b := range map[string]string{"track": `{"data":{"id":"other","generations":[{"session_id":"generation-original","format":"mp3","status":"done","url":"https://example.com/result.mp3"}]}}`, "session": `{"data":{"id":"track-original","generations":[{"session_id":"other","format":"mp3","status":"done","url":"https://example.com/result.mp3"}]}}`, "format": `{"data":{"id":"track-original","generations":[{"session_id":"generation-original","format":"wav","status":"done","url":"https://example.com/result.wav"}]}}`, "unknown status": `{"data":{"id":"track-original","generations":[{"session_id":"generation-original","format":"mp3","status":"mystery"}]}}`} {
		t.Run(name, func(t *testing.T) {
			body = b
			if _, done, err := ObserveNativeTask(context.Background(), cfg, receipt); err == nil || done {
				t.Fatal("unconfirmed state treated as terminal", done, err)
			}
		})
	}
	body = `{"data":{"id":"track-original","generations":[{"session_id":"generation-original","format":"mp3","status":"failed"}]}}`
	if _, done, err := ObserveNativeTask(context.Background(), cfg, receipt); err == nil || !done {
		t.Fatal("original failure lost", done, err)
	}
}
