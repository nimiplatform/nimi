package localservice

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const (
	localEnvironmentActivationStateReady                = "ready"
	localEnvironmentActivationStateSetupRequired        = "setup_required"
	localEnvironmentActivationStateSetupInProgress      = "setup_in_progress"
	localEnvironmentActivationStateRepairRequired       = "repair_required"
	localEnvironmentActivationStateFailed               = "failed"
	localEnvironmentActivationStateCancelled            = "cancelled"
	localEnvironmentActivationStateUnsupported          = "unsupported"
	localEnvironmentActivationReasonReady               = "LOCAL_ENVIRONMENT_ACTIVATION_READY"
	localEnvironmentActivationReasonSetupRequired       = "LOCAL_ENVIRONMENT_ACTIVATION_SETUP_REQUIRED"
	localEnvironmentActivationReasonSetupInProgress     = "LOCAL_ENVIRONMENT_ACTIVATION_SETUP_IN_PROGRESS"
	localEnvironmentActivationReasonRepairRequired      = "LOCAL_ENVIRONMENT_ACTIVATION_REPAIR_REQUIRED"
	localEnvironmentActivationReasonFailed              = "LOCAL_ENVIRONMENT_ACTIVATION_FAILED"
	localEnvironmentActivationReasonCancelled           = "LOCAL_ENVIRONMENT_ACTIVATION_CANCELLED"
	localEnvironmentActivationReasonUnsupported         = "LOCAL_ENVIRONMENT_ACTIVATION_UNSUPPORTED"
	localEnvironmentActivationReasonConsumerUnsupported = "LOCAL_ENVIRONMENT_CONSUMER_UNSUPPORTED"
)

type localEnvironmentConsumerActivationGateRequest struct {
	ConsumerID       string
	PackID           string
	HostProfile      *runtimev1.LocalDeviceProfile
	RuntimeDataRoot  string
	AssetID          string
	LocalAssetID     string
	CompanionAssetID string
	ParentAssetID    string
}

type localEnvironmentConsumerActivationGate struct {
	ConsumerID           string
	PackID               string
	State                string
	ReasonCode           string
	Detail               string
	BlockingDependencies []localEnvironmentPlanDependency
	Dependencies         []localEnvironmentPlanDependency
}

type localEnvironmentConsumerRequirement struct {
	ConsumerID string
	PackID     string
}

func (s *Service) resolveLocalEnvironmentConsumerActivationGate(req localEnvironmentConsumerActivationGateRequest) localEnvironmentConsumerActivationGate {
	consumerID := strings.TrimSpace(req.ConsumerID)
	requirement, ok := localEnvironmentConsumerRequirementByID(consumerID)
	if !ok {
		return localEnvironmentConsumerActivationGate{
			ConsumerID: consumerID,
			State:      localEnvironmentActivationStateUnsupported,
			ReasonCode: localEnvironmentActivationReasonConsumerUnsupported,
			Detail:     "local environment consumer is unsupported: " + consumerID,
		}
	}
	packID := requirement.PackID

	plan := s.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           packID,
		ConsumerScope:    consumerID,
		HostProfile:      req.HostProfile,
		RuntimeDataRoot:  req.RuntimeDataRoot,
		AssetID:          req.AssetID,
		LocalAssetID:     req.LocalAssetID,
		CompanionAssetID: req.CompanionAssetID,
		ParentAssetID:    req.ParentAssetID,
	})
	gate := localEnvironmentConsumerActivationGate{
		ConsumerID:   consumerID,
		PackID:       plan.PackID,
		State:        localEnvironmentActivationStateReady,
		ReasonCode:   localEnvironmentActivationReasonReady,
		Detail:       "local environment activation gate ready",
		Dependencies: make([]localEnvironmentPlanDependency, 0, len(plan.Dependencies)),
	}
	for _, dep := range plan.Dependencies {
		dep = s.resolveLocalEnvironmentActivationDependency(dep, consumerID)
		gate.Dependencies = append(gate.Dependencies, dep)
		if dep.Required && localEnvironmentDependencyBlocksActivation(dep.State) {
			gate.BlockingDependencies = append(gate.BlockingDependencies, dep)
		}
	}
	if len(gate.BlockingDependencies) == 0 {
		return gate
	}
	gate.State, gate.ReasonCode = localEnvironmentActivationBlockState(gate.BlockingDependencies)
	gate.Detail = localEnvironmentActivationBlockDetail(gate.BlockingDependencies)
	return gate
}

