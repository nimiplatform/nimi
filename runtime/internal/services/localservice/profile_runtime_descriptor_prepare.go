package localservice

import "strings"

func prepareProfileRuntimeDescriptor(descriptor *profileRuntimeDescriptor) ([]profileRuntimePrepareSliceResult, error) {
	return prepareProfileRuntimeDescriptorWithFacts(descriptor, profileRuntimePrepareFacts{})
}

func prepareProfileRuntimeDescriptorWithFacts(descriptor *profileRuntimeDescriptor, facts profileRuntimePrepareFacts) ([]profileRuntimePrepareSliceResult, error) {
	if descriptor == nil {
		return nil, profileRuntimeDescriptorError("descriptor.required_field_missing", "descriptor")
	}
	bindings := map[string]profileRuntimeDescriptorAssetBinding{}
	for _, binding := range descriptor.AssetBindings {
		bindings[binding.BindingID] = binding
	}
	results := make([]profileRuntimePrepareSliceResult, 0, len(descriptor.CapabilitySlices))
	for _, slice := range descriptor.CapabilitySlices {
		result := profileRuntimePrepareSliceResult{
			SliceID:              slice.SliceID,
			Capability:           slice.Capability,
			ReusableAssetHealthy: true,
		}
		reasons := profileRuntimeSliceNoLiveConfigReasons(slice, bindings, facts)
		if len(reasons) == 0 {
			if slice.ExecutionMode == "local" {
				key, err := profileRuntimeMaterializationCacheKey(descriptor, slice, bindings)
				if err != nil {
					return nil, err
				}
				result.MaterializationKey = key
				result.WorkflowBindingID = "workflow_binding:" + key
			}
			result.Outcome = profileRuntimePrepareReady
		} else if slice.ReadinessPolicy == "optional" {
			result.Outcome = profileRuntimePrepareOptionalOmitted
			result.ReasonCodes = reasons
		} else if profileRuntimeStringSliceContains(reasons, "product_state_unsupported") {
			result.Outcome = profileRuntimePrepareUnsupportedNoLiveConfig
			result.ReasonCodes = reasons
		} else {
			result.Outcome = profileRuntimePrepareSetupRequiredNoLiveConfig
			result.ReasonCodes = reasons
		}
		results = append(results, result)
	}
	return results, nil
}

func profileRuntimeSliceNoLiveConfigReasons(slice profileRuntimeDescriptorCapability, bindings map[string]profileRuntimeDescriptorAssetBinding, facts profileRuntimePrepareFacts) []string {
	reasons := []string{}
	switch slice.ContractState {
	case "proposed":
		reasons = append(reasons, "product_state_proposed")
	case "unsupported":
		reasons = append(reasons, "product_state_unsupported")
	}
	if slice.Execution.Backend == "diffusers" {
		reasons = append(reasons, "environment_materializer_unready")
	}
	if slice.Execution.Backend == "video.pipeline" {
		reasons = append(reasons, "environment_video_materializer_unready", "workflow_video_backend_unavailable")
	}
	if slice.ExecutionMode == "local" && slice.Execution.Backend == "stablediffusion-ggml" {
		reasons = append(reasons, profileRuntimeNativeImageBackendReadinessReasons(slice, facts)...)
	}
	if slice.ExecutionMode == "cloud_connector" && slice.CredentialPolicy != "runtime_custody_ready" {
		reasons = append(reasons, "credentials_required")
	}
	for _, assetRef := range slice.AssetRefs {
		binding, ok := bindings[assetRef]
		if !ok {
			reasons = append(reasons, "workflow_required_component_missing")
			continue
		}
		reasons = append(reasons, profileRuntimeAssetBindingReadinessReasons(binding, facts)...)
	}
	for _, companion := range slice.OrderedCompanionOccurrences {
		binding, ok := bindings[companion.AssetBindingRef]
		if !ok {
			if companion.Required {
				reasons = append(reasons, "required_companion_missing")
			}
			continue
		}
		if binding.AssetRole != "companion" {
			reasons = append(reasons, "required_companion_unassociated")
		}
		if companion.PreparedAssetID != "" && strings.TrimSpace(companion.PreparedAssetID) != strings.TrimSpace(binding.PreparedAssetID) {
			reasons = append(reasons, "required_companion_unassociated")
		}
		if companion.Required {
			reasons = append(reasons, profileRuntimeAssetBindingReadinessReasons(binding, facts)...)
		}
	}
	return uniqueSortedStrings(reasons)
}

