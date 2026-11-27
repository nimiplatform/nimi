package app

import (
	"context"
	"errors"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/appsafety"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const approvedAppCatalogRefreshCoalesceWindow = 3 * time.Second

type approvedAppCatalogRefreshFlight struct {
	done     chan struct{}
	response *runtimev1.ListApprovedAppCatalogTargetsResponse
	err      error
}

type ApprovedAppCatalogProvider interface {
	ListCurrentPlatformTargets(context.Context) ([]publicappregistry.ResolvedApprovedTarget, error)
}

func cloneApprovedAppCatalogTargetsResponse(
	resp *runtimev1.ListApprovedAppCatalogTargetsResponse,
) *runtimev1.ListApprovedAppCatalogTargetsResponse {
	if resp == nil {
		return nil
	}
	cloned, ok := proto.Clone(resp).(*runtimev1.ListApprovedAppCatalogTargetsResponse)
	if !ok {
		return nil
	}
	return cloned
}

func (s *Service) closeApprovedAppCatalogRefresh() {
	if s == nil {
		return
	}
	s.catalogRefreshMu.Lock()
	s.catalogRefreshClosed = true
	s.catalogRefreshResumePending = false
	cancel := s.catalogRefreshCancel
	done := s.catalogRefreshDrainDone
	if done == nil {
		done = make(chan struct{})
		s.catalogRefreshDrainDone = done
		go func() {
			s.catalogRefreshWG.Wait()
			s.catalogRefreshPersistMu.Lock()
			s.catalogRefreshPersistMu.Unlock()
			s.catalogRefreshMu.Lock()
			close(done)
			s.catalogRefreshMu.Unlock()
		}()
	}
	s.catalogRefreshMu.Unlock()
	if cancel != nil {
		cancel()
	}
	<-done
}

func (s *Service) reopenCatalogRefreshLocked() {
	if s.catalogRefreshCancel != nil {
		s.catalogRefreshCancel()
	}
	s.catalogRefreshCtx, s.catalogRefreshCancel = context.WithCancel(context.Background())
	s.catalogRefreshQuiesced = false
	s.catalogRefreshResumePending = false
	s.catalogRefreshDrainDone = nil
	s.catalogRefreshCompleted = false
	s.catalogLastLiveResponse = nil
	s.catalogLastRefreshErr = nil
	s.catalogLastRefreshAt = time.Time{}
}

// QuiesceDataRootContext cancels and drains background approved App catalog
// refresh work so no post-handoff write can reach the old data root's SQLite.
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007a
func (s *Service) QuiesceDataRootContext(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.catalogRefreshMu.Lock()
	s.catalogRefreshQuiesced = true
	s.catalogRefreshResumePending = false
	cancel := s.catalogRefreshCancel
	if s.catalogRefreshDrainDone == nil {
		done := make(chan struct{})
		s.catalogRefreshDrainDone = done
		go func() {
			s.catalogRefreshWG.Wait()
			s.catalogRefreshPersistMu.Lock()
			s.catalogRefreshPersistMu.Unlock()
			s.catalogRefreshMu.Lock()
			close(done)
			if s.catalogRefreshResumePending && !s.catalogRefreshClosed {
				s.reopenCatalogRefreshLocked()
			}
			s.catalogRefreshMu.Unlock()
		}()
	}
	done := s.catalogRefreshDrainDone
	s.catalogRefreshMu.Unlock()
	if cancel != nil {
		cancel()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
		return nil
	}
}

// ResumeDataRootAfterAbort restores background approved App catalog refreshes
// on the original root if Product Control aborts a pre-commit handoff.
func (s *Service) ResumeDataRootAfterAbort() {
	if s == nil {
		return
	}
	s.catalogRefreshMu.Lock()
	defer s.catalogRefreshMu.Unlock()
	if s.catalogRefreshClosed || !s.catalogRefreshQuiesced {
		return
	}
	if s.catalogRefreshDrainDone == nil {
		s.reopenCatalogRefreshLocked()
		return
	}
	select {
	case <-s.catalogRefreshDrainDone:
		s.reopenCatalogRefreshLocked()
	default:
		s.catalogRefreshResumePending = true
	}
}

func (s *Service) checkCatalogRefreshPersistAllowed(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.catalogRefreshMu.Lock()
	stopped := s.catalogRefreshClosed || s.catalogRefreshQuiesced
	s.catalogRefreshMu.Unlock()
	if stopped {
		return context.Canceled
	}
	return nil
}

func (s *Service) startOrJoinApprovedAppCatalogRefreshFlight() (*approvedAppCatalogRefreshFlight, bool) {
	s.catalogRefreshMu.Lock()
	if s.catalogRefreshClosed || s.catalogRefreshQuiesced {
		s.catalogRefreshMu.Unlock()
		return nil, false
	}
	if s.catalogRefreshFlight != nil {
		flight := s.catalogRefreshFlight
		s.catalogRefreshMu.Unlock()
		return flight, true
	}
	flight := &approvedAppCatalogRefreshFlight{done: make(chan struct{})}
	refreshCtx := s.catalogRefreshCtx
	if refreshCtx == nil {
		refreshCtx = context.Background()
	}
	s.catalogRefreshFlight = flight
	s.catalogRefreshWG.Add(1)
	s.catalogRefreshMu.Unlock()
	go s.runApprovedAppCatalogRefreshFlight(flight, refreshCtx)
	return flight, true
}

func (s *Service) runApprovedAppCatalogRefreshFlight(
	flight *approvedAppCatalogRefreshFlight,
	refreshCtx context.Context,
) {
	defer s.catalogRefreshWG.Done()
	resp, err := s.fetchLiveApprovedAppCatalogTargets(refreshCtx)
	completedAt := s.now().UTC()
	s.catalogRefreshMu.Lock()
	flight.response = resp
	flight.err = err
	if !s.catalogRefreshClosed && !s.catalogRefreshQuiesced && refreshCtx.Err() == nil {
		if err == nil && resp != nil {
			s.catalogLastLiveResponse = cloneApprovedAppCatalogTargetsResponse(resp)
			s.catalogLastRefreshErr = nil
		} else {
			s.catalogLastLiveResponse = nil
			s.catalogLastRefreshErr = err
		}
		s.catalogRefreshCompleted = true
		s.catalogLastRefreshAt = completedAt
	}
	if s.catalogRefreshFlight == flight {
		s.catalogRefreshFlight = nil
	}
	close(flight.done)
	s.catalogRefreshMu.Unlock()
}

func waitApprovedAppCatalogRefreshFlight(
	ctx context.Context,
	flight *approvedAppCatalogRefreshFlight,
) (*runtimev1.ListApprovedAppCatalogTargetsResponse, error) {
	if flight == nil {
		return nil, context.Canceled
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-flight.done:
		return cloneApprovedAppCatalogTargetsResponse(flight.response), flight.err
	}
}

func (s *Service) fetchLiveApprovedAppCatalogTargets(
	ctx context.Context,
) (*runtimev1.ListApprovedAppCatalogTargetsResponse, error) {
	var observedSeq uint64
	observedAt := s.now().UTC()
	if s.appInstallCoordinator != nil {
		observedSeq, observedAt = s.appInstallCoordinator.BeginPolicyObservation()
	}
	targets, err := s.approvedAppCatalog.ListCurrentPlatformTargets(ctx)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	projected := make([]*runtimev1.ApprovedAppCatalogTarget, 0, len(targets))
	for _, target := range targets {
		value, projectErr := approvedAppCatalogTargetProjection(target)
		if projectErr != nil {
			return nil, projectErr
		}
		projected = append(projected, value)
	}
	updatedAt := s.now().UTC()
	s.catalogRefreshPersistMu.Lock()
	if err := s.checkCatalogRefreshPersistAllowed(ctx); err != nil {
		s.catalogRefreshPersistMu.Unlock()
		return nil, err
	}
	persistCtx := context.WithoutCancel(ctx)
	s.saveApprovedAppCatalogBrowseProjection(persistCtx, targets, updatedAt)
	s.recordObservedCatalogKillSwitches(persistCtx, targets, observedSeq, observedAt)
	s.catalogRefreshPersistMu.Unlock()
	return &runtimev1.ListApprovedAppCatalogTargetsResponse{
		Targets:           projected,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		Stale:             false,
		UpdatedAt:         timestamppb.New(updatedAt),
		RefreshInProgress: false,
	}, nil
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-013a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-018a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (s *Service) ListApprovedAppCatalogTargets(
	ctx context.Context,
	req *runtimev1.ListApprovedAppCatalogTargetsRequest,
) (*runtimev1.ListApprovedAppCatalogTargetsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.approvedAppCatalog == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE)
	}
	if err := ctx.Err(); err != nil {
		return nil, approvedAppCatalogError(err)
	}
	resolveFlightResult := func(
		resp *runtimev1.ListApprovedAppCatalogTargetsResponse,
		err error,
	) (*runtimev1.ListApprovedAppCatalogTargetsResponse, error) {
		if err == nil && resp != nil {
			return resp, nil
		}
		if errors.Is(err, publicappregistry.ErrRegistryUnavailable) && ctx.Err() == nil {
			if staleResp, ok := s.loadStaleApprovedAppCatalogBrowseProjection(ctx); ok {
				return staleResp, nil
			}
		}
		return nil, approvedAppCatalogError(err)
	}

	if req.GetForceRefresh() {
		flight, ok := s.startOrJoinApprovedAppCatalogRefreshFlight()
		if !ok {
			return nil, approvedAppCatalogError(context.Canceled)
		}
		resp, err := waitApprovedAppCatalogRefreshFlight(ctx, flight)
		return resolveFlightResult(resp, err)
	}

	if req.GetAwaitRefresh() {
		s.catalogRefreshMu.Lock()
		if s.catalogRefreshClosed || s.catalogRefreshQuiesced {
			s.catalogRefreshMu.Unlock()
			return nil, approvedAppCatalogError(context.Canceled)
		}
		flight := s.catalogRefreshFlight
		completed := s.catalogRefreshCompleted
		lastLive := cloneApprovedAppCatalogTargetsResponse(s.catalogLastLiveResponse)
		lastErr := s.catalogLastRefreshErr
		s.catalogRefreshMu.Unlock()
		if flight != nil {
			resp, err := waitApprovedAppCatalogRefreshFlight(ctx, flight)
			return resolveFlightResult(resp, err)
		}
		if completed {
			if lastLive != nil {
				return lastLive, nil
			}
			if lastErr != nil {
				return resolveFlightResult(nil, lastErr)
			}
		}
		flight, ok := s.startOrJoinApprovedAppCatalogRefreshFlight()
		if !ok {
			return nil, approvedAppCatalogError(context.Canceled)
		}
		resp, err := waitApprovedAppCatalogRefreshFlight(ctx, flight)
		return resolveFlightResult(resp, err)
	}

	// Default cache-first path: when a validated persisted browse projection
	// exists, return it immediately (display-only empty selectors) and
	// start/join ONE singleflight background live refresh.
	if staleResp, ok := s.loadStaleApprovedAppCatalogBrowseProjection(ctx); ok {
		now := s.now().UTC()
		s.catalogRefreshMu.Lock()
		if s.catalogRefreshClosed || s.catalogRefreshQuiesced {
			s.catalogRefreshMu.Unlock()
			return staleResp, nil
		}
		if s.catalogRefreshFlight != nil {
			s.catalogRefreshMu.Unlock()
			staleResp.RefreshInProgress = true
			return staleResp, nil
		}
		if s.catalogRefreshCompleted &&
			!s.catalogLastRefreshAt.IsZero() &&
			s.catalogLastLiveResponse != nil {
			elapsed := now.Sub(s.catalogLastRefreshAt)
			if elapsed >= 0 && elapsed < approvedAppCatalogRefreshCoalesceWindow {
				liveResp := cloneApprovedAppCatalogTargetsResponse(s.catalogLastLiveResponse)
				s.catalogRefreshMu.Unlock()
				return liveResp, nil
			}
		}
		flight := &approvedAppCatalogRefreshFlight{done: make(chan struct{})}
		refreshCtx := s.catalogRefreshCtx
		if refreshCtx == nil {
			refreshCtx = context.Background()
		}
		s.catalogRefreshFlight = flight
		s.catalogRefreshWG.Add(1)
		s.catalogRefreshMu.Unlock()
		go s.runApprovedAppCatalogRefreshFlight(flight, refreshCtx)
		staleResp.RefreshInProgress = true
		return staleResp, nil
	}

	// Empty DB (no persisted browse projection yet): wait on the singleflight live refresh directly.
	flight, ok := s.startOrJoinApprovedAppCatalogRefreshFlight()
	if !ok {
		return nil, approvedAppCatalogError(context.Canceled)
	}
	resp, err := waitApprovedAppCatalogRefreshFlight(ctx, flight)
	return resolveFlightResult(resp, err)
}

