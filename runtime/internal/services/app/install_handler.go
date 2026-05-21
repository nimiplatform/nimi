package app

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appinstallgateway"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
)

// InstallApp resolves the admitted Nimi App registry row and bound release
// descriptor, then drives the Runtime-owned install gateway. It returns the
// typed install job projection. A failed install is recorded as a recoverable,
// retryable job and is never projected as success.
func (s *Service) InstallApp(ctx context.Context, req *runtimev1.InstallAppRequest) (*runtimev1.InstallAppResponse, error) {
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
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	}

	_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return nil, installResolveError(err)
	}

	if existing := s.installJobs.activeJobForApp(appID); existing != nil {
		return &runtimev1.InstallAppResponse{Job: existing}, nil
	}

	plan, planErr := s.installRuntime.plan(descriptor)
	var storage *runtimev1.AppInstallStorageProjection
	if planErr == nil {
		storage = storageProjectionFromPlan(plan)
	}
	job := s.installJobs.createJob(appID, descriptor.DescriptorID, descriptor.Version, installSourceKind(descriptor), storage)

	if planErr != nil {
		failed := s.installJobs.markFailed(job.GetJobId(), runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION, planErr.Error())
		return &runtimev1.InstallAppResponse{Job: orJob(failed, job)}, nil
	}

	go s.runInstallJob(job.GetJobId(), descriptor)
	return &runtimev1.InstallAppResponse{Job: job}, nil
}

// installObserver bridges install gateway pipeline phases to the typed
// AppInstallJob projection.
type installObserver struct {
	manager *installJobManager
	jobID   string
}

func (o installObserver) Phase(phase appinstallgateway.InstallPhase) {
	o.manager.advance(o.jobID, installPhaseProto(phase))
}

func (o installObserver) ArtifactVerified(artifact appinstallgateway.VerifiedArtifact) {
	o.manager.recordVerified(o.jobID, artifact.SHA256, artifact.Bytes)
}

// runInstallJob executes the install gateway in the background and records the
// typed phase progression plus the terminal state onto the install job. It
// fails closed: a digest/manifest/storage violation marks the job FAILED with
// a typed reason and never as success.
func (s *Service) runInstallJob(jobID string, descriptor appreleasecatalog.Descriptor) {
	observer := installObserver{manager: s.installJobs, jobID: jobID}
	installed, err := s.installRuntime.install(context.Background(), descriptor, observer)
	if err != nil {
		reason, detail := installFailureReason(err)
		s.installJobs.markFailed(jobID, reason, detail)
		if s.logger != nil {
			s.logger.Warn("app install job failed", "job_id", jobID, "app_id", descriptor.AppID, "reason", reason.String(), "error", err)
		}
		return
	}
	storage := storageProjectionFromPlan(installed.Plan)
	s.installJobs.markInstalled(jobID, installed.Artifact.Version, installed.Artifact.SHA256, installed.Artifact.Bytes, storage)
	if s.logger != nil {
		s.logger.Info("app install job installed", "job_id", jobID, "app_id", descriptor.AppID, "version", installed.Artifact.Version)
	}
}

// GetAppInstallJob returns a single typed install job projection.
func (s *Service) GetAppInstallJob(ctx context.Context, req *runtimev1.GetAppInstallJobRequest) (*runtimev1.GetAppInstallJobResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	job, ok := s.installJobs.getJob(strings.TrimSpace(req.GetJobId()))
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND)
	}
	if err := s.requireAppLifecycleSession(ctx, job.GetAppId()); err != nil {
		return nil, err
	}
	return &runtimev1.GetAppInstallJobResponse{Job: job}, nil
}

// ListAppInstallJobs lists typed install job projections, optionally filtered
// to a single app.
func (s *Service) ListAppInstallJobs(ctx context.Context, req *runtimev1.ListAppInstallJobsRequest) (*runtimev1.ListAppInstallJobsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID := strings.TrimSpace(req.GetAppId())
	if appID != "" {
		if err := s.requireAppLifecycleSession(ctx, appID); err != nil {
			return nil, err
		}
	}
	return &runtimev1.ListAppInstallJobsResponse{Jobs: s.installJobs.listJobs(appID)}, nil
}

