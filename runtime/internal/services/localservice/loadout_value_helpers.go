package localservice

import (
	"encoding/hex"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
)

func normalizeVerifiedContentID(value string) string {
	normalized := normalizeExactSHA256Hex(value)
	if normalized == "" {
		return ""
	}
	return "sha256:" + normalized
}

func normalizeExactSHA256Hex(value string) string {
	normalized := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "sha256:")
	if len(normalized) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(normalized); err != nil {
		return ""
	}
	return normalized
}

func normalizeStableStringSet(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			set[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func cloneLocalCapabilityRequirements(inputs []*runtimev1.LocalCapabilityRequirement) []*runtimev1.LocalCapabilityRequirement {
	result := make([]*runtimev1.LocalCapabilityRequirement, 0, len(inputs))
	for _, input := range inputs {
		if input == nil {
			continue
		}
		cloned, _ := proto.Clone(input).(*runtimev1.LocalCapabilityRequirement)
		result = append(result, cloned)
	}
	return result
}

func cloneLocalCapabilityRequirement(input *runtimev1.LocalCapabilityRequirement) *runtimev1.LocalCapabilityRequirement {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalCapabilityRequirement)
	return cloned
}

func cloneModelAssetExactBindings(inputs []*runtimev1.ModelAssetExactBinding) []*runtimev1.ModelAssetExactBinding {
	result := make([]*runtimev1.ModelAssetExactBinding, 0, len(inputs))
	for _, input := range inputs {
		if input == nil {
			continue
		}
		cloned, _ := proto.Clone(input).(*runtimev1.ModelAssetExactBinding)
		result = append(result, cloned)
	}
	return result
}

func cloneModelAssetExactBinding(input *runtimev1.ModelAssetExactBinding) *runtimev1.ModelAssetExactBinding {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.ModelAssetExactBinding)
	return cloned
}

func cloneCapabilityDriverModelAssetDescriptor(input capabilitydriver.ModelAssetDescriptor) capabilitydriver.ModelAssetDescriptor {
	input.ArtifactRoles = append([]string(nil), input.ArtifactRoles...)
	input.FormatProbe = append([]byte(nil), input.FormatProbe...)
	return input
}

func cloneCapabilityDriverModelAssetDescriptors(inputs []capabilitydriver.ModelAssetDescriptor) []capabilitydriver.ModelAssetDescriptor {
	result := make([]capabilitydriver.ModelAssetDescriptor, 0, len(inputs))
	for _, input := range inputs {
		result = append(result, cloneCapabilityDriverModelAssetDescriptor(input))
	}
	return result
}

func cloneAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		switch typed := value.(type) {
		case map[string]any:
			result[key] = cloneAnyMap(typed)
		case []any:
			result[key] = append([]any(nil), typed...)
		default:
			result[key] = typed
		}
	}
	return result
}
