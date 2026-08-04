package capabilitydriver

import (
	"encoding/hex"
	"math"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const inputImageFeature = "input.image"

// LlamaTextDriver projects only llama.cpp text resource intent.
type LlamaTextDriver struct{}

func (LlamaTextDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	features, reason := normalizedFeatures(input.SupportedFeatures)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	portable, reason := parsePortableConfig(input.PortableConfig, contains(features, inputImageFeature))
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}

	requirements := []*runtimev1.LocalCapabilityRequirement{requirement(
		MainGGUFRequirementID,
		runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		"gguf",
		portable.mainPolicy,
		portable.mainVerifiedContentID,
		"llm",
	)}
	if contains(features, inputImageFeature) {
		requirements = append(requirements, requirement(
			CompanionMMProjRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"mmproj",
			portable.mmprojPolicy,
			portable.mmprojVerifiedContentID,
			"mmproj",
		))
	}
	return requirements, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaTextDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || binding.GetRequirementId() != requirement.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetLocalAssetId() == "" || asset.LocalAssetID == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || asset.VerifiedContentID == "" || asset.EntrySHA256 == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetLocalAssetId() != asset.LocalAssetID || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if !llamaCompatible(requirement, asset) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if requirement.GetPolicy() == runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT &&
		binding.GetVerifiedContentId() != requirement.GetPreferredVerifiedContentId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaTextDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) == 0 || len(bindings) < len(requirements) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	if len(bindings) > len(requirements) || len(assets) > len(bindings) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if len(assets) < len(bindings) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	byRequirement := make(map[string]struct{}, len(requirements))
	for _, requirement := range requirements {
		if requirement == nil || requirement.GetRequirementId() == "" {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := byRequirement[requirement.GetRequirementId()]; exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		byRequirement[requirement.GetRequirementId()] = struct{}{}
	}
	byBinding := make(map[string]int, len(bindings))
	localAssets := make(map[string]struct{}, len(bindings))
	verifiedContents := make(map[string]struct{}, len(bindings))
	for index, binding := range bindings {
		if binding == nil || binding.GetRequirementId() == "" {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := byRequirement[binding.GetRequirementId()]; !exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := byBinding[binding.GetRequirementId()]; exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if localAssetID := binding.GetLocalAssetId(); localAssetID != "" {
			if _, exists := localAssets[localAssetID]; exists {
				return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
			}
			localAssets[localAssetID] = struct{}{}
		}
		if verifiedContentID := binding.GetVerifiedContentId(); verifiedContentID != "" {
			if _, exists := verifiedContents[verifiedContentID]; exists {
				return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
			}
			verifiedContents[verifiedContentID] = struct{}{}
		}
		byBinding[binding.GetRequirementId()] = index
	}
	for _, requirement := range requirements {
		index, exists := byBinding[requirement.GetRequirementId()]
		if !exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		if reason := driver.ValidateBinding(requirement, bindings[index], assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

type portableConfig struct {
	mainPolicy              runtimev1.LocalCapabilityRequirementPolicy
	mainVerifiedContentID   string
	mmprojPolicy            runtimev1.LocalCapabilityRequirementPolicy
	mmprojVerifiedContentID string
}

func parsePortableConfig(value *structpb.Struct, image bool) (portableConfig, runtimev1.LocalCapabilityReason) {
	result := portableConfig{
		mainPolicy:   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		mmprojPolicy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
	}
	if value == nil {
		return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	fields := value.GetFields()
	for key := range fields {
		switch key {
		case "mainRequirementPolicy", "mainVerifiedContentId", "mmprojRequirementPolicy", "mmprojVerifiedContentId",
			"contextSize", "cacheTypeK", "cacheTypeV", "flashAttention", "gpuLayers":
		default:
			return portableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	var reason runtimev1.LocalCapabilityReason
	if reason = validatePortableExecutionOptions(fields); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if result.mainPolicy, reason = portablePolicy(fields, "mainRequirementPolicy"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if result.mainVerifiedContentID, reason = portableString(fields, "mainVerifiedContentId"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if result.mmprojPolicy, reason = portablePolicy(fields, "mmprojRequirementPolicy"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if result.mmprojVerifiedContentID, reason = portableString(fields, "mmprojVerifiedContentId"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if result.mainVerifiedContentID, reason = normalizeVerifiedContentID(result.mainVerifiedContentID); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if result.mmprojVerifiedContentID, reason = normalizeVerifiedContentID(result.mmprojVerifiedContentID); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if result.mainPolicy == runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT && result.mainVerifiedContentID == "" ||
		result.mmprojPolicy == runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT && result.mmprojVerifiedContentID == "" ||
		!image && (fields["mmprojRequirementPolicy"] != nil || fields["mmprojVerifiedContentId"] != nil) {
		return portableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func validatePortableExecutionOptions(fields map[string]*structpb.Value) runtimev1.LocalCapabilityReason {
	if value, exists := fields["contextSize"]; exists && !portableIntegerInRange(value, 1) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	for _, key := range []string{"cacheTypeK", "cacheTypeV"} {
		if value, exists := fields[key]; exists {
			text, ok := portableStringValue(value)
			if !ok || !supportedCacheType(text) {
				return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
		}
	}
	if value, exists := fields["flashAttention"]; exists {
		if _, ok := value.Kind.(*structpb.Value_BoolValue); !ok {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	if value, exists := fields["gpuLayers"]; exists && !portableIntegerInRange(value, -1) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func portableIntegerInRange(value *structpb.Value, minimum float64) bool {
	const maximum = float64(1<<31 - 1)
	if value == nil {
		return false
	}
	if _, ok := value.Kind.(*structpb.Value_NumberValue); !ok {
		return false
	}
	number := value.GetNumberValue()
	return !math.IsNaN(number) && !math.IsInf(number, 0) && math.Trunc(number) == number && number >= minimum && number <= maximum
}

func portableStringValue(value *structpb.Value) (string, bool) {
	if value == nil {
		return "", false
	}
	if _, ok := value.Kind.(*structpb.Value_StringValue); !ok {
		return "", false
	}
	return value.GetStringValue(), true
}

func supportedCacheType(value string) bool {
	switch value {
	case "f32", "f16", "bf16", "q8_0", "q4_0":
		return true
	default:
		return false
	}
}

func normalizeVerifiedContentID(value string) (string, runtimev1.LocalCapabilityReason) {
	if value == "" {
		return "", runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+64 {
		return "", runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	hexValue := value[len("sha256:"):]
	if _, err := hex.DecodeString(hexValue); err != nil {
		return "", runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return "sha256:" + strings.ToLower(hexValue), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func portablePolicy(fields map[string]*structpb.Value, key string) (runtimev1.LocalCapabilityRequirementPolicy, runtimev1.LocalCapabilityReason) {
	value, exists := fields[key]
	if !exists {
		return runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	text := value.GetStringValue()
	if value.GetKind() == nil || (text != "strict" && text != "substitutable") {
		return 0, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if text == "strict" {
		return runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	return runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func portableString(fields map[string]*structpb.Value, key string) (string, runtimev1.LocalCapabilityReason) {
	value, exists := fields[key]
	if !exists {
		return "", runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	text, isString := portableStringValue(value)
	if !isString {
		return "", runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return text, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func normalizedFeatures(features []string) ([]string, runtimev1.LocalCapabilityReason) {
	set := map[string]struct{}{}
	for _, feature := range features {
		if feature != inputImageFeature {
			return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
		}
		set[feature] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for feature := range set {
		result = append(result, feature)
	}
	sort.Strings(result)
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func requirement(id string, role runtimev1.LocalCapabilityRequirementRole, resourceKind string, policy runtimev1.LocalCapabilityRequirementPolicy, preferredID, artifactRole string) *runtimev1.LocalCapabilityRequirement {
	constraints, _ := structpb.NewStruct(map[string]any{"engine": "llama", "artifact_role": artifactRole})
	return &runtimev1.LocalCapabilityRequirement{RequirementId: id, Role: role, ResourceKind: resourceKind, Policy: policy, PreferredVerifiedContentId: preferredID, CompatibilityConstraints: constraints}
}

func llamaCompatible(requirement *runtimev1.LocalCapabilityRequirement, asset AssetDescriptor) bool {
	if asset.Engine != "llama" {
		return false
	}
	role := ""
	if requirement.GetRequirementId() == MainGGUFRequirementID {
		role = "llm"
	} else if requirement.GetRequirementId() == CompanionMMProjRequirementID {
		role = "mmproj"
	}
	return role != "" && contains(asset.ArtifactRoles, role)
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