// WatchAppInstallJobEvents streams typed install job progress frames. An empty
// job_id streams progress for every install job.
func (s *Service) WatchAppInstallJobEvents(req *runtimev1.WatchAppInstallJobEventsRequest, stream runtimev1.RuntimeAppService_WatchAppInstallJobEventsServer) error {
	if req == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	sub := s.installJobs.subscribe(jobID)
	defer s.installJobs.unsubscribe(sub.id)
	return sub.relay.Run(stream.Context(), func(event *runtimev1.AppInstallJobEvent) error {
		return stream.Send(event)
	})
}

// UninstallApp removes the release payload for an installed app and, only when
// destructive deletion is explicitly confirmed, the durable app data root.
func (s *Service) UninstallApp(ctx context.Context, req *runtimev1.UninstallAppRequest) (*runtimev1.UninstallAppResponse, error) {
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
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	}
	if req.GetDeleteDurableData() && !req.GetDestructiveDataDeleteConfirmed() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION)
	}

	_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return nil, installResolveError(err)
	}
	plan, err := s.installRuntime.plan(descriptor)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION)
	}
	options := appstorage.UninstallOptions{
		DeleteDurableData:             req.GetDeleteDurableData(),
		DestructiveDataDeleteApproved: req.GetDestructiveDataDeleteConfirmed(),
	}
	if err := s.installRuntime.uninstall(ctx, plan, options); err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, uninstallReason(err))
	}
	if s.logger != nil {
		s.logger.Info("app uninstalled", "app_id", appID, "delete_durable_data", req.GetDeleteDurableData())
	}
	return &runtimev1.UninstallAppResponse{
		Result: &runtimev1.AppUninstallResult{
			AppId:              appID,
			ReleaseRemoved:     true,
			DurableDataRemoved: req.GetDeleteDurableData(),
			Storage:            storageProjectionFromPlan(plan),
			ReasonCode:         runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}, nil
}

// requireAppLifecycleSession enforces app-session credential validation for
// non-internal lifecycle callers (K-AUTHN-006 authenticated_required posture).
func (s *Service) requireAppLifecycleSession(ctx context.Context, appID string) error {
	if contextAppID := appIDFromContext(ctx); contextAppID != "" && contextAppID != appID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if s.sessionValidator == nil || isTrustedInternalCaller(ctx, appID) {
		return nil
	}
	sessionID, sessionToken, _ := envelope.ParseSessionFromContext(ctx)
	if reasonCode, ok := s.sessionValidator.ValidateAppSession(appID, sessionID, sessionToken); !ok {
		return grpcerr.WithReasonCode(codes.Unauthenticated, reasonCode)
	}
	return nil
}

func installResolveError(err error) error {
	switch {
	case errors.Is(err, errInstallAppIDRequired):
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	case errors.Is(err, errInstallRuntimeUnavailable):
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	default:
		// App not admitted, descriptor unbound, registry/descriptor not found.
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND)
	}
}

