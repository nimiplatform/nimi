package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const runtimeAgentAvatarPackageReadScope = "runtime.agent.avatar_package.read"

type AvatarPackageLaunchProjectionRequest struct {
	CallerAppID      string
	SubjectUserID    string
	OwnerUserID      string
	RealmAgentID     string
	LocalAgentRef    string
	AvatarInstanceID string
}

type AvatarPackageLaunchProjectionResolver interface {
	ResolveAvatarPackageLaunchProjection(context.Context, AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error)
}

func (s *Service) SetAvatarPackageLaunchProjectionResolver(resolver AvatarPackageLaunchProjectionResolver) {
	if s == nil {
		return
	}
	s.avatarPackageProjectionMu.Lock()
	defer s.avatarPackageProjectionMu.Unlock()
	s.avatarPackageProjectionResolver = resolver
}

func (s *Service) avatarPackageResolver() AvatarPackageLaunchProjectionResolver {
	if s == nil {
		return nil
	}
	s.avatarPackageProjectionMu.RLock()
	defer s.avatarPackageProjectionMu.RUnlock()
	return s.avatarPackageProjectionResolver
}

func (s *Service) ResolveAvatarPackageLaunchProjection(ctx context.Context, req *runtimev1.ResolveAvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error) {
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "resolve avatar package launch projection request is required")
	}
	requestContext := req.GetContext()
	callerAppID := strings.TrimSpace(requestContext.GetAppId())
	if callerAppID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	subjectUserID := strings.TrimSpace(requestContext.GetSubjectUserId())
	if subjectUserID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.subject_user_id is required")
	}
	avatarInstanceID := strings.TrimSpace(req.GetAvatarInstanceId())
	if avatarInstanceID == "" {
		return nil, status.Error(codes.InvalidArgument, "avatar_instance_id is required")
	}
	identity, _, err := s.agentEntryForIdentityContext(requestContext)
	if err != nil {
		return nil, err
	}
	if scopedBinding := requestContext.GetScopedBinding(); scopedBinding != nil {
		if boundAvatarInstanceID := strings.TrimSpace(scopedBinding.GetAvatarInstanceId()); boundAvatarInstanceID != "" && boundAvatarInstanceID != avatarInstanceID {
			return nil, status.Error(codes.PermissionDenied, "avatar package scoped binding avatar_instance_id mismatch")
		}
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, identity.LocalAgentRef, runtimeAgentAvatarPackageReadScope); err != nil {
			return nil, err
		}
	} else if !envelope.HasValidatedProtectedCapability(ctx, callerAppID, runtimeAgentAvatarPackageReadScope) {
		return nil, runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	resolver := s.avatarPackageResolver()
	if resolver == nil {
		return nil, status.Error(codes.FailedPrecondition, "runtime avatar package projection resolver unavailable")
	}
	projection, err := resolver.ResolveAvatarPackageLaunchProjection(ctx, AvatarPackageLaunchProjectionRequest{
		CallerAppID:      callerAppID,
		SubjectUserID:    subjectUserID,
		OwnerUserID:      identity.OwnerUserID,
		RealmAgentID:     identity.RealmAgentID,
		LocalAgentRef:    identity.LocalAgentRef,
		AvatarInstanceID: avatarInstanceID,
	})
	if err != nil {
		return nil, err
	}
	if err := validateRuntimeAvatarPackageLaunchProjection(projection); err != nil {
		return nil, err
	}
	return projection, nil
}

func validateRuntimeAvatarPackageLaunchProjection(projection *runtimev1.ResolveAvatarPackageLaunchProjectionResponse) error {
	if projection == nil {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection unavailable")
	}
	if strings.TrimSpace(projection.GetAvatarPackageRef()) == "" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing avatar_package_ref")
	}
	if strings.TrimSpace(projection.GetPackageKind()) != "avatar" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection package_kind must be avatar")
	}
	if strings.TrimSpace(projection.GetPackageId()) == "" || strings.TrimSpace(projection.GetBundleId()) == "" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing package identity")
	}
	bundleMembers := projection.GetBundleMemberAssetIds()
	if len(bundleMembers) == 0 {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing bundle_member_asset_ids")
	}
	bundleMemberSet := make(map[string]struct{}, len(bundleMembers))
	for _, assetID := range bundleMembers {
		trimmed := strings.TrimSpace(assetID)
		if trimmed == "" {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection invalid bundle_member_asset_ids")
		}
		bundleMemberSet[trimmed] = struct{}{}
	}
	backendKind := strings.TrimSpace(projection.GetBackendKind())
	if backendKind != "live2d" && backendKind != "vrm" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection unsupported backend_kind")
	}
	if strings.TrimSpace(projection.GetBackendCapabilityProfileRef()) == "" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing backend_capability_profile_ref")
	}
	if strings.TrimSpace(projection.GetStatus()) != "published" || !projection.GetIsReady() || len(projection.GetReadinessIssues()) > 0 {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection is not launch ready")
	}
	if strings.TrimSpace(projection.GetMaterializationRef()) == "" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing materialization_ref")
	}
	if err := validateRuntimeAvatarPackageLayout(projection.GetAvatarModelLayout(), backendKind, bundleMemberSet); err != nil {
		return err
	}
	if err := validateRuntimeAvatarPackageProvenance(projection.GetProvenance()); err != nil {
		return err
	}
	for _, diagnostic := range projection.GetCompatibilityDiagnostics() {
		if diagnostic == nil || strings.TrimSpace(diagnostic.GetCode()) == "" {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection invalid compatibility diagnostic")
		}
		switch strings.TrimSpace(diagnostic.GetSeverity()) {
		case "info", "warning":
		case "blocking":
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection has blocking compatibility diagnostic")
		default:
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection invalid compatibility diagnostic severity")
		}
	}
	return nil
}

