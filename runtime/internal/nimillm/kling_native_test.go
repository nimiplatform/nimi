package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestKlingConnectorChecksAuthenticatedAccountEnvelope(t *testing.T) {
	for _, code := range []int{0, 1002} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				start, _ := strconv.ParseInt(r.URL.Query().Get("start_time"), 10, 64)
				end, _ := strconv.ParseInt(r.URL.Query().Get("end_time"), 10, 64)
				if r.URL.Path != "/proxy/anthropic/account/costs" || end-start != int64((24*time.Hour)/time.Millisecond) || end > time.Now().UnixMilli() || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" {
					t.Error("wrong native account check", r.URL.String())
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "data": map[string]any{"code": 0, "resource_pack_subscribe_infos": []any{}}})
			}))
			defer server.Close()
			b := NewSecuredBackend("cloud-kling", server.URL+"/proxy/anthropic/v1", "test-key", defaultHTTPTimeout, true)
			err := b.ProbeConnector(context.Background())
			if (err == nil) != (code == 0) || calls != 1 {
				t.Fatal("HTTP200 mistaken for authenticated success", err, calls)
			}
		})
	}
}

func TestKlingOriginalTaskRejectsDifferentIdentityAndDialect(t *testing.T) {
	for _, model := range []string{"kling-4.0", "kling-v3", "kling-v3-omni"} {
		t.Run(model, func(t *testing.T) {
			query, mime := klingVideoQueryPath, "video/mp4"
			if model != "kling-4.0" {
				query, mime = klingImageQueryPath, "image/png"
				if model == "kling-v3-omni" {
					query = klingOmniImageQueryPath
				}
			}
			receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterKlingTask, Model: model, TaskID: "original", QueryPathTemplate: query, Artifact: BinaryArtifact(mime, nil, nil)}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				var data any = map[string]any{"task_id": "different", "task_status": "succeed", "task_result": map[string]any{"images": []any{map[string]any{"url": "https://example.com/result.png"}}}}
				if model == "kling-4.0" {
					data = []any{map[string]any{"id": "different", "status": "succeeded", "outputs": []any{map[string]any{"type": "video", "url": "https://example.com/result.mp4"}}}}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": data})
			}))
			defer server.Close()
			if got, terminal, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test", AllowLoopbackEndpoint: true}, receipt); err == nil || terminal || got != nil {
				t.Fatal("another task became original result", got, terminal, err)
			}
			receipt.QueryPathTemplate = "/v1/videos/text2video/{task_id}"
			if ValidateNativeTaskReceipt(receipt) == nil {
				t.Fatal("retired generic video dialect admitted")
			}
		})
	}
}
