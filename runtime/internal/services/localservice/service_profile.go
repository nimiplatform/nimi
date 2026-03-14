package localservice

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func (s *Service) ResolveProfile(_ context.Context, req *runtimev1.ResolveProfileRequest) (*runtimev1.ResolveProfileResponse, error) {
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

func profileEntryIsArtifact(entry *runtimev1.LocalProfileEntryDescriptor) bool {
	return entry != nil && entry.GetKind() == runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ARTIFACT
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
		EntryId: strings.TrimSpace(entry.GetEntryId()),
		Kind:         kind,
		Capability:   strings.TrimSpace(entry.GetCapability()),
		Title:        strings.TrimSpace(entry.GetTitle()),
		ModelId:      strings.TrimSpace(entry.GetModelId()),
		Repo:         strings.TrimSpace(entry.GetRepo()),
		ServiceId:    strings.TrimSpace(entry.GetServiceId()),
		NodeId:       strings.TrimSpace(entry.GetNodeId()),
		Engine:       strings.TrimSpace(entry.GetEngine()),
	}
}

func bridgeProfileToDependencyDeclaration(
	profile *runtimev1.LocalProfileDescriptor,
	capability string,
) (*runtimev1.LocalExecutionDeclarationDescriptor, []*runtimev1.LocalProfileArtifactPlanEntry) {
	declaration := &runtimev1.LocalExecutionDeclarationDescriptor{
		Required:     []*runtimev1.LocalExecutionOptionDescriptor{},
		Optional:     []*runtimev1.LocalExecutionOptionDescriptor{},
		Alternatives: []*runtimev1.LocalExecutionAlternativeDescriptor{},
		Preferred:    map[string]string{},
	}
	artifactEntries := make([]*runtimev1.LocalProfileArtifactPlanEntry, 0)
	if profile == nil {
		return declaration, artifactEntries
	}

	for _, entry := range profile.GetEntries() {
		if !profileEntryMatchesCapability(entry, capability) {
			continue
		}
		if profileEntryIsArtifact(entry) {
			artifactEntries = append(artifactEntries, &runtimev1.LocalProfileArtifactPlanEntry{
				Entry: cloneProfileEntryDescriptor(entry),
			})
			continue
		}

		option := profileEntryToDependencyOption(entry)
		if option == nil {
			continue
		}
		if profileEntryRequired(entry) {
			declaration.Required = append(declaration.Required, option)
			continue
		}
		declaration.Optional = append(declaration.Optional, option)
	}

	return declaration, artifactEntries
}

