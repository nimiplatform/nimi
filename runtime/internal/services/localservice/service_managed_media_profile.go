package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	managedMediaWorkflowProfileEntriesKey   = "profile_entries"
	managedMediaWorkflowEntryOverridesKey   = "entry_overrides"
	managedMediaWorkflowProfileOverridesKey = "profile_overrides"
)

var managedMediaRuntimeResolvedComponentOptionKeys = map[string]struct{}{
	"clip_l_path":            {},
	"llm_path":               {},
	"t5xxl_path":             {},
	"uncond_diffusion_model": {},
	"vae_path":               {},
}

type managedMediaProfileSlotAsset struct {
	EngineSlot string
	Asset      *runtimev1.LocalAssetRecord
	Path       string
}

type managedMediaProfileSlotResolution struct {
	ModelPath  string
	MainAsset  *runtimev1.LocalAssetRecord
	SlotPaths  map[string]string
	SlotAssets []managedMediaProfileSlotAsset
}

type managedMediaProfileMaterializationBinding struct {
	AssetID          string
	LocalAssetID     string
	CompanionKind    string
	EngineSlot       string
	CompanionAssetID string
	ParentAssetID    string
}

func cloneManagedMediaProfileMaterializationBindings(bindings []managedMediaProfileMaterializationBinding) []managedMediaProfileMaterializationBinding {
	if len(bindings) == 0 {
		return nil
	}
	out := make([]managedMediaProfileMaterializationBinding, len(bindings))
	copy(out, bindings)
	return out
}

