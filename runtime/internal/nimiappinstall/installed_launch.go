package nimiappinstall

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

var ErrInstalledLaunch = errors.New("installed App launch is unavailable")

// InstalledLaunch is host-private material resolved by Runtime. It is
// not a renderer DTO or an input accepting a caller's executable/arguments.
type InstalledLaunch struct {
	Release                 localappkernel.CommittedRelease
	Registration            localappkernel.Registration
	RuntimeEntry            string
	WorkingDirectory        string
	ExecutableDigest        protectedlocal.Identifier
	CarrierExecutablePath   string
	CarrierExecutableDigest protectedlocal.Identifier
	Arguments               []string
	expected                nimiapppackage.Expected
}

// Installation owns these inputs. They prevent a changed manifest from
// selecting another entrypoint without requiring a full payload scan at launch.
type installedLaunchConfig struct {
	Expected    nimiapppackage.Expected
	DisplayName string
}

// VerifyHost checks the exact installed executable's digest and native posture.
// Prepare invokes it once; bind independently verifies the actual child image
// against the committed digest before Desktop resumes that child.
func (launch InstalledLaunch) VerifyHost(ctx context.Context) error {
	if nimiapppackage.IsManagedWebExecutionProfile(launch.Release.ExecutionProfileRef) {
		if launch.CarrierExecutablePath == "" || launch.CarrierExecutableDigest == (protectedlocal.Identifier{}) || len(launch.Arguments) < 2 {
			return ErrInstalledLaunch
		}
		return nil
	}
	verifier, err := nativeVerifierForExpected(launch.expected)
	if err != nil {
		return err
	}
	return verifier.Verify(ctx, launch.RuntimeEntry, [32]byte(launch.ExecutableDigest))
}

// WithInstalledLaunch checks current installation and policy facts. Only the
// final state comparison and callback share the package-mutation reservation;
// Registry I/O and native inspection do not block launches of other Apps.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (coordinator *Coordinator) WithInstalledLaunch(ctx context.Context, handle string, bind func(InstalledLaunch) error) error {
	return coordinator.withInstalledLaunch(ctx, handle, false, bind)
}

func (coordinator *Coordinator) PrepareInstalledLaunch(ctx context.Context, handle string, prepare func(InstalledLaunch) error) error {
	return coordinator.withInstalledLaunch(ctx, handle, true, prepare)
}

