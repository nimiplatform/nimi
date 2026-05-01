package localservice

import (
	"context"
	"errors"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func (s *Service) executeNativeLlamaEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
	if strings.TrimSpace(job.DependencyID) != "llama.cpp.package" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	status, err := mgr.EnsureEngineBinaryDependency(ctx, "llama", "")
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if strings.TrimSpace(status.BinaryPath) == "" || strings.TrimSpace(status.SHA256) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.BinaryPath),
		Version:               strings.TrimSpace(status.Version),
		CompatibilityEvidence: []string{strings.TrimSpace(status.Detail), "asset=" + strings.TrimSpace(status.AssetName), "accelerator_plane=" + strings.TrimSpace(status.AcceleratorPlane)},
		VerifiedArtifacts:     normalizeStringSlice([]string{strings.TrimSpace(status.BinaryPath)}),
		Hashes:                map[string]string{"sha256": strings.TrimSpace(status.SHA256)},
		SelectedConsumers:     nativeLlamaSelectedConsumers(job.EnvironmentKey),
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func nativeLlamaSelectedConsumers(environmentKey string) []string {
	switch {
	case strings.Contains(environmentKey, "|llama.cpp.cuda"):
		return []string{"llama.cpp.cuda"}
	case strings.Contains(environmentKey, "|llama.cpp.vulkan"):
		return []string{"llama.cpp.vulkan"}
	case strings.Contains(environmentKey, "|llama.cpp.cpu"):
		return []string{"llama.cpp.cpu"}
	default:
		return []string{"llama.cpp"}
	}
}

func (s *Service) executeNativeSDCPPEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
	if strings.TrimSpace(job.DependencyID) != "stable-diffusion.cpp.package" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	status, err := mgr.EnsureManagedImageBackendDependency(ctx, &engine.ManagedImageBackendConfig{
		Mode:        engine.ManagedImageBackendOfficial,
		BackendName: "stablediffusion-ggml",
		Address:     "127.0.0.1:50052",
	})
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if strings.TrimSpace(status.CanonicalRoot) == "" || len(status.VerifiedArtifacts) == 0 {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.CanonicalRoot),
		Version:               strings.TrimSpace(status.PackageSource),
		CompatibilityEvidence: []string{strings.TrimSpace(status.Detail)},
		VerifiedArtifacts:     normalizeStringSlice(status.VerifiedArtifacts),
		SelectedConsumers:     nativeSDCPPSelectedConsumers(job.EnvironmentKey),
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func nativeSDCPPSelectedConsumers(environmentKey string) []string {
	switch {
	case strings.Contains(environmentKey, "|stable-diffusion.cpp.cuda"):
		return []string{"stable-diffusion.cpp.cuda"}
	case strings.Contains(environmentKey, "|stable-diffusion.cpp.metal"):
		return []string{"stable-diffusion.cpp.metal"}
	case strings.Contains(environmentKey, "|stable-diffusion.cpp.cpu"):
		return []string{"stable-diffusion.cpp.cpu"}
	default:
		return []string{"stable-diffusion.cpp"}
	}
}
