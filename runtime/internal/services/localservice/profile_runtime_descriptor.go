package localservice

import (
	"context"
	"sort"
	"strings"
)

const profileRuntimeDescriptorSchemaVersion = 1

type profileRuntimeDescriptor struct {
	SchemaVersion       int                                    `json:"schema_version"`
	DescriptorID        string                                 `json:"descriptor_id"`
	ProfileRef          profileRuntimeDescriptorProfileRef     `json:"profile_ref"`
	SourceProfileDigest string                                 `json:"source_profile_digest"`
	ProjectionOrigin    map[string]any                         `json:"projection_origin"`
	RequirementRefs     []string                               `json:"requirement_refs"`
	CapabilitySlices    []profileRuntimeDescriptorCapability   `json:"capability_slices"`
	AssetBindings       []profileRuntimeDescriptorAssetBinding `json:"asset_bindings,omitempty"`
	DefaultParams       map[string]any                         `json:"default_params,omitempty"`
	EditableFields      []string                               `json:"editable_fields,omitempty"`
	PrepareRequirements []string                               `json:"prepare_requirements,omitempty"`
	ContractStates      []string                               `json:"contract_states,omitempty"`
	ProjectionWarnings  []string                               `json:"projection_warnings,omitempty"`
}

type profileRuntimeDescriptorProfileRef struct {
	ProfileID string `json:"profile_id"`
	Version   string `json:"version,omitempty"`
	Revision  string `json:"revision,omitempty"`
}

type profileRuntimeDescriptorCapability struct {
	SliceID                     string                                        `json:"slice_id"`
	Capability                  string                                        `json:"capability"`
	ExecutionMode               string                                        `json:"execution_mode"`
	ContractState               string                                        `json:"contract_state"`
	ReadinessPolicy             string                                        `json:"readiness_policy"`
	ParamsRef                   string                                        `json:"params_ref"`
	RuntimeConsumerID           string                                        `json:"runtime_consumer_id,omitempty"`
	ConsumerID                  string                                        `json:"consumer_id,omitempty"`
	ConsumerScope               string                                        `json:"consumer_scope,omitempty"`
	Execution                   profileRuntimeDescriptorExecution             `json:"execution,omitempty"`
	Model                       profileRuntimeDescriptorModel                 `json:"model,omitempty"`
	Provider                    string                                        `json:"provider,omitempty"`
	ProviderCapability          string                                        `json:"provider_capability,omitempty"`
	ModelID                     string                                        `json:"model_id,omitempty"`
	CredentialPolicy            string                                        `json:"credential_policy,omitempty"`
	ConnectorSelector           string                                        `json:"connector_selector,omitempty"`
	AssetRefs                   []string                                      `json:"asset_refs,omitempty"`
	OrderedCompanionOccurrences []profileRuntimeDescriptorCompanionOccurrence `json:"ordered_companion_occurrences,omitempty"`
	ParamsDigest                string                                        `json:"params_digest,omitempty"`
	EnvironmentDigest           string                                        `json:"environment_digest,omitempty"`
	Extra                       map[string]any                                `json:"-"`
}

type profileRuntimeDescriptorExecution struct {
	Backend       string `json:"backend,omitempty"`
	BackendClass  string `json:"backend_class,omitempty"`
	BackendFamily string `json:"backend_family,omitempty"`
	ConsumerID    string `json:"consumer_id,omitempty"`
	ConsumerScope string `json:"consumer_scope,omitempty"`
}

type profileRuntimeDescriptorModel struct {
	Family string `json:"family,omitempty"`
}

type profileRuntimeDescriptorCompanionOccurrence struct {
	OccurrenceID    string         `json:"occurrence_id"`
	Order           int            `json:"order"`
	Role            string         `json:"role"`
	EngineSlot      string         `json:"engineSlot"`
	AssetBindingRef string         `json:"asset_binding_ref"`
	Required        bool           `json:"required"`
	Weight          string         `json:"weight,omitempty"`
	Options         map[string]any `json:"options,omitempty"`
	AppliesTo       []string       `json:"applies_to,omitempty"`
	PreparedAssetID string         `json:"prepared_asset_id,omitempty"`
}

type profileRuntimeDescriptorAssetBinding struct {
	BindingID        string                                `json:"binding_id"`
	AssetRole        string                                `json:"asset_role"`
	ComponentKind    string                                `json:"component_kind"`
	Source           string                                `json:"source"`
	ExpectedIdentity string                                `json:"expected_identity"`
	ReadinessPolicy  string                                `json:"readiness_policy"`
	HuggingFace      *profileRuntimeDescriptorHFSource     `json:"huggingface,omitempty"`
	Manual           *profileRuntimeDescriptorManualSource `json:"manual,omitempty"`
	PreparedAssetID  string                                `json:"prepared_asset_id,omitempty"`
}