// recordObservedCatalogKillSwitches persists official kill-switch blocks
// observed during a live catalog fetch so a newer deny immediately overrides
// any prior offline grace allow. It never records or renews an allow result.
func (s *Service) recordObservedCatalogKillSwitches(
	ctx context.Context,
	targets []publicappregistry.ResolvedApprovedTarget,
	observedSeq uint64,
	observedAt time.Time,
) {
	if s == nil {
		return
	}
	persistCtx := context.WithoutCancel(ctx)
	for _, target := range targets {
		if !target.KillSwitch.Active {
			continue
		}
		reason := ""
		if target.KillSwitch.Reason != nil {
			reason = strings.TrimSpace(*target.KillSwitch.Reason)
		}
		if s.appInstallCoordinator != nil {
			s.appInstallCoordinator.RecordObservedCatalogKillSwitch(
				persistCtx,
				target.AppID,
				reason,
				target.KillSwitch.Revision,
				target.RegistryRevision,
				observedSeq,
				observedAt,
			)
			continue
		}
		if s.localAppKernel == nil || s.localAppKernel.PackageLifecycle() == nil {
			continue
		}
		store := s.localAppKernel.PackageLifecycle()
		release, err := store.GetCommittedRelease(persistCtx, target.AppID, localappkernel.SourceClassVerified)
		if err != nil {
			continue
		}
		installedSelector, err := publicappregistry.ParseApprovedTargetSelector(release.ReleaseRef)
		if err != nil {
			continue
		}
		if reason == "" {
			reason = "policy-blocked"
		}
		if _, err := store.RecordVerifiedPolicy(persistCtx, localappkernel.VerifiedPolicyVerification{
			AppID:            release.AppID,
			ReleaseRef:       release.ReleaseRef,
			DescriptorID:     installedSelector.DescriptorID(),
			TargetID:         installedSelector.TargetID(),
			Status:           localappkernel.VerifiedPolicyBlocked,
			PolicyReason:     reason,
			PolicyRevision:   target.KillSwitch.Revision,
			RegistryRevision: target.RegistryRevision,
			VerifiedAt:       observedAt,
			ObservedAt:       observedAt,
		}); err != nil {
			if s.logger != nil {
				s.logger.Warn("failed to persist catalog-observed verified App kill switch",
					"app_id", release.AppID,
					"release_ref", release.ReleaseRef,
					"policy_revision", target.KillSwitch.Revision,
					"error", err,
				)
			}
			if delErr := store.DeleteVerifiedPolicy(
				persistCtx,
				release.AppID,
				release.ReleaseRef,
				installedSelector.DescriptorID(),
				installedSelector.TargetID(),
			); delErr != nil && s.logger != nil {
				s.logger.Warn("failed to delete stale verified App policy record after catalog kill-switch persistence failure",
					"app_id", release.AppID,
					"release_ref", release.ReleaseRef,
					"error", delErr,
				)
			}
		}
	}
}

