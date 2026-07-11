package app

import (
	"context"
	"encoding/hex"
	"errors"
	"os"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc/codes"
)

// appOpenScopeKind is the only AIScopeRef kind admitted by the Open flow
// (K-APP-017 / P-AISC-007). The launch AIConfig scope is always app-shaped.
const appOpenScopeKind = "app"

// openBlocked is the internal carrier for a fail-closed Open-flow branch. It
// names the exact step that blocked and the distinct typed reason; the Open
// flow never collapses these into a generic value.
type openBlocked struct {
	step   runtimev1.AppOpenFlowStep
	reason runtimev1.ReasonCode
	detail string
}

type openLaunchPolicy struct {
	productReadinessClaimAllowed bool
}

type openPackageResolution struct {
	ActiveVersion string
	Plan          appstorage.Plan
	Evidence      appstorage.InstallEvidence
}

func (e openBlocked) Error() string { return e.detail }

func blocked(step runtimev1.AppOpenFlowStep, reason runtimev1.ReasonCode, detail string) openBlocked {
	return openBlocked{step: step, reason: reason, detail: detail}
}

func resolveOpenLaunchPolicy(app appregistrycatalog.App, descriptor appreleasecatalog.Descriptor) (openLaunchPolicy, *openBlocked) {
	switch descriptor.AdmissionTrack {
	case appreleasecatalog.AdmissionTrackSandboxCI:
		if app.OrdinaryVisibility != appregistrycatalog.OrdinaryVisibilityDeveloperOnly {
			e := blocked(
				runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
				runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
				"admission-sandbox-ci launch requires developer-only ordinary visibility",
			)
			return openLaunchPolicy{}, &e
		}
		if descriptor.Source.Kind != appreleasecatalog.SourceKindAdmissionSandboxHTTPSArtifact {
			e := blocked(
				runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
				runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
				"admission-sandbox-ci launch requires admission-sandbox-https-artifact source",
			)
			return openLaunchPolicy{}, &e
		}
		return openLaunchPolicy{productReadinessClaimAllowed: false}, nil
	case appreleasecatalog.AdmissionTrackOrdinaryReleaseProof:
		if app.OrdinaryVisibility != appregistrycatalog.OrdinaryVisibilityOrdinaryVisible {
			e := blocked(
				runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
				runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
				"ordinary-release-proof launch requires ordinary-visible registry visibility",
			)
			return openLaunchPolicy{}, &e
		}
		return openLaunchPolicy{productReadinessClaimAllowed: true}, nil
	case "":
		if descriptor.DescriptorClass == appreleasecatalog.DescriptorClassBundledWithNimi &&
			app.OrdinaryVisibility == appregistrycatalog.OrdinaryVisibilityOrdinaryVisible {
			return openLaunchPolicy{productReadinessClaimAllowed: true}, nil
		}
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
			runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
			"app registry row is not ordinary-visible",
		)
		return openLaunchPolicy{}, &e
	default:
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
			runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
			"app release descriptor admission_track is not launchable",
		)
		return openLaunchPolicy{}, &e
	}
}

