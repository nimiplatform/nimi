package managedimagebackend

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func defaultStableDiffusionCPPGenerateRequester(ctx context.Context, client *http.Client, endpoint string, loaded loadModelState, req imageGenerateState) ([]byte, error) {
	if client == nil {
		client = &http.Client{}
	}
	if len(req.RefImages) > 0 {
		return nil, fmt.Errorf("stable-diffusion.cpp resident server does not support ref_images")
	}
	maskPath, err := managedImageMaskPath(req.EnableParams)
	if err != nil {
		return nil, err
	}
	path, payload, err := buildStableDiffusionCPPGenerateRequest(loaded, req, maskPath)
	if err != nil {
		return nil, err
	}
	requestBody, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal stable-diffusion.cpp generate request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(strings.TrimSpace(endpoint), "/")+path, strings.NewReader(string(requestBody)))
	if err != nil {
		return nil, fmt.Errorf("create stable-diffusion.cpp generate request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("execute stable-diffusion.cpp generate request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return nil, fmt.Errorf("stable-diffusion.cpp generate request failed: status=%d body=%s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var respBody stableDiffusionCPPGenerateResponse
	if err := json.NewDecoder(response.Body).Decode(&respBody); err != nil {
		return nil, fmt.Errorf("decode stable-diffusion.cpp generate response: %w", err)
	}
	return respBody.payload(ctx, client)
}

type stableDiffusionCPPGenerateResponse struct {
	Images []string `json:"images"`
	Data   []struct {
		B64JSON string `json:"b64_json"`
		URL     string `json:"url"`
	} `json:"data"`
}

func (r stableDiffusionCPPGenerateResponse) payload(ctx context.Context, client *http.Client) ([]byte, error) {
	if len(r.Images) > 0 {
		return decodeManagedImageBase64(r.Images[0])
	}
	if len(r.Data) > 0 {
		if strings.TrimSpace(r.Data[0].B64JSON) != "" {
			return decodeManagedImageBase64(r.Data[0].B64JSON)
		}
		if strings.TrimSpace(r.Data[0].URL) != "" {
			return fetchManagedImageURL(ctx, client, r.Data[0].URL)
		}
	}
	return nil, fmt.Errorf("stable-diffusion.cpp generate response did not include an image artifact")
}

func buildStableDiffusionCPPGenerateRequest(loaded loadModelState, req imageGenerateState, maskPath string) (string, map[string]any, error) {
	payload := map[string]any{
		"prompt": req.PositivePrompt,
	}
	if strings.TrimSpace(req.NegativePrompt) != "" {
		payload["negative_prompt"] = strings.TrimSpace(req.NegativePrompt)
	}
	if req.Width > 0 {
		payload["width"] = req.Width
	}
	if req.Height > 0 {
		payload["height"] = req.Height
	}
	if req.Step > 0 {
		payload["steps"] = req.Step
	}
	if loaded.CFGScale > 0 {
		payload["cfg_scale"] = loaded.CFGScale
	}
	if sampler := strings.TrimSpace(loaded.Options.Sampler); sampler != "" {
		payload["sampler_name"] = sampler
	}
	if scheduler := strings.TrimSpace(loaded.Options.Scheduler); scheduler != "" {
		payload["scheduler"] = scheduler
	}
	payload["seed"] = managedImageGenerateSeed(req.Seed)

	if strings.TrimSpace(req.Src) == "" && maskPath == "" {
		return "/sdapi/v1/txt2img", payload, nil
	}
	if strings.TrimSpace(req.Src) == "" {
		return "", nil, fmt.Errorf("stable-diffusion.cpp resident server requires src when a mask is provided")
	}
	sourceImage, err := loadManagedImageRequestImage(strings.TrimSpace(req.Src))
	if err != nil {
		return "", nil, err
	}
	payload["init_images"] = []string{sourceImage}
	if maskPath != "" {
		maskImage, err := loadManagedImageRequestImage(maskPath)
		if err != nil {
			return "", nil, err
		}
		payload["mask"] = maskImage
	}
	return "/sdapi/v1/img2img", payload, nil
}

func managedImageGenerateSeed(seed int32) int32 {
	if seed != 0 {
		return seed
	}
	return 42
}

func managedImageMaskPath(enableParams string) (string, error) {
	trimmed := strings.TrimSpace(enableParams)
	if trimmed == "" {
		return "", nil
	}
	key, value, hasValue := strings.Cut(trimmed, ":")
	if !hasValue || strings.ToLower(strings.TrimSpace(key)) != "mask" || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("stable-diffusion.cpp resident server does not support enable parameters %q", trimmed)
	}
	return strings.TrimSpace(value), nil
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

func fetchManagedImageURL(ctx context.Context, client *http.Client, target string) ([]byte, error) {
	if client == nil {
		client = &http.Client{}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(target), nil)
	if err != nil {
		return nil, fmt.Errorf("create managed image artifact request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("execute managed image artifact request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("managed image artifact request failed: status=%d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 100*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read managed image artifact: %w", err)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("managed image artifact is empty")
	}
	return payload, nil
}

func defaultManagedImageString(value string, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(fallback)
}

func emitManagedImageProgressUpdates(
	capture *managedImageLogCapture,
	cursor int,
	onProgress func(imageGenerateProgress) error,
	last imageGenerateProgress,
	haveLast bool,
) (int, imageGenerateProgress, bool, error) {
	if capture == nil {
		return cursor, last, haveLast, nil
	}
	lines, nextCursor := capture.LinesSince(cursor)
	if len(lines) == 0 {
		return nextCursor, last, haveLast, nil
	}
	for _, line := range lines {
		progress, ok := parseManagedImageProgressLine(line)
		if !ok {
			continue
		}
		if haveLast && progress == last {
			continue
		}
		if onProgress != nil {
			if err := onProgress(progress); err != nil {
				return nextCursor, last, haveLast, err
			}
		}
		last = progress
		haveLast = true
	}
	return nextCursor, last, haveLast, nil
}

func parseManagedImageProgressLine(line string) (imageGenerateProgress, bool) {
	matches := stableDiffusionProgressPattern.FindStringSubmatch(strings.TrimSpace(line))
	if len(matches) != 3 {
		return imageGenerateProgress{}, false
	}
	currentStep, err := strconv.Atoi(matches[1])
	if err != nil || currentStep <= 0 {
		return imageGenerateProgress{}, false
	}
	totalSteps, err := strconv.Atoi(matches[2])
	if err != nil || totalSteps <= 0 || currentStep > totalSteps {
		return imageGenerateProgress{}, false
	}
	progressPercent := int32((currentStep * 100) / totalSteps)
	if currentStep == totalSteps {
		progressPercent = 100
	}
	return imageGenerateProgress{
		CurrentStep:     int32(currentStep),
		TotalSteps:      int32(totalSteps),
		ProgressPercent: progressPercent,
	}, true
}