func (s *Service) resolveLocalEnvironmentActivationDependency(dep localEnvironmentPlanDependency, consumerID string) localEnvironmentPlanDependency {
	if dep.DependencyFamily == localEnvironmentFamilyCUDA {
		dep = s.resolveLocalEnvironmentCUDAProjection(dep, consumerID)
	}
	if localEnvironmentDependencyBlocksActivation(dep.State) {
		if job, ok := s.latestLocalEnvironmentDependencyJobForDependency(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, consumerID); ok {
			switch strings.TrimSpace(job.State) {
			case localEnvironmentStateQueued, localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling,
				localEnvironmentStateRepairRequired, localEnvironmentStateFailed, localEnvironmentStateCancelled, localEnvironmentStateUnsupported:
				dep.State = strings.TrimSpace(job.State)
				dep.SourceKind = strings.TrimSpace(job.SourceKind)
				dep.CanonicalRoot = strings.TrimSpace(job.CanonicalRoot)
				dep.Detail = strings.TrimSpace(job.FailureDetail)
				dep.ReasonCode = localEnvironmentActivationDependencyReason(dep.State)
			}
		}
	}
	return dep
}

func (s *Service) resolveLocalEnvironmentCUDAProjection(dep localEnvironmentPlanDependency, consumerID string) localEnvironmentPlanDependency {
	if dep.SelectedSourceRecordID != "" {
		return dep
	}
	status := s.resolveSharedCUDADependencyStatus(consumerID)
	dep.DependencyID = cudaUserSpaceRuntimeDependencyID
	dep.CanonicalRoot = strings.TrimSpace(status.CanonicalRoot)
	dep.Detail = strings.TrimSpace(status.Detail)
	dep.ReasonCode = localEnvironmentActivationDependencyReason(string(status.State))
	switch status.State {
	case engine.SharedAcceleratorDependencyReadySystem, engine.SharedAcceleratorDependencyReadyManaged:
		sourceKind := localEnvironmentSourceManaged
		if status.State == engine.SharedAcceleratorDependencyReadySystem {
			sourceKind = localEnvironmentSourceSystem
		}
		dep.State = localEnvironmentStateNeedsConfirmation
		dep.SourceKind = sourceKind
		dep.ConfirmationRequired = true
		dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED"
	case engine.SharedAcceleratorDependencyRepairRequired:
		dep.State = localEnvironmentStateRepairRequired
		dep.SourceKind = localEnvironmentSourceManaged
	case engine.SharedAcceleratorDependencyFailed:
		dep.State = localEnvironmentStateFailed
		dep.SourceKind = localEnvironmentSourceManaged
	case engine.SharedAcceleratorDependencyUnsupported:
		dep.State = localEnvironmentStateUnsupported
		dep.SourceKind = localEnvironmentSourceUnavailable
	default:
		dep.State = localEnvironmentStateNeedsConfirmation
		dep.SourceKind = localEnvironmentSourceManaged
		dep.ConfirmationRequired = true
	}
	return dep
}

func (s *Service) latestLocalEnvironmentDependencyJobForDependency(environmentKey string, dependencyFamily string, dependencyID string, consumerScope string) (localEnvironmentDependencyJobState, bool) {
	key := strings.TrimSpace(environmentKey)
	family := strings.TrimSpace(dependencyFamily)
	id := strings.TrimSpace(dependencyID)
	consumer := strings.TrimSpace(consumerScope)
	if key == "" {
		return localEnvironmentDependencyJobState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var latest localEnvironmentDependencyJobState
	for _, job := range s.localEnvironmentDependencyJobs {
		if strings.TrimSpace(job.EnvironmentKey) != key {
			continue
		}
		if family != "" && strings.TrimSpace(job.DependencyFamily) != family {
			continue
		}
		if id != "" && strings.TrimSpace(job.DependencyID) != id {
			continue
		}
		if consumer != "" && strings.TrimSpace(job.ConsumerScope) != consumer {
			continue
		}
		if latest.JobID == "" || localEnvironmentDependencyJobNewer(job, latest) {
			latest = job
		}
	}
	return latest, latest.JobID != ""
}

func localEnvironmentDependencyBlocksActivation(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateReadySystem, localEnvironmentStateReadyManaged:
		return false
	default:
		return true
	}
}

