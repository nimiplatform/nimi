package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
)

const (
	localAssetReadinessRefPrefix                    = "local_asset_readiness:v2:"
	localAssetEffectivePublicComponentIdentityField = "effectivePublicComponentIdentity"
	workflowBindingIDPrefix                         = "workflow_binding:"
)

var (
	ErrDurableLocalTargetInvalid            = errors.New("durable local target is invalid")
	ErrDurableLocalTargetUnavailable        = errors.New("durable local target is unavailable")
	ErrDurableLocalTargetCapabilityMismatch = errors.New("durable local target capability mismatch")
)

// ResolveDurableLocalTarget is the canonical Runtime-private v2 local target
// resolver. It resolves only Runtime-issued opaque target identity and never
// interprets model_id, asset_id, logical_model_id, or source prefixes.
func (s *Service) ResolveDurableLocalTarget(
	ctx context.Context,
	target *runtimeidentity.LocalTarget,
	capability string,
) (*runtimeidentity.ResolvedLocalBinding, *runtimev1.LocalAssetRecord, error) {
	return s.resolveDurableLocalTarget(ctx, target, capability, "")
}

// ResolveDurableLocalComponentTarget resolves a component selection through
// the same opaque v2 target registry used for runnable targets. componentKind
// is only a compatibility constraint; it never participates in identity.
func (s *Service) ResolveDurableLocalComponentTarget(
	ctx context.Context,
	target *runtimeidentity.LocalTarget,
	componentKind string,
) (*runtimeidentity.ResolvedLocalBinding, *runtimev1.LocalAssetRecord, error) {
	return s.resolveDurableLocalTarget(ctx, target, "", componentKind)
}