func (coordinator *Coordinator) withInstalledLaunch(ctx context.Context, handle string, verifyHost bool, bind func(InstalledLaunch) error) error {
	_, expectedOS, expectedArch, platformErr := publicappregistry.CurrentPlatformTarget()
	if ctx == nil || coordinator == nil || bind == nil || handle == "" || platformErr != nil {
		return ErrInstalledLaunch
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	started := time.Now()
	defer func() {
		if coordinator.logger != nil {
			coordinator.logger.Info("installed App launch state checked", "duration_ms", time.Since(started).Milliseconds())
		}
	}()
	if coordinator.isClosing() {
		return ErrInstalledLaunch
	}
	registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, handle)
	if err != nil || registration.State != localappkernel.RegistrationStateActive || !immutablePackageSource(registration.SourceClass) ||
		registration.SourceGeneration == 0 || registration.DeclarationGeneration == 0 || !registration.ImmutablePackageFactsComplete() {
		return errors.Join(ErrInstalledLaunch, err)
	}
	release, err := coordinator.lifecycle.GetCommittedRelease(ctx, registration.AppID, registration.SourceClass)
	if err != nil || release.RegistrationHandle != handle || release.ReleaseRef != registration.ImmutableLineageID ||
		release.ImmutableLineageID != registration.ImmutableLineageID || release.HostExecutableDigest != registration.HostExecutableDigest ||
		release.PayloadRootDigest != registration.PayloadRootDigest || release.ExecutionProfileRef != registration.ExecutionProfileRef {
		return errors.Join(ErrInstalledLaunch, err)
	}
	job, err := coordinator.lifecycle.GetActiveJob(ctx, registration.AppID, registration.SourceClass)
	if err == nil && !terminalPackagePhase(job.Phase) {
		return localappkernel.ErrPackageJobActive
	}
	if err != nil && !errors.Is(err, localappkernel.ErrPackageJobNotFound) {
		return err
	}

	relative, err := filepath.Rel(filepath.Join(coordinator.packagesPath, packageReleaseDirectory), registration.ProjectRoot)
	if err != nil || !runtimeOwnedChild(relative) || registration.ProjectRoot != filepath.Join(coordinator.packagesPath, packageReleaseDirectory, relative) ||
		registration.ManifestPath != filepath.Join(registration.ProjectRoot, "nimi.app.yaml") {
		return errors.Join(ErrInstalledLaunch, err)
	}
	info, err := coordinator.packagesRoot.Lstat(filepath.Join(packageReleaseDirectory, relative))
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.Join(ErrInstalledLaunch, err)
	}
	encoded := strings.TrimPrefix(release.HostExecutableDigest, "bii_v1_")
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	var digest protectedlocal.Identifier
	if err != nil || len(raw) != len(digest) {
		return errors.Join(ErrInstalledLaunch, err)
	}
	copy(digest[:], raw)
	if protectedlocal.ExecutableDigestRef(digest) != release.HostExecutableDigest {
		return ErrInstalledLaunch
	}
	rawConfig, err := coordinator.lifecycle.ReadLaunchConfig(ctx, handle, release.ReleaseRef)
	if err != nil {
		return fmt.Errorf("read installed App launch configuration: %w", errors.Join(ErrInstalledLaunch, err))
	}
	var config installedLaunchConfig
	if err := jsonstrict.Decode(rawConfig, &config); err != nil {
		return errors.Join(ErrInstalledLaunch, err)
	}
	packageExpected := config.Expected
	managedWeb := nimiapppackage.IsManagedWebExecutionProfile(release.ExecutionProfileRef)
	platformMatches := packageExpected.OS == expectedOS && packageExpected.Arch == expectedArch
	if managedWeb {
		platformMatches = nimiapppackage.IsManagedWebTarget(packageExpected) &&
			packageExpected.TargetID == nimiapppackage.ManagedWebTargetID &&
			packageExpected.OS == "any" && packageExpected.Arch == "any" &&
			packageExpected.RuntimeEntry == nimiapppackage.ManagedWebRuntimeEntry
	}
	if packageExpected.AppID != release.AppID || packageExpected.Version != release.Version || !platformMatches ||
		packageExpected.ExecutionProfileRef != release.ExecutionProfileRef || config.DisplayName != registration.DisplayName || !equalTextList(packageExpected.AppAccess, registration.RawDeclaration) {
		return ErrInstalledLaunch
	}
	usedStoredApproval := false
	var verifiedKey verifiedPolicyKey
	if registration.SourceClass == localappkernel.SourceClassVerified {
		if coordinator.registry == nil {
			return ErrInstalledLaunch
		}
		selector, err := publicSelector(release.ReleaseRef)
		if err != nil {
			return errors.Join(ErrInstalledLaunch, err)
		}
		verifiedKey = verifiedPolicyKey{
			appID:        release.AppID,
			releaseRef:   release.ReleaseRef,
			descriptorID: selector.DescriptorID(),
			targetID:     selector.TargetID(),
		}
		storedApproval, err := coordinator.enforceVerifiedInstalledPolicy(ctx, release, selector, packageExpected, expectedOS, expectedArch)
		if err != nil {
			return err
		}
		usedStoredApproval = storedApproval
	} else {
		if !strings.HasPrefix(release.ReleaseRef, localPackageLineageBase) {
			return ErrInstalledLaunch
		}
	}
	entry, err := nimiapppackage.ResolveInstalledRuntimeEntry(registration.ProjectRoot, packageExpected)
	if err != nil {
		return fmt.Errorf("resolve installed App entry: %w", err)
	}
	launch := InstalledLaunch{
		Release:                 release,
		Registration:            registration,
		RuntimeEntry:            entry,
		WorkingDirectory:        filepath.Dir(entry),
		ExecutableDigest:        digest,
		CarrierExecutablePath:   entry,
		CarrierExecutableDigest: digest,
		Arguments:               []string{},
		expected:                packageExpected,
	}
	if managedWeb {
		carrier, err := coordinator.resolveManagedWebCarrier(ctx)
		if err != nil || !carrier.Valid() {
			return fmt.Errorf("resolve managed-web shared carrier: %w", errors.Join(ErrInstalledLaunch, err))
		}
		arguments, err := protectedlocal.BuildManagedWebLaunchArguments(carrier.ArgumentsPrefix, release.PayloadRootDigest)
		if err != nil {
			return fmt.Errorf("build managed-web launch arguments: %w", errors.Join(ErrInstalledLaunch, err))
		}
		launch.WorkingDirectory = registration.ProjectRoot
		launch.CarrierExecutablePath = carrier.ExecutablePath
		launch.CarrierExecutableDigest = carrier.ExecutableDigest
		launch.Arguments = arguments
	}
	if verifyHost {
		nativeStarted := time.Now()
		err := launch.VerifyHost(ctx)
		if coordinator.logger != nil {
			coordinator.logger.Info("installed App Host verified", "app_id", registration.AppID, "duration_ms", time.Since(nativeStarted).Milliseconds(), "error", err)
		}
		if err != nil {
			return err
		}
	}
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	current, err := coordinator.kernel.Registrations().GetByHandle(ctx, handle)
	if err != nil || !reflect.DeepEqual(current, registration) {
		return errors.Join(ErrInstalledLaunch, err)
	}
	currentRelease, err := coordinator.lifecycle.GetCommittedRelease(ctx, registration.AppID, registration.SourceClass)
	if err != nil || !reflect.DeepEqual(currentRelease, release) {
		return errors.Join(ErrInstalledLaunch, err)
	}
	job, err = coordinator.lifecycle.GetActiveJob(ctx, registration.AppID, registration.SourceClass)
	if err == nil && !terminalPackagePhase(job.Phase) {
		return localappkernel.ErrPackageJobActive
	}
	if err != nil && !errors.Is(err, localappkernel.ErrPackageJobNotFound) {
		return err
	}
	if registration.SourceClass == localappkernel.SourceClassVerified {
		if err := coordinator.verifyFinalBindPolicy(ctx, verifiedKey, usedStoredApproval); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return bind(launch)
}

func immutablePackageSource(source localappkernel.SourceClass) bool {
	return source == localappkernel.SourceClassVerified || source == localappkernel.SourceClassUserImported
}

