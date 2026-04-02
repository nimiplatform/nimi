package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
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
) (string, map[string]string, error) {
	var modelPath string
	engineSlots := make(map[string]string)

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
				return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
					Message:    fmt.Sprintf("profile entry %q kind %s must declare engineSlot", entryID, entryKind.String()),
					ActionHint: "declare_profile_slot",
				})
			}
			// Main runnable model: assetKind matches capability, no engineSlot.
			if !assetKindMatchesCapability(entryKind, capability) {
				continue
			}
			if modelPath != "" {
				return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
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
				return "", nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
			}
			if !profileEntryInstalledAssetUsable(installed) {
				return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
					Message:    fmt.Sprintf("main asset %q is not in a usable status", installed.GetLocalAssetId()),
					ActionHint: "inspect_local_runtime_model_health",
				})
			}
			resolved, err := s.resolveManagedAssetEntryPath(installed)
			if err != nil {
				return "", nil, err
			}
			modelPath = resolved
			continue
		}

		// Slot-bound dependency: any non-main asset may bind an engineSlot,
		// including chat assets used as text encoders (for example llm_path).
		if assetKindMatchesCapability(entryKind, capability) {
			return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_FORBIDDEN, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("main asset entry %q kind %s cannot declare engineSlot %q", entryID, entryKind.String(), slot),
				ActionHint: "remove_profile_slot",
			})
		}
		if _, exists := engineSlots[slot]; exists {
			return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_PROFILE_SLOT_CONFLICT, grpcerr.ReasonOptions{
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
			return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("slot %q asset is not installed", slot),
				ActionHint: "install_profile_slot_asset",
			})
		}
		if !profileEntryInstalledAssetUsable(installed) {
			return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("slot %q asset %q is not in a usable status", slot, installed.GetLocalAssetId()),
				ActionHint: "inspect_profile_slot_asset",
			})
		}
		resolved, err := s.resolveManagedAssetEntryPath(installed)
		if err != nil {
			return "", nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING, grpcerr.ReasonOptions{
				Message:    fmt.Sprintf("slot %q asset path is unavailable: %v", slot, err),
				ActionHint: "inspect_profile_slot_asset",
			})
		}
		engineSlots[slot] = resolved
	}

	return modelPath, engineSlots, nil
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

	profile := mergeMaps(nil, profileOverrides)

	var modelPath string
	slotPaths := map[string]string{}

	if len(profileEntries) > 0 {
		resolved, slots, resolveErr := s.resolveProfileSlots(profileEntries, "image", entryOverrides)
		if resolveErr != nil {
			return "", nil, nil, resolveErr
		}
		if resolved != "" {
			modelPath = resolved
		}
		slotPaths = slots
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
	s.cacheManagedMediaImageProfile(model.GetLocalAssetId(), alias, profile)

	return alias, profile, managedMediaForwardedExtensions(scenarioExtensions), nil
}