func localEnvironmentActivationBlockState(blocking []localEnvironmentPlanDependency) (string, string) {
	for _, dep := range blocking {
		switch strings.TrimSpace(dep.State) {
		case localEnvironmentStateUnsupported:
			return localEnvironmentActivationStateUnsupported, localEnvironmentActivationReasonUnsupported
		case localEnvironmentStateRepairRequired:
			return localEnvironmentActivationStateRepairRequired, localEnvironmentActivationReasonRepairRequired
		case localEnvironmentStateFailed:
			return localEnvironmentActivationStateFailed, localEnvironmentActivationReasonFailed
		case localEnvironmentStateCancelled:
			return localEnvironmentActivationStateCancelled, localEnvironmentActivationReasonCancelled
		}
	}
	for _, dep := range blocking {
		switch strings.TrimSpace(dep.State) {
		case localEnvironmentStateQueued, localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling:
			return localEnvironmentActivationStateSetupInProgress, localEnvironmentActivationReasonSetupInProgress
		}
	}
	return localEnvironmentActivationStateSetupRequired, localEnvironmentActivationReasonSetupRequired
}

func localEnvironmentActivationBlockDetail(blocking []localEnvironmentPlanDependency) string {
	if len(blocking) == 0 {
		return ""
	}
	parts := make([]string, 0, len(blocking))
	for _, dep := range blocking {
		family := strings.TrimSpace(dep.DependencyFamily)
		if family == "" {
			family = "unknown_dependency"
		}
		dependencyID := strings.TrimSpace(dep.DependencyID)
		if dependencyID == "" {
			dependencyID = "unknown"
		}
		state := strings.TrimSpace(dep.State)
		if state == "" {
			state = localEnvironmentStateUnknown
		}
		if detail := strings.TrimSpace(dep.Detail); detail != "" {
			parts = append(parts, fmt.Sprintf("%s:%s state=%s detail=%s", family, dependencyID, state, detail))
			continue
		}
		parts = append(parts, fmt.Sprintf("%s:%s state=%s", family, dependencyID, state))
	}
	return "local environment activation blocked: " + strings.Join(parts, "; ")
}

func localEnvironmentActivationDependencyReason(state string) string {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateReadySystem:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_READY_SYSTEM"
	case localEnvironmentStateReadyManaged:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED"
	case localEnvironmentStateRepairRequired:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
	case localEnvironmentStateUnsupported:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED"
	case localEnvironmentStateFailed:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_FAILED"
	case localEnvironmentStateCancelled:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_CANCELLED"
	case localEnvironmentStateQueued, localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_SETUP_IN_PROGRESS"
	default:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED"
	}
}

func localEnvironmentConsumerRequirementByID(consumerID string) (localEnvironmentConsumerRequirement, bool) {
	switch strings.TrimSpace(consumerID) {
	case "llama.cpp.cpu", "llama.cpp.vulkan", "llama.cpp.cuda":
		return localEnvironmentConsumerRequirement{ConsumerID: strings.TrimSpace(consumerID), PackID: "local-text"}, true
	case "stable-diffusion.cpp.cpu", "stable-diffusion.cpp.metal", stableDiffusionCUDAConsumerID:
		return localEnvironmentConsumerRequirement{ConsumerID: strings.TrimSpace(consumerID), PackID: "local-image-native"}, true
	case "media.diffusers.cpu", "media.diffusers.cuda":
		return localEnvironmentConsumerRequirement{ConsumerID: strings.TrimSpace(consumerID), PackID: "local-image-python"}, true
	case "media.video-python.cpu", "media.video-python.cuda":
		return localEnvironmentConsumerRequirement{ConsumerID: strings.TrimSpace(consumerID), PackID: "local-video-python"}, true
	case "speech.qwen3-asr.python", "speech.qwen3-tts.python":
		return localEnvironmentConsumerRequirement{ConsumerID: strings.TrimSpace(consumerID), PackID: "local-speech"}, true
	default:
		return localEnvironmentConsumerRequirement{}, false
	}
}
