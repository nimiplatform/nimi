package localservice

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func (s *Service) ResolveProfile(_ context.Context, req *runtimev1.ResolveProfileRequest) (*runtimev1.ResolveProfileResponse, error) {
	// K-SCHED-004: auto-register profile in the runtime-side registry so that
	// the scheduling dependency feasibility checker can look it up by identity.
	if profile := req.GetProfile(); profile != nil {
		modID := strings.TrimSpace(req.GetModId())
		profileID := strings.TrimSpace(profile.GetId())
		if profileID != "" && s.profileRegistry != nil {
			s.profileRegistry.RegisterProfile(modID, profileID, profile)
		}
	}
	return &runtimev1.ResolveProfileResponse{
		Plan: s.resolveProfilePlan(req),
	}, nil
}

func (s *Service) ApplyProfile(ctx context.Context, req *runtimev1.ApplyProfileRequest) (*runtimev1.ApplyProfileResponse, error) {
	return &runtimev1.ApplyProfileResponse{
		Result: s.applyProfileStrict(ctx, req.GetPlan()),
	}, nil
}

func nextProfilePlanID(modID string, profileID string) string {
	modSlug := slug(defaultString(modID, "mod"))
	profileSlug := slug(defaultString(profileID, "profile"))
	return "profile_plan_" + modSlug + "_" + profileSlug + "_" + ulid.Make().String()
}

func profileEntryMatchesCapability(entry *runtimev1.LocalProfileEntryDescriptor, capability string) bool {
	if entry == nil {
		return false
	}
	capabilityFilter := strings.TrimSpace(capability)
	if capabilityFilter == "" {
		return true
	}
	entryCapability := strings.TrimSpace(entry.GetCapability())
	return entryCapability == "" || strings.EqualFold(entryCapability, capabilityFilter)
}

func profileEntryIsAsset(entry *runtimev1.LocalProfileEntryDescriptor) bool {
	return entry != nil && entry.GetKind() == runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET
}

func profileEntryHasEngineSlot(entry *runtimev1.LocalProfileEntryDescriptor) bool {
	return entry != nil && strings.TrimSpace(entry.GetEngineSlot()) != ""
}

func profileEntryUsesCanonicalImageResolution(entry *runtimev1.LocalProfileEntryDescriptor) bool {
	if !profileEntryIsAsset(entry) {
		return false
	}
	if entry.GetAssetKind() == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(entry.GetCapability()), "image")
}

func assetKindMatchesCapability(kind runtimev1.LocalAssetKind, capability string) bool {
	cap := normalizeLocalCapabilityToken(capability)
	if cap == "" {
		return isRunnableKind(kind)
	}
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT:
		return cap == "text.generate"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING:
		return cap == "text.embed"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE:
		return cap == "image.generate"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO:
		return cap == "video.generate"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS:
		return cap == "audio.synthesize"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT:
		return cap == "audio.transcribe"
	default:
		return false
	}
}

func profileEntryRequired(entry *runtimev1.LocalProfileEntryDescriptor) bool {
	if entry == nil || entry.Required == nil {
		return true
	}
	return entry.GetRequired()
}

func profileEntryToDependencyOption(entry *runtimev1.LocalProfileEntryDescriptor) *runtimev1.LocalExecutionOptionDescriptor {
	if entry == nil {
		return nil
	}
	kind := runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_MODEL
	switch entry.GetKind() {
	case runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_SERVICE:
		kind = runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_SERVICE
	case runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_NODE:
		kind = runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_NODE
	}

	return &runtimev1.LocalExecutionOptionDescriptor{
		EntryId:    strings.TrimSpace(entry.GetEntryId()),
		Kind:       kind,
		Capability: strings.TrimSpace(entry.GetCapability()),
		Title:      strings.TrimSpace(entry.GetTitle()),
		ModelId:    strings.TrimSpace(entry.GetAssetId()),
		Repo:       strings.TrimSpace(entry.GetRepo()),
		ServiceId:  strings.TrimSpace(entry.GetServiceId()),
		NodeId:     strings.TrimSpace(entry.GetNodeId()),
		Engine:     strings.TrimSpace(entry.GetEngine()),
	}
}

