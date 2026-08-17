package localservice

import (
	"context"
	"errors"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func (s *Service) executeNativeLlamaEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
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
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	status, err := mgr.EnsureEngineBinaryDependency(localEnvironmentEngineDownloadProgressContext(ctx, report), "llama", "")
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
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
		SelectedConsumers:     nativeLlamaSelectedConsumers(job),
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func nativeLlamaSelectedConsumers(job localEnvironmentDependencyJobState) []string {
	if consumer := strings.TrimSpace(job.ConsumerScope); consumer != "" {
		return []string{consumer}
	}
	environmentKey := strings.TrimSpace(job.EnvironmentKey)
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

func (s *Service) executeNativeSDCPPEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if strings.TrimSpace(job.DependencyID) != "stable-diffusion.cpp.package" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	consumer := strings.TrimSpace(job.ConsumerScope)
	if localEnvironmentCUDAConsumerScopeRequiresRuntime(consumer) {
		if _, ready, _ := s.readySelectedSourceForFamilyAndConsumer(localEnvironmentFamilyCUDA, consumer); !ready {
			if prerequisiteJob, exists := s.latestLocalEnvironmentDependencyJobForFamilyAndConsumer(localEnvironmentFamilyCUDA, consumer); exists {
				if localEnvironmentDependencyJobActiveForPlanApply(prerequisiteJob.State) || localEnvironmentDependencyJobBlocksPrerequisiteWait(prerequisiteJob.State) {
					if _, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyCUDA, consumer); !ok {
						return failedPrerequisiteDependencyResult(detail), nil
					}
				}
			}
		}
	}
	contract, ok := nativeSDCPPPackageContractForEnvironment(job.EnvironmentKey, consumer)
	if !ok {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			FailureDetail:   "stable-diffusion.cpp package source cannot be resolved for selected host/consumer",
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	status, err := mgr.EnsureManagedImageBackendDependency(ctx, &engine.ManagedImageBackendConfig{
		Mode:             engine.ManagedImageBackendOfficial,
		BackendName:      "stablediffusion-ggml",
		PackageSource:    contract.PackageSource,
		Address:          "127.0.0.1:50052",
		DownloadProgress: localEnvironmentManagedImageBackendDownloadProgress(report),
	})
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
	if strings.TrimSpace(status.CanonicalRoot) == "" || len(status.VerifiedArtifacts) == 0 {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	if !nativeSDCPPPackageStatusMatchesContract(status, contract) {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			FailureDetail:   "stable-diffusion.cpp package source does not match selected host/consumer contract",
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:         localEnvironmentStateReadyManaged,
		SourceKind:    localEnvironmentSourceManaged,
		CanonicalRoot: strings.TrimSpace(status.CanonicalRoot),
		Version:       strings.TrimSpace(status.PackageSource),
		CompatibilityEvidence: []string{
			strings.TrimSpace(status.Detail),
			"package_source=" + strings.TrimSpace(status.PackageSource),
			"package_format=" + strings.TrimSpace(status.PackageFormat),
			"launch_mode=" + strings.TrimSpace(status.LaunchMode),
			"supported_model_families=" + strings.Join(normalizeStringSlice(status.SupportedModelFamilies), ","),
		},
		VerifiedArtifacts: normalizeStringSlice(status.VerifiedArtifacts),
		SelectedConsumers: []string{contract.Consumer},
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func localEnvironmentManagedImageBackendDownloadProgress(report localEnvironmentDependencyJobProgressReporter) func(bytesReceived, bytesTotal int64) {
	return func(bytesReceived, bytesTotal int64) {
		reportLocalEnvironmentJobDownloadProgress(report, localEnvironmentDependencyJobProgress{
			BytesReceived: bytesReceived,
			BytesTotal:    bytesTotal,
		})
	}
}

type nativeSDCPPPackageContract struct {
	Consumer      string
	PackageSource string
	PackageFormat string
	LaunchMode    string
}

func nativeSDCPPPackageContractForEnvironment(environmentKey string, consumer string) (nativeSDCPPPackageContract, bool) {
	hostOS := nativeSDCPPEnvironmentHostOS(environmentKey)
	switch strings.TrimSpace(consumer) {
	case "stable-diffusion.cpp.metal":
		if hostOS == "darwin" {
			return nativeSDCPPPackageContract{
				Consumer:      "stable-diffusion.cpp.metal",
				PackageSource: "canonical_localai_derived",
				PackageFormat: "oci_payload",
				LaunchMode:    "package_entrypoint",
			}, true
		}
	case "stable-diffusion.cpp.cuda":
		if hostOS == "windows" {
			return nativeSDCPPPackageContract{
				Consumer:      "stable-diffusion.cpp.cuda",
				PackageSource: "canonical_runtime_wrapper",
				PackageFormat: "direct_archive",
				LaunchMode:    "runtime_wrapper",
			}, true
		}
	}
	return nativeSDCPPPackageContract{}, false
}

func nativeSDCPPPackageStatusMatchesContract(status engine.ManagedImageBackendDependencyStatus, contract nativeSDCPPPackageContract) bool {
	return strings.TrimSpace(status.PackageSource) == contract.PackageSource &&
		strings.TrimSpace(status.PackageFormat) == contract.PackageFormat &&
		strings.TrimSpace(status.LaunchMode) == contract.LaunchMode
}

func nativeSDCPPEnvironmentHostOS(environmentKey string) string {
	parts := strings.Split(strings.TrimSpace(environmentKey), "|")
	if len(parts) < 4 {
		return ""
	}
	platform := strings.TrimSpace(parts[3])
	if before, _, ok := strings.Cut(platform, "/"); ok {
		return strings.ToLower(strings.TrimSpace(before))
	}
	return strings.ToLower(platform)
}