// OpenApp is the sole Runtime RPC entry for launching a Nimi App (K-APP-017).
// It resolves the admitted registry row, receives an explicit app-shape
// AIScopeRef, and runs the typed Open flow:
//
//	resolve registry -> verify package -> verify library state ->
//	verify app data -> verify permissions -> ensure app AIConfig ->
//	validate manifest -> launch
//
// Every fail-closed branch carries a distinct typed reason_code and the exact
// step that blocked. OpenApp never launches without an explicit AIScopeRef,
// never infers launch scope, and never projects pseudo-success.
func (s *Service) OpenApp(ctx context.Context, req *runtimev1.OpenAppRequest) (*runtimev1.OpenAppResponse, error) {
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

	// The explicit canonical AIScopeRef is mandatory and is validated up front:
	// a missing or non-canonical scope fails closed before any launch work
	// (K-APP-017 MUST NOT — no launch without an explicit AIScopeRef).
	scope, scopeErr := validateOpenScope(appID, req.GetScope())
	if scopeErr != nil {
		return openBlockedResponse(appID, nil, *scopeErr), nil
	}
	if _, err := s.consumeLifecycleIntentForMutation(ctx, lifecycleIntentMutationRequest{
		action:                protectedlocal.LifecycleActionOpenApp,
		appID:                 appID,
		intentID:              req.GetLifecycleIntentId(),
		displayedImpactDigest: req.GetDisplayedImpactDigest(),
	}); err != nil {
		return nil, err
	}

	// Step 1 — resolve the admitted Nimi App registry row + bound descriptor.
	app, descriptor, resolveErr := s.installRuntime.resolveDescriptor(appID)
	if resolveErr != nil {
		if response, handled := s.openLocalAdoptedApp(ctx, appID, scope, resolveErr); handled {
			return response, nil
		}
		if blockErr := classifyResolveForOpen(resolveErr); blockErr != nil {
			return openBlockedResponse(appID, scope, *blockErr), nil
		}
		return nil, installResolveError(resolveErr)
	}
	launchPolicy, launchPolicyErr := resolveOpenLaunchPolicy(app, descriptor)
	if launchPolicyErr != nil {
		return openBlockedResponse(appID, scope, *launchPolicyErr), nil
	}

	plan, planErr := s.installRuntime.plan(descriptor)
	if planErr != nil {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			planErr.Error(),
		)), nil
	}

	// Step 2 — verify the materialized release package + install evidence.
	packageResolution, packageErr := verifyOpenPackage(s.installRuntime, plan, descriptor)
	if packageErr != nil {
		return openBlockedResponse(appID, scope, *packageErr), nil
	}

	// Step 3 — verify the account app-inventory state. Runtime consumes an
	// admitted verifier and fails closed when that authority is absent; it never
	// treats the verified package as a substitute for account-inventory truth.
	if inventoryErr := s.verifyOpenAccountInventory(ctx, app); inventoryErr != nil {
		return openBlockedResponse(appID, scope, *inventoryErr), nil
	}

	// Step 4 — verify the durable app-data root is resolvable and uncorrupted.
	if dataErr := verifyOpenAppData(plan); dataErr != nil {
		return openBlockedResponse(appID, scope, *dataErr), nil
	}

	// Step 5 — verify the app permissions are granted or promptable. The
	// declared registry permission scope refs must be structurally complete;
	// a malformed permission scope ref fails closed.
	if permErr := s.verifyOpenPermissions(ctx, app); permErr != nil {
		return openBlockedResponse(appID, scope, *permErr), nil
	}

	// Step 6 — ensure the app AIConfig. The Runtime does not own the AIConfig
	// store; this step certifies the AIScopeRef is the canonical app-shape ref
	// (validated up front) so the SDK/desktop per-app first-launch AIConfig
	// initialization (S-AICONF-009) can finalize against it. Runtime never
	// mutates a per-app AIConfig or factory profile template inside the Open
	// flow.

	// Step 7 — validate the manifest requirements.
	if manifestErr := verifyOpenManifest(descriptor); manifestErr != nil {
		return openBlockedResponse(appID, scope, *manifestErr), nil
	}

	// Step 8 — launch. The Open flow has verified every precondition; the
	// Runtime certifies the launch is admitted (P-NAPP-006 launch
	// supervision). Launch success is never inferred from process liveness or
	// file existence.
	if s.logger != nil {
		s.logger.Info("app open flow launched",
			"app_id", appID,
			"active_version", packageResolution.ActiveVersion,
			"scope_owner", scope.GetOwnerId(),
			"scope_surface", scope.GetSurfaceId(),
		)
	}
	if s.installedLaunches == nil {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH,
			runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED,
			"A.1 installed launch store and native child channel are not bound",
		)), nil
	}
	_, accountGeneration, accountReady := s.authenticatedLifecycleAccount(ctx)
	if !accountReady {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH,
			runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			"authenticated Runtime account generation is required for installed launch",
		)), nil
	}
	releaseDigest, digestErr := installedReleaseDigest(packageResolution.Evidence.SHA256)
	if digestErr != nil {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH,
			runtimev1.ReasonCode_APP_INSTALL_DIGEST_MISMATCH,
			digestErr.Error(),
		)), nil
	}
	ticket, ticketErr := s.installedLaunches.Issue(ctx, authservice.InstalledLaunchIssue{
		AppID:             appID,
		ReleaseDigest:     releaseDigest,
		AccountGeneration: accountGeneration,
	})
	if ticketErr != nil {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH,
			runtimev1.ReasonCode_APP_INSTALL_INTERNAL,
			"installed launch transaction failed",
		)), nil
	}
	return &runtimev1.OpenAppResponse{Projection: &runtimev1.AppOpenProjection{
		AppId:                        appID,
		State:                        runtimev1.AppOpenState_APP_OPEN_STATE_LAUNCH_PREPARED,
		ReachedStep:                  runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH,
		Launched:                     false,
		ActiveVersion:                packageResolution.ActiveVersion,
		Scope:                        scope,
		ReasonCode:                   runtimev1.ReasonCode_ACTION_EXECUTED,
		ReleaseDescriptorRef:         descriptor.DescriptorID,
		DescriptorClass:              string(descriptor.DescriptorClass),
		AdmissionTrack:               string(descriptor.AdmissionTrack),
		SourceKind:                   string(descriptor.Source.Kind),
		OrdinaryVisibility:           string(app.OrdinaryVisibility),
		DigestVerificationState:      packageResolution.Evidence.VerificationState,
		RuntimeEntryRef:              descriptor.Runtime.EntryRef,
		ActiveReleaseRoot:            packageResolution.Plan.ReleaseRoot,
		Storage:                      storageProjectionFromPlan(packageResolution.Plan),
		ShellCapabilitySetRef:        "installed-nimi-app-standard-shell-v1",
		CallerMode:                   "desktop-launched-nimi-app",
		LaunchId:                     append([]byte(nil), ticket.LaunchID[:]...),
		ProductReadinessClaimAllowed: launchPolicy.productReadinessClaimAllowed,
	}}, nil
}

