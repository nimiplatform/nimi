package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const canonicalCatalogProbeBodyLimitBytes = 128 * 1024

type canonicalHealthPayload struct {
	Ready  bool   `json:"ready"`
	Detail string `json:"detail"`
	Checks struct {
		Qwen3TTSReady              bool   `json:"qwen3_tts_driver_ready"`
		Qwen3TTSDetail             string `json:"qwen3_tts_driver_detail"`
		Qwen3ASRReady              bool   `json:"qwen3_asr_driver_ready"`
		Qwen3ASRDetail             string `json:"qwen3_asr_driver_detail"`
		Qwen3ASRTransformersReady  bool   `json:"qwen3_asr_transformers_driver_ready"`
		Qwen3ASRTransformersDetail string `json:"qwen3_asr_transformers_driver_detail"`
		VoxCPMReady                bool   `json:"voxcpm_driver_ready"`
		VoxCPMDetail               string `json:"voxcpm_driver_detail"`
	} `json:"checks"`
}

// ProbeHealth performs a single HTTP health check against the engine endpoint.
// Returns nil if healthy, error otherwise.
func ProbeHealth(ctx context.Context, endpoint string, healthPath string, expectedBody string) error {
	url := strings.TrimSuffix(endpoint, "/") + healthPath

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build health request: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("health probe failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("health probe returned status %d: %s", resp.StatusCode, string(body))
	}

	if expectedBody != "" {
		if !strings.Contains(string(body), expectedBody) {
			return fmt.Errorf("health probe body mismatch: expected %q in response", expectedBody)
		}
	}

	return nil
}

// WaitHealthy polls the engine health endpoint until it becomes healthy or
// the context is cancelled / timeout exceeded.
func WaitHealthy(ctx context.Context, endpoint string, healthPath string, expectedBody string, interval time.Duration, timeout time.Duration) error {
	deadline := time.After(timeout)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Try immediately first.
	if err := ProbeHealth(ctx, endpoint, healthPath, expectedBody); err == nil {
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait healthy cancelled: %w", ctx.Err())
		case <-deadline:
			return fmt.Errorf("wait healthy timed out after %s", timeout)
		case <-ticker.C:
			if err := ProbeHealth(ctx, endpoint, healthPath, expectedBody); err == nil {
				return nil
			}
		}
	}
}

func ProbeMediaHealth(ctx context.Context, endpoint string) error {
	return probeCanonicalCatalogHealth(ctx, endpoint, "media", "")
}

func ProbeSpeechHealth(ctx context.Context, endpoint string) error {
	return probeSpeechHealth(ctx, endpoint, "")
}

func probeSpeechHealth(ctx context.Context, endpoint string, requiredDriver SpeechDriver) error {
	return probeCanonicalCatalogHealth(ctx, endpoint, "speech", requiredDriver)
}