func (s *Service) resolveDurableLocalTarget(
	_ context.Context,
	target *runtimeidentity.LocalTarget,
	capability string,
	componentKind string,
) (*runtimeidentity.ResolvedLocalBinding, *runtimev1.LocalAssetRecord, error) {
	if s == nil || target == nil || !target.Valid() {
		return nil, nil, durableLocalTargetInvalidError()
	}
	normalizedCapability := normalizeLocalCapabilityToken(capability)
	normalizedComponentKind := strings.ToLower(strings.TrimSpace(componentKind))
	if normalizedCapability == "" && normalizedComponentKind == "" {
		return nil, nil, durableLocalTargetCapabilityMismatchError()
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var asset *runtimev1.LocalAssetRecord
	binding := &runtimeidentity.ResolvedLocalBinding{}
	if profileBindingID := strings.TrimSpace(target.ProfileBindingID); profileBindingID != "" {
		profile, matched := s.managedImageProfileBindings[profileBindingID]
		if !matched || !profile.MaterializationResolved {
			return nil, nil, durableLocalTargetUnavailableError()
		}
		localAssetID := strings.TrimSpace(profile.MainLocalAssetID)
		asset = s.assets[localAssetID]
		if asset == nil {
			return nil, nil, durableLocalTargetUnavailableError()
		}
		binding.ProfileBindingID = profileBindingID
	} else if readinessRef := strings.TrimSpace(target.ReadinessRef); readinessRef != "" {
		var matched *runtimev1.LocalAssetRecord
		for _, candidate := range s.assets {
			canonical := s.durableLocalTargetRefForAssetLocked(candidate)
			if normalizedComponentKind != "" {
				canonical = s.durableLocalAssetSelectionRefForAssetLocked(candidate)
			}
			if canonical == nil || canonical.GetReadinessRef() != readinessRef {
				continue
			}
			if matched != nil {
				return nil, nil, durableLocalTargetInvalidError()
			}
			matched = candidate
		}
		if matched == nil {
			return nil, nil, durableLocalTargetUnavailableError()
		}
		asset = matched
		binding.ReadinessRef = readinessRef
	} else {
		return nil, nil, durableLocalTargetInvalidError()
	}

	kind := effectiveAssetKind(asset.GetKind(), asset.GetCapabilities())
	if normalizedComponentKind != "" {
		kindToken, err := localAssetKindToken(kind)
		if err != nil || !profileRuntimePreparedAssetKindMatches(kindToken, normalizedComponentKind) {
			return nil, nil, durableLocalTargetCapabilityMismatchError()
		}
	} else if !assetKindMatchesCapability(kind, normalizedCapability) {
		return nil, nil, durableLocalTargetCapabilityMismatchError()
	}
	localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
	resolvedPublicIdentity := strings.TrimSpace(asset.GetLogicalModelId())
	if normalizedComponentKind != "" {
		resolvedPublicIdentity = effectiveLocalComponentPublicIdentity(asset)
	}
	if resolvedPublicIdentity == "" || localAssetID == "" {
		return nil, nil, durableLocalTargetUnavailableError()
	}

	projected := cloneLocalAsset(asset)
	binding.LocalAssetID = localAssetID
	binding.ExecutionProfileID = strings.TrimSpace(asset.GetLocalInvokeProfileId())
	binding.ResolvedModelID = resolvedPublicIdentity
	return binding, projected, nil
}

func (s *Service) projectDurableLocalTargetForAsset(
	asset *runtimev1.LocalAssetRecord,
) (*runtimeidentity.LocalTarget, runtimev1.LocalAssetStatus, runtimev1.ReasonCode) {
	if s == nil || asset == nil {
		return nil, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
	if localAssetID == "" {
		return nil, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.assets[localAssetID]
	if current == nil {
		return nil, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}
	target := s.durableLocalTargetRefForAssetLocked(current)
	if target == nil {
		return nil, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	status, reason := s.durableLocalTargetReadinessLocked(current, target)
	return cloneDurableLocalTargetRef(target), status, reason
}

func (s *Service) projectDurableLocalSelectionTargetForAsset(
	asset *runtimev1.LocalAssetRecord,
) *runtimeidentity.LocalTarget {
	if s == nil || asset == nil {
		return nil
	}
	localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
	if localAssetID == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.assets[localAssetID]
	if current == nil {
		return nil
	}
	return cloneDurableLocalTargetRef(s.durableLocalAssetSelectionRefForAssetLocked(current))
}

func (s *Service) durableLocalTargetRefForAssetLocked(
	asset *runtimev1.LocalAssetRecord,
) *runtimeidentity.LocalTarget {
	if asset == nil || strings.TrimSpace(asset.GetLogicalModelId()) == "" {
		return nil
	}
	return s.durableLocalAssetSelectionRefForAssetLocked(asset)
}

func (s *Service) durableLocalAssetSelectionRefForAssetLocked(
	asset *runtimev1.LocalAssetRecord,
) *runtimeidentity.LocalTarget {
	if asset == nil {
		return nil
	}
	localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
	if localAssetID == "" || effectiveLocalComponentPublicIdentity(asset) == "" {
		return nil
	}
	return &runtimeidentity.LocalTarget{ReadinessRef: durableLocalAssetReadinessRef(localAssetID)}
}

// effectiveLocalComponentPublicIdentity returns the public identity carried by
// selectedComponents.logicalModelId. Runnable components retain their public
// logical model identity. Passive components use a stable content identity
// derived from verified manifest facts and never from local_asset_id, asset_id,
// import instance, path, or profile binding identity.
func effectiveLocalComponentPublicIdentity(asset *runtimev1.LocalAssetRecord) string {
	if asset == nil {
		return ""
	}
	if logicalModelID := strings.TrimSpace(asset.GetLogicalModelId()); logicalModelID != "" {
		return logicalModelID
	}
	kind := effectiveAssetKind(asset.GetKind(), asset.GetCapabilities())
	if isRunnableKind(kind) {
		return ""
	}
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		return ""
	}
	entrySHA256 := expectedManagedModelEntryHash(asset)
	if entrySHA256 == "" {
		return ""
	}
	return "nimi/component/" + kindToken + "/sha256-" + entrySHA256
}

func (s *Service) durableLocalTargetReadinessLocked(
	asset *runtimev1.LocalAssetRecord,
	target *runtimeidentity.LocalTarget,
) (runtimev1.LocalAssetStatus, runtimev1.ReasonCode) {
	if asset == nil || target == nil {
		return runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
	}
	if target.GetProfileBindingId() != "" {
		if !profileEntryStaticConfigAssetUsable(asset) {
			return asset.GetStatus(), localAssetTargetReason(asset)
		}
		profile, ok := s.managedImageProfileBindings[strings.TrimSpace(target.GetProfileBindingId())]
		if !ok || !s.managedImageMaterializationReadyLocked(asset, profile) {
			return runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING
		}
		loaded, loadedOK := s.managedImageLoadCache[strings.TrimSpace(asset.GetLocalAssetId())]
		if asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
			loadedOK && strings.TrimSpace(loaded.Alias) == strings.TrimSpace(profile.Alias) && !loaded.VerifiedAt.IsZero() {
			return runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, runtimev1.ReasonCode_ACTION_EXECUTED
		}
		return runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	return asset.GetStatus(), localAssetTargetReason(asset)
}

func (s *Service) managedImageMaterializationReadyLocked(
	main *runtimev1.LocalAssetRecord,
	profile managedImageProfileState,
) bool {
	if main == nil ||
		!profile.MaterializationResolved ||
		!strings.HasPrefix(strings.TrimSpace(profile.Alias), profileRuntimeMaterializationKeyPrefix) ||
		len(profile.MaterializationBindings) == 0 {
		return false
	}
	mainLocalAssetID := strings.TrimSpace(main.GetLocalAssetId())
	mainAssetID := strings.TrimSpace(main.GetAssetId())
	mainCount := 0
	for _, binding := range profile.MaterializationBindings {
		if strings.TrimSpace(binding.LocalAssetID) != mainLocalAssetID ||
			strings.TrimSpace(binding.AssetID) != mainAssetID {
			return false
		}
		companionLocalAssetID := strings.TrimSpace(binding.CompanionLocalAssetID)
		companionAssetID := strings.TrimSpace(binding.CompanionAssetID)
		if companionLocalAssetID == "" && companionAssetID == "" {
			mainCount++
			if mainCount != 1 ||
				strings.TrimSpace(binding.CompanionKind) != "" ||
				strings.TrimSpace(binding.EngineSlot) != "" ||
				strings.TrimSpace(binding.ParentAssetID) != "" {
				return false
			}
			continue
		}
		if companionLocalAssetID == "" ||
			companionAssetID == "" ||
			strings.TrimSpace(binding.CompanionKind) == "" ||
			strings.TrimSpace(binding.EngineSlot) == "" ||
			strings.TrimSpace(binding.ParentAssetID) != mainAssetID {
			return false
		}
		companion := s.assets[companionLocalAssetID]
		if !profileEntryStaticConfigAssetUsable(companion) ||
			strings.TrimSpace(companion.GetAssetId()) != companionAssetID {
			return false
		}
	}
	return mainCount == 1
}

func durableLocalAssetReadinessRef(localAssetID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(localAssetID)))
	return localAssetReadinessRefPrefix + hex.EncodeToString(sum[:])
}

func localAssetTargetReason(asset *runtimev1.LocalAssetRecord) runtimev1.ReasonCode {
	if asset != nil && asset.GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return asset.GetReasonCode()
	}
	if asset != nil && asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	return runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
}

func cloneDurableLocalTargetRef(target *runtimeidentity.LocalTarget) *runtimeidentity.LocalTarget {
	return target.Clone()
}

func durableLocalTargetInvalidError() error {
	return grpcerr.WrapWithReasonCode(
		codes.InvalidArgument,
		runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		ErrDurableLocalTargetInvalid,
		grpcerr.ReasonOptions{},
	)
}

func durableLocalTargetUnavailableError() error {
	return grpcerr.WrapWithReasonCode(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
		ErrDurableLocalTargetUnavailable,
		grpcerr.ReasonOptions{},
	)
}

func durableLocalTargetCapabilityMismatchError() error {
	return grpcerr.WrapWithReasonCode(
		codes.InvalidArgument,
		runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
		ErrDurableLocalTargetCapabilityMismatch,
		grpcerr.ReasonOptions{},
	)
}