// resolveProfileSlots resolves main model path and passive engine slot paths
// from the given profile entries for a specific capability. Entries without
// engineSlot whose assetKind matches the capability produce the main runnable
// model path; entries with engineSlot are passive dependencies whose installed
// asset paths are returned as slot:path pairs.
//
// overrides maps entry_id -> local_asset_id. When an override exists for an
// entry, the overridden local_asset_id is used instead of looking up by
// assetId/kind/engine.
//
// Fail-close: duplicate runnable candidates, duplicate slot bindings, missing
// or unhealthy slot assets, and invalid runnable/passive slot declarations all
// return an error instead of silently continuing.
func (s *Service) resolveProfileSlots(
	entries []*runtimev1.LocalProfileEntryDescriptor,
	capability string,
	overrides map[string]string,
	allowUnhealthyMainLocalAssetID string,
) (managedMediaProfileSlotResolution, error) {
	resolution := managedMediaProfileSlotResolution{
		SlotPaths: make(map[string]string),
	}

	for _, entry := range entries {
		if entry == nil {
			continue
		}
		if !profileEntryMatchesCapability(entry, capability) {
			continue
		}
		if !profileEntryIsAsset(entry) {
			continue
		}

		// Apply entry override: when an override exists, resolve the
		// installed asset by local_asset_id directly.
		entryID := strings.TrimSpace(entry.GetEntryId())
		overriddenLocalID := ""
		if entryID != "" && overrides != nil {
			overriddenLocalID = overrides[entryID]
		}

		slot := strings.TrimSpace(entry.GetEngineSlot())
		entryKind := entry.GetAssetKind()
		if slot == "" {
			if !assetKindMatchesCapability(entryKind, capability) {
				return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
					Message:    fmt.Sprintf("profile entry %q kind %s must declare engineSlot", entryID, entryKind.String()),
					ActionHint: "declare_profile_slot",
				})
			}
			// Main runnable model: assetKind matches capability, no engineSlot.
			if !assetKindMatchesCapability(entryKind, capability) {
				continue
			}
			if resolution.ModelPath != "" {
				return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
					Message:    fmt.Sprintf("ambiguous: multiple main models for capability %q", capability),
					ActionHint: "narrow_profile_entries",
				})
			}
			var installed *runtimev1.LocalAssetRecord
			if overriddenLocalID != "" {
				installed = s.localAssetByID(overriddenLocalID)
			} else {
				installed = s.findInstalledAssetForProfileEntry(entry)
			}
			if installed == nil {
				return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
			}
			if !profileEntryInstalledMainAssetUsable(installed, allowUnhealthyMainLocalAssetID) {
				return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
					Message:    fmt.Sprintf("main asset %q is not in a usable status", installed.GetLocalAssetId()),
					ActionHint: "inspect_local_runtime_model_health",
				})
			}
			resolved, err := s.resolveManagedAssetEntryPath(installed)
			if err != nil {
				return managedMediaProfileSlotResolution{}, err
			}
			resolution.ModelPath = resolved
			resolution.MainAsset = installed
			continue
		}

		// Slot-bound dependency: any non-main asset may bind an engineSlot,
		// including chat assets used as text encoders (for example llm_path).
		// Some backends also require runnable-kind companion weights, such as
		// Ideogram4's unconditional diffusion model.
		if assetKindMatchesCapability(entryKind, capability) && !managedMediaSlotAllowsRunnableKind(slot, entryKind, capability) {
			return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_FORBIDDEN, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("main asset entry %q kind %s cannot declare engineSlot %q", entryID, entryKind.String(), slot),
				ActionHint: "remove_profile_slot",
			})
		}
		if _, exists := resolution.SlotPaths[slot]; exists {
			return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_PROFILE_SLOT_CONFLICT, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("duplicate engineSlot binding %q in profile entries", slot),
				ActionHint: "dedupe_profile_slot_bindings",
			})
		}
		var installed *runtimev1.LocalAssetRecord
		if overriddenLocalID != "" {
			installed = s.localAssetByID(overriddenLocalID)
		} else {
			installed = s.findInstalledAssetForProfileEntry(entry)
		}
		if installed == nil {
			return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("slot %q asset is not installed", slot),
				ActionHint: "install_profile_slot_asset",
			})
		}
		if !profileEntryInstalledAssetUsable(installed) {
			return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("slot %q asset %q is not in a usable status", slot, installed.GetLocalAssetId()),
				ActionHint: "inspect_profile_slot_asset",
			})
		}
		resolved, err := s.resolveManagedAssetEntryPath(installed)
		if err != nil {
			return managedMediaProfileSlotResolution{}, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("slot %q asset path is unavailable: %v", slot, err),
				ActionHint: "inspect_profile_slot_asset",
			})
		}
		resolution.SlotPaths[slot] = resolved
		resolution.SlotAssets = append(resolution.SlotAssets, managedMediaProfileSlotAsset{
			EngineSlot: slot,
			Asset:      installed,
			Path:       resolved,
		})
	}

	if err := validateManagedMediaProfileSlotCompatibility(resolution); err != nil {
		return managedMediaProfileSlotResolution{}, err
	}
	return resolution, nil
}

func validateManagedMediaProfileSlotCompatibility(resolution managedMediaProfileSlotResolution) error {
	if resolution.MainAsset == nil {
		return nil
	}
	mainFamily := strings.TrimSpace(resolution.MainAsset.GetFamily())
	if mainFamily == "" {
		return nil
	}
	for _, slotAsset := range resolution.SlotAssets {
		if slotAsset.Asset == nil {
			continue
		}
		slot := strings.TrimSpace(slotAsset.EngineSlot)
		switch slot {
		case "vae_path":
			assetFamily := strings.TrimSpace(slotAsset.Asset.GetFamily())
			if !managedImageVAEFamilyCompatibleWithImageFamily(mainFamily, assetFamily) {
				return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE, grpcerr.ReasonOptions{
					Message:    fmt.Sprintf("slot %q asset family %q is not compatible with main image family %q", slot, assetFamily, mainFamily),
					ActionHint: "select_compatible_profile_slot_asset",
				})
			}
		}
	}
	return nil
}

func profileEntryInstalledAssetUsable(asset *runtimev1.LocalAssetRecord) bool {
	if asset == nil {
		return false
	}
	switch asset.GetStatus() {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return true
	default:
		return false
	}
}

