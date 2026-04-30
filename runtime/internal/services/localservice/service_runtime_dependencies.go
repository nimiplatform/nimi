package localservice

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	cudaUserSpaceRuntimeDependencyID = engine.NVIDIACUDAUserSpaceRuntimeDependencyID
	stableDiffusionCUDAConsumerID    = "stable-diffusion.cpp.cuda"
)

func (s *Service) ResolveLocalRuntimeDependency(_ context.Context, req *runtimev1.ResolveLocalRuntimeDependencyRequest) (*runtimev1.ResolveLocalRuntimeDependencyResponse, error) {
	dependency, err := s.resolveLocalRuntimeDependencyDescriptor(req.GetDependencyId(), runtimeDependencyConsumerID(req.GetConsumerId(), req.GetLocalAssetId()), req.GetLocalAssetId(), nil)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ResolveLocalRuntimeDependencyResponse{Dependency: dependency}, nil
}

func (s *Service) StartLocalRuntimeDependencySetup(ctx context.Context, req *runtimev1.StartLocalRuntimeDependencySetupRequest) (*runtimev1.StartLocalRuntimeDependencySetupResponse, error) {
	dependencyID := normalizeLocalRuntimeDependencyID(req.GetDependencyId())
	if dependencyID != cudaUserSpaceRuntimeDependencyID {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "unsupported runtime dependency " + strings.TrimSpace(req.GetDependencyId()),
			ActionHint: "inspect_local_runtime_dependency",
		})
	}
	if !req.GetConfirmed() {
		dependency, err := s.resolveLocalRuntimeDependencyDescriptor(dependencyID, runtimeDependencyConsumerID(req.GetConsumerId(), req.GetLocalAssetId()), req.GetLocalAssetId(), nil)
		if err != nil {
			return nil, err
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    dependency.GetMessage(),
			ActionHint: "confirm_runtime_dependency_install",
		})
	}
	consumerID := runtimeDependencyConsumerID(req.GetConsumerId(), req.GetLocalAssetId())
	dependency, err := s.resolveLocalRuntimeDependencyDescriptor(dependencyID, consumerID, req.GetLocalAssetId(), nil)
	if err != nil {
		return nil, err
	}
	if dependency.GetState() == string(engine.SharedAcceleratorDependencyReadySystem) || dependency.GetState() == string(engine.SharedAcceleratorDependencyReadyManaged) {
		return &runtimev1.StartLocalRuntimeDependencySetupResponse{Dependency: dependency}, nil
	}

	transfer := s.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID:    dependencyID,
		Phase:      "queued",
		State:      localTransferStateQueued,
		Message:    "shared accelerator dependency setup queued",
		ReasonCode: "LOCAL_RUNTIME_DEPENDENCY_SETUP_QUEUED",
		Retryable:  true,
	})
	transfer = s.mutateLocalTransfer(transfer.GetInstallSessionId(), true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = "installing"
		summary.State = localTransferStateRunning
		summary.Message = "installing runtime-managed NVIDIA CUDA user-space dependency"
		summary.ReasonCode = "LOCAL_RUNTIME_DEPENDENCY_SETUP_RUNNING"
		summary.Retryable = true
	})

	mgr := s.engineManagerOrNil()
	if mgr == nil {
		transfer = s.failRuntimeDependencyTransfer(transfer.GetInstallSessionId(), "runtime engine manager unavailable")
		dependency, _ = s.resolveLocalRuntimeDependencyDescriptor(dependencyID, consumerID, req.GetLocalAssetId(), transfer)
		return &runtimev1.StartLocalRuntimeDependencySetupResponse{Dependency: dependency, Transfer: transfer}, nil
	}
	status, err := mgr.EnsureSharedAcceleratorDependency(ctx, dependencyID)
	if err != nil {
		transfer = s.failRuntimeDependencyTransfer(transfer.GetInstallSessionId(), fmt.Sprintf("install runtime dependency: %v", err))
		dependency, _ = s.resolveLocalRuntimeDependencyDescriptor(dependencyID, consumerID, req.GetLocalAssetId(), transfer)
		return &runtimev1.StartLocalRuntimeDependencySetupResponse{Dependency: dependency, Transfer: transfer}, nil
	}
	transfer = s.mutateLocalTransfer(transfer.GetInstallSessionId(), true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = "ready"
		summary.State = localTransferStateCompleted
		summary.Message = "runtime-managed CUDA user-space dependency installed"
		summary.ReasonCode = "LOCAL_RUNTIME_DEPENDENCY_READY_MANAGED"
		summary.Retryable = false
	})
	dependency = runtimeDependencyDescriptorFromStatus(status, transfer)
	return &runtimev1.StartLocalRuntimeDependencySetupResponse{Dependency: dependency, Transfer: transfer}, nil
}