type profileRuntimePrepareFacts struct {
	NativeBackendPackages []profileRuntimeNativeBackendPackageFact
	PreparedAssets        []profileRuntimePreparedAssetFact
}

type profileRuntimeNativeBackendPackageFact struct {
	BackendName            string
	DependencyFamily       string
	DependencyID           string
	SelectedConsumers      []string
	State                  string
	SourceKind             string
	PackageSource          string
	PackageFormat          string
	LaunchMode             string
	SelectedSourceRecordID string
	CanonicalRoot          string
	VerifiedArtifacts      []string
	SupportedModelFamilies []string
}

type profileRuntimePreparedAssetFact struct {
	PreparedAssetID string
	AssetID         string
	LocalAssetID    string
	Kind            string
	Role            string
	Status          string
	Admitted        bool
	SourceReady     bool
}

type profileRuntimeDescriptorHFSource struct {
	RepoID            string   `json:"repo_id"`
	Revision          string   `json:"revision"`
	Entries           []string `json:"entries"`
	AccessPolicy      string   `json:"access_policy"`
	ExpectedIntegrity string   `json:"expected_integrity,omitempty"`
}

type profileRuntimeDescriptorManualSource struct {
	ExpectedName            string   `json:"expected_name"`
	AssociationInstructions string   `json:"association_instructions"`
	AllowedFilePatterns     []string `json:"allowed_file_patterns,omitempty"`
	ExpectedIntegrity       string   `json:"expected_integrity,omitempty"`
	RiskLabel               string   `json:"risk_label,omitempty"`
}

type profileRuntimePrepareOutcome string

const (
	profileRuntimePrepareReady                     profileRuntimePrepareOutcome = "ready"
	profileRuntimePrepareSetupRequiredNoLiveConfig profileRuntimePrepareOutcome = "setup_required_no_live_config"
	profileRuntimePrepareUnsupportedNoLiveConfig   profileRuntimePrepareOutcome = "unsupported_no_live_config"
	profileRuntimePrepareFailedNoLiveConfig        profileRuntimePrepareOutcome = "failed_no_live_config"
	profileRuntimePrepareOptionalOmitted           profileRuntimePrepareOutcome = "optional_omitted"
)

type profileRuntimePrepareSliceResult struct {
	SliceID              string
	Capability           string
	Outcome              profileRuntimePrepareOutcome
	ReasonCodes          []string
	MaterializationKey   string
	WorkflowBindingID    string
	ReusableAssetHealthy bool
}

type ProfileRuntimeDescriptorPrepareRequest struct {
	DescriptorJSON []byte
}

type ProfileRuntimeDescriptorPrepareResult struct {
	DescriptorID   string
	ProfileID      string
	SliceResults   []ProfileRuntimeDescriptorPrepareSliceResult
	RequirementIDs []string
}

type ProfileRuntimeDescriptorPrepareSliceResult struct {
	SliceID              string
	Capability           string
	Outcome              string
	ReasonCodes          []string
	MaterializationKey   string
	WorkflowBindingID    string
	ReusableAssetHealthy bool
}

func (s *Service) prepareProfileRuntimeDescriptor(
	ctx context.Context,
	req ProfileRuntimeDescriptorPrepareRequest,
) (*ProfileRuntimeDescriptorPrepareResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	if len(req.DescriptorJSON) == 0 {
		return nil, profileRuntimeDescriptorError("descriptor.required_field_missing", "descriptor_json")
	}
	descriptor, err := validateProfileRuntimeDescriptor(req.DescriptorJSON)
	if err != nil {
		return nil, err
	}
	facts := s.profileRuntimePrepareFactsForDescriptor(descriptor)
	results, err := prepareProfileRuntimeDescriptorWithFacts(descriptor, facts)
	if err != nil {
		return nil, err
	}
	if err := s.projectProfileRuntimeDescriptorMaterialization(descriptor, facts, results); err != nil {
		return nil, err
	}
	out := &ProfileRuntimeDescriptorPrepareResult{
		DescriptorID:   descriptor.DescriptorID,
		ProfileID:      descriptor.ProfileRef.ProfileID,
		RequirementIDs: append([]string(nil), descriptor.RequirementRefs...),
		SliceResults:   make([]ProfileRuntimeDescriptorPrepareSliceResult, 0, len(results)),
	}
	for _, result := range results {
		out.SliceResults = append(out.SliceResults, ProfileRuntimeDescriptorPrepareSliceResult{
			SliceID:              result.SliceID,
			Capability:           result.Capability,
			Outcome:              string(result.Outcome),
			ReasonCodes:          append([]string(nil), result.ReasonCodes...),
			MaterializationKey:   result.MaterializationKey,
			WorkflowBindingID:    result.WorkflowBindingID,
			ReusableAssetHealthy: result.ReusableAssetHealthy,
		})
	}
	return out, nil
}