func (s *Service) resolveManagedMediaImageModel(requestedModelID string) *runtimev1.LocalAssetRecord {
	normalizedID, _, _ := parseManagedMediaRequestedModelID(requestedModelID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	candidates := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, model := range s.assets {
		if model == nil {
			continue
		}
		if strings.TrimSpace(model.GetAssetId()) != normalizedID {
			continue
		}
		if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
			model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED &&
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

func parseManagedMediaRequestedModelID(requestedModelID string) (string, string, bool) {
	raw := strings.TrimSpace(requestedModelID)
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "media/"):
		return strings.TrimSpace(raw[len("media/"):]), "media", false
	case strings.HasPrefix(lower, "llama/"):
		return strings.TrimSpace(raw[len("llama/"):]), "llama", false
	case strings.HasPrefix(lower, "local/"):
		return strings.TrimSpace(raw[len("local/"):]), "", true
	default:
		return raw, "", false
	}
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
	for _, capability := range capabilities {
		if strings.EqualFold(strings.TrimSpace(capability), target) {
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
	if _, exists := overrides["download_files"]; exists {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	parameters := valueAsObject(overrides["parameters"])
	if _, exists := parameters["model"]; exists {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for _, option := range valueAsStringSlice(overrides["options"]) {
		key, _, hasKV := strings.Cut(option, ":")
		if hasKV && strings.HasSuffix(strings.TrimSpace(key), "_path") {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	return nil
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

func (s *Service) localAssetByID(localArtifactID string) *runtimev1.LocalAssetRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneLocalAsset(s.assets[strings.TrimSpace(localArtifactID)])
}

func (s *Service) ResolveManagedAssetPath(_ context.Context, localArtifactID string) (string, error) {
	artifact := s.localAssetByID(localArtifactID)
	relPath, err := s.resolveManagedAssetEntryPath(artifact)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.resolvedLocalModelsPath(), filepath.FromSlash(relPath)), nil
}

func (s *Service) resolveManagedAssetEntryPath(artifact *runtimev1.LocalAssetRecord) (string, error) {
	if artifact == nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	modelsRoot := s.resolvedLocalModelsPath()
	repo := strings.TrimSpace(artifact.GetSource().GetRepo())
	if strings.HasPrefix(repo, "file://") {
		return resolveManagedEntryRelativePath(modelsRoot, artifact.GetAssetId(), repo, artifact.GetEntry())
	}
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	cleanEntry, err := sanitizeManagedEntryPath(artifact.GetEntry())
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	var absPath string
	if isRunnableKind(artifact.GetKind()) {
		logicalModelID := strings.Trim(strings.TrimSpace(artifact.GetLogicalModelId()), "/")
		if logicalModelID != "" {
			absPath = filepath.Join(rootAbs, "resolved", filepath.FromSlash(logicalModelID), cleanEntry)
		}
	}
	if absPath == "" {
		absPath = filepath.Join(rootAbs, "resolved", slugifyLocalAssetID(artifact.GetAssetId()), cleanEntry)
	}
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if !strings.HasPrefix(absPath, rootAbs+string(filepath.Separator)) && absPath != rootAbs {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	relPath, err := filepath.Rel(rootAbs, absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return filepath.ToSlash(relPath), nil
}

func (s *Service) resolvedLocalModelsPath() string {
	s.mu.RLock()
	localModelsPath := s.localModelsPath
	s.mu.RUnlock()
	return resolveLocalModelsPath(localModelsPath)
}

func resolveManagedEntryRelativePath(modelsRoot string, itemID string, sourceRepo string, entry string) (string, error) {
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	baseDir, err := resolveManagedBaseDir(rootAbs, itemID, sourceRepo)
	if err != nil {
		return "", err
	}
	cleanEntry := filepath.Clean(strings.TrimSpace(entry))
	if cleanEntry == "." || cleanEntry == "" || filepath.IsAbs(cleanEntry) || cleanEntry == ".." ||
		strings.HasPrefix(cleanEntry, ".."+string(filepath.Separator)) {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	absPath := filepath.Join(baseDir, cleanEntry)
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if !strings.HasPrefix(absPath, rootAbs+string(filepath.Separator)) && absPath != rootAbs {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "dynamic local media asset must reside under local models root",
			ActionHint: "reimport_under_local_models_root",
		})
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	relPath, err := filepath.Rel(rootAbs, absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return filepath.ToSlash(relPath), nil
}

func resolveManagedBaseDir(modelsRoot string, itemID string, sourceRepo string) (string, error) {
	repo := strings.TrimSpace(sourceRepo)
	if strings.HasPrefix(repo, "file://") {
		if parsed, err := url.Parse(repo); err == nil {
			path := parsed.Path
			if path != "" {
				baseDir := filepath.Dir(path)
				baseDir, err = filepath.Abs(baseDir)
				if err == nil {
					if resolvedBaseDir, resolveErr := filepath.EvalSymlinks(baseDir); resolveErr == nil {
						baseDir = resolvedBaseDir
					} else if !os.IsNotExist(resolveErr) {
						return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
					}
					return baseDir, nil
				}
			}
		}
	}
	return filepath.Join(modelsRoot, slugifyLocalModelID(itemID)), nil
}

func valueAsString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func valueAsObject(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return cloneAnyMap(object)
	}
	return map[string]any{}
}

func valueAsStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return append([]string(nil), typed...)
		}
		return []string{}
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text := valueAsString(item); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func cloneAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		switch typed := value.(type) {
		case map[string]any:
			out[key] = cloneAnyMap(typed)
		case []any:
			out[key] = append([]any(nil), typed...)
		default:
			out[key] = typed
		}
	}
	return out
}

func mergeMaps(base map[string]any, overrides map[string]any) map[string]any {
	out := cloneAnyMap(base)
	for key, value := range overrides {
		nextMap, nextIsMap := value.(map[string]any)
		currentMap, currentIsMap := out[key].(map[string]any)
		if nextIsMap && currentIsMap {
			out[key] = mergeMaps(currentMap, nextMap)
			continue
		}
		switch typed := value.(type) {
		case map[string]any:
			out[key] = cloneAnyMap(typed)
		case []any:
			out[key] = append([]any(nil), typed...)
		default:
			out[key] = typed
		}
	}
	return out
}