func (s *Service) failRuntimeDependencyTransfer(sessionID string, message string) *runtimev1.LocalTransferSessionSummary {
	return s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = "failed"
		summary.State = localTransferStateFailed
		summary.Message = strings.TrimSpace(message)
		summary.ReasonCode = "LOCAL_RUNTIME_DEPENDENCY_SETUP_FAILED"
		summary.Retryable = true
	})
}

func (s *Service) resolveLocalRuntimeDependencyDescriptor(dependencyID string, consumerID string, localAssetID string, transfer *runtimev1.LocalTransferSessionSummary) (*runtimev1.LocalRuntimeDependencyDescriptor, error) {
	normalizedDependencyID := normalizeLocalRuntimeDependencyID(dependencyID)
	if normalizedDependencyID != cudaUserSpaceRuntimeDependencyID {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "unsupported runtime dependency " + strings.TrimSpace(dependencyID),
			ActionHint: "inspect_local_runtime_dependency",
		})
	}
	model := s.modelByID(strings.TrimSpace(localAssetID))
	if model == nil && strings.TrimSpace(localAssetID) != "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "local asset unavailable for runtime dependency resolution",
			ActionHint: "install_or_select_existing_local_model",
		})
	}
	if model != nil {
		selection := canonicalSupervisedImageSelectionForLocalAsset(model, collectDeviceProfile())
		if !selectionRequiresCUDAUserSpaceRuntime(selection) {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				Message:    "local asset does not require CUDA user-space runtime dependency",
				ActionHint: "inspect_local_runtime_model_health",
			})
		}
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		status := engine.SharedAcceleratorDependencyStatus{
			DependencyID: normalizedDependencyID,
			ConsumerID:   strings.TrimSpace(consumerID),
			State:        engine.SharedAcceleratorDependencyUnsupported,
			Source:       "unavailable",
			Detail:       "runtime engine manager unavailable",
		}
		return runtimeDependencyDescriptorFromStatus(status, transfer), nil
	}
	status := mgr.ResolveSharedAcceleratorDependency(normalizedDependencyID, strings.TrimSpace(consumerID))
	return runtimeDependencyDescriptorFromStatus(status, transfer), nil
}

func normalizeLocalRuntimeDependencyID(raw string) string {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return cudaUserSpaceRuntimeDependencyID
	}
	return engine.NormalizeSharedAcceleratorDependencyID(trimmed)
}

func runtimeDependencyDescriptorFromStatus(status engine.SharedAcceleratorDependencyStatus, transfer *runtimev1.LocalTransferSessionSummary) *runtimev1.LocalRuntimeDependencyDescriptor {
	state := string(status.State)
	if state == "" {
		state = "unsupported"
	}
	source := strings.TrimSpace(status.Source)
	if source == "" {
		source = "runtime_managed"
	}
	confirmationRequired := status.State == engine.SharedAcceleratorDependencyMaterializableRequiresConfirmation
	message := strings.TrimSpace(status.Detail)
	if strings.TrimSpace(message) == "" {
		message = "runtime dependency state=" + state
	}
	return &runtimev1.LocalRuntimeDependencyDescriptor{
		DependencyId:           normalizeLocalRuntimeDependencyID(status.DependencyID),
		Kind:                   "accelerator.cuda.runtime",
		State:                  state,
		Source:                 source,
		ConfirmationRequired:   confirmationRequired,
		Message:                message,
		ReasonCode:             runtimeDependencyReasonCode(state),
		InstallLocation:        "nimi_data_runtime_dependency_directory",
		SystemPathMutation:     false,
		Transfer:               cloneLocalTransferSummary(transfer),
		ConsumerId:             strings.TrimSpace(status.ConsumerID),
		HostProfileId:          strings.TrimSpace(status.HostProfileID),
		SelectedSourceRecordId: strings.TrimSpace(status.SelectedSourceRecordID),
		CanonicalRoot:          strings.TrimSpace(status.CanonicalRoot),
	}
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

func runtimeDependencyConsumerID(raw string, localAssetID string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed != "" {
		return trimmed
	}
	if strings.TrimSpace(localAssetID) != "" {
		return stableDiffusionCUDAConsumerID
	}
	return ""
}
