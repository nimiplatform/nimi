package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const profileRuntimeMaterializationKeyPrefix = "profile_workflow:"

func (s *Service) profileRuntimePrepareFactsForDescriptor(descriptor *profileRuntimeDescriptor) profileRuntimePrepareFacts {
	if s == nil || descriptor == nil {
		return profileRuntimePrepareFacts{}
	}
	facts := profileRuntimePrepareFacts{}
	nativeBackendEnvironmentKeys := s.profileRuntimeNativeBackendEnvironmentKeysForDescriptor(descriptor)
	s.mu.RLock()
	for _, record := range s.localEnvironmentSelectedSources {
		if strings.TrimSpace(record.DependencyFamily) != localEnvironmentFamilyNativeSDCPP {
			continue
		}
		if len(nativeBackendEnvironmentKeys) == 0 {
			continue
		}
		if _, ok := nativeBackendEnvironmentKeys[strings.TrimSpace(record.EnvironmentKey)]; !ok {
			continue
		}
		packageSource, packageFormat, launchMode := profileRuntimeNativeBackendPackageSourceFormatAndLaunchMode(record)
		supportedModelFamilies := profileRuntimeNativeBackendPackageSupportedModelFamilies(record)
		state := localEnvironmentStateReadyManaged
		if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
			state = localEnvironmentStateRepairRequired
		} else if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
			state = localEnvironmentStateRepairRequired
		}
		facts.NativeBackendPackages = append(facts.NativeBackendPackages, profileRuntimeNativeBackendPackageFact{
			BackendName:            "stablediffusion-ggml",
			DependencyFamily:       record.DependencyFamily,
			DependencyID:           record.DependencyID,
			SelectedConsumers:      normalizeStringSlice(record.SelectedConsumers),
			State:                  state,
			SourceKind:             record.SourceKind,
			PackageSource:          packageSource,
			PackageFormat:          packageFormat,
			LaunchMode:             launchMode,
			SelectedSourceRecordID: record.RecordID,
			CanonicalRoot:          record.CanonicalRoot,
			VerifiedArtifacts:      normalizeStringSlice(record.VerifiedArtifacts),
			SupportedModelFamilies: supportedModelFamilies,
		})
	}
	bindingsByPreparedID := map[string]profileRuntimeDescriptorAssetBinding{}
	for _, binding := range descriptor.AssetBindings {
		if preparedID := strings.TrimSpace(binding.PreparedAssetID); preparedID != "" {
			bindingsByPreparedID[preparedID] = binding
		}
	}
	for _, asset := range s.assets {
		if asset == nil {
			continue
		}
		preparedID := strings.TrimSpace(asset.GetLocalAssetId())
		binding := bindingsByPreparedID[preparedID]
		status := asset.GetStatus()
		admitted := status == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED ||
			status == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
		kind := ""
		if token, err := localAssetKindToken(effectiveAssetKind(asset.GetKind(), asset.GetCapabilities())); err == nil {
			kind = token
		}
		facts.PreparedAssets = append(facts.PreparedAssets, profileRuntimePreparedAssetFact{
			PreparedAssetID: preparedID,
			AssetID:         strings.TrimSpace(asset.GetAssetId()),
			LocalAssetID:    preparedID,
			LogicalModelID:  effectiveLocalComponentPublicIdentity(asset),
			Kind:            kind,
			Role:            strings.TrimSpace(binding.AssetRole),
			Status:          status.String(),
			Admitted:        admitted,
			SourceReady:     admitted,
		})
	}
	s.mu.RUnlock()
	return facts
}

func (s *Service) profileRuntimeNativeBackendEnvironmentKeysForDescriptor(descriptor *profileRuntimeDescriptor) map[string]struct{} {
	if s == nil || descriptor == nil {
		return nil
	}
	runtimeDataRoot := s.localEnvironmentRuntimeDataRoot()
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	platformTuple := localEnvironmentPlatformTuple(hostState)
	keys := map[string]struct{}{}
	for _, slice := range descriptor.CapabilitySlices {
		dependencyID, _, ok := profileRuntimeNativeImageBackendRequirement(slice)
		if !ok {
			continue
		}
		key := localEnvironmentKey(localEnvironmentFamilyNativeSDCPP, dependencyID, hostState.HostProfileID, platformTuple, runtimeDataRoot)
		keys[key] = struct{}{}
	}
	if len(keys) == 0 {
		return nil
	}
	return keys
}

func profileRuntimeNativeBackendPackageSourceFormatAndLaunchMode(record localEnvironmentSelectedSourceRecordState) (string, string, string) {
	packageSource := strings.TrimSpace(record.Version)
	packageFormat := ""
	launchMode := ""
	for _, item := range record.CompatibilityEvidence {
		trimmed := strings.TrimSpace(item)
		if strings.HasPrefix(trimmed, "package_source=") {
			packageSource = strings.TrimSpace(strings.TrimPrefix(trimmed, "package_source="))
		}
		if strings.HasPrefix(trimmed, "package_format=") {
			packageFormat = strings.TrimSpace(strings.TrimPrefix(trimmed, "package_format="))
		}
		if strings.HasPrefix(trimmed, "launch_mode=") {
			launchMode = strings.TrimSpace(strings.TrimPrefix(trimmed, "launch_mode="))
		}
	}
	return packageSource, packageFormat, launchMode
}

