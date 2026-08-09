package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExecuteBytedanceARKTaskImageOmitsUnsupportedResponseFormat(t *testing.T) {
	var capturedPayload map[string]any
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/images/generations":
			_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"url": server.URL + "/artifact.png",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/artifact.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("ark-image-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	artifacts, _, providerJobID, err := ExecuteBytedanceARKTask(
		context.Background(),
		MediaAdapterConfig{
			BaseURL:               server.URL,
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		noopJobStateUpdater{},
		"job-image-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
						Prompt:         "a calico cat wearing a black hat",
						Size:           "2k",
						ResponseFormat: "url",
					},
				},
			},
		},
		"seedream-5.0",
	)
	if err != nil {
		t.Fatalf("ExecuteBytedanceARKTask image failed: %v", err)
	}
	if providerJobID != "" {
		t.Fatalf("unexpected providerJobID: %q", providerJobID)
	}
	if capturedPayload == nil {
		t.Fatal("expected captured payload")
	}
	if _, ok := capturedPayload["response_format"]; ok {
		t.Fatalf("seedream image payload must not include response_format: %#v", capturedPayload["response_format"])
	}
	if got := strings.TrimSpace(ValueAsString(capturedPayload["model"])); got != "seedream-5.0" {
		t.Fatalf("unexpected model: %q", got)
	}
	if got := strings.TrimSpace(ValueAsString(capturedPayload["size"])); got != "2k" {
		t.Fatalf("unexpected size: %q", got)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one image artifact, got=%d", len(artifacts))
	}
	if len(artifacts[0].GetBytes()) != 0 || artifacts[0].GetUri() != server.URL+"/artifact.png" {
		t.Fatalf("unexpected private image source: %+v", artifacts[0])
	}
}

func TestExecuteBytedanceARKTaskImageNormalizesSeedreamSmallSize(t *testing.T) {
	var capturedPayload map[string]any
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/images/generations":
			_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"url": server.URL + "/artifact.png",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/artifact.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("ark-image-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, _, _, err := ExecuteBytedanceARKTask(
		context.Background(),
		MediaAdapterConfig{
			BaseURL:               server.URL,
			AllowLoopbackEndpoint: true,
			APIKey:                "test-api-key",
		},
		noopJobStateUpdater{},
		"job-image-small-size-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
						Prompt: "a calico cat wearing a black hat",
						Size:   "512x512",
					},
				},
			},
		},
		"seedream-5.0",
	)
	if err != nil {
		t.Fatalf("ExecuteBytedanceARKTask image failed: %v", err)
	}
	if capturedPayload == nil {
		t.Fatal("expected captured payload")
	}
	if got := strings.TrimSpace(ValueAsString(capturedPayload["size"])); got != "2k" {
		t.Fatalf("seedream image payload must normalize too-small size to 2k, got %q", got)
	}
}

func TestNormalizeBytedanceARKImageSize(t *testing.T) {
	tests := []struct {
		name          string
		modelResolved string
		rawSize       string
		want          string
	}{
		{
			name:          "non-seedream keeps caller size",
			modelResolved: "some-image-model",
			rawSize:       "512x512",
			want:          "512x512",
		},
		{
			name:          "seedream empty defaults to native high resolution",
			modelResolved: "seedream-5.0",
			rawSize:       "",
			want:          "2k",
		},
		{
			name:          "seedream tester default is too small",
			modelResolved: "seedream-5.0",
			rawSize:       "512x512",
			want:          "2k",
		},
		{
			name:          "seedream provider model too small",
			modelResolved: "doubao-seedream-5-0-260128",
			rawSize:       "1024x1024",
			want:          "2k",
		},
		{
			name:          "seedream provider-prefixed model too small",
			modelResolved: "volcengine/doubao-seedream-5-0-260128",
			rawSize:       "768x768",
			want:          "2k",
		},
		{
			name:          "seedream valid square size is preserved",
			modelResolved: "seedream-5.0",
			rawSize:       "1920x1920",
			want:          "1920x1920",
		},
		{
			name:          "seedream shorthand is preserved",
			modelResolved: "seedream-5.0",
			rawSize:       "2K",
			want:          "2k",
		},
		{
			name:          "malformed size fails closed",
			modelResolved: "seedream-5.0",
			rawSize:       "wide",
			want:          "wide",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeBytedanceARKImageSize(tt.modelResolved, tt.rawSize); got != tt.want {
				t.Fatalf("normalizeBytedanceARKImageSize(%q, %q) = %q, want %q", tt.modelResolved, tt.rawSize, got, tt.want)
			}
		})
	}
}

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
				"id":        "ark-video-task-1",
				"status":    "succeeded",
				"video_url": server.URL + "/artifact.mp4",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/artifact.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("ark-video-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	artifacts, _, providerJobID, err := ExecuteBytedanceARKTask(
		context.Background(),
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