// installFailureReason maps a gateway install error to a typed, distinct
// fail-closed reason. The reasons are never collapsed into a generic value.
func installFailureReason(err error) (runtimev1.ReasonCode, string) {
	detail := err.Error()
	switch {
	case errors.Is(err, appinstallgateway.ErrDigestMismatch),
		errors.Is(err, appinstallgateway.ErrSizeMismatch):
		return runtimev1.ReasonCode_APP_INSTALL_DIGEST_MISMATCH, detail
	case errors.Is(err, appreleasecatalog.ErrDescriptorNotFound),
		errors.Is(err, appinstallgateway.ErrDescriptorNotInstallable),
		errors.Is(err, appinstallgateway.ErrBundledArtifactNotFound):
		return runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND, detail
	case errors.Is(err, appreleasecatalog.ErrDescriptorMissingFields),
		errors.Is(err, appreleasecatalog.ErrDescriptorParse),
		errors.Is(err, appreleasecatalog.ErrDescriptorUnknownClass),
		errors.Is(err, appreleasecatalog.ErrDescriptorUnknownSourceKind),
		errors.Is(err, appreleasecatalog.ErrDescriptorDigestUnsupported),
		errors.Is(err, appreleasecatalog.ErrDescriptorPackageKindInvalid),
		errors.Is(err, appreleasecatalog.ErrDescriptorMutableSource),
		errors.Is(err, appreleasecatalog.ErrDescriptorClassSourceMismatch):
		return runtimev1.ReasonCode_APP_INSTALL_MANIFEST_INVALID, detail
	case errors.Is(err, appstorage.ErrDataRootRequired),
		errors.Is(err, appstorage.ErrDataRootMustBeAbsolute),
		errors.Is(err, appstorage.ErrInvalidAppIDSegment),
		errors.Is(err, appstorage.ErrInvalidVersionSegment),
		errors.Is(err, appstorage.ErrStoragePolicyUnsupported),
		errors.Is(err, appstorage.ErrStorageRootSymlink),
		errors.Is(err, appstorage.ErrStorageRootNotDirectory),
		errors.Is(err, appinstallgateway.ErrArchiveEntryEscapesRoot),
		errors.Is(err, appinstallgateway.ErrBundledArtifactSymlink),
		errors.Is(err, appinstallgateway.ErrBundledArtifactNotDirectory):
		return runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION, detail
	case errors.Is(err, appinstallgateway.ErrArtifactLocatorNotHTTPS),
		errors.Is(err, appinstallgateway.ErrArtifactLocatorHostNotAllowed),
		errors.Is(err, appinstallgateway.ErrArtifactDownloadStatus),
		errors.Is(err, appinstallgateway.ErrArtifactTooLarge),
		errors.Is(err, appinstallgateway.ErrBundledDescriptorNotDownloadable):
		return runtimev1.ReasonCode_APP_INSTALL_DOWNLOAD_FAILED, detail
	case errors.Is(err, appinstallgateway.ErrUnsupportedArchiveFormat),
		errors.Is(err, appinstallgateway.ErrArchiveEntrySymlink),
		errors.Is(err, appinstallgateway.ErrArchiveEntryTooLarge),
		errors.Is(err, appinstallgateway.ErrArchiveTooLarge),
		errors.Is(err, appinstallgateway.ErrArchiveTooManyEntries):
		return runtimev1.ReasonCode_APP_INSTALL_UNPACK_FAILED, detail
	default:
		return runtimev1.ReasonCode_APP_INSTALL_INTERNAL, detail
	}
}

func uninstallReason(err error) runtimev1.ReasonCode {
	if errors.Is(err, appstorage.ErrDestructiveDeleteConfirmation) {
		return runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION
	}
	return runtimev1.ReasonCode_APP_INSTALL_INTERNAL
}

func installSourceKind(descriptor appreleasecatalog.Descriptor) runtimev1.AppInstallSourceKind {
	if descriptor.DescriptorClass == appreleasecatalog.DescriptorClassBundledWithNimi {
		return runtimev1.AppInstallSourceKind_APP_INSTALL_SOURCE_KIND_BUNDLED
	}
	return runtimev1.AppInstallSourceKind_APP_INSTALL_SOURCE_KIND_EXTERNAL_ARTIFACT
}

func installPhaseProto(phase appinstallgateway.InstallPhase) runtimev1.AppInstallJobPhase {
	switch phase {
	case appinstallgateway.InstallPhaseResolveDescriptor:
		return runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_RESOLVE_DESCRIPTOR
	case appinstallgateway.InstallPhaseDownload:
		return runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_DOWNLOAD
	case appinstallgateway.InstallPhaseVerify:
		return runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_VERIFY
	case appinstallgateway.InstallPhaseMaterialize:
		return runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_MATERIALIZE
	case appinstallgateway.InstallPhaseUnpack:
		return runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_UNPACK
	case appinstallgateway.InstallPhaseEvidence:
		return runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_EVIDENCE
	default:
		return runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_UNSPECIFIED
	}
}

func orJob(primary *runtimev1.AppInstallJob, fallback *runtimev1.AppInstallJob) *runtimev1.AppInstallJob {
	if primary != nil {
		return primary
	}
	return fallback
}