func profileRuntimeNativeBackendPackageSupportedModelFamilies(record localEnvironmentSelectedSourceRecordState) []string {
	for _, item := range record.CompatibilityEvidence {
		trimmed := strings.TrimSpace(item)
		if !strings.HasPrefix(trimmed, "supported_model_families=") {
			continue
		}
		return normalizeStringSlice(strings.Split(strings.TrimSpace(strings.TrimPrefix(trimmed, "supported_model_families=")), ","))
	}
	return nil
}

func profileRuntimeMaterializationCacheKey(
	descriptor *profileRuntimeDescriptor,
	slice profileRuntimeDescriptorCapability,
	bindings map[string]profileRuntimeDescriptorAssetBinding,
) (string, error) {
	if descriptor == nil {
		return "", profileRuntimeDescriptorError("cache.descriptor_missing", "descriptor")
	}
	if strings.TrimSpace(slice.SliceID) == "" || strings.TrimSpace(slice.Execution.Backend) == "" || strings.TrimSpace(slice.Model.Family) == "" {
		return "", profileRuntimeDescriptorError("cache.workflow_binding_identity_missing", slice.SliceID)
	}
	material := map[string]any{
		"profile_ref":           descriptor.ProfileRef,
		"source_profile_digest": descriptor.SourceProfileDigest,
		"requirement_refs":      descriptor.RequirementRefs,
		"slice_id":              slice.SliceID,
		"capability":            slice.Capability,
		"execution_backend":     slice.Execution.Backend,
		"model_family":          slice.Model.Family,
		"params_digest":         slice.ParamsDigest,
		"environment_digest":    slice.EnvironmentDigest,
	}
	assetIDs := []string{}
	for _, assetRef := range slice.AssetRefs {
		binding := bindings[assetRef]
		assetIDs = append(assetIDs, strings.TrimSpace(binding.PreparedAssetID))
	}
	material["prepared_asset_ids"] = assetIDs
	companionMaterial := make([]map[string]any, 0, len(slice.OrderedCompanionOccurrences))
	for _, companion := range slice.OrderedCompanionOccurrences {
		binding := bindings[companion.AssetBindingRef]
		companionMaterial = append(companionMaterial, map[string]any{
			"occurrence_id":     companion.OccurrenceID,
			"order":             companion.Order,
			"role":              companion.Role,
			"engine_slot":       companion.EngineSlot,
			"asset_binding_ref": companion.AssetBindingRef,
			"prepared_asset_id": strings.TrimSpace(binding.PreparedAssetID),
			"weight":            companion.Weight,
			"options":           companion.Options,
		})
	}
	material["ordered_companion_occurrences"] = companionMaterial
	raw, err := json.Marshal(material)
	if err != nil {
		return "", profileRuntimeDescriptorError("cache.identity_marshal_failed", err.Error())
	}
	sum := sha256.Sum256(raw)
	return profileRuntimeMaterializationKeyPrefix + hex.EncodeToString(sum[:]), nil
}

func rejectProfileRuntimeForbiddenPayload(value any, path string) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if profileRuntimeDescriptorFieldIsForbidden(key) {
				return profileRuntimeDescriptorError("descriptor.forbidden_host_local_field", path+"."+key)
			}
			if err := rejectProfileRuntimeForbiddenPayload(child, path+"."+key); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range typed {
			if err := rejectProfileRuntimeForbiddenPayload(child, fmt.Sprintf("%s[%d]", path, index)); err != nil {
				return err
			}
		}
	case string:
		if profileRuntimeDescriptorStringIsPathLike(typed) {
			return profileRuntimeDescriptorError("descriptor.forbidden_host_local_field", path)
		}
	}
	return nil
}

func profileRuntimeDescriptorStringIsPathLike(value string) bool {
	trimmed := strings.TrimSpace(value)
	return strings.HasPrefix(trimmed, "/") ||
		strings.HasPrefix(trimmed, "~") ||
		strings.HasPrefix(trimmed, "file://") ||
		strings.Contains(trimmed, `\`) ||
		strings.Contains(trimmed, "/Users/") ||
		strings.Contains(trimmed, "/tmp/") ||
		strings.Contains(trimmed, "/var/")
}

func profileRuntimeDescriptorError(reason string, detail string) error {
	message := reason
	if strings.TrimSpace(detail) != "" {
		message += ": " + strings.TrimSpace(detail)
	}
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{
		Message:    message,
		ActionHint: "provide_valid_profile_runtime_descriptor",
	})
}

func uniqueSortedStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	set := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		set[trimmed] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func profileRuntimeStringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
