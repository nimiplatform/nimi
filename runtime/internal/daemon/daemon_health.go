package daemon

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func (d *Daemon) sampleAIProviderHealth(ctx context.Context) {
	targets := configuredAIProviderTargets(d.cfg)
	if len(targets) == 0 {
		return
	}

	timeout := time.Duration(d.cfg.AIHTTPTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	interval := time.Duration(d.cfg.AIHealthIntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 8 * time.Second
	}
	client := &http.Client{Timeout: timeout}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	probe := func() {
		if ctx.Err() != nil {
			return
		}
		snapshot := d.state.Snapshot()
		if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
			return
		}

		var firstErr string
		healthyCount := 0
		for _, target := range targets {
			if ctx.Err() != nil {
				return
			}
			previous := providerhealth.Snapshot{}
			if d.aiHealth != nil {
				previous = d.aiHealth.SnapshotOf(target.Name)
			}
			if err := d.probeAIProviderFn(ctx, client, target); err != nil {
				if ctx.Err() != nil {
					return
				}
				err = d.decorateProviderProbeError(target.Name, err)
				if d.aiHealth != nil {
					if markErr := d.aiHealth.Mark(target.Name, false, err.Error()); markErr == nil {
						appendProviderHealthAudit(d.auditStore, target.Name, previous, d.aiHealth.SnapshotOf(target.Name))
					}
				}
				if firstErr == "" {
					firstErr = fmt.Sprintf("ai-provider:%s unavailable (%v)", target.Name, err)
				}
				continue
			}
			healthyCount++
			if d.aiHealth != nil {
				if markErr := d.aiHealth.Mark(target.Name, true, ""); markErr == nil {
					appendProviderHealthAudit(d.auditStore, target.Name, previous, d.aiHealth.SnapshotOf(target.Name))
				}
			}
		}

		if healthyCount > 0 {
			current := d.state.Snapshot()
			if current.Status == health.StatusDegraded && strings.HasPrefix(current.Reason, "ai-provider:") {
				d.state.SetStatus(health.StatusReady, "ready")
				d.grpc.SyncServingState()
			}
			return
		}

		if firstErr == "" {
			firstErr = "ai-provider:all unavailable"
		}
		d.setDegradedStatus(firstErr)
	}

	probe()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			probe()
		}
	}
}

type aiProviderTarget struct {
	Name   string
	Base   string
	APIKey string
}

func configuredAIProviderTargets(cfg config.Config) []aiProviderTarget {
	cloudTargets := config.ResolveCloudProviderTargets(cfg.Providers)
	targets := make([]aiProviderTarget, 0, 3+len(cloudTargets))
	seen := map[string]bool{}

	add := func(name string, base string, apiKey string) {
		normalized := strings.TrimSuffix(strings.TrimSpace(base), "/")
		if normalized == "" {
			return
		}
		key := name + "::" + normalized
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, aiProviderTarget{
			Name:   name,
			Base:   normalized,
			APIKey: strings.TrimSpace(apiKey),
		})
	}

	add("local", runtimeGetenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL"), runtimeGetenv("NIMI_RUNTIME_LOCAL_LLAMA_API_KEY"))
	add("local-media", runtimeGetenv("NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL"), runtimeGetenv("NIMI_RUNTIME_LOCAL_MEDIA_API_KEY"))
	add("local-speech", runtimeGetenv("NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL"), runtimeGetenv("NIMI_RUNTIME_LOCAL_SPEECH_API_KEY"))
	add("local-sidecar", runtimeGetenv("NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL"), runtimeGetenv("NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY"))
	for _, target := range cloudTargets {
		add(cloudProviderTargetName(target.CanonicalID), target.BaseURL, target.APIKey)
	}
	return targets
}

func cloudProviderTargetName(canonicalID string) string {
	trimmed := strings.TrimSpace(canonicalID)
	if trimmed == "" {
		return "cloud"
	}
	return "cloud-" + strings.ReplaceAll(trimmed, "_", "-")
}

// probeAIProvider checks provider health per K-PROV-003:
//   - 2xx/401/403/429 = healthy
//   - 404 = try next path
//   - other 4xx/5xx = unhealthy
func probeAIProvider(ctx context.Context, client *http.Client, target aiProviderTarget) error {
	paths := providerProbePaths(target.Name)
	var lastErr error
	for _, path := range paths {
		endpoint := resolveProbeEndpoint(target.Base, path)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		if target.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+target.APIKey)
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()

		switch {
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			return nil // 2xx = healthy
		case resp.StatusCode == 401, resp.StatusCode == 403, resp.StatusCode == 429:
			return nil // auth/rate-limit = healthy (provider is reachable)
		case resp.StatusCode == 404:
			continue // try next path
		default:
			lastErr = fmt.Errorf("status=%d", resp.StatusCode)
		}
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("unreachable")
}

func providerProbePaths(name string) []string {
	if strings.EqualFold(strings.TrimSpace(name), "local-media") {
		return []string{"/healthz", "/v1/catalog"}
	}
	if strings.EqualFold(strings.TrimSpace(name), "local-speech") {
		return []string{"/healthz", "/v1/catalog"}
	}
	if strings.EqualFold(strings.TrimSpace(name), "local") {
		return []string{"/health", "/v1/models"}
	}
	return []string{"/healthz", "/v1/models"}
}

func resolveProbeEndpoint(base string, path string) string {
	trimmedBase := strings.TrimSuffix(strings.TrimSpace(base), "/")
	normalizedPath := strings.TrimSpace(path)
	if trimmedBase == "" || normalizedPath == "" {
		return trimmedBase + normalizedPath
	}
	if !strings.HasPrefix(normalizedPath, "/") {
		normalizedPath = "/" + normalizedPath
	}

	parsed, err := url.Parse(trimmedBase)
	if err != nil {
		return trimmedBase + normalizedPath
	}

	basePath := strings.TrimSuffix(parsed.Path, "/")
	if strings.HasSuffix(basePath, "/v1") && strings.HasPrefix(normalizedPath, "/v1/") {
		normalizedPath = strings.TrimPrefix(normalizedPath, "/v1")
		if !strings.HasPrefix(normalizedPath, "/") {
			normalizedPath = "/" + normalizedPath
		}
	}
	parsed.Path = basePath + normalizedPath
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