func profileEntryInstalledMainAssetUsable(asset *runtimev1.LocalAssetRecord, allowUnhealthyMainLocalAssetID string) bool {
	if profileEntryInstalledAssetUsable(asset) {
		return true
	}
	if asset == nil {
		return false
	}
	if asset.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		return false
	}
	return strings.TrimSpace(asset.GetLocalAssetId()) != "" &&
		strings.TrimSpace(asset.GetLocalAssetId()) == strings.TrimSpace(allowUnhealthyMainLocalAssetID)
}

func managedMediaSlotAllowsRunnableKind(slot string, kind runtimev1.LocalAssetKind, capability string) bool {
	if !assetKindMatchesCapability(kind, capability) {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(slot)) {
	case "uncond_diffusion_model":
		return kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE && normalizeLocalCapabilityToken(capability) == "image.generate"
	default:
		return false
	}
}

// managedMediaProfileEntries extracts profile entries from the scenario
// extensions when supplied under the profile_entries key.
func managedMediaProfileEntries(scenarioExtensions map[string]any) []*runtimev1.LocalProfileEntryDescriptor {
	raw, ok := scenarioExtensions[managedMediaWorkflowProfileEntriesKey]
	if !ok || raw == nil {
		return nil
	}
	if typed, ok := raw.([]*runtimev1.LocalProfileEntryDescriptor); ok {
		return typed
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	entries := make([]*runtimev1.LocalProfileEntryDescriptor, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			return nil
		}
		entry, ok := managedMediaProfileEntryDescriptor(record)
		if !ok {
			return nil
		}
		entries = append(entries, entry)
	}
	if len(entries) == 0 {
		return nil
	}
	return entries
}

func managedMediaProfileEntryDescriptor(record map[string]any) (*runtimev1.LocalProfileEntryDescriptor, bool) {
	if len(record) == 0 {
		return nil, false
	}
	entryID := strings.TrimSpace(valueAsString(record["entry_id"]))
	if entryID == "" {
		entryID = strings.TrimSpace(valueAsString(record["entryId"]))
	}
	kindToken := strings.TrimSpace(valueAsString(record["kind"]))
	if entryID == "" || kindToken == "" {
		return nil, false
	}
	var kind runtimev1.LocalProfileEntryKind
	switch strings.ToLower(kindToken) {
	case "asset":
		kind = runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET
	case "service":
		kind = runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_SERVICE
	case "node":
		kind = runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_NODE
	default:
		return nil, false
	}
	assetKindToken := strings.TrimSpace(valueAsString(record["asset_kind"]))
	if assetKindToken == "" {
		assetKindToken = strings.TrimSpace(valueAsString(record["assetKind"]))
	}
	assetKind, _ := parseLocalAssetKindToken(assetKindToken)
	required := managedMediaOptionalBool(record, "required")
	preferred := managedMediaOptionalBool(record, "preferred")
	return &runtimev1.LocalProfileEntryDescriptor{
		EntryId:     entryID,
		Kind:        kind,
		Title:       strings.TrimSpace(valueAsString(record["title"])),
		Description: strings.TrimSpace(valueAsString(record["description"])),
		Capability:  strings.TrimSpace(valueAsString(record["capability"])),
		Required:    required,
		Preferred:   preferred,
		AssetId:     strings.TrimSpace(firstManagedMediaProfileValue(record, "asset_id", "assetId")),
		AssetKind:   assetKind,
		EngineSlot:  strings.TrimSpace(firstManagedMediaProfileValue(record, "engine_slot", "engineSlot")),
		Repo:        strings.TrimSpace(valueAsString(record["repo"])),
		ServiceId:   strings.TrimSpace(firstManagedMediaProfileValue(record, "service_id", "serviceId")),
		NodeId:      strings.TrimSpace(firstManagedMediaProfileValue(record, "node_id", "nodeId")),
		Engine:      strings.TrimSpace(valueAsString(record["engine"])),
		TemplateId:  strings.TrimSpace(firstManagedMediaProfileValue(record, "template_id", "templateId")),
		Revision:    strings.TrimSpace(valueAsString(record["revision"])),
		Tags:        valueAsStringSlice(record["tags"]),
	}, true
}

