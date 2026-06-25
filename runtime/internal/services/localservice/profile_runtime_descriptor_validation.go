package localservice

import (
	"encoding/json"
	"strings"
)

var profileRuntimeDescriptorForbiddenFields = map[string]struct{}{
	"RuntimeRouteBinding":          {},
	"selectedBindings":             {},
	"selected_source_records":      {},
	"selectedSourceRecords":        {},
	"install_evidence":             {},
	"installEvidence":              {},
	"materialization_evidence":     {},
	"materializationEvidence":      {},
	"workflow_binding_id":          {},
	"workflowBindingId":            {},
	"backend_environment_evidence": {},
	"backendEnvironmentEvidence":   {},
	"scheduler_state":              {},
	"schedulerState":               {},
	"provider_health":              {},
	"providerHealth":               {},
	"credential_payload":           {},
	"credentialPayload":            {},
	"secret":                       {},
	"token":                        {},
	"api_key":                      {},
	"apiKey":                       {},
	"endpoint":                     {},
	"localModelId":                 {},
	"goRuntimeLocalModelId":        {},
}

func validateProfileRuntimeDescriptor(raw []byte) (*profileRuntimeDescriptor, error) {
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, profileRuntimeDescriptorError("descriptor.invalid_json", err.Error())
	}
	if err := rejectProfileRuntimeForbiddenPayload(object, "descriptor"); err != nil {
		return nil, err
	}
	var descriptor profileRuntimeDescriptor
	if err := json.Unmarshal(raw, &descriptor); err != nil {
		return nil, profileRuntimeDescriptorError("descriptor.schema_invalid", err.Error())
	}
	if descriptor.SchemaVersion != profileRuntimeDescriptorSchemaVersion {
		return nil, profileRuntimeDescriptorError("descriptor.schema_version_unsupported", "unsupported descriptor schema version")
	}
	required := map[string]string{
		"descriptor_id":          descriptor.DescriptorID,
		"profile_ref.profile_id": descriptor.ProfileRef.ProfileID,
		"source_profile_digest":  descriptor.SourceProfileDigest,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return nil, profileRuntimeDescriptorError("descriptor.required_field_missing", field)
		}
	}
	if len(descriptor.RequirementRefs) == 0 {
		return nil, profileRuntimeDescriptorError("descriptor.required_field_missing", "requirement_refs")
	}
	if len(descriptor.CapabilitySlices) == 0 {
		return nil, profileRuntimeDescriptorError("descriptor.required_field_missing", "capability_slices")
	}
	seenSliceIDs := map[string]struct{}{}
	for index := range descriptor.CapabilitySlices {
		if err := validateProfileRuntimeDescriptorSlice(&descriptor.CapabilitySlices[index]); err != nil {
			return nil, err
		}
		sliceID := strings.TrimSpace(descriptor.CapabilitySlices[index].SliceID)
		if _, ok := seenSliceIDs[sliceID]; ok {
			return nil, profileRuntimeDescriptorError("descriptor.slice.duplicate_slice_id", sliceID)
		}
		seenSliceIDs[sliceID] = struct{}{}
	}
	seenAssetBindingIDs := map[string]struct{}{}
	for index := range descriptor.AssetBindings {
		if err := validateProfileRuntimeDescriptorAssetBinding(&descriptor.AssetBindings[index]); err != nil {
			return nil, err
		}
		bindingID := strings.TrimSpace(descriptor.AssetBindings[index].BindingID)
		if _, ok := seenAssetBindingIDs[bindingID]; ok {
			return nil, profileRuntimeDescriptorError("descriptor.asset_binding.duplicate_binding_id", bindingID)
		}
		seenAssetBindingIDs[bindingID] = struct{}{}
	}
	assetBindingsByID := profileRuntimeAssetBindingsByID(descriptor.AssetBindings)
	for index := range descriptor.CapabilitySlices {
		if err := validateProfileRuntimeRequiredCompanionSlots(&descriptor.CapabilitySlices[index], assetBindingsByID); err != nil {
			return nil, err
		}
	}
	return &descriptor, nil
}

