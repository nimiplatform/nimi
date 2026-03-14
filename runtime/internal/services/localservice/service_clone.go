package localservice

import (
	"strings"
	"time"
	"unicode"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func defaultString(input string, fallback string) string {
	normalized := strings.TrimSpace(input)
	if normalized != "" {
		return normalized
	}
	return fallback
}

func firstCapability(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func normalizeStringSlice(values []string) []string {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, item := range values {
		normalized := strings.TrimSpace(item)
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, normalized)
	}
	return out
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func cloneLocalModel(input *runtimev1.LocalModelRecord) *runtimev1.LocalModelRecord {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalModelRecord)
	return cloned
}

func cloneLocalArtifact(input *runtimev1.LocalArtifactRecord) *runtimev1.LocalArtifactRecord {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalArtifactRecord)
	return cloned
}

func cloneVerifiedModel(input *runtimev1.LocalVerifiedModelDescriptor) *runtimev1.LocalVerifiedModelDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalVerifiedModelDescriptor)
	return cloned
}

func cloneVerifiedArtifact(input *runtimev1.LocalVerifiedArtifactDescriptor) *runtimev1.LocalVerifiedArtifactDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalVerifiedArtifactDescriptor)
	return cloned
}

func cloneCatalogItem(input *runtimev1.LocalCatalogModelDescriptor) *runtimev1.LocalCatalogModelDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalCatalogModelDescriptor)
	return cloned
}

func cloneDeviceProfile(input *runtimev1.LocalDeviceProfile) *runtimev1.LocalDeviceProfile {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalDeviceProfile)
	return cloned
}

func cloneDependencyDescriptor(input *runtimev1.LocalExecutionEntryDescriptor) *runtimev1.LocalExecutionEntryDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalExecutionEntryDescriptor)
	return cloned
}

func cloneProfileEntryDescriptor(input *runtimev1.LocalProfileEntryDescriptor) *runtimev1.LocalProfileEntryDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalProfileEntryDescriptor)
	return cloned
}

func cloneProfileRequirement(input *runtimev1.LocalProfileRequirementDescriptor) *runtimev1.LocalProfileRequirementDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalProfileRequirementDescriptor)
	return cloned
}

func cloneProfileDescriptor(input *runtimev1.LocalProfileDescriptor) *runtimev1.LocalProfileDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalProfileDescriptor)
	return cloned
}

func cloneProfileArtifactPlanEntry(input *runtimev1.LocalProfileArtifactPlanEntry) *runtimev1.LocalProfileArtifactPlanEntry {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalProfileArtifactPlanEntry)
	return cloned
}

func cloneDependencyApplyResult(input *runtimev1.LocalExecutionApplyResult) *runtimev1.LocalExecutionApplyResult {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalExecutionApplyResult)
	return cloned
}

func clonePreflightDecisions(input []*runtimev1.LocalPreflightDecision) []*runtimev1.LocalPreflightDecision {
	out := make([]*runtimev1.LocalPreflightDecision, 0, len(input))
	for _, item := range input {
		cloned, _ := proto.Clone(item).(*runtimev1.LocalPreflightDecision)
		if cloned != nil {
			out = append(out, cloned)
		}
	}
	return out
}

func cloneServiceDescriptor(input *runtimev1.LocalServiceDescriptor) *runtimev1.LocalServiceDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalServiceDescriptor)
	return cloned
}

func cloneProviderHints(input *runtimev1.LocalProviderHints) *runtimev1.LocalProviderHints {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalProviderHints)
	return cloned
}

func cloneLocalAuditEvent(input *runtimev1.LocalAuditEvent) *runtimev1.LocalAuditEvent {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalAuditEvent)
	return cloned
}

func toStruct(payload map[string]any) *structpb.Struct {
	if len(payload) == 0 {
		return nil
	}
	result, err := structpb.NewStruct(payload)
	if err != nil {
		return nil
	}
	return result
}

func structToMap(value *structpb.Struct) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value.AsMap()
}

func cloneStruct(value *structpb.Struct) *structpb.Struct {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*structpb.Struct)
	return cloned
}

func slug(input string) string {
	normalized := strings.TrimSpace(strings.ToLower(input))
	if normalized == "" {
		return "item"
	}
	var builder strings.Builder
	lastDash := false
	for _, r := range normalized {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('_')
			lastDash = true
		}
	}
	out := strings.Trim(builder.String(), "_")
	if out == "" {
		return "item"
	}
	return out
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