func validateRuntimeAvatarPackageLayout(layout *runtimev1.RuntimeAvatarPackageModelLayout, backendKind string, bundleMemberSet map[string]struct{}) error {
	if layout == nil {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing avatar_model_layout")
	}
	if layout.GetLayoutVersion() <= 0 {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection invalid layout_version")
	}
	if strings.TrimSpace(layout.GetBackendKind()) != backendKind {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection layout backend_kind mismatch")
	}
	entryAssetID := strings.TrimSpace(layout.GetEntryAssetId())
	if entryAssetID == "" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing entry_asset_id")
	}
	if _, ok := bundleMemberSet[entryAssetID]; !ok {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection entry_asset_id not in bundle")
	}
	runtimeRoot := strings.TrimSpace(layout.GetRuntimeRoot())
	if err := validateRuntimeAvatarPackageRelativePath(runtimeRoot, "runtime_root"); err != nil {
		return err
	}
	requiredAssetIDs := layout.GetRequiredAssetIds()
	if len(requiredAssetIDs) == 0 {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing required_asset_ids")
	}
	for _, assetID := range requiredAssetIDs {
		trimmed := strings.TrimSpace(assetID)
		if trimmed == "" {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection invalid required_asset_ids")
		}
		if _, ok := bundleMemberSet[trimmed]; !ok {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection required_asset_id not in bundle")
		}
	}
	if backendKind == "live2d" {
		live2d := layout.GetLive2D()
		if live2d == nil {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing live2d layout")
		}
		modelAssetID := strings.TrimSpace(live2d.GetModel3JsonAssetId())
		if modelAssetID != entryAssetID {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection live2d asset must match entry_asset_id")
		}
		if _, ok := bundleMemberSet[modelAssetID]; !ok {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection live2d asset not in bundle")
		}
		modelPath := strings.TrimSpace(live2d.GetModel3JsonPath())
		if err := validateRuntimeAvatarPackagePathUnderRoot(modelPath, runtimeRoot, "model3_json_path"); err != nil {
			return err
		}
		if !strings.HasSuffix(modelPath, ".model3.json") {
			return status.Error(codes.FailedPrecondition, "runtime avatar package projection model3_json_path must end with .model3.json")
		}
		return nil
	}
	vrm := layout.GetVrm()
	if vrm == nil {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing vrm layout")
	}
	vrmAssetID := strings.TrimSpace(vrm.GetVrmAssetId())
	if vrmAssetID != entryAssetID {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection vrm asset must match entry_asset_id")
	}
	if _, ok := bundleMemberSet[vrmAssetID]; !ok {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection vrm asset not in bundle")
	}
	vrmPath := strings.TrimSpace(vrm.GetVrmFilePath())
	if err := validateRuntimeAvatarPackagePathUnderRoot(vrmPath, runtimeRoot, "vrm_file_path"); err != nil {
		return err
	}
	if !strings.HasSuffix(vrmPath, ".vrm") {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection vrm_file_path must end with .vrm")
	}
	return nil
}

func validateRuntimeAvatarPackageProvenance(provenance *runtimev1.RuntimeAvatarPackageProvenance) error {
	if provenance == nil {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection missing provenance")
	}
	sourceType := strings.TrimSpace(provenance.GetSourceType())
	if sourceType == "future_reviewed_ugc" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection future_reviewed_ugc requires AM-MOD admission")
	}
	if sourceType != "first_party_curated" && sourceType != "imported_local_materialization" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection unsupported provenance source_type")
	}
	if strings.TrimSpace(provenance.GetSourceFingerprint()) == "" ||
		strings.TrimSpace(provenance.GetAdmittedAt()) == "" ||
		strings.TrimSpace(provenance.GetValidator()) == "" {
		return status.Error(codes.FailedPrecondition, "runtime avatar package projection incomplete provenance")
	}
	return nil
}

func validateRuntimeAvatarPackageRelativePath(value string, label string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "\\") {
		return status.Errorf(codes.FailedPrecondition, "runtime avatar package projection invalid %s", label)
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "://") || strings.Contains(trimmed, "\\") {
		return status.Errorf(codes.FailedPrecondition, "runtime avatar package projection invalid %s", label)
	}
	if len(trimmed) >= 2 && trimmed[1] == ':' {
		return status.Errorf(codes.FailedPrecondition, "runtime avatar package projection invalid %s", label)
	}
	for _, segment := range strings.Split(trimmed, "/") {
		if segment == "." || segment == ".." {
			return status.Errorf(codes.FailedPrecondition, "runtime avatar package projection invalid %s", label)
		}
	}
	return nil
}

func validateRuntimeAvatarPackagePathUnderRoot(value string, runtimeRoot string, label string) error {
	if err := validateRuntimeAvatarPackageRelativePath(value, label); err != nil {
		return err
	}
	trimmedPath := strings.TrimSpace(value)
	trimmedRoot := strings.TrimSuffix(strings.TrimSpace(runtimeRoot), "/")
	if trimmedPath != trimmedRoot && !strings.HasPrefix(trimmedPath, trimmedRoot+"/") {
		return status.Errorf(codes.FailedPrecondition, "runtime avatar package projection %s must be under runtime_root", label)
	}
	return nil
}
