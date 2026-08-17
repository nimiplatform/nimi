package localservice

import (
	"context"
	"fmt"
	"net"
	"path/filepath"
	"runtime"
	"strings"
	"time"
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