func firstManagedMediaProfileValue(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(valueAsString(record[key])); value != "" {
			return value
		}
	}
	return ""
}

func managedMediaOptionalBool(record map[string]any, key string) *bool {
	value, ok := record[key]
	if !ok {
		return nil
	}
	flag, ok := value.(bool)
	if !ok {
		return nil
	}
	return &flag
}

// ResolveManagedMediaImageProfile renders a dynamic managed media profile for
// the selected main model. Slot dependencies are resolved from profile entries
// supplied via the profile_entries key in scenario extensions. The workflow is
// hard-cut and does not fall back to the model's own entry path.
func (s *Service) ResolveManagedMediaImageProfile(_ context.Context, requestedModelID string, scenarioExtensions map[string]any) (string, map[string]any, map[string]any, error) {
	model := s.resolveManagedMediaImageModel(requestedModelID)
	if model == nil {
		return "", nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	profileOverrides, err := managedMediaProfileOverrides(scenarioExtensions)
	if err != nil {
		return "", nil, nil, err
	}
	if err := validateManagedMediaProfileOverrides(profileOverrides); err != nil {
		return "", nil, nil, err
	}

	profileEntries := managedMediaProfileEntries(scenarioExtensions)
	entryOverrides, err := managedMediaEntryOverrides(scenarioExtensions)
	if err != nil {
		return "", nil, nil, err
	}

	profile := managedMediaNormalizeImageProfile(model, mergeMaps(structToMap(model.GetEngineConfig()), profileOverrides))

	var modelPath string
	slotPaths := map[string]string{}
	materializationBindings := []managedMediaProfileMaterializationBinding{}
	materializationResolved := false

	if len(profileEntries) > 0 {
		resolved, resolveErr := s.resolveProfileSlots(profileEntries, "image", entryOverrides, model.GetLocalAssetId())
		if resolveErr != nil {
			return "", nil, nil, resolveErr
		}
		materializationResolved = true
		if resolved.ModelPath != "" {
			modelPath = resolved.ModelPath
		}
		slotPaths = resolved.SlotPaths
		mainAsset := resolved.MainAsset
		if mainAsset == nil {
			mainAsset = model
		}
		parentAssetID := strings.TrimSpace(mainAsset.GetAssetId())
		materializationBindings = append(materializationBindings, managedMediaProfileMaterializationBinding{
			AssetID:      parentAssetID,
			LocalAssetID: strings.TrimSpace(mainAsset.GetLocalAssetId()),
		})
		for _, slotAsset := range resolved.SlotAssets {
			if slotAsset.Asset == nil {
				continue
			}
			companionKind, _ := localAssetKindToken(effectiveAssetKind(slotAsset.Asset.GetKind(), slotAsset.Asset.GetCapabilities()))
			materializationBindings = append(materializationBindings, managedMediaProfileMaterializationBinding{
				AssetID:          parentAssetID,
				LocalAssetID:     strings.TrimSpace(mainAsset.GetLocalAssetId()),
				CompanionKind:    companionKind,
				EngineSlot:       strings.TrimSpace(slotAsset.EngineSlot),
				CompanionAssetID: strings.TrimSpace(slotAsset.Asset.GetAssetId()),
				ParentAssetID:    parentAssetID,
			})
		}
	}

	// Fail-close: profile entries must supply the main model path for image workflow.
	if modelPath == "" {
		return "", nil, nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "image workflow requires profile entries with a main image model; no fallback to model entry path",
			ActionHint: "supply_profile_entries",
		})
	}

	parameters := valueAsObject(profile["parameters"])
	parameters["model"] = modelPath
	profile["parameters"] = parameters

	options := valueAsStringSlice(profile["options"])
	filteredOptions := make([]string, 0, len(options)+len(slotPaths))
	for _, option := range options {
		key, _, hasKV := strings.Cut(option, ":")
		if hasKV {
			key = strings.TrimSpace(key)
			if _, exists := slotPaths[key]; exists {
				continue
			}
		}
		filteredOptions = append(filteredOptions, option)
	}
	slotNames := make([]string, 0, len(slotPaths))
	for slot := range slotPaths {
		slotNames = append(slotNames, slot)
	}
	sort.Strings(slotNames)
	for _, slot := range slotNames {
		filteredOptions = append(filteredOptions, slot+":"+slotPaths[slot])
	}
	profile["options"] = filteredOptions

	profile["download_files"] = nil
	delete(profile, managedMediaWorkflowProfileEntriesKey)
	delete(profile, managedMediaWorkflowProfileOverridesKey)

	canonical, err := json.Marshal(profile)
	if err != nil {
		return "", nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	sum := sha256.Sum256(canonical)
	alias := "nimi-img-" + hex.EncodeToString(sum[:8])
	profile["name"] = alias
	s.cacheManagedMediaImageProfileResolution(model.GetLocalAssetId(), alias, profile, materializationResolved, materializationBindings)

	return alias, profile, managedMediaForwardedExtensions(scenarioExtensions), nil
}

