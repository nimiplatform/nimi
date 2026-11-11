package managedimagebackend

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

var nativeImageJobID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validManagedControlType(value string) bool {
	return slices.Contains([]string{"openpose", "depth", "scribble", "canny", "normal", "segment", "tile", "repaint"}, value)
}

type nativeControlImageJob struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Result *struct {
		OutputFormat string `json:"output_format"`
		Images       []struct {
			Index  int    `json:"index"`
			Base64 string `json:"b64_json"`
		} `json:"images"`
	} `json:"result"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.sdxl-controlnet-union
func generateNativeControlImage(ctx context.Context, client *http.Client, endpoint string, loaded loadModelState, req imageGenerateState) ([]byte, error) {
	if !loaded.Options.Checkpoint || loaded.Options.ComponentsBySlot()["control_net_path"] == "" || req.Src != "" || req.Mask != "" || len(req.ReferenceImage) == 0 || !validManagedControlType(req.ControlType) || math.IsNaN(float64(req.ControlStrength)) || math.IsInf(float64(req.ControlStrength), 0) || req.ControlStrength < 0 || req.ControlStrength > 2 {
		return nil, fmt.Errorf("native ControlNet request does not match the loaded checkpoint")
	}
	payload := map[string]any{
		"prompt": req.PositivePrompt, "negative_prompt": req.NegativePrompt,
		"width": req.Width, "height": req.Height, "seed": req.Seed,
		"batch_count": 1, "output_format": "png",
		"control_image": base64.StdEncoding.EncodeToString(req.ReferenceImage),
		"control_type":  req.ControlType, "control_strength": req.ControlStrength,
		"sample_params": map[string]any{"sample_steps": req.Step, "sample_method": req.Sampler, "scheduler": req.Scheduler, "guidance": map[string]any{"txt_cfg": req.CFGScale}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode native ControlNet request: %w", err)
	}
	base := strings.TrimRight(endpoint, "/")
	job, err := readNativeControlJob(ctx, client, http.MethodPost, base+"/sdcpp/v1/img_gen", body, http.StatusAccepted)
	if err != nil {
		return nil, err
	}
	if !nativeImageJobID.MatchString(job.ID) || job.Kind != "img_gen" {
		return nil, fmt.Errorf("native image submission returned an invalid job identity")
	}
	id := job.ID
	defer func() {
		if ctx.Err() == nil {
			return
		}
		cancelCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		request, err := http.NewRequestWithContext(cancelCtx, http.MethodPost, base+"/sdcpp/v1/jobs/"+id+"/cancel", nil)
		if err == nil {
			if response, sendErr := client.Do(request); sendErr == nil {
				_ = response.Body.Close()
			}
		}
	}()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		if job.ID != id || job.Kind != "img_gen" {
			return nil, fmt.Errorf("native image job identity changed")
		}
		switch job.Status {
		case "completed":
			if job.Error != nil || job.Result == nil || job.Result.OutputFormat != "png" || len(job.Result.Images) != 1 || job.Result.Images[0].Index != 0 {
				return nil, fmt.Errorf("native image job returned an invalid result")
			}
			return decodeManagedImageBase64(job.Result.Images[0].Base64)
		case "failed", "cancelled":
			if job.Error != nil {
				return nil, fmt.Errorf("native image job %s: %s: %s", job.Status, job.Error.Code, job.Error.Message)
			}
			return nil, fmt.Errorf("native image job %s", job.Status)
		case "queued", "generating":
		default:
			return nil, fmt.Errorf("native image job status is invalid")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
		job, err = readNativeControlJob(ctx, client, http.MethodGet, base+"/sdcpp/v1/jobs/"+id, nil, http.StatusOK)
		if err != nil {
			return nil, err
		}
	}
}

func readNativeControlJob(ctx context.Context, client *http.Client, method, endpoint string, payload []byte, expectedStatus int) (nativeControlImageJob, error) {
	var job nativeControlImageJob
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(payload))
	if err != nil {
		return job, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return job, fmt.Errorf("native ControlNet request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != expectedStatus {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return job, fmt.Errorf("native ControlNet HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, localexecution.MaxImageArtifactBytes*2+(1<<20))).Decode(&job); err != nil {
		return job, fmt.Errorf("decode native image job: %w", err)
	}
	return job, nil
}