type verifiedPolicyKey struct {
	appID        string
	releaseRef   string
	descriptorID string
	targetID     string
}

type verifiedPolicyDenyBarrier struct {
	status           localappkernel.VerifiedPolicyStatus
	reason           string
	policyRevision   uint64
	registryRevision string
	observedSeq      uint64
	observedAt       time.Time
	persisted        bool
	lastAbsentSeq    uint64
}

type verifiedPolicyAllowedWatermark struct {
	policyRevision uint64
	observedSeq    uint64
	observedAt     time.Time
}

// BeginPolicyObservation allocates a monotonic in-process observation sequence
// and timestamp before an official Registry policy read starts.
func (coordinator *Coordinator) BeginPolicyObservation() (uint64, time.Time) {
	if coordinator == nil {
		return 0, time.Now().UTC()
	}
	coordinator.policyMu.Lock()
	coordinator.policyObservedSeq++
	seq := coordinator.policyObservedSeq
	coordinator.policyMu.Unlock()
	return seq, coordinator.now()
}

// RecordObservedCatalogKillSwitch records a kill-switch observed during a live
// catalog fetch through the same monotonic sequence and fail-closed deny
// barrier used by installed-App launch revalidation.
func (coordinator *Coordinator) RecordObservedCatalogKillSwitch(
	ctx context.Context,
	appID string,
	reason string,
	policyRevision uint64,
	registryRevision string,
	observedSeq uint64,
	observedAt time.Time,
) {
	if coordinator == nil || coordinator.lifecycle == nil || strings.TrimSpace(appID) == "" {
		return
	}
	persistCtx := context.WithoutCancel(ctx)
	release, err := coordinator.lifecycle.GetCommittedRelease(persistCtx, appID, localappkernel.SourceClassVerified)
	if err != nil {
		return
	}
	installedSelector, err := publicSelector(release.ReleaseRef)
	if err != nil {
		return
	}
	key := verifiedPolicyKey{
		appID:        release.AppID,
		releaseRef:   release.ReleaseRef,
		descriptorID: installedSelector.DescriptorID(),
		targetID:     installedSelector.TargetID(),
	}
	coordinator.recordObservedPolicyDeny(
		persistCtx,
		key,
		localappkernel.VerifiedPolicyBlocked,
		reason,
		policyRevision,
		registryRevision,
		observedSeq,
		observedAt,
	)
}

func (coordinator *Coordinator) clearVerifiedPolicyStateForRelease(appID, releaseRef string) {
	if coordinator == nil {
		return
	}
	coordinator.policyMu.Lock()
	defer coordinator.policyMu.Unlock()
	for key := range coordinator.policyDenyBarriers {
		if key.appID == appID && key.releaseRef == releaseRef {
			delete(coordinator.policyDenyBarriers, key)
		}
	}
	for key := range coordinator.policyAllowedWatermarks {
		if key.appID == appID && key.releaseRef == releaseRef {
			delete(coordinator.policyAllowedWatermarks, key)
		}
	}
}

func (coordinator *Coordinator) recordCommittedInitialAllowedPolicy(record localappkernel.VerifiedPolicyVerification) {
	if coordinator == nil {
		return
	}
	key := verifiedPolicyKey{
		appID:        record.AppID,
		releaseRef:   record.ReleaseRef,
		descriptorID: record.DescriptorID,
		targetID:     record.TargetID,
	}
	coordinator.policyMu.Lock()
	defer coordinator.policyMu.Unlock()
	coordinator.policyObservedSeq++
	seq := coordinator.policyObservedSeq
	if coordinator.policyAllowedWatermarks == nil {
		coordinator.policyAllowedWatermarks = make(map[verifiedPolicyKey]verifiedPolicyAllowedWatermark)
	}
	coordinator.policyAllowedWatermarks[key] = verifiedPolicyAllowedWatermark{
		policyRevision: record.PolicyRevision,
		observedSeq:    seq,
		observedAt:     record.VerifiedAt.UTC(),
	}
	if barrier, ok := coordinator.policyDenyBarriers[key]; ok {
		if (barrier.status == localappkernel.VerifiedPolicyBlocked && record.PolicyRevision > barrier.policyRevision) ||
			(barrier.status == localappkernel.VerifiedPolicyRowAbsent && record.PolicyRevision >= barrier.policyRevision &&
				((barrier.observedSeq > 0 && seq > barrier.observedSeq) || record.VerifiedAt.UTC().After(barrier.observedAt.UTC()))) {
			delete(coordinator.policyDenyBarriers, key)
		}
	}
}

func denyBarrierError(barrier verifiedPolicyDenyBarrier) error {
	switch barrier.status {
	case localappkernel.VerifiedPolicyBlocked:
		return &publicappregistry.PolicyBlockedError{Reason: barrier.reason, Revision: barrier.policyRevision}
	case localappkernel.VerifiedPolicyRowAbsent:
		return publicappregistry.ErrCatalogAppNotFound
	default:
		return publicappregistry.ErrPolicyBlocked
	}
}