func profileRuntimeNativeImageBackendReadinessReasons(slice profileRuntimeDescriptorCapability, facts profileRuntimePrepareFacts) []string {
	dependencyID, consumer, ok := profileRuntimeNativeImageBackendRequirement(slice)
	if !ok {
		return []string{"native_backend_package_consumer_unresolved"}
	}
	fallback := []string{"native_backend_package_source_missing"}
	for _, pkg := range facts.NativeBackendPackages {
		if strings.TrimSpace(pkg.BackendName) != "stablediffusion-ggml" {
			continue
		}
		if strings.TrimSpace(pkg.DependencyFamily) != "" && strings.TrimSpace(pkg.DependencyFamily) != localEnvironmentFamilyNativeSDCPP {
			continue
		}
		if strings.TrimSpace(pkg.DependencyID) != dependencyID {
			continue
		}
		if !stringSliceContains(pkg.SelectedConsumers, consumer) {
			fallback = []string{"native_backend_package_consumer_mismatch"}
			continue
		}
		if strings.TrimSpace(pkg.State) != localEnvironmentStateReadyManaged {
			fallback = []string{"native_backend_package_not_ready"}
			continue
		}
		if strings.TrimSpace(pkg.SourceKind) != localEnvironmentSourceManaged {
			fallback = []string{"native_backend_package_source_not_canonical_oci"}
			continue
		}
		contract, ok := nativeSDCPPPackageContractForConsumer(consumer)
		if !ok ||
			strings.TrimSpace(pkg.PackageSource) != contract.PackageSource ||
			strings.TrimSpace(pkg.PackageFormat) != contract.PackageFormat ||
			strings.TrimSpace(pkg.LaunchMode) != contract.LaunchMode {
			fallback = []string{"native_backend_package_source_not_supported"}
			continue
		}
		if strings.TrimSpace(pkg.SelectedSourceRecordID) == "" ||
			strings.TrimSpace(pkg.CanonicalRoot) == "" ||
			len(normalizeStringSlice(pkg.VerifiedArtifacts)) == 0 {
			fallback = []string{"native_backend_package_materialization_evidence_missing"}
			continue
		}
		if !profileRuntimeNativeBackendPackageSupportsModelFamily(pkg, slice.Model.Family) {
			fallback = []string{"native_backend_package_model_family_unsupported"}
			continue
		}
		return nil
	}
	return fallback
}

func profileRuntimeNativeBackendPackageSupportsModelFamily(pkg profileRuntimeNativeBackendPackageFact, family string) bool {
	normalizedFamily := normalizeProfileRuntimeImageModelFamily(family)
	if normalizedFamily == "" {
		return false
	}
	supportedFamilies := normalizeStringSlice(pkg.SupportedModelFamilies)
	if len(supportedFamilies) == 0 {
		return false
	}
	for _, supported := range supportedFamilies {
		if normalizeProfileRuntimeImageModelFamily(supported) == normalizedFamily {
			return true
		}
	}
	return false
}