func (s *Service) projectProfileRuntimeDescriptorMaterialization(
	descriptor *profileRuntimeDescriptor,
	facts profileRuntimePrepareFacts,
	results []profileRuntimePrepareSliceResult,
) error {
	if s == nil || descriptor == nil {
		return nil
	}
	bindings := profileRuntimeAssetBindingsByID(descriptor.AssetBindings)
	resultsBySliceID := make(map[string]profileRuntimePrepareSliceResult, len(results))
	for _, result := range results {
		resultsBySliceID[strings.TrimSpace(result.SliceID)] = result
	}
	for _, slice := range descriptor.CapabilitySlices {
		if !profileRuntimeSliceSupportsImageMaterializationProjection(slice) {
			continue
		}
		result, ok := resultsBySliceID[strings.TrimSpace(slice.SliceID)]
		if !ok || result.Outcome != profileRuntimePrepareReady || strings.TrimSpace(result.MaterializationKey) == "" {
			continue
		}
		mainLocalAssetID, materializationBindings, err := profileRuntimeDescriptorMaterializationBindings(slice, bindings, facts)
		if err != nil {
			return err
		}
		s.cacheManagedMediaImageProfileResolution(
			mainLocalAssetID,
			result.MaterializationKey,
			nil,
			true,
			materializationBindings,
		)
	}
	return nil
}

func profileRuntimeSliceSupportsImageMaterializationProjection(slice profileRuntimeDescriptorCapability) bool {
	return strings.TrimSpace(slice.ExecutionMode) == "local" &&
		strings.TrimSpace(slice.ContractState) == "declared" &&
		strings.TrimSpace(slice.Execution.Backend) == "stablediffusion-ggml" &&
		strings.TrimSpace(slice.Capability) == "image.generate"
}

func profileRuntimeDescriptorMaterializationBindings(
	slice profileRuntimeDescriptorCapability,
	bindings map[string]profileRuntimeDescriptorAssetBinding,
	facts profileRuntimePrepareFacts,
) (string, []managedMediaProfileMaterializationBinding, error) {
	_, mainFact, err := profileRuntimeDescriptorMainAssetFact(slice, bindings, facts)
	if err != nil {
		return "", nil, err
	}
	mainAssetID := strings.TrimSpace(mainFact.AssetID)
	mainLocalAssetID := strings.TrimSpace(mainFact.LocalAssetID)
	if mainLocalAssetID == "" {
		mainLocalAssetID = strings.TrimSpace(mainFact.PreparedAssetID)
	}
	if mainAssetID == "" || mainLocalAssetID == "" {
		return "", nil, profileRuntimeDescriptorError("materialization.main_asset_identity_missing", slice.SliceID)
	}
	materializationBindings := []managedMediaProfileMaterializationBinding{
		{
			AssetID:      mainAssetID,
			LocalAssetID: mainLocalAssetID,
		},
	}
	companions := append([]profileRuntimeDescriptorCompanionOccurrence(nil), slice.OrderedCompanionOccurrences...)
	sort.SliceStable(companions, func(i, j int) bool {
		return companions[i].Order < companions[j].Order
	})
	for _, companion := range companions {
		binding, ok := bindings[strings.TrimSpace(companion.AssetBindingRef)]
		if !ok {
			if companion.Required {
				return "", nil, profileRuntimeDescriptorError("materialization.required_companion_missing", companion.OccurrenceID)
			}
			continue
		}
		if strings.TrimSpace(binding.AssetRole) != "companion" {
			return "", nil, profileRuntimeDescriptorError("materialization.required_companion_unassociated", companion.OccurrenceID)
		}
		companionFact, err := profileRuntimeReadyFactForBinding(binding, facts)
		if err != nil {
			if companion.Required {
				return "", nil, err
			}
			continue
		}
		if preparedID := strings.TrimSpace(companion.PreparedAssetID); preparedID != "" && preparedID != strings.TrimSpace(binding.PreparedAssetID) {
			return "", nil, profileRuntimeDescriptorError("materialization.required_companion_unassociated", companion.OccurrenceID)
		}
		companionAssetID := strings.TrimSpace(companionFact.AssetID)
		if companionAssetID == "" {
			return "", nil, profileRuntimeDescriptorError("materialization.companion_asset_identity_missing", companion.OccurrenceID)
		}
		materializationBindings = append(materializationBindings, managedMediaProfileMaterializationBinding{
			AssetID:          mainAssetID,
			LocalAssetID:     mainLocalAssetID,
			CompanionKind:    profileRuntimeDescriptorCompanionKind(binding),
			EngineSlot:       strings.TrimSpace(companion.EngineSlot),
			CompanionAssetID: companionAssetID,
			ParentAssetID:    mainAssetID,
		})
	}
	return mainLocalAssetID, materializationBindings, nil
}

