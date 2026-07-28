package localservice

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func parseProjectionReasonCode(raw string) runtimev1.ReasonCode {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	value, ok := runtimev1.ReasonCode_value[trimmed]
	if !ok {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	return runtimev1.ReasonCode(value)
}

func formatProjectionReasonCode(reason runtimev1.ReasonCode) string {
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return ""
	}
	return reason.String()
}

func loadLocalStateSnapshot(path string) (localStateSnapshot, error) {
	result := localStateSnapshot{
		Assets:    []localStateAssetState{},
		Services:  []localStateServiceState{},
		Transfers: []localStateTransferState{},
		Audits:    []localStateAuditState{},
	}

	payload, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return result, nil
		}
		return result, err
	}
	if len(payload) == 0 {
		return result, nil
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return result, err
	}
	if result.SchemaVersion != localStateSchemaVersion {
		return result, fmt.Errorf("unsupported local-state.json schemaVersion=%d (expected %d); delete local-state.json before starting Runtime", result.SchemaVersion, localStateSchemaVersion)
	}
	return result, nil
}

func saveLocalStateSnapshot(path string, snapshot localStateSnapshot) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmpPath := path + ".tmp." + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func managedImageMaterializationBindingsToLocalState(bindings []managedMediaProfileMaterializationBinding) []localStateManagedImageMaterializationBindingState {
	if len(bindings) == 0 {
		return nil
	}
	out := make([]localStateManagedImageMaterializationBindingState, 0, len(bindings))
	for _, binding := range bindings {
		if strings.TrimSpace(binding.AssetID) == "" && strings.TrimSpace(binding.CompanionAssetID) == "" {
			continue
		}
		out = append(out, localStateManagedImageMaterializationBindingState{
			AssetID:          strings.TrimSpace(binding.AssetID),
			LocalAssetID:     strings.TrimSpace(binding.LocalAssetID),
			CompanionKind:    strings.TrimSpace(binding.CompanionKind),
			EngineSlot:       strings.TrimSpace(binding.EngineSlot),
			CompanionAssetID: strings.TrimSpace(binding.CompanionAssetID),
			ParentAssetID:    strings.TrimSpace(binding.ParentAssetID),
		})
	}
	return out
}

func restoreManagedImageProfileMaterialization(
	item localStateManagedImageProfileMaterializationState,
	assets map[string]*runtimev1.LocalAssetRecord,
) (string, string, []managedMediaProfileMaterializationBinding, bool) {
	localAssetID := strings.TrimSpace(item.LocalAssetID)
	materializationKey := strings.TrimSpace(item.MaterializationKey)
	if localAssetID == "" || !item.MaterializationResolved || len(item.MaterializationBindings) == 0 {
		return "", "", nil, false
	}
	mainAsset := assets[localAssetID]
	if !localStateAssetAdmitted(mainAsset) {
		return "", "", nil, false
	}
	bindings := managedImageMaterializationBindingsFromLocalState(item.MaterializationBindings)
	if len(bindings) == 0 {
		return "", "", nil, false
	}
	mainBinding := managedMediaProfileMaterializationBinding{}
	mainBindingCount := 0
	for _, binding := range bindings {
		if strings.TrimSpace(binding.CompanionAssetID) != "" {
			continue
		}
		mainBinding = binding
		mainBindingCount++
	}
	mainAssetID := strings.TrimSpace(mainBinding.AssetID)
	if mainBindingCount != 1 ||
		mainAssetID == "" ||
		strings.TrimSpace(mainBinding.LocalAssetID) != localAssetID ||
		strings.TrimSpace(mainAsset.GetAssetId()) != mainAssetID {
		return "", "", nil, false
	}
	for _, binding := range bindings {
		companionAssetID := strings.TrimSpace(binding.CompanionAssetID)
		if companionAssetID == "" {
			continue
		}
		if strings.TrimSpace(binding.AssetID) != mainAssetID ||
			strings.TrimSpace(binding.LocalAssetID) != localAssetID ||
			strings.TrimSpace(binding.ParentAssetID) != mainAssetID ||
			strings.TrimSpace(binding.CompanionKind) == "" ||
			strings.TrimSpace(binding.EngineSlot) == "" {
			return "", "", nil, false
		}
		if !localStateAssetIDAdmitted(assets, companionAssetID) {
			return "", "", nil, false
		}
	}
	return localAssetID, materializationKey, bindings, true
}

func localStateAssetIDAdmitted(assets map[string]*runtimev1.LocalAssetRecord, assetID string) bool {
	identity := strings.TrimSpace(assetID)
	if identity == "" {
		return false
	}
	for _, asset := range assets {
		if strings.TrimSpace(asset.GetAssetId()) == identity && localStateAssetAdmitted(asset) {
			return true
		}
	}
	return false
}

func localStateAssetAdmitted(asset *runtimev1.LocalAssetRecord) bool {
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

func managedImageMaterializationBindingsFromLocalState(bindings []localStateManagedImageMaterializationBindingState) []managedMediaProfileMaterializationBinding {
	if len(bindings) == 0 {
		return nil
	}
	out := make([]managedMediaProfileMaterializationBinding, 0, len(bindings))
	for _, binding := range bindings {
		if strings.TrimSpace(binding.AssetID) == "" && strings.TrimSpace(binding.CompanionAssetID) == "" {
			continue
		}
		out = append(out, managedMediaProfileMaterializationBinding{
			AssetID:          strings.TrimSpace(binding.AssetID),
			LocalAssetID:     strings.TrimSpace(binding.LocalAssetID),
			CompanionKind:    strings.TrimSpace(binding.CompanionKind),
			EngineSlot:       strings.TrimSpace(binding.EngineSlot),
			CompanionAssetID: strings.TrimSpace(binding.CompanionAssetID),
			ParentAssetID:    strings.TrimSpace(binding.ParentAssetID),
		})
	}
	return out
}

func hostRequirementsToMap(input *runtimev1.LocalHostRequirements) map[string]any {
	if input == nil {
		return nil
	}
	return map[string]any{
		"gpuRequired":           input.GetGpuRequired(),
		"pythonRuntimeRequired": input.GetPythonRuntimeRequired(),
		"supportedPlatforms":    append([]string(nil), input.GetSupportedPlatforms()...),
		"requiredBackends":      append([]string(nil), input.GetRequiredBackends()...),
	}
}

func hostRequirementsFromMap(input map[string]any) *runtimev1.LocalHostRequirements {
	if len(input) == 0 {
		return nil
	}
	requirements := &runtimev1.LocalHostRequirements{}
	if value, ok := input["gpuRequired"].(bool); ok {
		requirements.GpuRequired = value
	}
	if value, ok := input["pythonRuntimeRequired"].(bool); ok {
		requirements.PythonRuntimeRequired = value
	}
	if values, ok := input["supportedPlatforms"].([]any); ok {
		requirements.SupportedPlatforms = anySliceToStrings(values)
	}
	if values, ok := input["requiredBackends"].([]any); ok {
		requirements.RequiredBackends = anySliceToStrings(values)
	}
	return requirements
}

func anySliceToStrings(values []any) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, strings.TrimSpace(text))
		}
	}
	return out
}
