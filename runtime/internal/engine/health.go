package engine

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

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
