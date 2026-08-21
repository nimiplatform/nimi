package localservice

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const (
	cudaUserSpaceRuntimeDependencyID   = engine.NVIDIACUDAUserSpaceRuntimeDependencyID
	cuda13UserSpaceRuntimeDependencyID = engine.NVIDIACUDA13UserSpaceRuntimeDependencyID
	stableDiffusionCUDAConsumerID      = "stable-diffusion.cpp.cuda"
	audioCppCUDAConsumerID             = "audio.cpp.cuda"
	audioCppQwen3TTSCUDAConsumerID     = "audio.cpp.qwen3-tts.cuda"
)

func audioCppSelectedConsumers() []string {
	return []string{audioCppCUDAConsumerID, audioCppQwen3TTSCUDAConsumerID}
}

func normalizeLocalRuntimeDependencyID(raw string) string {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return cudaUserSpaceRuntimeDependencyID
	}
	return engine.NormalizeSharedAcceleratorDependencyID(trimmed)
}

func runtimeDependencyReasonCode(state string) string {
	switch strings.TrimSpace(state) {
	case "ready_system":
		return "LOCAL_RUNTIME_DEPENDENCY_READY_SYSTEM"
	case "ready_managed":
		return "LOCAL_RUNTIME_DEPENDENCY_READY_MANAGED"
	case string(engine.SharedAcceleratorDependencyMaterializableRequiresConfirmation):
		return "LOCAL_RUNTIME_DEPENDENCY_CONFIRMATION_REQUIRED"
	case string(engine.SharedAcceleratorDependencyRepairRequired):
		return "LOCAL_RUNTIME_DEPENDENCY_REPAIR_REQUIRED"
	default:
		return "LOCAL_RUNTIME_DEPENDENCY_UNAVAILABLE"
	}
}