func (s *Service) saveApprovedAppCatalogBrowseProjection(
	ctx context.Context,
	targets []publicappregistry.ResolvedApprovedTarget,
	updatedAt time.Time,
) {
	if s == nil || s.localAppKernel == nil || s.localAppKernel.PackageLifecycle() == nil {
		return
	}
	platformTargetID, expectedOS, expectedArch, platformErr := publicappregistry.CurrentPlatformTarget()
	if platformErr != nil {
		return
	}
	raw, revision, err := publicappregistry.EncodeBrowseProjection(targets, expectedOS, expectedArch)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("failed to encode public App Catalog browse projection", "error", err)
		}
		return
	}
	if err := s.localAppKernel.PackageLifecycle().SavePublicCatalogBrowseSnapshot(ctx, localappkernel.PublicCatalogBrowseSnapshot{
		TargetID:         platformTargetID,
		OS:               expectedOS,
		Arch:             expectedArch,
		RegistryRevision: revision,
		ProjectionJSON:   raw,
		UpdatedAt:        updatedAt,
	}); err != nil && s.logger != nil {
		s.logger.Warn("failed to persist public App Catalog browse projection", "error", err)
	}
}

func (s *Service) loadStaleApprovedAppCatalogBrowseProjection(
	ctx context.Context,
) (*runtimev1.ListApprovedAppCatalogTargetsResponse, bool) {
	if s == nil || s.localAppKernel == nil || s.localAppKernel.PackageLifecycle() == nil {
		return nil, false
	}
	platformTargetID, expectedOS, expectedArch, platformErr := publicappregistry.CurrentPlatformTarget()
	if platformErr != nil {
		return nil, false
	}
	snapshot, err := s.localAppKernel.PackageLifecycle().ReadPublicCatalogBrowseSnapshot(ctx, platformTargetID, expectedOS, expectedArch)
	if err != nil {
		return nil, false
	}
	decoded, err := publicappregistry.DecodeBrowseProjection(snapshot.ProjectionJSON, expectedOS, expectedArch)
	if err != nil {
		return nil, false
	}
	projected := make([]*runtimev1.ApprovedAppCatalogTarget, 0, len(decoded.Targets))
	for _, item := range decoded.Targets {
		projected = append(projected, approvedAppCatalogBrowseTargetProjection(item))
	}
	return &runtimev1.ListApprovedAppCatalogTargetsResponse{
		Targets:    projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Stale:      true,
		UpdatedAt:  timestamppb.New(snapshot.UpdatedAt),
	}, true
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
// @nimi-authority: definition.nimi.runtime.app-surface.registered-app-subject-record-plane
func (s *Service) ListCommittedAppReleases(
	ctx context.Context,
	req *runtimev1.ListCommittedAppReleasesRequest,
) (*runtimev1.ListCommittedAppReleasesResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	releases, err := store.ListCommittedReleases(ctx)
	if err != nil {
		return nil, appPackageInventoryReadError(err)
	}
	projected := make([]*runtimev1.CommittedAppRelease, 0, len(releases))
	for _, release := range releases {
		value, projectErr := committedAppReleaseProjection(release)
		if projectErr != nil {
			return nil, appPackageInventoryReadError(projectErr)
		}
		registration, err := s.localAppKernel.Registrations().GetByHandle(ctx, release.RegistrationHandle)
		if errors.Is(err, localappkernel.ErrRegistrationUnavailable) {
			// Durable releases survive a root copy or another installation. A
			// launch selector is projected only through this host's exact binding;
			// reading the inventory must neither reopen nor remove foreign records.
			continue
		}
		if err != nil {
			return nil, appPackageInventoryReadError(err)
		}
		value.DisplayName = registration.DisplayName
		value.AppAccess = append([]string(nil), registration.RawDeclaration...)
		projected = append(projected, value)
	}
	return &runtimev1.ListCommittedAppReleasesResponse{
		Releases:   projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func appPackageInventoryReadError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return appPackageLifecycleError("read installed App inventory", err)
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE, err,
		grpcerr.ReasonOptions{Message: "installed App inventory is unavailable"})
}

func (s *Service) ListAppPackageJobs(
	ctx context.Context,
	req *runtimev1.ListAppPackageJobsRequest,
) (*runtimev1.ListAppPackageJobsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	var jobs []localappkernel.PackageJob
	if s.appInstallCoordinator != nil {
		jobs, err = s.appInstallCoordinator.ListJobs(ctx)
	} else {
		jobs, err = store.ListJobs(ctx)
	}
	if err != nil {
		return nil, appPackageLifecycleError("list App package jobs", err)
	}
	projected := make([]*runtimev1.AppPackageJob, 0, len(jobs))
	for _, job := range jobs {
		value, projectErr := appPackageJobProjection(job)
		if projectErr != nil {
			return nil, projectErr
		}
		projected = append(projected, value)
	}
	return &runtimev1.ListAppPackageJobsResponse{
		Jobs:       projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetAppPackageJob(
	ctx context.Context,
	req *runtimev1.GetAppPackageJobRequest,
) (*runtimev1.GetAppPackageJobResponse, error) {
	if req == nil || len(req.GetJobId()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	var job localappkernel.PackageJob
	if s.appInstallCoordinator != nil {
		job, err = s.appInstallCoordinator.GetJob(ctx, string(req.GetJobId()))
	} else {
		job, err = store.GetJob(ctx, string(req.GetJobId()))
	}
	if err != nil {
		return nil, appPackageLifecycleError("get App package job", err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAppPackageJobResponse{
		Job:        projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
func (s *Service) StartAppPackageInstall(
	ctx context.Context,
	req *runtimev1.StartAppPackageInstallRequest,
) (*runtimev1.StartAppPackageInstallResponse, error) {
	if req == nil || len(req.GetApprovedTargetSelector()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	selector, err := publicappregistry.ParseApprovedTargetSelector(string(req.GetApprovedTargetSelector()))
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID, err, grpcerr.ReasonOptions{})
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	job, err := s.appInstallCoordinator.StartInstall(ctx, selector)
	if err != nil {
		return nil, appPackageInstallStartError(err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartAppPackageInstallResponse{
		Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) CancelAppPackageJob(
	ctx context.Context,
	req *runtimev1.CancelAppPackageJobRequest,
) (*runtimev1.CancelAppPackageJobResponse, error) {
	if req == nil || len(req.GetJobId()) == 0 || strings.TrimSpace(req.GetReasonCode()) == "" || strings.TrimSpace(req.GetReasonCode()) != req.GetReasonCode() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	expected, ok := packageJobPhaseFromProto(req.GetExpectedPhase())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	job, err := store.GetJob(ctx, string(req.GetJobId()))
	if err != nil {
		return nil, appPackageLifecycleError("cancel App package job", err)
	}
	coordinatorOwned := (job.SourceClass == localappkernel.SourceClassVerified || job.SourceClass == localappkernel.SourceClassUserImported) &&
		(job.Kind == localappkernel.PackageJobInstall || job.Kind == localappkernel.PackageJobUpdate || job.Kind == localappkernel.PackageJobUninstall)
	if coordinatorOwned && s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	if !coordinatorOwned {
		job, err = store.Cancel(ctx, job.JobID, expected, req.GetReasonCode())
	} else if job.Kind == localappkernel.PackageJobUninstall {
		job, err = s.appInstallCoordinator.CancelUninstall(ctx, job.JobID, expected, req.GetReasonCode())
		if err == nil {
			if owner, ok := protectedlocal.DesktopConnectionFromContext(ctx); ok {
				owner.UnbindRevocationHook(uninstallJobHook(job.JobID))
			}
		}
	} else {
		job, err = s.appInstallCoordinator.CancelInstall(ctx, job.JobID, expected, req.GetReasonCode())
	}
	if err != nil {
		return nil, appPackageLifecycleError("cancel App package job", err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelAppPackageJobResponse{
		Job:        projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func appPackageInstallStartError(err error) error {
	var blocked *publicappregistry.PolicyBlockedError
	switch {
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, "public App install start canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, "public App install start deadline exceeded")
	case errors.Is(err, publicappregistry.ErrInvalidSelector), errors.Is(err, nimiappinstall.ErrInstallTarget):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrStaleSelection):
		return grpcerr.WrapWithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE, err, grpcerr.ReasonOptions{})
	case errors.As(err, &blocked):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED, err, grpcerr.ReasonOptions{Metadata: map[string]string{
			"policy_reason": blocked.Reason, "policy_revision": strconv.FormatUint(blocked.Revision, 10),
		}})
	case errors.Is(err, nimiappinstall.ErrAppAlreadyInstalled):
		return grpcerr.WrapWithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_APP_PACKAGE_ALREADY_INSTALLED, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobActive):
		return grpcerr.WrapWithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_JOB_ACTIVE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, nimiappinstall.ErrInvalidCoordinator), errors.Is(err, nimiappinstall.ErrUnsupportedInstallPlatform), errors.Is(err, nimiappinstall.ErrInstallQuiescing):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrRegistryUnavailable), errors.Is(err, publicappregistry.ErrInvalidRegistrySnapshot),
		errors.Is(err, nimiappinstall.ErrInstallPersistenceUnavailable):
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	default:
		return fmt.Errorf("start public App package install: %w", err)
	}
}

func approvedAppCatalogError(err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, "public App Catalog read canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, "public App Catalog read deadline exceeded")
	case errors.Is(err, publicappregistry.ErrCatalogAppNotFound):
		// The Registry was read and confirms no row: not a read failure and not a retirement state.
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_CATALOG_ROW_ABSENT, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrCatalogTargetNotFound):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrRegistryUnavailable), errors.Is(err, publicappregistry.ErrInvalidRegistrySnapshot):
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	default:
		return fmt.Errorf("list approved public App Catalog targets: %w", err)
	}
}

func (s *Service) packageLifecycleStore() (*localappkernel.PackageLifecycleStore, error) {
	if s == nil || s.localAppKernel == nil || s.localAppKernel.PackageLifecycle() == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return s.localAppKernel.PackageLifecycle(), nil
}

func appPackageLifecycleError(operation string, err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, operation+" canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, operation+" deadline exceeded")
	case errors.Is(err, nimiappinstall.ErrInvalidCoordinator), errors.Is(err, nimiappinstall.ErrInstallQuiescing):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, nimiappinstall.ErrUpdateUnavailable):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_UPDATE_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, nimiappinstall.ErrUpdateHostRunning):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_HOST_RUNNING, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrStaleSelection), errors.Is(err, publicappregistry.ErrPolicyBlocked),
		errors.Is(err, publicappregistry.ErrInvalidSelector), errors.Is(err, nimiappinstall.ErrInstallTarget),
		errors.Is(err, publicappregistry.ErrRegistryUnavailable), errors.Is(err, publicappregistry.ErrInvalidRegistrySnapshot),
		errors.Is(err, nimiappinstall.ErrInstallPersistenceUnavailable):
		return appPackageInstallStartError(err)
	case errors.Is(err, localappkernel.ErrInvalidArgument):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobNotFound):
		return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_PACKAGE_JOB_NOT_FOUND, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobPhase):
		return grpcerr.WrapWithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_JOB_PHASE_CONFLICT, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobNotCancelable), errors.Is(err, localappkernel.ErrPackageJobTerminal):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_JOB_NOT_CANCELABLE, err, grpcerr.ReasonOptions{})
	default:
		return fmt.Errorf("%s: %w", operation, err)
	}
}

