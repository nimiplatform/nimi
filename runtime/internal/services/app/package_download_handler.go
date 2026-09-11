package app

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040d
func (s *Service) PauseAppPackageJob(ctx context.Context, req *runtimev1.PauseAppPackageJobRequest) (*runtimev1.PauseAppPackageJobResponse, error) {
	if req == nil || len(req.GetJobId()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	job, err := s.appInstallCoordinator.PauseInstall(ctx, string(req.GetJobId()))
	if err != nil {
		return nil, appPackageLifecycleError("pause App package job", err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.PauseAppPackageJobResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) ResumeAppPackageJob(ctx context.Context, req *runtimev1.ResumeAppPackageJobRequest) (*runtimev1.ResumeAppPackageJobResponse, error) {
	if req == nil || len(req.GetJobId()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	job, err := s.appInstallCoordinator.ResumeInstall(ctx, string(req.GetJobId()))
	if err != nil {
		return nil, appPackageLifecycleError("resume App package job", err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ResumeAppPackageJobResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) ReorderAppPackageJob(ctx context.Context, req *runtimev1.ReorderAppPackageJobRequest) (*runtimev1.ReorderAppPackageJobResponse, error) {
	if req == nil || len(req.GetJobId()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	job, err := s.appInstallCoordinator.ReorderInstall(ctx, string(req.GetJobId()), string(req.GetBeforeJobId()))
	if err != nil {
		return nil, appPackageLifecycleError("reorder App package job", err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ReorderAppPackageJobResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}