func probeCanonicalCatalogHealth(ctx context.Context, endpoint string, engineLabel string, requiredSpeechDriver SpeechDriver) error {
	baseURL := strings.TrimSuffix(endpoint, "/")
	healthURL := baseURL + "/healthz"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return fmt.Errorf("build health request: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("health probe failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	healthPayload := canonicalHealthPayload{}
	_ = json.Unmarshal(body, &healthPayload)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("health probe returned status %d: %s", resp.StatusCode, string(body))
	}

	if requiredSpeechDriver != "" {
		driverReady := false
		driverDetail := ""
		switch requiredSpeechDriver {
		case SpeechDriverQwen3TTS:
			driverReady = healthPayload.Checks.Qwen3TTSReady
			driverDetail = healthPayload.Checks.Qwen3TTSDetail
		case SpeechDriverQwen3ASR:
			driverReady = healthPayload.Checks.Qwen3ASRReady
			driverDetail = healthPayload.Checks.Qwen3ASRDetail
		case SpeechDriverQwen3ASRTransformers:
			driverReady = healthPayload.Checks.Qwen3ASRTransformersReady
			driverDetail = healthPayload.Checks.Qwen3ASRTransformersDetail
		case SpeechDriverVoxCPM:
			driverReady = healthPayload.Checks.VoxCPMReady
			driverDetail = healthPayload.Checks.VoxCPMDetail
		default:
			return fmt.Errorf("speech health probe required driver is unsupported: %s", requiredSpeechDriver)
		}
		if !driverReady {
			if detail := strings.TrimSpace(driverDetail); detail != "" {
				return fmt.Errorf("speech health probe required driver %s reported ready=false: %s", requiredSpeechDriver, detail)
			}
			return fmt.Errorf("speech health probe required driver %s reported ready=false", requiredSpeechDriver)
		}
		// Capability-scoped Hosts are ready when their exact selected Driver
		// passes preflight. The package profile may still expose the legacy
		// aggregate ready=false/no-bundles payload, and catalog discovery is not
		// an execution prerequisite because the invocation already owns a model.
		return nil
	}

	if !healthPayload.Ready {
		details := make([]string, 0, 5)
		for _, detail := range []string{
			healthPayload.Detail,
			healthPayload.Checks.Qwen3TTSDetail,
			healthPayload.Checks.Qwen3ASRDetail,
			healthPayload.Checks.Qwen3ASRTransformersDetail,
			healthPayload.Checks.VoxCPMDetail,
		} {
			trimmed := strings.TrimSpace(detail)
			if trimmed != "" && !stringSliceContains(details, trimmed) {
				details = append(details, trimmed)
			}
		}
		if len(details) > 0 {
			return fmt.Errorf("%s health probe reported ready=false: %s", engineLabel, strings.Join(details, "; "))
		}
		return fmt.Errorf("%s health probe reported ready=false", engineLabel)
	}

	url := baseURL + "/v1/catalog"
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build catalog request: %w", err)
	}

	catalogResp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("catalog probe failed: %w", err)
	}
	defer func() { _ = catalogResp.Body.Close() }()

	body, _ = io.ReadAll(io.LimitReader(catalogResp.Body, canonicalCatalogProbeBodyLimitBytes))
	if catalogResp.StatusCode < 200 || catalogResp.StatusCode >= 300 {
		return fmt.Errorf("catalog probe returned status %d: %s", catalogResp.StatusCode, string(body))
	}

	payload := struct {
		Ready  bool `json:"ready"`
		Models []struct {
			ID    string `json:"id"`
			Ready bool   `json:"ready"`
		} `json:"models"`
	}{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("%s catalog probe parse failed: %w", engineLabel, err)
	}
	if !payload.Ready {
		return fmt.Errorf("%s catalog probe reported ready=false", engineLabel)
	}
	for _, model := range payload.Models {
		if strings.TrimSpace(model.ID) != "" && model.Ready {
			return nil
		}
	}
	return fmt.Errorf("%s catalog probe missing ready models", engineLabel)
}

func WaitMediaHealthy(ctx context.Context, endpoint string, interval time.Duration, timeout time.Duration) error {
	return waitCanonicalCatalogHealthy(ctx, endpoint, interval, timeout, ProbeMediaHealth)
}

func WaitSpeechHealthy(ctx context.Context, endpoint string, interval time.Duration, timeout time.Duration) error {
	return waitSpeechHealthy(ctx, endpoint, interval, timeout, "")
}

func waitSpeechHealthy(ctx context.Context, endpoint string, interval time.Duration, timeout time.Duration, requiredDriver SpeechDriver) error {
	return waitCanonicalCatalogHealthy(ctx, endpoint, interval, timeout, func(ctx context.Context, endpoint string) error {
		return probeSpeechHealth(ctx, endpoint, requiredDriver)
	})
}

func waitCanonicalCatalogHealthy(
	ctx context.Context,
	endpoint string,
	interval time.Duration,
	timeout time.Duration,
	probe func(context.Context, string) error,
) error {
	deadline := time.After(timeout)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	lastErr := probe(ctx, endpoint)
	if lastErr == nil {
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait healthy cancelled: %w", ctx.Err())
		case <-deadline:
			return fmt.Errorf("wait healthy timed out after %s: last probe: %w", timeout, lastErr)
		case <-ticker.C:
			if err := probe(ctx, endpoint); err == nil {
				return nil
			} else {
				lastErr = err
			}
		}
	}
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