func installedReleaseDigest(value string) (protectedlocal.Identifier, error) {
	var digest protectedlocal.Identifier
	decoded, err := hex.DecodeString(strings.TrimSpace(value))
	if err != nil || len(decoded) != len(digest) {
		return digest, errors.New("installed release requires an exact SHA-256 digest")
	}
	copy(digest[:], decoded)
	if digest == (protectedlocal.Identifier{}) {
		return digest, errors.New("installed release digest is empty")
	}
	return digest, nil
}

func (s *Service) openLocalAdoptedApp(
	ctx context.Context,
	appID string,
	scope *runtimev1.AppOpenScopeRef,
	resolveErr error,
) (*runtimev1.OpenAppResponse, bool) {
	if s.localAdoptions == nil {
		return nil, false
	}
	adoption, ok, err := s.localAdoptions.findAdopted(appID)
	if err != nil {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
			runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
			err.Error(),
		)), true
	}
	if !ok {
		return nil, false
	}
	app, manifestErr := appFromLocalAdoption(adoption)
	if manifestErr != nil {
		return openBlockedResponse(appID, scope, *manifestErr), true
	}
	if packageErr := verifyOpenLocalPackage(adoption); packageErr != nil {
		return openBlockedResponse(appID, scope, *packageErr), true
	}
	if inventoryErr := s.verifyOpenAccountInventory(ctx, app); inventoryErr != nil {
		return openBlockedResponse(appID, scope, *inventoryErr), true
	}
	plan, planErr := s.localAdoptionAppRoots(adoption)
	if planErr != nil {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_APP_DATA,
			runtimev1.ReasonCode_APP_OPEN_APP_DATA_INVALID,
			planErr.Error(),
		)), true
	}
	if dataErr := verifyOpenAppData(plan); dataErr != nil {
		return openBlockedResponse(appID, scope, *dataErr), true
	}
	if permErr := s.verifyOpenPermissions(ctx, app); permErr != nil {
		return openBlockedResponse(appID, scope, *permErr), true
	}
	if manifestErr := verifyOpenLocalManifest(adoption); manifestErr != nil {
		return openBlockedResponse(appID, scope, *manifestErr), true
	}
	if s.logger != nil {
		s.logger.Info("local app adoption remains non-authorizing",
			"app_id", appID,
			"active_version", adoption.Version,
			"scope_owner", scope.GetOwnerId(),
			"scope_surface", scope.GetSurfaceId(),
			"registry_resolve_error", resolveErr.Error(),
		)
	}
	return openBlockedResponse(appID, scope, blocked(
		runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH,
		runtimev1.ReasonCode_LOCAL_DEVELOPMENT_AUTHORIZATION_REQUIRED,
		"local adoption records inventory only; launch requires Desktop-supervised local-development authorization",
	)), true
}