func managedMediaNormalizeImageProfile(model *runtimev1.LocalAssetRecord, profile map[string]any) map[string]any {
	out := cloneAnyMap(profile)
	if model == nil {
		return out
	}
	if !isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind()) {
		return out
	}
	if strings.TrimSpace(valueAsString(out["backend"])) == "" {
		out["backend"] = "stablediffusion-ggml"
	}
	if !managedMediaProfileHasCFGScale(out) {
		out["cfg_scale"] = 1
	}
	out["options"] = managedMediaEnsureImageOptions(valueAsStringSlice(out["options"]))
	return out
}

func managedMediaProfileHasCFGScale(profile map[string]any) bool {
	for _, value := range []any{
		profile["cfg_scale"],
		profile["cfgScale"],
		valueAsObject(profile["parameters"])["cfg_scale"],
		valueAsObject(profile["parameters"])["cfgScale"],
	} {
		switch typed := value.(type) {
		case float32:
			if typed > 0 {
				return true
			}
		case float64:
			if typed > 0 {
				return true
			}
		case int:
			if typed > 0 {
				return true
			}
		case int32:
			if typed > 0 {
				return true
			}
		case int64:
			if typed > 0 {
				return true
			}
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				if parsed, err := strconv.ParseFloat(trimmed, 32); err == nil && parsed > 0 {
					return true
				}
			}
		}
	}
	return false
}

func managedMediaEnsureImageOptions(options []string) []string {
	out := make([]string, 0, len(options)+1)
	hasDiffusionModel := false
	hasDiffusionFA := false
	for _, option := range options {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		if strings.EqualFold(trimmed, "diffusion_model") {
			if hasDiffusionModel {
				continue
			}
			hasDiffusionModel = true
			out = append(out, "diffusion_model")
			continue
		}
		if strings.EqualFold(trimmed, "diffusion_fa:true") {
			if hasDiffusionFA {
				continue
			}
			hasDiffusionFA = true
			out = append(out, "diffusion_fa:true")
			continue
		}
		if strings.EqualFold(trimmed, "diffusion_fa:false") {
			if hasDiffusionFA {
				continue
			}
			hasDiffusionFA = true
			out = append(out, "diffusion_fa:false")
			continue
		}
		out = append(out, trimmed)
	}
	if !hasDiffusionModel {
		out = append([]string{"diffusion_model"}, out...)
	}
	if !hasDiffusionFA && strings.EqualFold(localRuntimeGOOS, "darwin") && strings.EqualFold(localRuntimeGOARCH, "arm64") {
		out = append(out, "diffusion_fa:true")
	}
	return out
}

