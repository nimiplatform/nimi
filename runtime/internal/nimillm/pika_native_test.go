package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPikaCancelNeedsConfirmedOriginalJob(t *testing.T) {
	for _, tc := range []struct {
		name              string
		status            int
		id, state, cancel string
		want              ProviderTaskCleanupOutcome
	}{
		{"confirmed", 200, "original", "cancelled", "cancelled", ProviderTaskCleanupCanceled},
		{"pending", 202, "original", "queued", "pending", ProviderTaskCleanupUnconfirmed},
		{"202-is-not-proof", 202, "original", "cancelled", "cancelled", ProviderTaskCleanupUnconfirmed},
		{"wrong-job", 200, "other", "cancelled", "cancelled", ProviderTaskCleanupUnconfirmed},
		{"too-late", 409, "original", "running", "", ProviderTaskCleanupNotCancelable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/prefix/anthropic/v1/media/jobs/original/cancel" || r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("wrong original cancel request")
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": tc.id, "status": tc.state, "cancellation_status": tc.cancel})
			}))
			defer server.Close()
			got, _ := DeleteProviderAsyncTask(context.Background(), AdapterPikaTask, "original", MediaAdapterConfig{BaseURL: server.URL + "/prefix/anthropic/v1", APIKey: "test-key", AllowLoopbackEndpoint: true})
			if got != tc.want {
				t.Fatal(got, tc.want)
			}
		})
	}
}

func TestPikaProbeUsesPrivateBalanceAndDoesNotRequireFunds(t *testing.T) {
	for _, valid := range []bool{true, false} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "GET" || r.URL.Path != "/proxy/anthropic/billing/balance" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" {
				t.Error("wrong account probe")
			}
			w.Header().Set("Content-Type", "application/json")
			if valid {
				_ = json.NewEncoder(w).Encode(map[string]any{"unit": "micro_usd", "currency": "usd", "org_id": "org-owned", "balance_micro_usd": 0})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"apis": []any{}})
			}
		}))
		b := NewSecuredBackend("cloud-pika", server.URL+"/proxy/anthropic/v1", "test-key", defaultHTTPTimeout, true)
		err := b.ProbeConnector(context.Background())
		server.Close()
		if (err == nil) != valid {
			t.Fatal("public catalog or funding confused with credential validation", err)
		}
	}
}

func TestPikaPendingBillingDoesNotBecomeChargeOrDuration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "completed", "runtime_s": 1000, "usage": map[string]any{"output_seconds": 5}, "billing": map[string]any{"state": "pending", "charge_micro_usd": 999}, "output": map[string]any{"media_type": "video", "video": map[string]any{"url": "https://example.com/result.mp4"}}})
	}))
	defer server.Close()
	r := &NativeTaskReceipt{Version: 1, Adapter: AdapterPikaTask, Model: "pika/pika-h3-flex/text-to-video", TaskID: "original", QueryPathTemplate: pikaQueryPath, Artifact: BinaryArtifact("video/mp4", nil, nil)}
	out, done, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, r)
	if err != nil || !done || len(out.Artifacts) != 1 {
		t.Fatal(out, done, err)
	}
	a := out.Artifacts[0]
	if a.GetDurationMs() != 0 || out.Usage != nil || a.GetMetadata().GetFields()["provider_charge_micro_usd"] != nil || a.GetMetadata().GetFields()["provider_billing_state"].GetStringValue() != "pending" {
		t.Fatal("unsettled or unmeasured facts invented", out)
	}
}