// entryOverrideIndex builds a lookup map from entry_id -> local_asset_id
// for entry overrides supplied by the caller.
func entryOverrideIndex(overrides []*runtimev1.ProfileEntryOverride) map[string]string {
	if len(overrides) == 0 {
		return nil
	}
	idx := make(map[string]string, len(overrides))
	for _, o := range overrides {
		if o == nil {
			continue
		}
		entryID := strings.TrimSpace(o.GetEntryId())
		localAssetID := strings.TrimSpace(o.GetLocalAssetId())
		if entryID != "" && localAssetID != "" {
			idx[entryID] = localAssetID
		}
	}
	if len(idx) == 0 {
		return nil
	}
	return idx
}

func bridgeProfileToDependencyDeclaration(
	profile *runtimev1.LocalProfileDescriptor,
	capability string,
	overrides map[string]string,
) *runtimev1.LocalExecutionDeclarationDescriptor {
	declaration := &runtimev1.LocalExecutionDeclarationDescriptor{
		Required:     []*runtimev1.LocalExecutionOptionDescriptor{},
		Optional:     []*runtimev1.LocalExecutionOptionDescriptor{},
		Alternatives: []*runtimev1.LocalExecutionAlternativeDescriptor{},
		Preferred:    map[string]string{},
	}
	if profile == nil {
		return declaration
	}

	for _, entry := range profile.GetEntries() {
		if !profileEntryMatchesCapability(entry, capability) {
			continue
		}
		if profileEntryIsAsset(entry) && profileEntryHasEngineSlot(entry) {
			continue
		}

		option := profileEntryToDependencyOption(entry)
		if option == nil {
			continue
		}
		// Apply entry override: when an override exists for this entry_id,
		// use the overridden local_asset_id as the ModelId.
		if overriddenAssetID, ok := overrides[option.GetEntryId()]; ok {
			option.ModelId = overriddenAssetID
		}
		if profileEntryRequired(entry) {
			declaration.Required = append(declaration.Required, option)
		} else {
			declaration.Optional = append(declaration.Optional, option)
		}
	}

	return declaration
}

func (s *Service) resolveProfilePlan(req *runtimev1.ResolveProfileRequest) *runtimev1.LocalProfileResolutionPlan {
	planID := nextProfilePlanID("", "")
	if req == nil {
		return &runtimev1.LocalProfileResolutionPlan{
			PlanId:     planID,
			Warnings:   []string{"resolve profile request is required"},
			ReasonCode: "LOCAL_PROFILE_REQUEST_REQUIRED",
		}
	}

	modID := strings.TrimSpace(req.GetModId())
	profile := cloneProfileDescriptor(req.GetProfile())
	capability := strings.TrimSpace(req.GetCapability())
	deviceProfile := cloneDeviceProfile(req.GetDeviceProfile())
	if deviceProfile == nil {
		deviceProfile = collectDeviceProfile()
	}

	profileID := ""
	title := ""
	description := ""
	recommended := false
	consumeCapabilities := []string{}
	requirements := (*runtimev1.LocalProfileRequirementDescriptor)(nil)
	warnings := []string{}
	if profile == nil {
		warnings = append(warnings, "profile descriptor is required")
	} else {
		profileID = strings.TrimSpace(profile.GetId())
		title = strings.TrimSpace(profile.GetTitle())
		description = strings.TrimSpace(profile.GetDescription())
		recommended = profile.GetRecommended()
		consumeCapabilities = normalizeStringSlice(profile.GetConsumeCapabilities())
		requirements = cloneProfileRequirement(profile.GetRequirements())
		if profileID == "" {
			warnings = append(warnings, "profile.id is required")
		}
		if title == "" {
			warnings = append(warnings, "profile.title is required")
		}
	}

	planID = nextProfilePlanID(modID, profileID)
	overrides := entryOverrideIndex(req.GetEntryOverrides())
	declaration := bridgeProfileToDependencyDeclaration(profile, capability, overrides)
	executionPlan := resolveExecutionPlan(&executionResolveRequest{
		modID:         modID,
		capability:    capability,
		entries:       declaration,
		deviceProfile: cloneDeviceProfile(deviceProfile),
	})
	appendPassiveAssetEntriesToExecutionPlan(executionPlan, profile, capability, overrides)
	executionPlan.PlanId = planID
	executionPlan.ModId = modID
	executionPlan.Capability = capability
	executionPlan.DeviceProfile = cloneDeviceProfile(deviceProfile)

	warnings = append(warnings, executionPlan.GetWarnings()...)
	warnings = normalizeStringSlice(warnings)
	reasonCode := strings.TrimSpace(executionPlan.GetReasonCode())
	switch {
	case profile == nil:
		reasonCode = "LOCAL_PROFILE_REQUIRED"
	case profileID == "":
		reasonCode = "LOCAL_PROFILE_ID_REQUIRED"
	case title == "":
		reasonCode = "LOCAL_PROFILE_TITLE_REQUIRED"
	case reasonCode == "":
		reasonCode = "ACTION_EXECUTED"
	}

	return &runtimev1.LocalProfileResolutionPlan{
		PlanId:              planID,
		ModId:               modID,
		ProfileId:           profileID,
		Title:               title,
		Description:         description,
		Recommended:         recommended,
		ConsumeCapabilities: consumeCapabilities,
		Requirements:        requirements,
		ExecutionPlan:       executionPlan,
		Warnings:            warnings,
		ReasonCode:          reasonCode,
	}
}