func (s *Service) localAdoptionAppRoots(adoption localAppAdoptionRecord) (appstorage.Plan, error) {
	dataRootRef := strings.TrimSpace(s.appStorageDataRoot)
	if dataRootRef == "" && s.installRuntime != nil {
		dataRootRef = strings.TrimSpace(s.installRuntime.dataRootRef)
	}
	return appstorage.ResolveAppRoots(dataRootRef, adoption.AppID, adoption.StoragePolicyRef)
}

func appFromLocalAdoption(adoption localAppAdoptionRecord) (appregistrycatalog.App, *openBlocked) {
	scopes, ok := localPermissionScopeRefs(adoption.AppID, adoption.PermissionScopeRef)
	if !ok {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS,
			runtimev1.ReasonCode_APP_OPEN_PERMISSION_NOT_GRANTED,
			"local app adoption permissionScopeRef is not structurally parseable",
		)
		return appregistrycatalog.App{}, &e
	}
	return appregistrycatalog.App{
		AppID:                   adoption.AppID,
		DisplayLabel:            adoption.DisplayName,
		Publisher:               "Local",
		PackageKind:             appregistrycatalog.PackageKindNimiApp,
		PermissionScopeRefs:     scopes,
		OrdinaryVisibility:      appregistrycatalog.OrdinaryVisibilityOrdinaryVisible,
		AdmissionStatus:         appregistrycatalog.AdmissionStatusAdmitted,
		InstallStoragePolicyRef: adoption.StoragePolicyRef,
		SourceRule:              "local_adoption",
	}, nil
}

func localPermissionScopeRefs(appID string, ref string) ([]appregistrycatalog.PermissionScopeRef, bool) {
	normalized := strings.TrimSpace(ref)
	if normalized == "" {
		return nil, false
	}
	if parts := strings.SplitN(normalized, ":", 2); len(parts) == 2 {
		family := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		return []appregistrycatalog.PermissionScopeRef{{
			AppID:       appID,
			ScopeFamily: family,
			ScopeName:   name,
		}}, family != "" && name != ""
	}
	if strings.Contains(normalized, ".") {
		return []appregistrycatalog.PermissionScopeRef{{
			AppID:       appID,
			ScopeFamily: "app",
			ScopeName:   normalized,
		}}, true
	}
	return nil, false
}

func verifyOpenLocalPackage(adoption localAppAdoptionRecord) *openBlocked {
	candidate, err := resolveLocalAppAdoptionCandidate(adoption.RootPath, adoption.AppID)
	if err != nil {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			err.Error(),
		)
		return &e
	}
	if candidate.Version != adoption.Version ||
		candidate.EntryRef != adoption.EntryRef ||
		candidate.PermissionScopeRef != adoption.PermissionScopeRef ||
		candidate.StoragePolicyRef != adoption.StoragePolicyRef ||
		candidate.ManifestPath != adoption.ManifestPath {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"local app adoption manifest no longer matches the Runtime adoption record",
		)
		return &e
	}
	return nil
}

