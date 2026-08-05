package localservice

import (
	"context"
	"fmt"
	"net"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	managedImageBackendServiceID    = "svc_managed_image_backend"
	managedImageBackendServiceTitle = "Managed Image Backend"
)

func resolveLocalModelsPath(configuredPath string) string {
	if value := strings.TrimSpace(configuredPath); value != "" {
		return value
	}
	return ""
}

func resolveLocalEnvironmentRuntimeDataRoot(configuredDataRoot string) string {
	return strings.TrimSpace(configuredDataRoot)
}

func validateProductControlDerivedLocalPaths(configuredModelsPath string, configuredDataRoot string) error {
	dataRoot := filepath.Clean(strings.TrimSpace(configuredDataRoot))
	modelsRoot := filepath.Clean(strings.TrimSpace(configuredModelsPath))
	if dataRoot == "." && modelsRoot == "." {
		return nil
	}
	if dataRoot == "." || !filepath.IsAbs(dataRoot) || dataRoot == filepath.VolumeName(dataRoot)+string(filepath.Separator) {
		return fmt.Errorf("Product Control-derived data root must be an absolute non-root path")
	}
	if modelsRoot == "." || !filepath.IsAbs(modelsRoot) || !sameLocalEnvironmentPath(modelsRoot, filepath.Join(dataRoot, "models")) {
		return fmt.Errorf("Product Control-derived models path must equal <dataRoot>/models")
	}
	return nil
}

func sameLocalEnvironmentPath(left string, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func (s *Service) localEnvironmentRuntimeDataRoot() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	runtimeDataRoot := s.runtimeDataRoot
	s.mu.RUnlock()
	return resolveLocalEnvironmentRuntimeDataRoot(runtimeDataRoot)
}

func (s *Service) requireCanonicalLocalEnvironmentDataRoot(requested string) (string, error) {
	canonical := s.localEnvironmentRuntimeDataRoot()
	if canonical == "" {
		return "", fmt.Errorf("Product Control dataRoot.path is not available")
	}
	proof := strings.TrimSpace(requested)
	if proof != "" && !sameLocalEnvironmentPath(proof, canonical) {
		return "", fmt.Errorf("request runtime_data_root does not match Product Control dataRoot.path")
	}
	return canonical, nil
}

// SetManagedMediaEndpoint records the managed media endpoint exposed
// by the daemon and rewrites supervised media model endpoints to that value.
func (s *Service) SetManagedMediaEndpoint(endpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.managedMediaEndpointValue = strings.TrimSpace(endpoint)
	if s.managedMediaEndpointValue == "" {
		return
	}
	s.syncManagedEndpointProjectionLocked("media", s.managedMediaEndpointValue)
}

// ManagedMediaEndpoint returns the currently exposed managed media loopback
// endpoint, if any.
func (s *Service) ManagedMediaEndpoint() string {
	return s.managedMediaEndpoint()
}

// ResolveManagedMediaBackendTarget returns the local models root and the
// daemon-managed image backend address used by the supervised gguf image path.
func (s *Service) ResolveManagedMediaBackendTarget(_ context.Context) (string, string, error) {
	s.mu.RLock()
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	address := strings.TrimSpace(s.managedMediaBackendAddress)
	s.mu.RUnlock()
	return modelsRoot, address, nil
}

// SetManagedSpeechEndpoint records the managed speech endpoint exposed
// by the daemon and rewrites supervised speech model endpoints to that value.
func (s *Service) SetManagedSpeechEndpoint(endpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.managedSpeechEndpointValue = strings.TrimSpace(endpoint)
	if s.managedSpeechEndpointValue == "" {
		return
	}
	s.syncManagedEndpointProjectionLocked("speech", s.managedSpeechEndpointValue)
}