func verifiedPolicyDenyError(record localappkernel.VerifiedPolicyVerification) error {
	switch record.Status {
	case localappkernel.VerifiedPolicyBlocked:
		return &publicappregistry.PolicyBlockedError{Reason: record.PolicyReason, Revision: record.PolicyRevision}
	case localappkernel.VerifiedPolicyRowAbsent:
		return publicappregistry.ErrCatalogAppNotFound
	default:
		return publicappregistry.ErrPolicyBlocked
	}
}

func shouldHydratePersistedDenyBarrier(existing, hydrated verifiedPolicyDenyBarrier) bool {
	switch hydrated.status {
	case localappkernel.VerifiedPolicyBlocked:
		if existing.status == localappkernel.VerifiedPolicyBlocked {
			if hydrated.policyRevision > existing.policyRevision {
				return true
			}
			if hydrated.policyRevision < existing.policyRevision {
				return false
			}
			return existing.observedSeq == 0 && hydrated.observedAt.After(existing.observedAt)
		}
		return hydrated.policyRevision > existing.policyRevision || hydrated.observedAt.After(existing.observedAt)
	case localappkernel.VerifiedPolicyRowAbsent:
		return hydrated.observedAt.After(existing.observedAt)
	default:
		return false
	}
}

func (coordinator *Coordinator) hydratePersistedDenyBarrier(
	key verifiedPolicyKey,
	record localappkernel.VerifiedPolicyVerification,
) {
	if coordinator == nil || (record.Status != localappkernel.VerifiedPolicyBlocked && record.Status != localappkernel.VerifiedPolicyRowAbsent) {
		return
	}
	hydrated := verifiedPolicyDenyBarrier{
		status:           record.Status,
		reason:           record.PolicyReason,
		policyRevision:   record.PolicyRevision,
		registryRevision: record.RegistryRevision,
		observedSeq:      0,
		observedAt:       record.VerifiedAt.UTC(),
		persisted:        true,
	}
	coordinator.policyMu.Lock()
	defer coordinator.policyMu.Unlock()
	if coordinator.policyDenyBarriers == nil {
		coordinator.policyDenyBarriers = make(map[verifiedPolicyKey]verifiedPolicyDenyBarrier)
	}
	existing, hasExisting := coordinator.policyDenyBarriers[key]
	if !hasExisting || shouldHydratePersistedDenyBarrier(existing, hydrated) {
		hydrated.lastAbsentSeq = existing.lastAbsentSeq
		coordinator.policyDenyBarriers[key] = hydrated
	}
}

func denyBarrierSupersedesAllowed(
	barrier verifiedPolicyDenyBarrier,
	policyRevision uint64,
	observedSeq uint64,
) bool {
	if barrier.lastAbsentSeq != 0 && observedSeq <= barrier.lastAbsentSeq {
		return true
	}
	switch barrier.status {
	case localappkernel.VerifiedPolicyBlocked:
		// Under p-napp-043d, lifting a kill-switch strictly increments kill_switch.revision.
		return policyRevision <= barrier.policyRevision
	case localappkernel.VerifiedPolicyRowAbsent:
		return policyRevision < barrier.policyRevision
	default:
		return true
	}
}

func (coordinator *Coordinator) recordObservedPolicyDeny(
	ctx context.Context,
	key verifiedPolicyKey,
	status localappkernel.VerifiedPolicyStatus,
	reason string,
	policyRevision uint64,
	registryRevision string,
	observedSeq uint64,
	observedAt time.Time,
) {
	if coordinator == nil || (status != localappkernel.VerifiedPolicyBlocked && status != localappkernel.VerifiedPolicyRowAbsent) {
		return
	}
	observedAt = observedAt.UTC()
	if observedAt.IsZero() {
		observedAt = coordinator.now()
	}
	reason = strings.TrimSpace(reason)
	if status == localappkernel.VerifiedPolicyBlocked && reason == "" {
		reason = "policy-blocked"
	}
	if status == localappkernel.VerifiedPolicyRowAbsent {
		reason = ""
	}
	registryRevision = strings.TrimSpace(registryRevision)

	coordinator.policyPersistMu.Lock()
	defer coordinator.policyPersistMu.Unlock()

	coordinator.policyMu.Lock()
	if observedSeq == 0 {
		coordinator.policyObservedSeq++
		observedSeq = coordinator.policyObservedSeq
	}
	if coordinator.policyDenyBarriers == nil {
		coordinator.policyDenyBarriers = make(map[verifiedPolicyKey]verifiedPolicyDenyBarrier)
	}
	if allowed, hasAllowed := coordinator.policyAllowedWatermarks[key]; hasAllowed {
		if status == localappkernel.VerifiedPolicyBlocked && policyRevision < allowed.policyRevision {
			coordinator.policyMu.Unlock()
			return
		}
		if status == localappkernel.VerifiedPolicyRowAbsent && observedSeq < allowed.observedSeq {
			coordinator.policyMu.Unlock()
			return
		}
	}
	incoming := verifiedPolicyDenyBarrier{
		status:           status,
		reason:           reason,
		policyRevision:   policyRevision,
		registryRevision: registryRevision,
		observedSeq:      observedSeq,
		observedAt:       observedAt,
		persisted:        false,
	}
	if status == localappkernel.VerifiedPolicyRowAbsent {
		incoming.lastAbsentSeq = observedSeq
	}
	shouldPersist := true
	if existing, hasExisting := coordinator.policyDenyBarriers[key]; hasExisting {
		if existing.status == localappkernel.VerifiedPolicyBlocked && status == localappkernel.VerifiedPolicyRowAbsent {
			// Keep the explicit block and its revision, while fencing any allow
			// whose read started before this newer absence.
			existing.lastAbsentSeq = max(existing.lastAbsentSeq, observedSeq)
			coordinator.policyDenyBarriers[key] = existing
			incoming = existing
			shouldPersist = !existing.persisted
		} else if shouldUpdateDenyBarrier(existing, incoming) {
			incoming.lastAbsentSeq = max(existing.lastAbsentSeq, incoming.lastAbsentSeq)
			if incoming.registryRevision == "" && existing.registryRevision != "" &&
				incoming.status == existing.status && incoming.policyRevision == existing.policyRevision {
				incoming.registryRevision = existing.registryRevision
			}
			coordinator.policyDenyBarriers[key] = incoming
		} else {
			incoming = existing
			shouldPersist = !existing.persisted
		}
	} else {
		coordinator.policyDenyBarriers[key] = incoming
	}
	coordinator.policyMu.Unlock()

	if shouldPersist {
		coordinator.persistDenyBarrierLocked(context.WithoutCancel(ctx), key, incoming)
	}
}