func committedAppReleaseProjection(release localappkernel.CommittedRelease) (*runtimev1.CommittedAppRelease, error) {
	sourceClass, ok := packageSourceClassToProto(release.SourceClass)
	if !ok {
		return nil, fmt.Errorf("project committed App release: unsupported source class %q", release.SourceClass)
	}
	return &runtimev1.CommittedAppRelease{
		AppId:          release.AppID,
		SourceClass:    sourceClass,
		Version:        release.Version,
		ReleaseRef:     release.ReleaseRef,
		LaunchSelector: []byte(release.RegistrationHandle),
		CommittedAt:    timestamppb.New(release.CommittedAt),
	}, nil
}

func approvedAppCatalogTargetProjection(target publicappregistry.ResolvedApprovedTarget) (*runtimev1.ApprovedAppCatalogTarget, error) {
	selector, err := target.Selector.Encode()
	if err != nil || target.DescriptorID != target.Selector.DescriptorID() ||
		target.Target.TargetID != target.Selector.TargetID() ||
		target.RegistryRevision != target.Selector.ObservedRegistryCommit() {
		return nil, fmt.Errorf("project approved App Catalog target: inconsistent selector: %w", publicappregistry.ErrInvalidRegistrySnapshot)
	}
	storage := make([]*runtimev1.ApprovedAppCatalogStorageDisclosure, 0, len(target.StoragePolicy.OSStorageDisclosure))
	for _, disclosure := range target.StoragePolicy.OSStorageDisclosure {
		storage = append(storage, &runtimev1.ApprovedAppCatalogStorageDisclosure{
			PathPattern:      disclosure.PathPattern,
			Purpose:          disclosure.Purpose,
			ExpectedSizeBand: disclosure.ExpectedSizeBand,
		})
	}
	return &runtimev1.ApprovedAppCatalogTarget{
		ApprovedTargetSelector:          []byte(selector),
		ObservedRegistryRevision:        target.RegistryRevision,
		DescriptorId:                    target.DescriptorID,
		AppId:                           target.AppID,
		DisplayName:                     target.DisplayName,
		Version:                         target.Version,
		PublisherGithubNamespace:        target.Publisher.GitHubNamespace,
		SourceRepository:                target.Source.Repository,
		SourceLicenseSpdxExpression:     target.Source.License.SPDXExpression,
		AppAccess:                       append([]string(nil), target.AppAccess...),
		CapabilityContractRefs:          append([]string(nil), target.CapabilityContractRefs...),
		RequiredStandardizedFeatureRefs: append([]string(nil), target.RequiredStandardizedFeatureRefs...),
		StoragePolicyKind:               target.StoragePolicy.Kind,
		OsStorageDisclosures:            storage,
		TargetId:                        target.Target.TargetID,
		Os:                              target.Target.OS,
		Arch:                            target.Target.Arch,
		AssetName:                       target.Target.AssetName,
		AssetSize:                       target.Target.Size,
		ExecutionProfileRef:             target.Target.ExecutionProfileRef,
		WindowsCodeSigning:              target.Target.NativeTrust.WindowsCodeSigning,
		ObservedSigningSubject:          cloneStringPointer(target.Target.NativeTrust.ObservedSubject),
		MacosNotarization:               target.Target.NativeTrust.MacOSNotarization,
		MacosDeveloperIdSubject:         cloneStringPointer(target.Target.NativeTrust.MacOSDeveloperIDSubject),
		PolicyBlocked:                   target.KillSwitch.Active,
		PolicyReason:                    cloneStringPointer(target.KillSwitch.Reason),
		PolicyRevision:                  target.KillSwitch.Revision,
		SafetyDeclaration:               appSafetyDeclarationProjection(target.SafetyProfile),
		ProductOrigin:                   target.Origin,
		ProductUpstream:                 appProductUpstreamProjection(target.Upstream),
		AdmissionTrustTier:              target.Admission.TrustTier,
	}, nil
}

