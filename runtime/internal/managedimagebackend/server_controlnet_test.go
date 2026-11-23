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
	"slices"
	"sync/atomic"
	"testing"
	"time"
)

func TestNativeControlImageSubmitsTypedParametersAndForwardsSamplingProgress(t *testing.T) {
	originalPoll := nativeImageJobPollInterval
	nativeImageJobPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { nativeImageJobPollInterval = originalPoll })

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
			switch polls.Add(1) {
			case 1:
				// Conditioning / 0-step sampling must be ignored without failing.
				_, _ = w.Write([]byte(`{"id":"job_test","kind":"img_gen","status":"generating","progress":{"stage":"conditioning","completed":null,"total":null,"unit":null}}`))
			case 2:
				_, _ = w.Write([]byte(`{"id":"job_test","kind":"img_gen","status":"generating","progress":{"stage":"sampling","completed":0,"total":20,"unit":"steps"}}`))
			case 3:
				_, _ = w.Write([]byte(`{"id":"job_test","kind":"img_gen","status":"generating","progress":{"stage":"sampling","completed":5,"total":20,"unit":"steps"}}`))
			case 4:
				// Duplicate step must be deduplicated.
				_, _ = w.Write([]byte(`{"id":"job_test","kind":"img_gen","status":"generating","progress":{"stage":"sampling","completed":5,"total":20,"unit":"steps"}}`))
			case 5:
				_, _ = w.Write([]byte(`{"id":"job_test","kind":"img_gen","status":"generating","progress":{"stage":"sampling","completed":15,"total":20,"unit":"steps"}}`))
			case 6:
				// Encoding images stage must be ignored without failing.
				_, _ = w.Write([]byte(`{"id":"job_test","kind":"img_gen","status":"generating","progress":{"stage":"encoding","completed":0,"total":1,"unit":"images"}}`))
			default:
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "job_test", "kind": "img_gen", "status": "completed", "result": map[string]any{"output_format": "png", "images": []any{map[string]any{"index": 0, "b64_json": base64.StdEncoding.EncodeToString(encoded.Bytes())}}}})
			}
		default:
			t.Errorf("unexpected native path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	loaded := loadModelState{Options: managedImageOptions{Checkpoint: true, Components: []managedImageComponent{{EngineSlot: "control_net_path", Path: "control.safetensors"}}}}
	request := imageGenerateState{Mode: ImageRequestModeControl, PositivePrompt: "yellow cup", Width: 64, Height: 64, Step: 20, Seed: 42, CFGScale: 7, Sampler: "euler", Scheduler: "discrete", ReferenceImage: encoded.Bytes(), ControlType: "canny", ControlStrength: 1}
	var observed []imageGenerateProgress
	got, err := defaultStableDiffusionCPPGenerateRequester(context.Background(), server.Client(), server.URL, loaded, request, func(p imageGenerateProgress) error {
		observed = append(observed, p)
		return nil
	})
	if err != nil || !bytes.Equal(got, encoded.Bytes()) || polls.Load() != 7 {
		t.Fatalf("native result bytes=%d polls=%d err=%v", len(got), polls.Load(), err)
	}
	wantProgress := []imageGenerateProgress{
		{CurrentStep: 5, TotalSteps: 20, ProgressPercent: 25},
		{CurrentStep: 15, TotalSteps: 20, ProgressPercent: 75},
	}
	if !slices.Equal(observed, wantProgress) {
		t.Fatalf("observed native progress = %+v, want %+v", observed, wantProgress)
	}
}

func TestNativeControlImageCancelsItsExactJob(t *testing.T) {
	originalPoll := nativeImageJobPollInterval
	nativeImageJobPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { nativeImageJobPollInterval = originalPoll })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sdcpp/v1/img_gen":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"job_cancel","kind":"img_gen","status":"queued"}`))
		case "/sdcpp/v1/jobs/job_cancel":
			polls.Add(1)
			cancel()
			_, _ = w.Write([]byte(`{"id":"job_cancel","kind":"img_gen","status":"generating"}`))
		default:
			t.Errorf("unexpected native path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	loaded := loadModelState{Options: managedImageOptions{Checkpoint: true, Components: []managedImageComponent{{EngineSlot: "control_net_path", Path: "control.safetensors"}}}}
	_, err := defaultStableDiffusionCPPGenerateRequester(ctx, server.Client(), server.URL, loaded, imageGenerateState{Mode: ImageRequestModeControl, ReferenceImage: []byte("captured map"), ControlType: "tile", ControlStrength: 1}, nil)
	if !errors.Is(err, context.Canceled) || polls.Load() != 1 {
		t.Fatalf("polls=%d error=%v", polls.Load(), err)
	}
}

func TestNativeImageProgressCallbackErrorCancelsJobImmediately(t *testing.T) {
	originalPoll := nativeImageJobPollInterval
	nativeImageJobPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { nativeImageJobPollInterval = originalPoll })

	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sdcpp/v1/img_gen":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"job_prog_err","kind":"img_gen","status":"queued"}`))
		case "/sdcpp/v1/jobs/job_prog_err":
			polls.Add(1)
			_, _ = w.Write([]byte(`{"id":"job_prog_err","kind":"img_gen","status":"generating","progress":{"stage":"sampling","completed":2,"total":6,"unit":"steps"}}`))
		default:
			t.Errorf("unexpected native path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	sentinel := errors.New("progress rejected")
	_, err := defaultStableDiffusionCPPGenerateRequester(context.Background(), server.Client(), server.URL, loadModelState{}, imageGenerateState{
		Mode: ImageRequestModeTextToImage, PositivePrompt: "test", Step: 6,
	}, func(imageGenerateProgress) error {
		return sentinel
	})
	if !errors.Is(err, sentinel) || polls.Load() != 1 {
		t.Fatalf("progress error = %v polls=%d", err, polls.Load())
	}
}