func shouldUpdateDenyBarrier(existing, incoming verifiedPolicyDenyBarrier) bool {
	switch incoming.status {
	case localappkernel.VerifiedPolicyBlocked:
		if existing.status == localappkernel.VerifiedPolicyBlocked {
			if incoming.policyRevision < existing.policyRevision {
				return false
			}
			if incoming.policyRevision > existing.policyRevision {
				return true
			}
			return incoming.observedSeq >= existing.observedSeq && !incoming.observedAt.Before(existing.observedAt)
		}
		// Upgrading row_absent -> policy_blocked when revision is higher or observation is at least as new.
		return incoming.policyRevision > existing.policyRevision || incoming.observedSeq >= existing.observedSeq
	case localappkernel.VerifiedPolicyRowAbsent:
		return incoming.observedSeq > existing.observedSeq
	default:
		return false
	}
}

func sameDenyBarrierVersion(a, b verifiedPolicyDenyBarrier) bool {
	return a.status == b.status &&
		a.policyRevision == b.policyRevision &&
		a.observedSeq == b.observedSeq &&
		a.observedAt.Equal(b.observedAt) &&
		a.lastAbsentSeq == b.lastAbsentSeq
}

func (coordinator *Coordinator) persistDenyBarrierLocked(
	ctx context.Context,
	key verifiedPolicyKey,
	snapshot verifiedPolicyDenyBarrier,
) {
	if coordinator == nil || coordinator.lifecycle == nil {
		return
	}
	effective, err := coordinator.lifecycle.RecordVerifiedPolicy(ctx, localappkernel.VerifiedPolicyVerification{
		AppID:              key.appID,
		ReleaseRef:         key.releaseRef,
		DescriptorID:       key.descriptorID,
		TargetID:           key.targetID,
		Status:             snapshot.status,
		PolicyReason:       snapshot.reason,
		PolicyRevision:     snapshot.policyRevision,
		RegistryRevision:   snapshot.registryRevision,
		VerifiedAt:         snapshot.observedAt,
		ObservedAt:         snapshot.observedAt,
		OrderedObservation: snapshot.status == localappkernel.VerifiedPolicyRowAbsent,
	})
	if err == nil {
		coordinator.policyMu.Lock()
		if current, ok := coordinator.policyDenyBarriers[key]; ok && sameDenyBarrierVersion(current, snapshot) {
			switch effective.Status {
			case localappkernel.VerifiedPolicyBlocked, localappkernel.VerifiedPolicyRowAbsent:
				if effective.Status == current.status &&
					effective.PolicyRevision == current.policyRevision &&
					effective.VerifiedAt.UTC().Equal(current.observedAt.UTC()) {
					current.persisted = true
					current.reason = effective.PolicyReason
					if effective.RegistryRevision != "" {
						current.registryRevision = effective.RegistryRevision
					}
					coordinator.policyDenyBarriers[key] = current
				} else {
					coordinator.policyDenyBarriers[key] = verifiedPolicyDenyBarrier{
						status:           effective.Status,
						reason:           effective.PolicyReason,
						policyRevision:   effective.PolicyRevision,
						registryRevision: effective.RegistryRevision,
						observedSeq:      0,
						observedAt:       effective.VerifiedAt.UTC(),
						persisted:        true,
						lastAbsentSeq:    current.lastAbsentSeq,
					}
				}
			case localappkernel.VerifiedPolicyAllowed:
				// The deny was superseded by a strictly higher-revision / newer lift already in SQLite.
				delete(coordinator.policyDenyBarriers, key)
				if coordinator.policyAllowedWatermarks == nil {
					coordinator.policyAllowedWatermarks = make(map[verifiedPolicyKey]verifiedPolicyAllowedWatermark)
				}
				existingWM := coordinator.policyAllowedWatermarks[key]
				if effective.PolicyRevision > existingWM.policyRevision ||
					(effective.PolicyRevision == existingWM.policyRevision && effective.VerifiedAt.UTC().After(existingWM.observedAt.UTC())) {
					coordinator.policyAllowedWatermarks[key] = verifiedPolicyAllowedWatermark{
						policyRevision: effective.PolicyRevision,
						observedSeq:    existingWM.observedSeq,
						observedAt:     effective.VerifiedAt.UTC(),
					}
				}
			}
		}
		coordinator.policyMu.Unlock()
		return
	}
	if errors.Is(err, localappkernel.ErrCommittedReleaseNotFound) {
		coordinator.policyMu.Lock()
		if current, ok := coordinator.policyDenyBarriers[key]; ok && sameDenyBarrierVersion(current, snapshot) {
			delete(coordinator.policyDenyBarriers, key)
		}
		coordinator.policyMu.Unlock()
		return
	}
	if coordinator.logger != nil {
		coordinator.logger.Warn("failed to persist verified App policy deny; enforcing fail-closed barrier",
			"app_id", key.appID,
			"release_ref", key.releaseRef,
			"policy_status", string(snapshot.status),
			"policy_revision", snapshot.policyRevision,
			"error", err,
		)
	}
	if delErr := coordinator.lifecycle.DeleteVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID); delErr != nil && coordinator.logger != nil {
		coordinator.logger.Warn("failed to invalidate stale verified App policy allow after deny persistence failure",
			"app_id", key.appID,
			"release_ref", key.releaseRef,
			"error", delErr,
		)
	}
}