func appProductUpstreamProjection(upstream *publicappregistry.ProductUpstream) *runtimev1.AppProductUpstream {
	if upstream == nil {
		return nil
	}
	return &runtimev1.AppProductUpstream{
		Name: upstream.Name,
		Url:  upstream.URL,
	}
}

// approvedAppCatalogBrowseTargetProjection converts a persisted display-only
// browse entry to wire format with an explicitly empty approved_target_selector
// so stale display records never grant install, update, or launch authority.
func approvedAppCatalogBrowseTargetProjection(target publicappregistry.BrowseTarget) *runtimev1.ApprovedAppCatalogTarget {
	storage := make([]*runtimev1.ApprovedAppCatalogStorageDisclosure, 0, len(target.StoragePolicy.OSStorageDisclosure))
	for _, disclosure := range target.StoragePolicy.OSStorageDisclosure {
		storage = append(storage, &runtimev1.ApprovedAppCatalogStorageDisclosure{
			PathPattern:      disclosure.PathPattern,
			Purpose:          disclosure.Purpose,
			ExpectedSizeBand: disclosure.ExpectedSizeBand,
		})
	}
	return &runtimev1.ApprovedAppCatalogTarget{
		ApprovedTargetSelector:          nil,
		ObservedRegistryRevision:        target.ObservedRegistryRevision,
		DescriptorId:                    target.DescriptorID,
		AppId:                           target.AppID,
		DisplayName:                     target.DisplayName,
		Version:                         target.Version,
		PublisherGithubNamespace:        target.PublisherGitHubNamespace,
		SourceRepository:                target.SourceRepository,
		SourceLicenseSpdxExpression:     target.SourceLicenseSPDXExpression,
		AppAccess:                       append([]string(nil), target.AppAccess...),
		CapabilityContractRefs:          append([]string(nil), target.CapabilityContractRefs...),
		RequiredStandardizedFeatureRefs: append([]string(nil), target.RequiredStandardizedFeatureRefs...),
		StoragePolicyKind:               target.StoragePolicy.Kind,
		OsStorageDisclosures:            storage,
		TargetId:                        target.TargetID,
		Os:                              target.OS,
		Arch:                            target.Arch,
		AssetName:                       target.AssetName,
		AssetSize:                       target.AssetSize,
		ExecutionProfileRef:             target.ExecutionProfileRef,
		WindowsCodeSigning:              target.WindowsCodeSigning,
		ObservedSigningSubject:          cloneStringPointer(target.ObservedSigningSubject),
		MacosNotarization:               target.MacOSNotarization,
		MacosDeveloperIdSubject:         cloneStringPointer(target.MacOSDeveloperIDSubject),
		PolicyBlocked:                   target.KillSwitch.Active,
		PolicyReason:                    cloneStringPointer(target.KillSwitch.Reason),
		PolicyRevision:                  target.KillSwitch.Revision,
		SafetyDeclaration:               appSafetyDeclarationProjection(target.SafetyProfile),
		ProductOrigin:                   target.Origin,
		ProductUpstream:                 appProductUpstreamProjection(target.Upstream),
		AdmissionTrustTier:              target.AdmissionTrustTier,
	}
}

