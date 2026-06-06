package localservice

import (
	"context"
	"errors"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func (s *Service) executeCUDAEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if normalizeLocalRuntimeDependencyID(job.DependencyID) != cudaUserSpaceRuntimeDependencyID {
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
	status, err := mgr.EnsureSharedAcceleratorDependency(ctx, cudaUserSpaceRuntimeDependencyID)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
	if strings.TrimSpace(status.ConsumerID) == "" {
		status.ConsumerID = strings.TrimSpace(job.ConsumerScope)
	}
	if strings.TrimSpace(status.ConsumerID) == "" {
		status.ConsumerID = cudaSelectedConsumer(job.EnvironmentKey)
	}
	return localEnvironmentDependencyJobResultFromSharedAcceleratorStatus(status), nil
}

func cudaSelectedConsumer(environmentKey string) string {
	for _, consumer := range []string{
		"stable-diffusion.cpp.cuda",
		"media.diffusers.cuda",
		"media.video-python.cuda",
		"llama.cpp.cuda",
		"desktop.local-model-center",
	} {
		if strings.Contains(environmentKey, "|"+consumer) {
			return consumer
		}
	}
	return "accelerator.cuda.runtime"
}

func localEnvironmentDependencyJobResultFromSharedAcceleratorStatus(status engine.SharedAcceleratorDependencyStatus) localEnvironmentDependencyJobResult {
	switch status.State {
	case engine.SharedAcceleratorDependencyReadySystem:
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadySystem,
			SourceKind:            localEnvironmentSourceSystem,
			CanonicalRoot:         strings.TrimSpace(status.CanonicalRoot),
			Version:               "cuda_major=12",
			CompatibilityEvidence: []string{strings.TrimSpace(status.Detail)},
			VerifiedArtifacts:     normalizeStringSlice(status.RequiredArtifacts),
			Hashes:                map[string]string{"required_artifact_set": shortHash(strings.Join(normalizeStringSlice(status.RequiredArtifacts), "|"))},
			SelectedConsumers:     normalizeStringSlice([]string{status.ConsumerID}),
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_SYSTEM",
		}
	case engine.SharedAcceleratorDependencyReadyManaged:
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         strings.TrimSpace(status.CanonicalRoot),
			Version:               "cuda_major=12",
			CompatibilityEvidence: []string{strings.TrimSpace(status.Detail)},
			VerifiedArtifacts:     normalizeStringSlice(status.RequiredArtifacts),
			Hashes:                map[string]string{"required_artifact_set": shortHash(strings.Join(normalizeStringSlice(status.RequiredArtifacts), "|"))},
			SelectedConsumers:     normalizeStringSlice([]string{status.ConsumerID}),
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}
	case engine.SharedAcceleratorDependencyRepairRequired:
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}
	case engine.SharedAcceleratorDependencyUnsupported:
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}
	default:
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNAVAILABLE",
		}
	}
}