func verifyOpenLocalManifest(adoption localAppAdoptionRecord) *openBlocked {
	if strings.TrimSpace(adoption.EntryRef) == "" ||
		strings.TrimSpace(adoption.PermissionScopeRef) == "" ||
		strings.TrimSpace(adoption.StoragePolicyRef) == "" {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VALIDATE_MANIFEST,
			runtimev1.ReasonCode_APP_OPEN_MANIFEST_REQUIREMENT_UNSATISFIED,
			"local app adoption manifest is missing entry, permission, or storage declarations",
		)
		return &e
	}
	return nil
}

// validateOpenScope validates the explicit app-launch AIConfig scope against
// the P-AISC-007 app shape: kind must be the literal `app`, owner_id must be
// the app being opened, and surface_id (when present) must be a clean token.
// A missing or non-canonical scope fails closed — it is never inferred.
func validateOpenScope(appID string, scope *runtimev1.AppOpenScopeRef) (*runtimev1.AppOpenScopeRef, *openBlocked) {
	if scope == nil {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_ENSURE_AICONFIG,
			runtimev1.ReasonCode_APP_OPEN_SCOPE_REF_REQUIRED,
			"OpenApp requires an explicit app-launch AIScopeRef",
		)
		return nil, &e
	}
	kind := strings.TrimSpace(scope.GetKind())
	ownerID := strings.TrimSpace(scope.GetOwnerId())
	surfaceID := strings.TrimSpace(scope.GetSurfaceId())
	if kind != appOpenScopeKind {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_ENSURE_AICONFIG,
			runtimev1.ReasonCode_APP_OPEN_SCOPE_REF_INVALID,
			"app-launch AIScopeRef kind must be 'app'",
		)
		return nil, &e
	}
	if ownerID == "" || ownerID != appID {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_ENSURE_AICONFIG,
			runtimev1.ReasonCode_APP_OPEN_SCOPE_REF_INVALID,
			"app-launch AIScopeRef ownerId must equal the opened app_id",
		)
		return nil, &e
	}
	if surfaceID != "" && (surfaceID != scope.GetSurfaceId() || strings.ContainsAny(surfaceID, " \t\n")) {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_ENSURE_AICONFIG,
			runtimev1.ReasonCode_APP_OPEN_SCOPE_REF_INVALID,
			"app-launch AIScopeRef surfaceId is not a stable token",
		)
		return nil, &e
	}
	return &runtimev1.AppOpenScopeRef{
		Kind:      appOpenScopeKind,
		OwnerId:   ownerID,
		SurfaceId: surfaceID,
	}, nil
}

// classifyResolveForOpen maps a descriptor-resolution error onto a typed
// Open-flow blocked branch. An app that is not admitted / not found resolves
// to a blocked projection at the resolve-registry step; a genuine runtime
// unavailability surfaces as a transport error.
func classifyResolveForOpen(err error) *openBlocked {
	switch {
	case errors.Is(err, errInstallRuntimeUnavailable),
		errors.Is(err, errInstallAppIDRequired):
		return nil
	default:
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
			runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
			err.Error(),
		)
		return &e
	}
}

