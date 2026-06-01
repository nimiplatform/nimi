package app

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// GetAppPackageReadiness returns the Runtime-owned package readiness truth
// projection. It reads the admitted descriptor, active release pointer, and
// Runtime-written install evidence; callers must not scan Runtime storage
// directly to infer the same state.
func (s *Service) GetAppPackageReadiness(ctx context.Context, req *runtimev1.GetAppPackageReadinessRequest) (*runtimev1.GetAppPackageReadinessResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := s.requireAppLifecycleSession(ctx, appID); err != nil {
		return nil, err
	}
	if s.installRuntime == nil {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessBlocked(
			appID,
			runtimev1.ReasonCode_APP_INSTALL_INTERNAL,
			"app install runtime is not configured",
		)}, nil
	}

	_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessBlocked(
			appID,
			runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
			err.Error(),
		)}, nil
	}
	base := &runtimev1.AppPackageReadinessProjection{
		AppId:                appID,
		ReleaseDescriptorRef: descriptor.DescriptorID,
		StoragePolicyRef:     descriptor.StoragePolicyRef,
		ExpectedVersion:      descriptor.Version,
	}

	plan, err := s.installRuntime.plan(descriptor)
	if err != nil {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_BLOCKED,
			runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			err.Error(),
		)}, nil
	}
	active, activeErr := s.installRuntime.activeRelease(plan)
	if errors.Is(activeErr, appstorage.ErrActiveReleaseNotFound) {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_INSTALL_REQUIRED,
			runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
			"app has no active release; install is required",
		)}, nil
	}
	if activeErr != nil {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			activeErr.Error(),
		)}, nil
	}
	activeVersion := strings.TrimSpace(active.ActiveVersion)
	if activeVersion == "" {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app active release pointer has no version",
		)}, nil
	}
	base.ActiveVersion = activeVersion

	activePlan, err := appstorage.Resolve(plan.DataRootRef, descriptor.AppID, activeVersion, descriptor.StoragePolicyRef)
	if err != nil {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			err.Error(),
		)}, nil
	}
	evidence, err := appstorage.ReadInstallEvidence(activePlan)
	if err != nil {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence is missing or unreadable for the active release",
		)}, nil
	}
	base.InstalledVersion = strings.TrimSpace(evidence.InstalledVersion)
	base.Sha256 = strings.TrimSpace(evidence.SHA256)
	base.VerificationState = strings.TrimSpace(evidence.VerificationState)

	if !isVerifiedInstallState(evidence.VerificationState) {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence is not in a verified state",
		)}, nil
	}
	if strings.TrimSpace(evidence.AppID) != appID ||
		strings.TrimSpace(evidence.StoragePolicyRef) != descriptor.StoragePolicyRef ||
		base.InstalledVersion != activeVersion {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence does not match the active release",
		)}, nil
	}
	if activeVersion != descriptor.Version {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_UPDATE_REQUIRED,
			runtimev1.ReasonCode_ACTION_EXECUTED,
			"app has a verified active release, but a newer bound descriptor version is available",
		)}, nil
	}
	shaMustMatchDescriptor := strings.TrimSpace(evidence.VerificationState) == "digest-verified"
	if strings.TrimSpace(evidence.ReleaseDescriptorRef) != descriptor.DescriptorID ||
		(shaMustMatchDescriptor && strings.TrimSpace(evidence.SHA256) != descriptor.Artifact.SHA256) {
		return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
			base,
			runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence does not match the bound release descriptor",
		)}, nil
	}
	return &runtimev1.GetAppPackageReadinessResponse{Projection: appPackageReadinessFromBase(
		base,
		runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_READY,
		runtimev1.ReasonCode_ACTION_EXECUTED,
		"",
	)}, nil
}

func appPackageReadinessBlocked(appID string, reason runtimev1.ReasonCode, detail string) *runtimev1.AppPackageReadinessProjection {
	return &runtimev1.AppPackageReadinessProjection{
		AppId:      appID,
		State:      runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_BLOCKED,
		ReasonCode: reason,
		Detail:     detail,
	}
}

func appPackageReadinessFromBase(
	base *runtimev1.AppPackageReadinessProjection,
	state runtimev1.AppPackageReadinessState,
	reason runtimev1.ReasonCode,
	detail string,
) *runtimev1.AppPackageReadinessProjection {
	projection := *base
	projection.State = state
	projection.ReasonCode = reason
	projection.Detail = detail
	return &projection
}
