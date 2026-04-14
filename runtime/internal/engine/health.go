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
	defer resp.Body.Close()

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
	return probeCanonicalCatalogHealth(ctx, endpoint, "media")
}

func ProbeSpeechHealth(ctx context.Context, endpoint string) error {
	return probeCanonicalCatalogHealth(ctx, endpoint, "speech")
}

func probeCanonicalCatalogHealth(ctx context.Context, endpoint string, engineLabel string) error {
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
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	healthPayload := struct {
		Ready       bool   `json:"ready"`
		ImageDriver string `json:"image_driver"`
		Checks      struct {
			ProxyMode bool `json:"proxy_mode"`
		} `json:"checks"`
	}{}
	// Parse body before checking status code so we can inspect image_driver
	// even on non-2xx responses (e.g. 503 when proxy_execution is fail-closed).
	_ = json.Unmarshal(body, &healthPayload)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// When the media engine reports not-ready solely because the
		// proxy_execution sub-check failed but an image_driver is active
		// (diffusers-backend is running), treat the engine as healthy
		// for image operations. Without this, a health probe failure
		// accumulates toward the 3-strike unhealthy threshold and can
		// degrade the daemon while image generation is working fine.
		if engineLabel == "media" && strings.TrimSpace(healthPayload.ImageDriver) != "" {
			return nil
		}
		return fmt.Errorf("health probe returned status %d: %s", resp.StatusCode, string(body))
	}

	if !healthPayload.Ready {
		// Same partial-health logic: if image_driver is active the media
		// engine is functional for image workloads even when ready=false.
		if engineLabel == "media" && strings.TrimSpace(healthPayload.ImageDriver) != "" {
			return nil
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
	defer catalogResp.Body.Close()

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
	if engineLabel == "media" && healthPayload.Checks.ProxyMode {
		if payload.Ready {
			return nil
		}
		return fmt.Errorf("%s catalog probe reported ready=false in proxy mode", engineLabel)
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
	return waitCanonicalCatalogHealthy(ctx, endpoint, interval, timeout, ProbeSpeechHealth)
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

	if err := probe(ctx, endpoint); err == nil {
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait healthy cancelled: %w", ctx.Err())
		case <-deadline:
			return fmt.Errorf("wait healthy timed out after %s", timeout)
		case <-ticker.C:
			if err := probe(ctx, endpoint); err == nil {
				return nil
			}
		}
	}
}