func (coordinator *Coordinator) retryPendingDenyBarrier(ctx context.Context, key verifiedPolicyKey) {
	if coordinator == nil {
		return
	}
	coordinator.policyMu.Lock()
	barrier, hasBarrier := coordinator.policyDenyBarriers[key]
	coordinator.policyMu.Unlock()
	if !hasBarrier || barrier.persisted {
		return
	}
	coordinator.policyPersistMu.Lock()
	defer coordinator.policyPersistMu.Unlock()
	coordinator.policyMu.Lock()
	barrier, hasBarrier = coordinator.policyDenyBarriers[key]
	coordinator.policyMu.Unlock()
	if !hasBarrier || barrier.persisted {
		return
	}
	coordinator.persistDenyBarrierLocked(context.WithoutCancel(ctx), key, barrier)
}

func (coordinator *Coordinator) checkOfflineDenyBarrier(ctx context.Context, key verifiedPolicyKey) error {
	if coordinator == nil {
		return nil
	}
	coordinator.policyPersistMu.Lock()
	defer coordinator.policyPersistMu.Unlock()

	coordinator.policyMu.Lock()
	barrier, hasBarrier := coordinator.policyDenyBarriers[key]
	coordinator.policyMu.Unlock()
	if !hasBarrier {
		return nil
	}
	if !barrier.persisted {
		coordinator.persistDenyBarrierLocked(context.WithoutCancel(ctx), key, barrier)
		coordinator.policyMu.Lock()
		barrier, hasBarrier = coordinator.policyDenyBarriers[key]
		coordinator.policyMu.Unlock()
		if !hasBarrier {
			return nil
		}
	}
	return denyBarrierError(barrier)
}

func (coordinator *Coordinator) verifyFinalBindPolicy(
	ctx context.Context,
	key verifiedPolicyKey,
	usedStoredApproval bool,
) error {
	coordinator.policyPersistMu.Lock()
	defer coordinator.policyPersistMu.Unlock()

	coordinator.policyMu.Lock()
	barrier, hasBarrier := coordinator.policyDenyBarriers[key]
	coordinator.policyMu.Unlock()
	if hasBarrier {
		return denyBarrierError(barrier)
	}

	record, err := coordinator.lifecycle.GetVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		if errors.Is(err, localappkernel.ErrVerifiedPolicyNotFound) {
			if usedStoredApproval {
				return publicappregistry.ErrRegistryUnavailable
			}
			return nil
		}
		return errors.Join(ErrInstalledLaunch, err)
	}
	switch record.Status {
	case localappkernel.VerifiedPolicyBlocked, localappkernel.VerifiedPolicyRowAbsent:
		coordinator.hydratePersistedDenyBarrier(key, record)
		return verifiedPolicyDenyError(record)
	case localappkernel.VerifiedPolicyAllowed:
		return nil
	default:
		return ErrInstalledLaunch
	}
}

