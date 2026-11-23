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
	"os"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

var nativeImageJobPollInterval = 150 * time.Millisecond

type nativeImageJobProgress struct {
	Stage     string `json:"stage"`
	Detail    string `json:"detail"`
	Pass      int    `json:"pass"`
	Completed *int64 `json:"completed"`
	Total     *int64 `json:"total"`
	Unit      string `json:"unit"`
}

type nativeImageJob struct {
	ID       string                  `json:"id"`
	Kind     string                  `json:"kind"`
	Status   string                  `json:"status"`
	Progress *nativeImageJobProgress `json:"progress"`
	Result   *struct {
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

// @nimi-authority: rule.nimi.runtime.local-compute.r067
// @nimi-authority: rule.nimi.runtime.ai-provider.sdxl-controlnet-union
func defaultStableDiffusionCPPGenerateRequester(
	ctx context.Context,
	client *http.Client,
	endpoint string,
	loaded loadModelState,
	req imageGenerateState,
	onProgress func(imageGenerateProgress) error,
) ([]byte, error) {
	if client == nil {
		client = &http.Client{}
	}
	path, payload, err := buildStableDiffusionCPPGenerateRequest(loaded, req)
	if err != nil {
		return nil, err
	}
	requestBody, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal stable-diffusion.cpp generate request: %w", err)
	}
	base := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	job, err := readNativeImageJob(ctx, client, http.MethodPost, base+path, requestBody, http.StatusAccepted)
	if err != nil {
		return nil, err
	}
	if !nativeImageJobID.MatchString(job.ID) || job.Kind != "img_gen" {
		return nil, fmt.Errorf("native image submission returned an invalid job identity")
	}
	id := job.ID
	pollCtx, cancelPoll := context.WithCancel(ctx)
	defer cancelPoll()

	var lastStep int64
	emitProgress := func(progress *nativeImageJobProgress) error {
		update, ok := nativeImageSamplingProgress(progress, req.Step)
		if !ok || int64(update.CurrentStep) <= lastStep {
			return nil
		}
		lastStep = int64(update.CurrentStep)
		if onProgress != nil {
			if err := onProgress(update); err != nil {
				cancelPoll()
				return err
			}
		}
		return nil
	}

	pollInterval := nativeImageJobPollInterval
	if pollInterval <= 0 {
		pollInterval = 150 * time.Millisecond
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		if job.ID != id || job.Kind != "img_gen" {
			return nil, fmt.Errorf("native image job identity changed")
		}
		if err := emitProgress(job.Progress); err != nil {
			return nil, err
		}
		switch job.Status {
		case "completed":
			return decodeNativeImageJobResult(job)
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
		case <-pollCtx.Done():
			return nil, pollCtx.Err()
		case <-ticker.C:
		}
		job, err = readNativeImageJob(pollCtx, client, http.MethodGet, base+"/sdcpp/v1/jobs/"+id, nil, http.StatusOK)
		if err != nil {
			return nil, err
		}
	}
}

func nativeImageSamplingProgress(progress *nativeImageJobProgress, expectedSteps int32) (imageGenerateProgress, bool) {
	if progress == nil || expectedSteps <= 0 {
		return imageGenerateProgress{}, false
	}
	if progress.Stage != "sampling" || progress.Unit != "steps" || progress.Completed == nil || progress.Total == nil {
		return imageGenerateProgress{}, false
	}
	step := *progress.Completed
	total := *progress.Total
	if step <= 0 || total != int64(expectedSteps) || step > total {
		return imageGenerateProgress{}, false
	}
	percent := int32((step * 100) / total)
	return imageGenerateProgress{
		CurrentStep:     int32(step),
		TotalSteps:      int32(total),
		ProgressPercent: percent,
	}, true
}

func decodeNativeImageJobResult(job nativeImageJob) ([]byte, error) {
	if job.Error != nil || job.Result == nil || job.Result.OutputFormat != "png" ||
		len(job.Result.Images) != 1 || job.Result.Images[0].Index != 0 {
		return nil, fmt.Errorf("native image job returned an invalid result")
	}
	return decodeManagedImageBase64(job.Result.Images[0].Base64)
}

func readNativeImageJob(ctx context.Context, client *http.Client, method, endpoint string, payload []byte, expectedStatus int) (nativeImageJob, error) {
	var job nativeImageJob
	var bodyReader io.Reader
	if len(payload) > 0 {
		bodyReader = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bodyReader)
	if err != nil {
		return job, fmt.Errorf("create stable-diffusion.cpp generate request: %w", err)
	}
	if len(payload) > 0 {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return job, fmt.Errorf("execute stable-diffusion.cpp generate request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != expectedStatus {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return job, fmt.Errorf("stable-diffusion.cpp generate request failed: status=%d body=%s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, localexecution.MaxImageArtifactBytes*2+(1<<20))).Decode(&job); err != nil {
		return job, fmt.Errorf("decode native image job: %w", err)
	}
	return job, nil
}

func buildStableDiffusionCPPGenerateRequest(loaded loadModelState, req imageGenerateState) (string, map[string]any, error) {
	sampleParams := map[string]any{
		"guidance": map[string]any{
			"txt_cfg": req.CFGScale,
		},
	}
	if req.Step > 0 {
		sampleParams["sample_steps"] = req.Step
	}
	if sampler := strings.TrimSpace(req.Sampler); sampler != "" {
		sampleParams["sample_method"] = sampler
	}
	if scheduler := strings.TrimSpace(req.Scheduler); scheduler != "" {
		sampleParams["scheduler"] = scheduler
	}

	payload := map[string]any{
		"prompt":        req.PositivePrompt,
		"seed":          req.Seed,
		"batch_count":   1,
		"output_format": "png",
		"sample_params": sampleParams,
	}
	if negative := strings.TrimSpace(req.NegativePrompt); negative != "" {
		payload["negative_prompt"] = negative
	}
	if req.Width > 0 {
		payload["width"] = req.Width
	}
	if req.Height > 0 {
		payload["height"] = req.Height
	}

	switch req.Mode {
	case ImageRequestModeTextToImage:
		if strings.TrimSpace(req.Src) != "" || strings.TrimSpace(req.Mask) != "" || len(req.ReferenceImage) != 0 {
			return "", nil, fmt.Errorf("stable-diffusion.cpp text-to-image request contains image inputs")
		}
		return "/sdcpp/v1/img_gen", payload, nil
	case ImageRequestModeImageToImage:
		if strings.TrimSpace(req.Src) == "" || len(req.ReferenceImage) != 0 {
			return "", nil, fmt.Errorf("stable-diffusion.cpp image-to-image request requires src")
		}
		sourceImage, err := loadManagedImageRequestImage(strings.TrimSpace(req.Src))
		if err != nil {
			return "", nil, err
		}
		payload["init_image"] = sourceImage
		if maskPath := strings.TrimSpace(req.Mask); maskPath != "" {
			maskImage, err := loadManagedImageRequestImage(maskPath)
			if err != nil {
				return "", nil, err
			}
			payload["mask_image"] = maskImage
		}
		return "/sdcpp/v1/img_gen", payload, nil
	case ImageRequestModeInstructionEdit:
		if strings.TrimSpace(req.Src) != "" || strings.TrimSpace(req.Mask) != "" || len(req.ReferenceImage) == 0 {
			return "", nil, fmt.Errorf("stable-diffusion.cpp instruction edit requires resolved image bytes and rejects paths and masks")
		}
		payload["ref_images"] = []string{base64.StdEncoding.EncodeToString(req.ReferenceImage)}
		return "/sdcpp/v1/img_gen", payload, nil
	case ImageRequestModeControl:
		if !loaded.Options.Checkpoint || loaded.Options.ComponentsBySlot()["control_net_path"] == "" ||
			strings.TrimSpace(req.Src) != "" || strings.TrimSpace(req.Mask) != "" || len(req.ReferenceImage) == 0 ||
			!validManagedControlType(req.ControlType) ||
			math.IsNaN(float64(req.ControlStrength)) || math.IsInf(float64(req.ControlStrength), 0) ||
			req.ControlStrength < 0 || req.ControlStrength > 2 {
			return "", nil, fmt.Errorf("native ControlNet request does not match the loaded checkpoint")
		}
		payload["control_image"] = base64.StdEncoding.EncodeToString(req.ReferenceImage)
		payload["control_type"] = req.ControlType
		payload["control_strength"] = req.ControlStrength
		return "/sdcpp/v1/img_gen", payload, nil
	default:
		return "", nil, fmt.Errorf("stable-diffusion.cpp request mode is unknown")
	}
}

func loadManagedImageRequestImage(path string) (string, error) {
	payload, err := os.ReadFile(strings.TrimSpace(path))
	if err != nil {
		return "", fmt.Errorf("read managed image input %s: %w", strings.TrimSpace(path), err)
	}
	if len(payload) == 0 {
		return "", fmt.Errorf("managed image input %s is empty", strings.TrimSpace(path))
	}
	return base64.StdEncoding.EncodeToString(payload), nil
}

func decodeManagedImageBase64(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, fmt.Errorf("managed image payload is empty")
	}
	if strings.HasPrefix(trimmed, "data:") {
		if comma := strings.Index(trimmed, ","); comma >= 0 {
			trimmed = strings.TrimSpace(trimmed[comma+1:])
		}
	}
	payload, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("decode managed image payload: %w", err)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("managed image payload is empty")
	}
	return payload, nil
}

func defaultManagedImageString(value string, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(fallback)
}