func (s *Service) syncManagedEndpointProjectionLocked(engineName string, endpoint string) {
	normalizedEngine := strings.ToLower(strings.TrimSpace(engineName))
	normalizedEndpoint := strings.TrimSpace(endpoint)
	if normalizedEngine == "" || normalizedEndpoint == "" {
		return
	}
	changed := false
	now := nowISO()

	for id, record := range s.assets {
		if record == nil {
			continue
		}
		if normalizeRuntimeMode(s.assetRuntimeModes[id]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if managedRuntimeEngineForModel(record) != normalizedEngine {
			continue
		}
		if strings.TrimSpace(record.GetEndpoint()) == normalizedEndpoint {
			continue
		}
		cloned := cloneLocalAsset(record)
		cloned.Endpoint = normalizedEndpoint
		cloned.UpdatedAt = now
		s.assets[id] = cloned
		changed = true
	}

	for id, record := range s.services {
		if record == nil {
			continue
		}
		if normalizeRuntimeMode(s.serviceRuntimeModes[id]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if strings.ToLower(strings.TrimSpace(record.GetEngine())) != normalizedEngine {
			continue
		}
		if strings.TrimSpace(record.GetEndpoint()) == normalizedEndpoint {
			continue
		}
		cloned := cloneServiceDescriptor(record)
		cloned.Endpoint = normalizedEndpoint
		cloned.UpdatedAt = now
		s.services[id] = cloned
		changed = true
	}

	if changed {
		s.persistStateLocked()
	}
}

// SetManagedImageBackendConfig records whether the managed image
// backend is configured for daemon-supervised local media workflows.
func (s *Service) SetManagedImageBackendConfig(enabled bool, address string) {
	s.SetManagedImageBackendConfigWithSource(enabled, address, "")
}

// SetManagedImageBackendConfigWithSource records whether the managed image
// backend is configured and which admitted package source owns startup.
func (s *Service) SetManagedImageBackendConfigWithSource(enabled bool, address string, packageSource string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.managedMediaBackendConfigured = enabled
	s.managedMediaBackendHealthy = false
	s.managedMediaBackendAddress = strings.TrimSpace(address)
	s.managedMediaBackendPackageSource = strings.TrimSpace(packageSource)
	s.managedMediaBackendEpoch++
	s.resetManagedMediaImageLoadCacheLocked()
	now := nowISO()
	if enabled {
		if strings.TrimSpace(s.managedMediaBackendInstalledAt) == "" {
			s.managedMediaBackendInstalledAt = now
		}
		s.managedMediaBackendUpdatedAt = now
		s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED
		s.managedMediaBackendDetail = "daemon-managed image backend configured"
		return
	}
	s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED
	s.managedMediaBackendDetail = "daemon-managed image backend disabled"
	s.managedMediaBackendInstalledAt = ""
	s.managedMediaBackendUpdatedAt = now
}

// SetManagedImageBackendHealth records the current managed image
// backend health reported by the engine supervisor.
func (s *Service) SetManagedImageBackendHealth(healthy bool, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.managedMediaBackendConfigured {
		return
	}
	s.managedMediaBackendHealthy = healthy
	s.managedMediaBackendUpdatedAt = nowISO()
	s.managedMediaBackendEpoch++
	s.resetManagedMediaImageLoadCacheLocked()
	trimmed := strings.TrimSpace(detail)
	if healthy {
		s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE
		s.managedMediaBackendDetail = defaultString(trimmed, "daemon-managed image backend active")
		return
	}
	s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY
	s.managedMediaBackendDetail = defaultString(trimmed, "daemon-managed image backend unhealthy")
}

// SetManagedImageBackendIdle marks an intentionally stopped backend as
// installed-but-cold. It is used by keep_alive reclamation, not by crash probes.
func (s *Service) SetManagedImageBackendIdle(detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.managedMediaBackendConfigured {
		return
	}
	s.managedMediaBackendHealthy = false
	s.managedMediaBackendUpdatedAt = nowISO()
	s.managedMediaBackendEpoch++
	s.resetManagedMediaImageLoadCacheLocked()
	s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED
	s.managedMediaBackendDetail = defaultString(strings.TrimSpace(detail), "daemon-managed image backend idle")
}

func waitForManagedEnginePortRelease(ctx context.Context, port int, timeout time.Duration) error {
	return waitForManagedEnginePortReleaseWithProbe(ctx, port, timeout, loopbackPortAvailable)
}

func waitForManagedEnginePortReleaseWithProbe(ctx context.Context, port int, timeout time.Duration, probe func(int) bool) error {
	if port <= 0 || port > 65535 {
		return fmt.Errorf("invalid managed engine port %d", port)
	}
	if probe == nil {
		probe = loopbackPortAvailable
	}

	deadline := time.Now().Add(timeout)
	for {
		if probe(port) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("configured port %d remained unavailable after %s", port, timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func loopbackPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}
