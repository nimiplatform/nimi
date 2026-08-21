package localservice

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func (s *Service) resolveSharedCUDADependencyStatus(consumerID string) engine.SharedAcceleratorDependencyStatus {
	return s.resolveSharedCUDADependencyStatusForID(cudaUserSpaceRuntimeDependencyID, consumerID)
}

func (s *Service) resolveSharedCUDADependencyStatusForID(dependencyID string, consumerID string) engine.SharedAcceleratorDependencyStatus {
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return engine.SharedAcceleratorDependencyStatus{
			DependencyID: strings.TrimSpace(dependencyID),
			ConsumerID:   strings.TrimSpace(consumerID),
			State:        engine.SharedAcceleratorDependencyUnsupported,
			Source:       "unavailable",
			Detail:       "runtime engine manager unavailable",
		}
	}
	return mgr.ResolveSharedAcceleratorDependency(strings.TrimSpace(dependencyID), strings.TrimSpace(consumerID))
}

func sharedCUDADependencyBlocksActivation(status engine.SharedAcceleratorDependencyStatus) bool {
	return status.State != engine.SharedAcceleratorDependencyReadySystem &&
		status.State != engine.SharedAcceleratorDependencyReadyManaged
}

func sharedCUDADependencyActivationDetail(status engine.SharedAcceleratorDependencyStatus) string {
	if strings.TrimSpace(status.Detail) != "" {
		return status.Detail
	}
	if strings.TrimSpace(string(status.State)) != "" {
		return fmt.Sprintf("nvidia_cuda_user_space_runtime state=%s", status.State)
	}
	return "nvidia_cuda_user_space_runtime state=unsupported"
}

func selectionRequiresCUDAUserSpaceRuntime(selection engine.ImageSupervisedMatrixSelection) bool {
	if !selection.Matched || selection.Conflict || selection.Entry == nil {
		return false
	}
	return selection.EntryID == "windows-x64-nvidia-gguf" &&
		selection.BackendFamily == engine.ImageBackendFamilyStableDiffusionGGML &&
		selection.BackendClass == engine.ImageBackendClassNativeBinary
}