func (s *Service) resolveManagedMediaImageModel(requestedModelID string) *runtimev1.LocalAssetRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	candidates := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, model := range s.assets {
		if model == nil {
			continue
		}
		if !localAssetRecordMatchesIdentity(model, requestedModelID) {
			continue
		}
		if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
			model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED &&
			model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY &&
			model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED {
			continue
		}
		if !hasCapability(model.GetCapabilities(), "image") {
			continue
		}
		candidates = append(candidates, cloneLocalAsset(model))
	}
	if len(candidates) == 0 {
		return nil
	}
	if len(candidates) > 1 {
		return nil
	}
	return candidates[0]
}

func managedMediaEnginePriority(engine string) int {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "media":
		return 0
	case "llama":
		return 1
	default:
		return 9
	}
}

func hasCapability(capabilities []string, target string) bool {
	normalizedTarget := normalizeLocalCapabilityToken(target)
	for _, capability := range capabilities {
		if strings.EqualFold(strings.TrimSpace(capability), target) || normalizeLocalCapabilityToken(capability) == normalizedTarget {
			return true
		}
	}
	return false
}

func managedMediaProfileOverrides(scenarioExtensions map[string]any) (map[string]any, error) {
	raw, ok := scenarioExtensions[managedMediaWorkflowProfileOverridesKey]
	if !ok || raw == nil {
		return map[string]any{}, nil
	}
	object, ok := raw.(map[string]any)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return cloneAnyMap(object), nil
}

func managedMediaEntryOverrides(scenarioExtensions map[string]any) (map[string]string, error) {
	raw, ok := scenarioExtensions[managedMediaWorkflowEntryOverridesKey]
	if !ok || raw == nil {
		return nil, nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	overrides := make(map[string]string, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		entryID := strings.TrimSpace(valueAsString(record["entry_id"]))
		if entryID == "" {
			entryID = strings.TrimSpace(valueAsString(record["entryId"]))
		}
		localAssetID := strings.TrimSpace(valueAsString(record["local_asset_id"]))
		if localAssetID == "" {
			localAssetID = strings.TrimSpace(valueAsString(record["localAssetId"]))
		}
		if entryID == "" || localAssetID == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		overrides[entryID] = localAssetID
	}
	if len(overrides) == 0 {
		return nil, nil
	}
	return overrides, nil
}

func validateManagedMediaProfileOverrides(overrides map[string]any) error {
	if len(overrides) == 0 {
		return nil
	}
	if managedMediaProfileOverrideContainsForbiddenKey(overrides) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for _, option := range valueAsStringSlice(overrides["options"]) {
		key, _, hasKV := strings.Cut(option, ":")
		if hasKV && managedMediaProfileOverrideOptionKeyForbidden(key) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	return nil
}

func managedMediaProfileOverrideOptionKeyForbidden(key string) bool {
	normalizedKey := strings.ToLower(strings.TrimSpace(key))
	if normalizedKey == "" {
		return false
	}
	if normalizedKey == "diffusion_model" {
		return true
	}
	if _, ok := managedMediaRuntimeResolvedComponentOptionKeys[normalizedKey]; ok {
		return true
	}
	return strings.HasSuffix(normalizedKey, "_path")
}

func managedMediaProfileOverrideContainsForbiddenKey(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalizedKey := strings.ToLower(strings.TrimSpace(key))
			if normalizedKey == "download_files" || normalizedKey == "model" || managedMediaProfileOverrideOptionKeyForbidden(normalizedKey) {
				return true
			}
			if managedMediaProfileOverrideContainsForbiddenKey(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if managedMediaProfileOverrideContainsForbiddenKey(child) {
				return true
			}
		}
	}
	return false
}

func managedMediaForwardedExtensions(scenarioExtensions map[string]any) map[string]any {
	if len(scenarioExtensions) == 0 {
		return nil
	}
	out := make(map[string]any, len(scenarioExtensions))
	for key, value := range scenarioExtensions {
		if key == managedMediaWorkflowProfileEntriesKey || key == managedMediaWorkflowEntryOverridesKey || key == managedMediaWorkflowProfileOverridesKey {
			continue
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
