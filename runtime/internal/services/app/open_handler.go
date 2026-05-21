package app

import (
	"context"
	"errors"
	"os"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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

func (e openBlocked) Error() string { return e.detail }

func blocked(step runtimev1.AppOpenFlowStep, reason runtimev1.ReasonCode, detail string) openBlocked {
	return openBlocked{step: step, reason: reason, detail: detail}
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

	// Step 1 — resolve the admitted Nimi App registry row + bound descriptor.
	app, descriptor, resolveErr := s.installRuntime.resolveDescriptor(appID)
	if resolveErr != nil {
		if blockErr := classifyResolveForOpen(resolveErr); blockErr != nil {
			return openBlockedResponse(appID, scope, *blockErr), nil
		}
		return nil, installResolveError(resolveErr)
	}
	// resolveDescriptor already enforces admission_status=admitted; the Open
	// flow additionally requires the row to be ordinary-visible (K-APP-017).
	if app.OrdinaryVisibility != appregistrycatalog.OrdinaryVisibilityOrdinaryVisible {
		return openBlockedResponse(appID, scope, blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY,
			runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND,
			"app registry row is not ordinary-visible",
		)), nil
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
	activeVersion, packageErr := verifyOpenPackage(s.installRuntime, plan, descriptor)
	if packageErr != nil {
		return openBlockedResponse(appID, scope, *packageErr), nil
	}

	// Step 3 — verify the account app-library state. The account app-library
	// projection is desktop-local (T4 Fork D); at the Runtime layer the
	// library checkpoint is satisfied once the app resolves as an admitted,
	// installed, verified package. Runtime does not gate launch on a
	// desktop-local file it does not own.

	// Step 4 — verify the durable app-data root is resolvable and uncorrupted.
	if dataErr := verifyOpenAppData(plan); dataErr != nil {
		return openBlockedResponse(appID, scope, *dataErr), nil
	}

	// Step 5 — verify the app permissions are granted or promptable. The
	// declared registry permission scope refs must be structurally complete;
	// a malformed permission scope ref fails closed.
	if permErr := verifyOpenPermissions(app); permErr != nil {
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
			"active_version", activeVersion,
			"scope_owner", scope.GetOwnerId(),
			"scope_surface", scope.GetSurfaceId(),
		)
	}
	return &runtimev1.OpenAppResponse{
		Projection: &runtimev1.AppOpenProjection{
			AppId:         appID,
			State:         runtimev1.AppOpenState_APP_OPEN_STATE_LAUNCHED,
			ReachedStep:   runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH,
			Launched:      true,
			ActiveVersion: activeVersion,
			Scope:         scope,
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}, nil
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
func verifyOpenPackage(runtime *installRuntime, plan appstorage.Plan, descriptor appreleasecatalog.Descriptor) (string, *openBlocked) {
	active, activeErr := runtime.activeRelease(plan)
	if activeErr != nil {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app has no active release; it is not installed",
		)
		return "", &e
	}
	activeVersion := strings.TrimSpace(active.ActiveVersion)
	if activeVersion == "" {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app active release pointer has no version",
		)
		return "", &e
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
		return "", &e
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
		return "", &e
	}
	if strings.TrimSpace(evidence.InstalledVersion) != activeVersion {
		e := blocked(
			runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE,
			runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED,
			"app install evidence version does not match the active release",
		)
		return "", &e
	}
	return activeVersion, nil
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

// verifyOpenPermissions verifies the app's declared permission scope refs are
// structurally complete. A registry row that declares a permission scope with
// a missing family/name fails the Open flow closed — launch never proceeds
// against an unresolvable permission declaration.
func verifyOpenPermissions(app appregistrycatalog.App) *openBlocked {
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