func validateProfileRuntimeDescriptorSlice(slice *profileRuntimeDescriptorCapability) error {
	if strings.TrimSpace(slice.SliceID) == "" || strings.TrimSpace(slice.Capability) == "" ||
		strings.TrimSpace(slice.ContractState) == "" || strings.TrimSpace(slice.ReadinessPolicy) == "" ||
		strings.TrimSpace(slice.ParamsRef) == "" {
		return profileRuntimeDescriptorError("descriptor.slice.required_field_missing", "slice_id/capability/contract_state/readiness_policy/params_ref")
	}
	if slice.ContractState != "declared" && slice.ContractState != "proposed" && slice.ContractState != "unsupported" {
		return profileRuntimeDescriptorError("descriptor.slice.contract_state_invalid", slice.ContractState)
	}
	if slice.ReadinessPolicy != "required" && slice.ReadinessPolicy != "optional" {
		return profileRuntimeDescriptorError("descriptor.slice.readiness_policy_invalid", slice.ReadinessPolicy)
	}
	switch slice.ExecutionMode {
	case "local":
		if strings.TrimSpace(slice.Execution.Backend) == "" {
			return profileRuntimeDescriptorError("descriptor.execution_backend_missing", slice.SliceID)
		}
		if strings.TrimSpace(slice.Model.Family) == "" {
			return profileRuntimeDescriptorError("descriptor.model_family_missing", slice.SliceID)
		}
		if err := validateProfileRuntimeWorkflowContract(slice); err != nil {
			return err
		}
	case "cloud_connector":
		if strings.TrimSpace(slice.Provider) == "" || strings.TrimSpace(slice.ProviderCapability) == "" ||
			strings.TrimSpace(slice.ModelID) == "" || strings.TrimSpace(slice.CredentialPolicy) == "" {
			return profileRuntimeDescriptorError("descriptor.cloud_connector_required_field_missing", slice.SliceID)
		}
	default:
		return profileRuntimeDescriptorError("descriptor.execution_mode_invalid", slice.ExecutionMode)
	}
	return validateProfileRuntimeOrderedCompanions(slice.OrderedCompanionOccurrences)
}

func validateProfileRuntimeWorkflowContract(slice *profileRuntimeDescriptorCapability) error {
	backend := strings.TrimSpace(slice.Execution.Backend)
	family := strings.TrimSpace(slice.Model.Family)
	capability := strings.TrimSpace(slice.Capability)
	switch backend {
	case "stablediffusion-ggml":
		if capability != "image.generate" {
			return profileRuntimeDescriptorError("descriptor.capability_backend_mismatch", capability)
		}
		if !profileRuntimeWorkflowFamilyAllowed(family, "flux", "ideogram4", "sdxl", "z-image", "z-image-turbo") {
			return profileRuntimeDescriptorError("profile_model_family_mismatch", family)
		}
	case "diffusers":
		if capability != "image.generate" {
			return profileRuntimeDescriptorError("descriptor.capability_backend_mismatch", capability)
		}
		if !profileRuntimeWorkflowFamilyAllowed(family, "flux", "sdxl") {
			return profileRuntimeDescriptorError("profile_model_family_mismatch", family)
		}
	case "video.pipeline":
		if capability != "video.generate" {
			return profileRuntimeDescriptorError("workflow.video_backend_unavailable", capability)
		}
		if !profileRuntimeWorkflowFamilyAllowed(family, "video-diffusion", "wan") {
			return profileRuntimeDescriptorError("profile_model_family_mismatch", family)
		}
	case "llama.cpp":
		if capability != "text.generate" {
			return profileRuntimeDescriptorError("descriptor.capability_backend_mismatch", capability)
		}
	default:
		return profileRuntimeDescriptorError("profile_backend_mismatch", backend)
	}
	return nil
}

func profileRuntimeWorkflowFamilyAllowed(family string, allowed ...string) bool {
	normalized := normalizeProfileRuntimeImageModelFamily(family)
	for _, candidate := range allowed {
		if normalized == normalizeProfileRuntimeImageModelFamily(candidate) {
			return true
		}
	}
	return false
}