func profileRuntimeDescriptorMainAssetFact(
	slice profileRuntimeDescriptorCapability,
	bindings map[string]profileRuntimeDescriptorAssetBinding,
	facts profileRuntimePrepareFacts,
) (profileRuntimeDescriptorAssetBinding, profileRuntimePreparedAssetFact, error) {
	var mainBinding profileRuntimeDescriptorAssetBinding
	var mainFact profileRuntimePreparedAssetFact
	found := false
	for _, assetRef := range slice.AssetRefs {
		binding, ok := bindings[strings.TrimSpace(assetRef)]
		if !ok {
			return profileRuntimeDescriptorAssetBinding{}, profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.main_asset_binding_missing", assetRef)
		}
		if strings.TrimSpace(binding.AssetRole) != "main" {
			continue
		}
		fact, err := profileRuntimeReadyFactForBinding(binding, facts)
		if err != nil {
			return profileRuntimeDescriptorAssetBinding{}, profileRuntimePreparedAssetFact{}, err
		}
		if found {
			return profileRuntimeDescriptorAssetBinding{}, profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.main_asset_ambiguous", slice.SliceID)
		}
		mainBinding = binding
		mainFact = fact
		found = true
	}
	if !found {
		return profileRuntimeDescriptorAssetBinding{}, profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.main_asset_binding_missing", slice.SliceID)
	}
	return mainBinding, mainFact, nil
}

func profileRuntimeReadyFactForBinding(binding profileRuntimeDescriptorAssetBinding, facts profileRuntimePrepareFacts) (profileRuntimePreparedAssetFact, error) {
	fact, ok := profileRuntimePreparedAssetFactForBinding(binding, facts)
	if !ok {
		if strings.TrimSpace(binding.AssetRole) == "companion" {
			return profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.required_companion_unadmitted", binding.BindingID)
		}
		return profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.prepared_asset_not_admitted", binding.BindingID)
	}
	if strings.TrimSpace(binding.ExpectedIdentity) == "" || strings.TrimSpace(fact.AssetID) != strings.TrimSpace(binding.ExpectedIdentity) {
		return profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.prepared_asset_identity_mismatch", binding.BindingID)
	}
	if !profileRuntimePreparedAssetKindMatches(fact.Kind, binding.ComponentKind) {
		return profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.prepared_asset_kind_mismatch", binding.BindingID)
	}
	if strings.TrimSpace(fact.Role) != "" && strings.TrimSpace(fact.Role) != strings.TrimSpace(binding.AssetRole) {
		return profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.prepared_asset_role_mismatch", binding.BindingID)
	}
	if !fact.Admitted {
		return profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.prepared_asset_not_admitted", binding.BindingID)
	}
	if !fact.SourceReady {
		return profileRuntimePreparedAssetFact{}, profileRuntimeDescriptorError("materialization.prepared_asset_source_unready", binding.BindingID)
	}
	return fact, nil
}

func profileRuntimeDescriptorCompanionKind(binding profileRuntimeDescriptorAssetBinding) string {
	return strings.ToLower(strings.TrimSpace(binding.ComponentKind))
}

func profileRuntimeAssetBindingsByID(bindings []profileRuntimeDescriptorAssetBinding) map[string]profileRuntimeDescriptorAssetBinding {
	out := make(map[string]profileRuntimeDescriptorAssetBinding, len(bindings))
	for _, binding := range bindings {
		out[strings.TrimSpace(binding.BindingID)] = binding
	}
	return out
}
