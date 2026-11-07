package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExecuteBytedanceARKTaskVideoForwardsResolution(t *testing.T) {
	var capturedPayload map[string]any
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/contents/generations/tasks":
			_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":     "ark-video-task-1",
				"status": "queued",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/ark-video-task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":      "ark-video-task-1",
				"model":   "doubao-seedance-2-0-260128",
				"status":  "succeeded",
				"content": map[string]any{"video_url": server.URL + "/artifact.mp4"},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/artifact.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("ark-video-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	_, _, providerJobID, err := ExecuteBytedanceARKTask(
		ctx,
		MediaAdapterConfig{
			BaseURL:               server.URL,
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		noopJobStateUpdater{},
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
							DurationSec: testInt32(4),
							Resolution:  "480p",
							Ratio:       "16:9",
						},
					},
				},
			},
		},
		"doubao-seedance-2-0-260128",
	)
	if !errors.Is(err, ErrNativeTaskYielded) {
		t.Fatalf("native create did not yield: %v", err)
	}
	observation, _, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-api-key", AllowLoopbackEndpoint: true}, receipt)
	artifacts := observation.GetArtifacts()

	if err != nil {
		t.Fatalf("ExecuteBytedanceARKTask video failed: %v", err)
	}
	if providerJobID != "ark-video-task-1" {
		t.Fatalf("unexpected providerJobID: %q", providerJobID)
	}
	if got := strings.TrimSpace(ValueAsString(capturedPayload["model"])); got != "doubao-seedance-2-0-260128" {
		t.Fatalf("unexpected model: %q", got)
	}
	if got := strings.TrimSpace(ValueAsString(capturedPayload["resolution"])); got != "480p" {
		t.Fatalf("unexpected resolution: %q", got)
	}
	if got := strings.TrimSpace(ValueAsString(capturedPayload["ratio"])); got != "16:9" {
		t.Fatalf("unexpected ratio: %q", got)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one video artifact, got=%d", len(artifacts))
	}
	if len(artifacts[0].GetBytes()) != 0 || artifacts[0].GetUri() != server.URL+"/artifact.mp4" {
		t.Fatalf("unexpected private video source: %+v", artifacts[0])
	}
}