// verifyOpenPackage verifies the active release pointer and the digest-verified
// install evidence for an installed app. An app with no active release is not
// installed; a release with missing or non-digest-verified evidence is not a
// launchable package.
func verifyOpenPackage(runtime *installRuntime, plan appstorage.Plan, descriptor appreleasecatalog.Descriptor) (openPackageResolution, *openBlocked) {
	active, activeErr := runtime.activeRelease(plan)
	if activeErr != nil {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app has no active release; it is not installed",
		)
		return openPackageResolution{}, &e
	}
	activeVersion := strings.TrimSpace(active.ActiveVersion)
	if activeVersion == "" {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app active release pointer has no version",
		)
		return openPackageResolution{}, &e
	}
	// The install evidence is read against the active release's storage plan.
	activePlan := plan
	activePlan.Version = activeVersion
	if resolved, err := appstorage.Resolve(plan.DataRootRef, descriptor.AppID, activeVersion, descriptor.StoragePolicyRef); err == nil {
		activePlan = resolved
	}
	evidence, evidenceErr := appstorage.ReadInstallEvidence(activePlan)
	if evidenceErr != nil {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence is missing for the active release",
		)
		return openPackageResolution{}, &e
	}
	// A launchable package carries a verified install state: an external
	// artifact is `digest-verified`, a bundled-with-nimi artifact is
	// `bundled-source` (materialized from the atomic Nimi release bundle). Any
	// other state (e.g. digest-mismatch) is not a verified package.
	if !isVerifiedInstallState(evidence.VerificationState) {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence is not in a verified state",
		)
		return openPackageResolution{}, &e
	}
	if strings.TrimSpace(evidence.InstalledVersion) != activeVersion {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence version does not match the active release",
		)
		return openPackageResolution{}, &e
	}
	if strings.TrimSpace(evidence.AppID) != descriptor.AppID ||
		strings.TrimSpace(evidence.ReleaseDescriptorRef) != descriptor.DescriptorID ||
		strings.TrimSpace(evidence.StoragePolicyRef) != descriptor.StoragePolicyRef {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence does not match the release descriptor",
		)
		return openPackageResolution{}, &e
	}
	if strings.TrimSpace(evidence.VerificationState) == "digest-verified" &&
		strings.TrimSpace(evidence.SHA256) != descriptor.Artifact.SHA256 {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence sha256 does not match the release descriptor",
		)
		return openPackageResolution{}, &e
	}
	return openPackageResolution{ActiveVersion: activeVersion, Plan: activePlan, Evidence: evidence}, nil
}

// isVerifiedInstallState reports whether an install evidence verification
// state is a launchable verified state. An external artifact is
// `digest-verified`; a bundled-with-nimi artifact is `bundled-source`. Any
// other state (digest-mismatch, empty) is not a verified package.
func isVerifiedInstallState(state string) bool {
	switch strings.TrimSpace(state) {
	case "digest-verified", "bundled-source":
		return true
	default:
		return false
	}
}

// verifyOpenAppData verifies the durable app-data root is resolvable and is a
// real directory (not a symlink, not a non-directory). A corrupted data root
// fails the Open flow closed rather than launching against unknown state.
func verifyOpenAppData(plan appstorage.Plan) *openBlocked {
	info, err := os.Lstat(plan.DurableDataRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// A durable data root is materialized at install time. Its absence
			// for an otherwise-installed app is a corrupted app-data state.
			e := blocked(
				runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_APP_DATA,
				runtimev1.ReasonCode_APP_OPEN_APP_DATA_INVALID,
				"app durable data root is missing",
			)
			return &e
		}
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_APP_DATA,
			runtimev1.ReasonCode_APP_OPEN_APP_DATA_INVALID,
			"app durable data root is not readable",
		)
		return &e
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_APP_DATA,
			runtimev1.ReasonCode_APP_OPEN_APP_DATA_INVALID,
			"app durable data root is not a directory",
		)
		return &e
	}
	return nil
}

// verifyOpenAccountInventory verifies the authenticated account app-inventory
// row for the target app. Package verification never substitutes for account
// visibility or local materialization truth.
func (s *Service) verifyOpenAccountInventory(ctx context.Context, app appregistrycatalog.App) *openBlocked {
	if s.openReadiness == nil {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_LIBRARY,
			runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID,
			"Runtime OpenApp account-inventory verifier is not configured",
		)
		return &e
	}
	decision, err := s.openReadiness.VerifyOpenAccountInventory(ctx, app)
	if err != nil || !decision.Allowed {
		detail := strings.TrimSpace(decision.Detail)
		if detail == "" && err != nil {
			detail = err.Error()
		}
		if detail == "" {
			detail = "account app-inventory state is not launchable"
		}
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_LIBRARY,
			runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID,
			detail,
		)
		return &e
	}
	return nil
}