// Projects the declaration as declared; nil stays nil (undeclared), never an
// empty declaration.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043c
func appSafetyDeclarationProjection(profile *appsafety.Profile) *runtimev1.AppSafetyDeclaration {
	if profile == nil {
		return nil
	}
	outputs := make([]*runtimev1.AppSafetyOutputDeclaration, 0, len(profile.AI.Outputs))
	for _, output := range profile.AI.Outputs {
		outputs = append(outputs, &runtimev1.AppSafetyOutputDeclaration{
			Modality: output.Modality, Exposure: output.Exposure, PublicationControl: output.PublicationControl,
			InProductNotice: output.InProductNotice, ExportVisibleMarking: output.ExportVisibleMarking, MachineReadableMarking: output.MachineReadableMarking,
		})
	}
	return &runtimev1.AppSafetyDeclaration{
		IntendedAudience:               profile.IntendedAudience,
		ContentDescriptors:             append([]string{}, profile.ContentDescriptors...),
		AiDirectInteraction:            profile.AI.DirectInteraction != nil && *profile.AI.DirectInteraction,
		AiInteractionNotice:            profile.AI.InteractionNotice,
		AiRiskFeatures:                 append([]string{}, profile.AI.RiskFeatures...),
		AiSubjectNotice:                profile.AI.SubjectNotice,
		AiOutputs:                      outputs,
		PublisherDirectExternalNetwork: profile.DataPractices.PublisherDirectExternalNetwork != nil && *profile.DataPractices.PublisherDirectExternalNetwork,
		Telemetry:                      append([]string{}, profile.DataPractices.Telemetry...),
		ThirdPartyAccount:              profile.DataPractices.ThirdPartyAccount,
		UserContentSharing:             profile.DataPractices.UserContentSharing,
		CommercialFeatures:             append([]string{}, profile.DataPractices.CommercialFeatures...),
		SensitiveDataCategories:        append([]string{}, profile.DataPractices.SensitiveDataCategories...),
		HighImpactDecisionUses:         append([]string{}, profile.HighImpactDecisionUses...),
	}
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func appPackageJobProjection(job localappkernel.PackageJob) (*runtimev1.AppPackageJob, error) {
	sourceClass, sourceOK := packageSourceClassToProto(job.SourceClass)
	kind, kindOK := packageJobKindToProto(job.Kind)
	phase, phaseOK := packageJobPhaseToProto(job.Phase)
	basis, basisOK := packageProgressBasisToProto(job.ProgressBasis)
	terminal, terminalOK := packageTerminalResultToProto(job.TerminalResult)
	if !sourceOK || !kindOK || !phaseOK || !basisOK || !terminalOK {
		return nil, fmt.Errorf("project App package job: unsupported stored enum")
	}
	projection := &runtimev1.AppPackageJob{
		JobId:            []byte(job.JobID),
		AppId:            job.AppID,
		SourceClass:      sourceClass,
		Kind:             kind,
		TargetRef:        job.TargetRef,
		Phase:            phase,
		ProgressBasis:    basis,
		BytesCompleted:   job.BytesCompleted,
		BytesTotal:       cloneUint64(job.BytesTotal),
		StepsCompleted:   job.StepsCompleted,
		StepsTotal:       cloneUint64(job.StepsTotal),
		StartedAt:        timestamppb.New(job.StartedAt),
		TerminalResult:   terminal,
		ReasonCode:       job.ReasonCode,
		Cancelable:       job.Cancelable,
		QueuePosition:    job.QueuePosition,
		SpeedBytesPerSec: job.SpeedBytesPerSec,
		EtaSeconds:       job.EtaSeconds,
		UpdatedAt:        timestamppb.New(job.UpdatedAt),
		DisplayName:      job.DisplayName,
		TargetVersion:    job.TargetVersion,
		PreviousVersion:  job.PreviousVersion,
		TargetOs:         job.TargetOS,
		TargetArch:       job.TargetArch,
	}
	if job.ProgressObservedAt != nil {
		projection.ProgressObservedAt = timestamppb.New(*job.ProgressObservedAt)
	}
	if job.CompletedAt != nil {
		projection.CompletedAt = timestamppb.New(*job.CompletedAt)
	}
	return projection, nil
}

func packageSourceClassToProto(value localappkernel.SourceClass) (runtimev1.AppPackageSourceClass, bool) {
	switch value {
	case localappkernel.SourceClassVerified:
		return runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_VERIFIED, true
	case localappkernel.SourceClassUserImported:
		return runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_USER_IMPORTED, true
	default:
		return runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_UNSPECIFIED, false
	}
}

func packageJobKindToProto(value localappkernel.PackageJobKind) (runtimev1.AppPackageJobKind, bool) {
	switch value {
	case localappkernel.PackageJobInstall:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_INSTALL, true
	case localappkernel.PackageJobUpdate:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_UPDATE, true
	case localappkernel.PackageJobRepair:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_REPAIR, true
	case localappkernel.PackageJobUninstall:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_UNINSTALL, true
	default:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_UNSPECIFIED, false
	}
}

func packageJobPhaseToProto(value localappkernel.PackageJobPhase) (runtimev1.AppPackageJobPhase, bool) {
	values := map[localappkernel.PackageJobPhase]runtimev1.AppPackageJobPhase{
		localappkernel.PackageJobQueued:             runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED,
		localappkernel.PackageJobDownloading:        runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_DOWNLOADING,
		localappkernel.PackageJobPaused:             runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_PAUSED,
		localappkernel.PackageJobReadingLocal:       runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_READING_LOCAL,
		localappkernel.PackageJobVerifying:          runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING,
		localappkernel.PackageJobVerifyingInstalled: runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING_INSTALLED,
		localappkernel.PackageJobAcquiringMissing:   runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_ACQUIRING_MISSING,
		localappkernel.PackageJobStaging:            runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_STAGING,
		localappkernel.PackageJobCommitting:         runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_COMMITTING,
		localappkernel.PackageJobRemovingPackage:    runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_REMOVING_PACKAGE,
		localappkernel.PackageJobUnregistering:      runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_UNREGISTERING,
		localappkernel.PackageJobCompleted:          runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_COMPLETED,
		localappkernel.PackageJobFailed:             runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_FAILED,
		localappkernel.PackageJobCanceled:           runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_CANCELED,
	}
	result, ok := values[value]
	return result, ok
}

func packageJobPhaseFromProto(value runtimev1.AppPackageJobPhase) (localappkernel.PackageJobPhase, bool) {
	values := map[runtimev1.AppPackageJobPhase]localappkernel.PackageJobPhase{
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED:              localappkernel.PackageJobQueued,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_DOWNLOADING:         localappkernel.PackageJobDownloading,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_PAUSED:              localappkernel.PackageJobPaused,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_READING_LOCAL:       localappkernel.PackageJobReadingLocal,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING:           localappkernel.PackageJobVerifying,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING_INSTALLED: localappkernel.PackageJobVerifyingInstalled,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_ACQUIRING_MISSING:   localappkernel.PackageJobAcquiringMissing,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_STAGING:             localappkernel.PackageJobStaging,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_COMMITTING:          localappkernel.PackageJobCommitting,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_REMOVING_PACKAGE:    localappkernel.PackageJobRemovingPackage,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_UNREGISTERING:       localappkernel.PackageJobUnregistering,
	}
	result, ok := values[value]
	return result, ok
}

func packageProgressBasisToProto(value localappkernel.PackageProgressBasis) (runtimev1.AppPackageProgressBasis, bool) {
	switch value {
	case localappkernel.PackageProgressBytes:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_BYTES, true
	case localappkernel.PackageProgressSteps:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_STEPS, true
	case localappkernel.PackageProgressIndeterminate:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_INDETERMINATE, true
	default:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_UNSPECIFIED, false
	}
}

func packageTerminalResultToProto(value string) (runtimev1.AppPackageTerminalResult, bool) {
	switch value {
	case "":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_UNSPECIFIED, true
	case "completed":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_COMPLETED, true
	case "failed":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_FAILED, true
	case "canceled":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_CANCELED, true
	default:
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_UNSPECIFIED, false
	}
}

func cloneUint64(value *uint64) *uint64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