func appendPassiveAssetEntriesToExecutionPlan(
	plan *runtimev1.LocalExecutionPlan,
	profile *runtimev1.LocalProfileDescriptor,
	capability string,
	overrides map[string]string,
) {
	if plan == nil || profile == nil {
		return
	}
	for _, entry := range profile.GetEntries() {
		if !profileEntryMatchesCapability(entry, capability) || !profileEntryIsAsset(entry) || !profileEntryHasEngineSlot(entry) {
			continue
		}
		modelID := strings.TrimSpace(entry.GetAssetId())
		if overrideLocalAssetID, ok := overrides[strings.TrimSpace(entry.GetEntryId())]; ok && strings.TrimSpace(overrideLocalAssetID) != "" {
			modelID = strings.TrimSpace(overrideLocalAssetID)
		}
		descriptor := &runtimev1.LocalExecutionEntryDescriptor{
			EntryId:    strings.TrimSpace(entry.GetEntryId()),
			Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_MODEL,
			Capability: strings.TrimSpace(entry.GetCapability()),
			Required:   profileEntryRequired(entry),
			Selected:   true,
			Preferred:  false,
			ModelId:    modelID,
			Repo:       strings.TrimSpace(entry.GetRepo()),
			Engine:     strings.TrimSpace(entry.GetEngine()),
			ReasonCode: "LOCAL_DEPENDENCY_PASSIVE_SELECTED",
			Warnings:   []string{},
		}
		plan.Entries = append(plan.GetEntries(), descriptor)
		plan.SelectionRationale = append(plan.GetSelectionRationale(), &runtimev1.LocalExecutionSelectionRationale{
			EntryId:    descriptor.GetEntryId(),
			Selected:   true,
			ReasonCode: "LOCAL_DEPENDENCY_PASSIVE_SELECTED",
			Detail:     "slot-bound asset bypasses execution resolver and is applied directly",
		})
		plan.PreflightDecisions = append(plan.GetPreflightDecisions(), &runtimev1.LocalPreflightDecision{
			EntryId:    descriptor.GetEntryId(),
			Target:     preflightTargetForDependency(descriptor),
			Check:      "dependency-shape",
			Ok:         true,
			ReasonCode: "LOCAL_DEPENDENCY_PASSIVE_SELECTED",
			Detail:     "slot-bound asset queued for direct apply",
		})
	}
}

func (s *Service) applyProfileStrict(ctx context.Context, plan *runtimev1.LocalProfileResolutionPlan) *runtimev1.LocalProfileApplyResult {
	if plan == nil {
		return &runtimev1.LocalProfileApplyResult{
			InstalledAssets: []*runtimev1.LocalAssetRecord{},
			Warnings:        []string{"profile plan is required"},
			ReasonCode:      "LOCAL_PROFILE_PLAN_REQUIRED",
		}
	}

	result := &runtimev1.LocalProfileApplyResult{
		PlanId:          strings.TrimSpace(plan.GetPlanId()),
		ModId:           strings.TrimSpace(plan.GetModId()),
		ProfileId:       strings.TrimSpace(plan.GetProfileId()),
		ExecutionResult: cloneDependencyApplyResult(s.applyExecutionPlanStrict(ctx, plan.GetExecutionPlan())),
		InstalledAssets: []*runtimev1.LocalAssetRecord{},
		Warnings:        append([]string(nil), plan.GetWarnings()...),
		ReasonCode:      "ACTION_EXECUTED",
	}
	if result.ExecutionResult != nil {
		result.ReasonCode = strings.TrimSpace(result.ExecutionResult.GetReasonCode())
	}

	// Passive asset installation now happens as part of the execution plan apply
	// (dependency_apply.go stage 2). Collect passive installed assets from
	// the execution result into the profile result for backward compatibility.
	if result.ExecutionResult != nil {
		for _, asset := range result.ExecutionResult.GetInstalledAssets() {
			if asset != nil && asset.GetKind() >= runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE {
				result.InstalledAssets = append(result.InstalledAssets, cloneLocalAsset(asset))
			}
		}
	}

	result.Warnings = normalizeStringSlice(result.Warnings)
	if result.ReasonCode == "" {
		result.ReasonCode = "ACTION_EXECUTED"
	}
	return result
}

