package localservice

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const (
	cudaUserSpaceRuntimeDependencyID   = engine.NVIDIACUDAUserSpaceRuntimeDependencyID
	cuda13UserSpaceRuntimeDependencyID = engine.NVIDIACUDA13UserSpaceRuntimeDependencyID
	stableDiffusionCUDAConsumerID      = "stable-diffusion.cpp.cuda"
	audioCppCUDAConsumerID             = "audio.cpp.cuda"
	audioCppQwen3TTSCUDAConsumerID     = "audio.cpp.qwen3-tts.cuda"
	audioCppInflectTTSConsumerID       = "audio.cpp.inflect-v2.tts.cuda"
)

func audioCppSelectedConsumers() []string {
	consumers := []string{audioCppCUDAConsumerID, audioCppQwen3TTSCUDAConsumerID}
	for _, registration := range capabilitydriver.AudioCppSpeechRegistrations() {
		consumers = append(consumers, registration.ConsumerID)
	}
	for _, registration := range capabilitydriver.AudioCppReferenceVoiceRegistrations() {
		consumers = append(consumers, registration.ConsumerID)
	}
	return normalizeStringSlice(consumers)
}

func audioCppConsumerIDKnown(consumer string) bool {
	consumer = strings.TrimSpace(consumer)
	for _, candidate := range audioCppSelectedConsumers() {
		if candidate == consumer {
			return true
		}
	}
	return false
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