func profileRuntimeAssetBindingReadinessReasons(binding profileRuntimeDescriptorAssetBinding, facts profileRuntimePrepareFacts) []string {
	if strings.TrimSpace(binding.PreparedAssetID) != "" {
		if fact, ok := profileRuntimePreparedAssetFactForBinding(binding, facts); ok {
			if !profileRuntimePreparedAssetIdentityMatches(binding, fact) {
				return []string{"prepared_asset_identity_mismatch"}
			}
			if !profileRuntimePreparedAssetKindMatches(fact.Kind, binding.ComponentKind) {
				return []string{"prepared_asset_kind_mismatch"}
			}
			if strings.TrimSpace(fact.Role) != "" && strings.TrimSpace(fact.Role) != strings.TrimSpace(binding.AssetRole) {
				return []string{"prepared_asset_role_mismatch"}
			}
			if !fact.Admitted {
				return []string{"prepared_asset_not_admitted"}
			}
			if !fact.SourceReady {
				return []string{"prepared_asset_source_unready"}
			}
			return nil
		}
		if binding.AssetRole == "companion" {
			return []string{"required_companion_unadmitted"}
		}
		return []string{"prepared_asset_not_admitted"}
	}
	if binding.AssetRole == "companion" && binding.Source == "manual" {
		return []string{"required_companion_unassociated"}
	}
	if binding.Source == "huggingface" && binding.HuggingFace != nil {
		switch binding.HuggingFace.AccessPolicy {
		case "requires_auth":
			return []string{"credentials_required"}
		case "gated":
			return []string{"hf_terms_required"}
		case "unknown":
			return []string{"source_readiness_unknown"}
		}
	}
	if binding.Source == "manual" {
		return []string{"manual_association_required"}
	}
	return []string{"required_asset_missing"}
}

func profileRuntimePreparedAssetFactForBinding(binding profileRuntimeDescriptorAssetBinding, facts profileRuntimePrepareFacts) (profileRuntimePreparedAssetFact, bool) {
	preparedID := strings.TrimSpace(binding.PreparedAssetID)
	if preparedID == "" {
		return profileRuntimePreparedAssetFact{}, false
	}
	for _, fact := range facts.PreparedAssets {
		if strings.TrimSpace(fact.PreparedAssetID) == preparedID ||
			strings.TrimSpace(fact.LocalAssetID) == preparedID {
			return fact, true
		}
	}
	return profileRuntimePreparedAssetFact{}, false
}

func profileRuntimePreparedAssetKindMatches(factKind string, componentKind string) bool {
	normalizedFact := strings.ToLower(strings.TrimSpace(factKind))
	normalizedComponent := strings.ToLower(strings.TrimSpace(componentKind))
	if normalizedComponent == "" {
		return false
	}
	return normalizedFact == normalizedComponent || strings.HasSuffix(normalizedFact, "_"+normalizedComponent)
}

func profileRuntimeNativeImageBackendRequirement(slice profileRuntimeDescriptorCapability) (string, string, bool) {
	if strings.TrimSpace(slice.Execution.Backend) != "stablediffusion-ggml" || strings.TrimSpace(slice.Capability) != "image.generate" {
		return "", "", false
	}
	consumer := strings.TrimSpace(slice.RuntimeConsumerID)
	if consumer == "" {
		return "", "", false
	}
	if _, ok := nativeSDCPPPackageContractForConsumer(consumer); !ok {
		return "", "", false
	}
	return "stable-diffusion.cpp.package", consumer, true
}

func nativeSDCPPPackageContractForConsumer(consumer string) (nativeSDCPPPackageContract, bool) {
	switch strings.TrimSpace(consumer) {
	case "stable-diffusion.cpp.metal":
		return nativeSDCPPPackageContract{
			Consumer:      "stable-diffusion.cpp.metal",
			PackageSource: "canonical_localai_derived",
			PackageFormat: "oci_payload",
			LaunchMode:    "package_entrypoint",
		}, true
	case "stable-diffusion.cpp.cuda":
		return nativeSDCPPPackageContract{
			Consumer:      "stable-diffusion.cpp.cuda",
			PackageSource: "canonical_runtime_wrapper",
			PackageFormat: "direct_archive",
			LaunchMode:    "runtime_wrapper",
		}, true
	default:
		return nativeSDCPPPackageContract{}, false
	}
}