func (s *Service) resolveVerifiedAssetForProfileEntry(entry *runtimev1.LocalProfileEntryDescriptor) *runtimev1.LocalVerifiedAssetDescriptor {
	if entry == nil {
		return nil
	}
	templateID := strings.TrimSpace(entry.GetTemplateId())
	assetID := strings.TrimSpace(entry.GetAssetId())
	engine := strings.TrimSpace(entry.GetEngine())
	if profileEntryUsesCanonicalImageResolution(entry) {
		engine = ""
	}
	assetKind := entry.GetAssetKind()

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, item := range s.verified {
		if item == nil {
			continue
		}
		if templateID != "" && item.GetTemplateId() == templateID {
			return cloneVerifiedAsset(item)
		}
		if assetID != "" && item.GetAssetId() != assetID {
			continue
		}
		if assetKind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED && effectiveAssetKind(item.GetKind(), item.GetCapabilities()) != assetKind {
			continue
		}
		if engine != "" && !strings.EqualFold(item.GetEngine(), engine) {
			continue
		}
		if assetID != "" || assetKind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED || engine != "" {
			return cloneVerifiedAsset(item)
		}
	}
	return nil
}

// resolveVerifiedByAssetIDAndEngine looks up a verified asset descriptor by
// assetId and engine. Used by dependency_apply to detect passive assets
// (kind >= VAE) during the install stage.
func (s *Service) resolveVerifiedByAssetIDAndEngine(assetID string, engine string) *runtimev1.LocalVerifiedAssetDescriptor {
	normalizedID := strings.TrimSpace(assetID)
	normalizedEngine := strings.TrimSpace(engine)
	if normalizedID == "" {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, item := range s.verified {
		if item == nil {
			continue
		}
		if item.GetAssetId() != normalizedID {
			continue
		}
		if normalizedEngine != "" && !strings.EqualFold(item.GetEngine(), normalizedEngine) {
			continue
		}
		return cloneVerifiedAsset(item)
	}
	return nil
}

func (s *Service) findInstalledAssetForProfileEntry(entry *runtimev1.LocalProfileEntryDescriptor) *runtimev1.LocalAssetRecord {
	if entry == nil {
		return nil
	}
	assetID := strings.TrimSpace(entry.GetAssetId())
	engine := strings.TrimSpace(entry.GetEngine())
	if profileEntryUsesCanonicalImageResolution(entry) {
		engine = ""
	}
	assetKind := entry.GetAssetKind()
	if descriptor := s.resolveVerifiedAssetForProfileEntry(entry); descriptor != nil {
		if assetID == "" {
			assetID = strings.TrimSpace(descriptor.GetAssetId())
		}
		if assetKind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
			assetKind = descriptor.GetKind()
		}
		if engine == "" && !profileEntryUsesCanonicalImageResolution(entry) {
			engine = strings.TrimSpace(descriptor.GetEngine())
		}
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, existing := range s.assets {
		if existing == nil || existing.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if assetID != "" && existing.GetAssetId() != assetID {
			continue
		}
		if assetKind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED && effectiveAssetKind(existing.GetKind(), existing.GetCapabilities()) != assetKind {
			continue
		}
		if engine != "" && !strings.EqualFold(existing.GetEngine(), engine) {
			continue
		}
		if assetID != "" || assetKind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED || engine != "" {
			return cloneLocalAsset(existing)
		}
	}
	return nil
}