func (s *Service) verifyOpenPermissions(ctx context.Context, app appregistrycatalog.App) *openBlocked {
	if app.PermissionScopeRefPending {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS,
			runtimev1.ReasonCode_APP_OPEN_PERMISSION_NOT_GRANTED,
			"app permission scope ref is permission_fabric_pending",
		)
		return &e
	}
	for _, scope := range app.PermissionScopeRefs {
		if strings.TrimSpace(scope.ScopeFamily) == "" || strings.TrimSpace(scope.ScopeName) == "" {
			e := blocked(
				runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS,
				runtimev1.ReasonCode_APP_OPEN_PERMISSION_NOT_GRANTED,
				"app declares a permission scope with no family or name",
			)
			return &e
		}
		if strings.TrimSpace(scope.AppID) != "" && strings.TrimSpace(scope.AppID) != strings.TrimSpace(app.AppID) {
			e := blocked(
				runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS,
				runtimev1.ReasonCode_APP_OPEN_PERMISSION_NOT_GRANTED,
				"app declares a permission scope bound to a different app",
			)
			return &e
		}
	}
	if len(app.PermissionScopeRefs) == 0 {
		return nil
	}
	if s.openReadiness == nil {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS,
			runtimev1.ReasonCode_APP_OPEN_PERMISSION_NOT_GRANTED,
			"Runtime OpenApp permission verifier is not configured",
		)
		return &e
	}
	decision, err := s.openReadiness.VerifyOpenPermissions(ctx, app)
	if err != nil || !decision.Allowed {
		detail := strings.TrimSpace(decision.Detail)
		if detail == "" && err != nil {
			detail = err.Error()
		}
		if detail == "" {
			detail = "app permissions are not granted or promptable"
		}
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS,
			runtimev1.ReasonCode_APP_OPEN_PERMISSION_NOT_GRANTED,
			detail,
		)
		return &e
	}
	return nil
}

// verifyOpenManifest validates the bound release descriptor's runtime manifest
// requirements. A descriptor that is not a nimi-app package, or that has no
// runtime entry ref, is not a launchable manifest.
func verifyOpenManifest(descriptor appreleasecatalog.Descriptor) *openBlocked {
	if descriptor.Runtime.PackageKind != "nimi-app" {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VALIDATE_MANIFEST,
			runtimev1.ReasonCode_APP_OPEN_MANIFEST_REQUIREMENT_UNSATISFIED,
			"app release manifest package_kind is not nimi-app",
		)
		return &e
	}
	if strings.TrimSpace(descriptor.Runtime.EntryRef) == "" {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VALIDATE_MANIFEST,
			runtimev1.ReasonCode_APP_OPEN_MANIFEST_REQUIREMENT_UNSATISFIED,
			"app release manifest has no runtime entry ref",
		)
		return &e
	}
	if strings.TrimSpace(descriptor.Runtime.SandboxRef) == "" {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VALIDATE_MANIFEST,
			runtimev1.ReasonCode_APP_OPEN_MANIFEST_REQUIREMENT_UNSATISFIED,
			"app release manifest has no runtime sandbox ref",
		)
		return &e
	}
	return nil
}

// openBlockedResponse builds the typed fail-closed Open projection. The
// blocked state names the exact step and carries the distinct reason; it is
// never collapsed and never projects as launched.
func openBlockedResponse(appID string, scope *runtimev1.AppOpenScopeRef, e openBlocked) *runtimev1.OpenAppResponse {
	return &runtimev1.OpenAppResponse{
		Projection: &runtimev1.AppOpenProjection{
			AppId:       appID,
			State:       runtimev1.AppOpenState_APP_OPEN_STATE_BLOCKED,
			ReachedStep: e.step,
			Launched:    false,
			Scope:       scope,
			ReasonCode:  e.reason,
			Detail:      e.detail,
		},
	}
}