func (s *Service) resolveProfilePlan(req *runtimev1.ResolveProfileRequest) *runtimev1.LocalProfileResolutionPlan {
	planID := nextProfilePlanID("", "")
	if req == nil {
		return &runtimev1.LocalProfileResolutionPlan{
			PlanId:          planID,
			ArtifactEntries: []*runtimev1.LocalProfileArtifactPlanEntry{},
			Warnings:        []string{"resolve profile request is required"},
			ReasonCode:      "LOCAL_PROFILE_REQUEST_REQUIRED",
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
	declaration, artifactEntries := bridgeProfileToDependencyDeclaration(profile, capability)
	executionPlan := resolveExecutionPlan(&executionResolveRequest{
		modID:         modID,
		capability:    capability,
		entries:       declaration,
		deviceProfile: cloneDeviceProfile(deviceProfile),
	})
	executionPlan.PlanId = planID
	executionPlan.ModId = modID
	executionPlan.Capability = capability
	executionPlan.DeviceProfile = cloneDeviceProfile(deviceProfile)

	for _, entry := range artifactEntries {
		entry.Installed = s.findInstalledArtifactForProfileEntry(entry.GetEntry()) != nil
	}

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
		ArtifactEntries:     artifactEntries,
		Warnings:            warnings,
		ReasonCode:          reasonCode,
	}
}

func (s *Service) applyProfileStrict(ctx context.Context, plan *runtimev1.LocalProfileResolutionPlan) *runtimev1.LocalProfileApplyResult {
	if plan == nil {
		return &runtimev1.LocalProfileApplyResult{
			InstalledArtifacts: []*runtimev1.LocalArtifactRecord{},
			Warnings:           []string{"profile plan is required"},
			ReasonCode:         "LOCAL_PROFILE_PLAN_REQUIRED",
		}
	}

	result := &runtimev1.LocalProfileApplyResult{
		PlanId:             strings.TrimSpace(plan.GetPlanId()),
		ModId:              strings.TrimSpace(plan.GetModId()),
		ProfileId:          strings.TrimSpace(plan.GetProfileId()),
		ExecutionResult:    cloneDependencyApplyResult(s.applyExecutionPlanStrict(ctx, plan.GetExecutionPlan())),
		InstalledArtifacts: []*runtimev1.LocalArtifactRecord{},
		Warnings:           append([]string(nil), plan.GetWarnings()...),
		ReasonCode:         "ACTION_EXECUTED",
	}
	if result.ExecutionResult != nil {
		result.ReasonCode = strings.TrimSpace(result.ExecutionResult.GetReasonCode())
	}
	if result.ReasonCode != "" && result.ReasonCode != "ACTION_EXECUTED" {
		result.Warnings = normalizeStringSlice(result.Warnings)
		return result
	}

	for _, artifactPlanEntry := range plan.GetArtifactEntries() {
		entry := artifactPlanEntry.GetEntry()
		if entry == nil {
			result.Warnings = append(result.Warnings, "profile artifact entry is missing")
			result.ReasonCode = "LOCAL_PROFILE_ARTIFACT_ENTRY_REQUIRED"
			break
		}
		if existing := s.findInstalledArtifactForProfileEntry(entry); existing != nil {
			result.InstalledArtifacts = append(result.InstalledArtifacts, cloneLocalArtifact(existing))
			continue
		}

		templateID := strings.TrimSpace(entry.GetTemplateId())
		if templateID == "" {
			warning := fmt.Sprintf("profile artifact %s requires templateId", defaultString(entry.GetEntryId(), "artifact"))
			result.Warnings = append(result.Warnings, warning)
			if profileEntryRequired(entry) {
				result.ReasonCode = "LOCAL_PROFILE_ARTIFACT_TEMPLATE_ID_REQUIRED"
				break
			}
			continue
		}

		installed, err := s.InstallVerifiedArtifact(ctx, &runtimev1.InstallVerifiedArtifactRequest{
			TemplateId: templateID,
		})
		if err != nil || installed.GetArtifact() == nil {
			warning := fmt.Sprintf(
				"profile artifact %s install failed: %s",
				defaultString(entry.GetEntryId(), templateID),
				defaultString(fmt.Sprintf("%v", err), "artifact install returned empty response"),
			)
			result.Warnings = append(result.Warnings, warning)
			if profileEntryRequired(entry) {
				result.ReasonCode = "LOCAL_PROFILE_ARTIFACT_INSTALL_FAILED"
				break
			}
			continue
		}

		result.InstalledArtifacts = append(result.InstalledArtifacts, cloneLocalArtifact(installed.GetArtifact()))
	}

	result.Warnings = normalizeStringSlice(result.Warnings)
	if result.ReasonCode == "" {
		result.ReasonCode = "ACTION_EXECUTED"
	}
	return result
}

func (s *Service) resolveVerifiedArtifactForProfileEntry(entry *runtimev1.LocalProfileEntryDescriptor) *runtimev1.LocalVerifiedArtifactDescriptor {
	if entry == nil {
		return nil
	}
	templateID := strings.TrimSpace(entry.GetTemplateId())
	artifactID := strings.TrimSpace(entry.GetArtifactId())
	engine := strings.TrimSpace(entry.GetEngine())
	artifactKind := entry.GetArtifactKind()

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, item := range s.verifiedArtifacts {
		if item == nil {
			continue
		}
		if templateID != "" && item.GetTemplateId() == templateID {
			return cloneVerifiedArtifact(item)
		}
		if artifactID != "" && item.GetArtifactId() != artifactID {
			continue
		}
		if artifactKind != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED && item.GetKind() != artifactKind {
			continue
		}
		if engine != "" && !strings.EqualFold(item.GetEngine(), engine) {
			continue
		}
		if artifactID != "" || artifactKind != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED || engine != "" {
			return cloneVerifiedArtifact(item)
		}
	}
	return nil
}

func (s *Service) findInstalledArtifactForProfileEntry(entry *runtimev1.LocalProfileEntryDescriptor) *runtimev1.LocalArtifactRecord {
	if entry == nil {
		return nil
	}
	artifactID := strings.TrimSpace(entry.GetArtifactId())
	engine := strings.TrimSpace(entry.GetEngine())
	artifactKind := entry.GetArtifactKind()
	if descriptor := s.resolveVerifiedArtifactForProfileEntry(entry); descriptor != nil {
		if artifactID == "" {
			artifactID = strings.TrimSpace(descriptor.GetArtifactId())
		}
		if artifactKind == runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED {
			artifactKind = descriptor.GetKind()
		}
		if engine == "" {
			engine = strings.TrimSpace(descriptor.GetEngine())
		}
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, existing := range s.artifacts {
		if existing == nil || existing.GetStatus() == runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_REMOVED {
			continue
		}
		if artifactID != "" && existing.GetArtifactId() != artifactID {
			continue
		}
		if artifactKind != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED && existing.GetKind() != artifactKind {
			continue
		}
		if engine != "" && !strings.EqualFold(existing.GetEngine(), engine) {
			continue
		}
		if artifactID != "" || artifactKind != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED || engine != "" {
			return cloneLocalArtifact(existing)
		}
	}
	return nil
}
