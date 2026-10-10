package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestNativeReceiptRejectsForeignQueryBeforeCredentialedIO(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	for _, path := range []string{server.URL + "/foreign/{task_id}", "//foreign.invalid/{task_id}", "/other-provider/{task_id}", "/contents/generations/tasks/{task_id}?forward=foreign"} {
		receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterBytedanceARKTask, TaskID: "original", QueryPathTemplate: path, Artifact: BinaryArtifact("video/mp4", nil, nil)}
		if _, terminal, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "original-secret"}, receipt); err == nil || terminal {
			t.Fatalf("foreign selector accepted: %q terminal=%v err=%v", path, terminal, err)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid receipt performed %d credentialed calls", calls.Load())
	}
}