func validateProfileRuntimeRequiredCompanionSlots(
	slice *profileRuntimeDescriptorCapability,
	assetBindings map[string]profileRuntimeDescriptorAssetBinding,
) error {
	if strings.TrimSpace(slice.Execution.Backend) != "stablediffusion-ggml" ||
		strings.TrimSpace(slice.Capability) != "image.generate" {
		return nil
	}
	requiredSlots := profileRuntimeRequiredImageCompanionSlots(slice.Model.Family)
	if len(requiredSlots) == 0 {
		return nil
	}
	declaredRequiredSlots := map[string]profileRuntimeDescriptorCompanionOccurrence{}
	for _, occurrence := range slice.OrderedCompanionOccurrences {
		if !occurrence.Required {
			continue
		}
		slot := strings.TrimSpace(occurrence.EngineSlot)
		if slot != "" {
			declaredRequiredSlots[slot] = occurrence
		}
	}
	for _, required := range requiredSlots {
		occurrence, ok := declaredRequiredSlots[required.EngineSlot]
		if !ok {
			return profileRuntimeDescriptorError(
				"descriptor.required_companion_slot_missing",
				normalizeProfileRuntimeImageModelFamily(slice.Model.Family)+":"+required.EngineSlot,
			)
		}
		if !strings.EqualFold(strings.TrimSpace(occurrence.Role), required.Role) {
			return profileRuntimeDescriptorError(
				"descriptor.required_companion_slot_mismatch",
				normalizeProfileRuntimeImageModelFamily(slice.Model.Family)+":"+required.EngineSlot+":role",
			)
		}
		binding, ok := assetBindings[strings.TrimSpace(occurrence.AssetBindingRef)]
		if !ok {
			return profileRuntimeDescriptorError(
				"descriptor.required_companion_binding_missing",
				normalizeProfileRuntimeImageModelFamily(slice.Model.Family)+":"+required.EngineSlot,
			)
		}
		if !strings.EqualFold(strings.TrimSpace(binding.ComponentKind), required.ComponentKind) {
			return profileRuntimeDescriptorError(
				"descriptor.required_companion_slot_mismatch",
				normalizeProfileRuntimeImageModelFamily(slice.Model.Family)+":"+required.EngineSlot+":component_kind",
			)
		}
	}
	return nil
}

func validateProfileRuntimeOrderedCompanions(companions []profileRuntimeDescriptorCompanionOccurrence) error {
	seen := map[string]struct{}{}
	seenOrder := map[int]struct{}{}
	for _, occurrence := range companions {
		if strings.TrimSpace(occurrence.OccurrenceID) == "" || strings.TrimSpace(occurrence.Role) == "" ||
			strings.TrimSpace(occurrence.EngineSlot) == "" || strings.TrimSpace(occurrence.AssetBindingRef) == "" {
			return profileRuntimeDescriptorError("descriptor.ordered_companion.required_field_missing", occurrence.OccurrenceID)
		}
		key := strings.TrimSpace(occurrence.OccurrenceID)
		if _, ok := seen[key]; ok {
			return profileRuntimeDescriptorError("descriptor.ordered_companion.duplicate_occurrence", key)
		}
		seen[key] = struct{}{}
		if occurrence.Order < 0 || occurrence.Order >= len(companions) {
			return profileRuntimeDescriptorError("descriptor.ordered_companion.order_invalid", key)
		}
		if _, ok := seenOrder[occurrence.Order]; ok {
			return profileRuntimeDescriptorError("descriptor.ordered_companion.order_duplicate", key)
		}
		seenOrder[occurrence.Order] = struct{}{}
	}
	return nil
}

func validateProfileRuntimeDescriptorAssetBinding(binding *profileRuntimeDescriptorAssetBinding) error {
	if strings.TrimSpace(binding.BindingID) == "" || strings.TrimSpace(binding.AssetRole) == "" ||
		strings.TrimSpace(binding.ComponentKind) == "" || strings.TrimSpace(binding.Source) == "" ||
		strings.TrimSpace(binding.ExpectedIdentity) == "" || strings.TrimSpace(binding.ReadinessPolicy) == "" {
		return profileRuntimeDescriptorError("descriptor.asset_binding.required_field_missing", binding.BindingID)
	}
	if binding.ReadinessPolicy != "required" && binding.ReadinessPolicy != "optional" {
		return profileRuntimeDescriptorError("descriptor.asset_binding.readiness_policy_invalid", binding.BindingID)
	}
	switch binding.Source {
	case "huggingface":
		if binding.HuggingFace == nil || strings.TrimSpace(binding.HuggingFace.RepoID) == "" ||
			strings.TrimSpace(binding.HuggingFace.Revision) == "" || len(binding.HuggingFace.Entries) == 0 {
			return profileRuntimeDescriptorError("descriptor.asset_binding.huggingface_required_field_missing", binding.BindingID)
		}
		switch binding.HuggingFace.AccessPolicy {
		case "public", "requires_auth", "gated", "unknown":
		default:
			return profileRuntimeDescriptorError("descriptor.asset_binding.huggingface_access_policy_invalid", binding.BindingID)
		}
	case "manual":
		if binding.Manual == nil || strings.TrimSpace(binding.Manual.ExpectedName) == "" ||
			strings.TrimSpace(binding.Manual.AssociationInstructions) == "" {
			return profileRuntimeDescriptorError("descriptor.asset_binding.manual_required_field_missing", binding.BindingID)
		}
	default:
		return profileRuntimeDescriptorError("descriptor.asset_binding.source_invalid", binding.Source)
	}
	return nil
}