func (coordinator *Coordinator) recordVerifiedAllowed(
	ctx context.Context,
	key verifiedPolicyKey,
	policyRevision uint64,
	registryRevision string,
	observedSeq uint64,
	observedAt time.Time,
) error {
	observedAt = observedAt.UTC()
	coordinator.policyPersistMu.Lock()
	defer coordinator.policyPersistMu.Unlock()

	coordinator.policyMu.Lock()
	barrier, hasBarrier := coordinator.policyDenyBarriers[key]
	watermark, hasWatermark := coordinator.policyAllowedWatermarks[key]
	coordinator.policyMu.Unlock()

	if hasBarrier && denyBarrierSupersedesAllowed(barrier, policyRevision, observedSeq) {
		if !barrier.persisted {
			coordinator.persistDenyBarrierLocked(context.WithoutCancel(ctx), key, barrier)
			coordinator.policyMu.Lock()
			barrier, hasBarrier = coordinator.policyDenyBarriers[key]
			coordinator.policyMu.Unlock()
		}
		if hasBarrier && denyBarrierSupersedesAllowed(barrier, policyRevision, observedSeq) {
			return denyBarrierError(barrier)
		}
	}
	if hasWatermark && (policyRevision < watermark.policyRevision ||
		(policyRevision == watermark.policyRevision && observedSeq < watermark.observedSeq)) {
		// Stale out-of-order allow behind a newer already-recorded allow; do not overwrite.
		return nil
	}
	effective, persistErr := coordinator.lifecycle.RecordVerifiedPolicy(ctx, localappkernel.VerifiedPolicyVerification{
		AppID:              key.appID,
		ReleaseRef:         key.releaseRef,
		DescriptorID:       key.descriptorID,
		TargetID:           key.targetID,
		Status:             localappkernel.VerifiedPolicyAllowed,
		PolicyRevision:     policyRevision,
		RegistryRevision:   registryRevision,
		VerifiedAt:         observedAt,
		ObservedAt:         observedAt,
		OrderedObservation: true,
	})
	if persistErr != nil {
		if coordinator.logger != nil {
			coordinator.logger.Warn("failed to persist verified App policy allow",
				"app_id", key.appID,
				"release_ref", key.releaseRef,
				"policy_revision", policyRevision,
				"error", persistErr,
			)
		}
		// Never clear a deny barrier when persisting a lifting/restoring allow fails.
		coordinator.policyMu.Lock()
		currentBarrier, stillHasBarrier := coordinator.policyDenyBarriers[key]
		coordinator.policyMu.Unlock()
		if stillHasBarrier {
			return denyBarrierError(currentBarrier)
		}
		if errors.Is(persistErr, localappkernel.ErrCommittedReleaseNotFound) {
			return errors.Join(ErrInstalledLaunch, persistErr)
		}
		stored, getErr := coordinator.lifecycle.GetVerifiedPolicy(context.WithoutCancel(ctx), key.appID, key.releaseRef, key.descriptorID, key.targetID)
		if getErr == nil && (stored.Status == localappkernel.VerifiedPolicyBlocked || stored.Status == localappkernel.VerifiedPolicyRowAbsent) {
			coordinator.hydratePersistedDenyBarrier(key, stored)
			return verifiedPolicyDenyError(stored)
		}
		if getErr != nil && !errors.Is(getErr, localappkernel.ErrVerifiedPolicyNotFound) {
			return errors.Join(ErrInstalledLaunch, getErr)
		}
		return nil
	}
	if effective.Status == localappkernel.VerifiedPolicyBlocked || effective.Status == localappkernel.VerifiedPolicyRowAbsent {
		coordinator.hydratePersistedDenyBarrier(key, effective)
		return verifiedPolicyDenyError(effective)
	}

	effectiveRev := policyRevision
	if effective.PolicyRevision > effectiveRev {
		effectiveRev = effective.PolicyRevision
	}
	effectiveAt := observedAt
	if effective.VerifiedAt.UTC().After(effectiveAt) {
		effectiveAt = effective.VerifiedAt.UTC()
	}

	coordinator.policyMu.Lock()
	if coordinator.policyAllowedWatermarks == nil {
		coordinator.policyAllowedWatermarks = make(map[verifiedPolicyKey]verifiedPolicyAllowedWatermark)
	}
	existingWM := coordinator.policyAllowedWatermarks[key]
	if effectiveRev > existingWM.policyRevision ||
		(effectiveRev == existingWM.policyRevision && observedSeq >= existingWM.observedSeq) {
		coordinator.policyAllowedWatermarks[key] = verifiedPolicyAllowedWatermark{
			policyRevision: effectiveRev,
			observedSeq:    observedSeq,
			observedAt:     effectiveAt,
		}
	}
	if currentBarrier, stillHasBarrier := coordinator.policyDenyBarriers[key]; stillHasBarrier &&
		!denyBarrierSupersedesAllowed(currentBarrier, effectiveRev, observedSeq) {
		delete(coordinator.policyDenyBarriers, key)
	}
	coordinator.policyMu.Unlock()
	return nil
}

const (
	// verifiedPolicyProbeMaxBudget bounds online Registry revalidation when the
	// caller provides a deadline (e.g. the 15s local-app session rebind budget)
	// so stalled networks still leave headroom for offline SQLite lookup and
	// host/process verification.
	verifiedPolicyProbeMaxBudget   = 10 * time.Second
	verifiedPolicyProbeMinHeadroom = 2 * time.Second
)

func verifiedPolicyProbeBudget(remaining time.Duration) time.Duration {
	if remaining <= 0 {
		return 0
	}
	var budget time.Duration
	if remaining <= 2*verifiedPolicyProbeMinHeadroom {
		budget = remaining / 2
	} else {
		budget = remaining - verifiedPolicyProbeMinHeadroom
	}
	if budget > verifiedPolicyProbeMaxBudget {
		budget = verifiedPolicyProbeMaxBudget
	}
	if budget <= 0 {
		return time.Nanosecond
	}
	return budget
}

func verifiedPolicyRevalidateProbeContext(ctx context.Context) (context.Context, context.CancelFunc) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return ctx, func() {}
	}
	budget := verifiedPolicyProbeBudget(time.Until(deadline))
	if budget <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, budget)
}

