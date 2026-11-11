package managedimagebackend

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestNativeControlImageSubmitsTypedParametersAndReadsCompletedJob(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 64, 64))); err != nil {
		t.Fatal(err)
	}
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/sdcpp/v1/img_gen":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			if payload["control_type"] != "canny" || payload["control_strength"] != 1.0 || payload["control_image"] != base64.StdEncoding.EncodeToString(encoded.Bytes()) || payload["prompt"] != "yellow cup" {
				t.Error("native control map parameters changed", payload)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"job_test","kind":"img_gen","status":"queued"}`))
		case "/sdcpp/v1/jobs/job_test":
			polls.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "job_test", "kind": "img_gen", "status": "completed", "result": map[string]any{"output_format": "png", "images": []any{map[string]any{"index": 0, "b64_json": base64.StdEncoding.EncodeToString(encoded.Bytes())}}}})
		default:
			t.Errorf("unexpected native path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	loaded := loadModelState{Options: managedImageOptions{Checkpoint: true, Components: []managedImageComponent{{EngineSlot: "control_net_path", Path: "control.safetensors"}}}}
	request := imageGenerateState{Mode: ImageRequestModeControl, PositivePrompt: "yellow cup", Width: 64, Height: 64, Step: 20, Seed: 42, CFGScale: 7, Sampler: "euler", Scheduler: "discrete", ReferenceImage: encoded.Bytes(), ControlType: "canny", ControlStrength: 1}
	got, err := defaultStableDiffusionCPPGenerateRequester(context.Background(), server.Client(), server.URL, loaded, request)
	if err != nil || !bytes.Equal(got, encoded.Bytes()) || polls.Load() != 1 {
		t.Fatalf("native result bytes=%d polls=%d err=%v", len(got), polls.Load(), err)
	}
}

func TestNativeControlImageCancelsItsExactJob(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var cancellations atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sdcpp/v1/img_gen":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"job_cancel","kind":"img_gen","status":"queued"}`))
		case "/sdcpp/v1/jobs/job_cancel":
			cancel()
			_, _ = w.Write([]byte(`{"id":"job_cancel","kind":"img_gen","status":"generating"}`))
		case "/sdcpp/v1/jobs/job_cancel/cancel":
			cancellations.Add(1)
			_, _ = w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected native path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	loaded := loadModelState{Options: managedImageOptions{Checkpoint: true, Components: []managedImageComponent{{EngineSlot: "control_net_path", Path: "control.safetensors"}}}}
	_, err := generateNativeControlImage(ctx, server.Client(), server.URL, loaded, imageGenerateState{ReferenceImage: []byte("captured map"), ControlType: "tile", ControlStrength: 1})
	if !errors.Is(err, context.Canceled) || cancellations.Load() != 1 {
		t.Fatalf("cancellation=%d error=%v", cancellations.Load(), err)
	}
}