// enforceVerifiedInstalledPolicy verifies official Registry policy for an exact
// installed verified target and persists the official result across restarts.
// When the Registry is unavailable, a stored approval for that exact target
// remains usable without a time limit. An observed denial or missing approval
// still blocks, and offline use never changes the stored verification.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (coordinator *Coordinator) enforceVerifiedInstalledPolicy(
	ctx context.Context,
	release localappkernel.CommittedRelease,
	selector publicappregistry.ApprovedTargetSelector,
	packageExpected nimiapppackage.Expected,
	expectedOS, expectedArch string,
) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	key := verifiedPolicyKey{
		appID:        release.AppID,
		releaseRef:   release.ReleaseRef,
		descriptorID: selector.DescriptorID(),
		targetID:     selector.TargetID(),
	}
	coordinator.retryPendingDenyBarrier(ctx, key)
	observedSeq, observedAt := coordinator.BeginPolicyObservation()
	probeCtx, probeCancel := verifiedPolicyRevalidateProbeContext(ctx)
	resolved, err := coordinator.registry.RevalidateInstalled(probeCtx, selector)
	probeErr := probeCtx.Err()
	probeCancel()
	if err == nil {
		if resolved.AppID != release.AppID || resolved.Version != release.Version || resolved.Selector != selector ||
			resolved.DescriptorID != selector.DescriptorID() || resolved.Target.TargetID != selector.TargetID() ||
			!publicappregistry.TargetCompatibleWithPlatform(resolved.Target, expectedOS, expectedArch) ||
			resolved.Target.OS != packageExpected.OS || resolved.Target.Arch != packageExpected.Arch {
			return false, ErrInstalledLaunch
		}
		if !reflect.DeepEqual(packageExpected, packageExpectation(resolved)) {
			return false, ErrInstalledLaunch
		}
		if blockErr := coordinator.recordVerifiedAllowed(ctx, key, resolved.KillSwitch.Revision, resolved.RegistryRevision, observedSeq, observedAt); blockErr != nil {
			return false, blockErr
		}
		return false, nil
	}
	var blocked *publicappregistry.PolicyBlockedError
	if errors.As(err, &blocked) {
		coordinator.recordObservedPolicyDeny(
			ctx,
			key,
			localappkernel.VerifiedPolicyBlocked,
			blocked.Reason,
			blocked.Revision,
			"",
			observedSeq,
			observedAt,
		)
		return false, err
	}
	if errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
		coordinator.recordObservedPolicyDeny(
			ctx,
			key,
			localappkernel.VerifiedPolicyRowAbsent,
			"",
			0,
			"",
			observedSeq,
			observedAt,
		)
		return false, err
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return false, ctxErr
	}
	if probeErr != nil && !errors.Is(err, publicappregistry.ErrRegistryUnavailable) &&
		(errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)) {
		err = fmt.Errorf("%w: %w", publicappregistry.ErrRegistryUnavailable, err)
	}
	if !errors.Is(err, publicappregistry.ErrRegistryUnavailable) {
		return false, err
	}
	if barrierErr := coordinator.checkOfflineDenyBarrier(ctx, key); barrierErr != nil {
		return false, barrierErr
	}
	record, recordErr := coordinator.lifecycle.GetVerifiedPolicy(ctx, release.AppID, release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
	if recordErr != nil {
		if errors.Is(recordErr, context.Canceled) || errors.Is(recordErr, context.DeadlineExceeded) {
			return false, recordErr
		}
		return false, err
	}
	switch record.Status {
	case localappkernel.VerifiedPolicyBlocked:
		coordinator.hydratePersistedDenyBarrier(key, record)
		return false, &publicappregistry.PolicyBlockedError{Reason: record.PolicyReason, Revision: record.PolicyRevision}
	case localappkernel.VerifiedPolicyRowAbsent:
		coordinator.hydratePersistedDenyBarrier(key, record)
		return false, publicappregistry.ErrCatalogAppNotFound
	case localappkernel.VerifiedPolicyAllowed:
		return true, nil
	default:
		return false, err
	}
}

func (coordinator *Coordinator) recordObservedPolicyBlock(
	ctx context.Context,
	selector publicappregistry.ApprovedTargetSelector,
	cause error,
	observedSeq uint64,
	observedAt time.Time,
) {
	if coordinator == nil || coordinator.lifecycle == nil {
		return
	}
	var blocked *publicappregistry.PolicyBlockedError
	if !errors.As(cause, &blocked) {
		return
	}
	descriptorID := selector.DescriptorID()
	sep := strings.LastIndexByte(descriptorID, '@')
	if sep <= 0 {
		return
	}
	appID := descriptorID[:sep]
	release, err := coordinator.lifecycle.GetCommittedRelease(context.WithoutCancel(ctx), appID, localappkernel.SourceClassVerified)
	if err != nil {
		return
	}
	installedSelector, err := publicSelector(release.ReleaseRef)
	if err != nil {
		return
	}
	key := verifiedPolicyKey{
		appID:        release.AppID,
		releaseRef:   release.ReleaseRef,
		descriptorID: installedSelector.DescriptorID(),
		targetID:     installedSelector.TargetID(),
	}
	coordinator.recordObservedPolicyDeny(
		ctx,
		key,
		localappkernel.VerifiedPolicyBlocked,
		blocked.Reason,
		blocked.Revision,
		"",
		observedSeq,
		observedAt,
	)
}
