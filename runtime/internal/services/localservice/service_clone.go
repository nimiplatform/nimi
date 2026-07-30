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

func cloneLocalAsset(input *runtimev1.LocalAssetRecord) *runtimev1.LocalAssetRecord {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalAssetRecord)
	return cloned
}

func cloneVerifiedAsset(input *runtimev1.LocalVerifiedAssetDescriptor) *runtimev1.LocalVerifiedAssetDescriptor {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalVerifiedAssetDescriptor)
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

// hostProfileOrCollected normalizes a request-supplied host posture into a
// non-nil LocalDeviceProfile: it returns a clone of the caller's profile, or a
// freshly collected profile for this host when the request omitted one.
//
// Every K-MCAT-034 resolver entry point (install-level plan resolution and
// Product Control first-run model selection) must route its host posture
// through this helper. A nil profile reaching resolveHostBudget zeroes the
// RAM/VRAM budget, which makes classifyVariant rule every cpu variant
// tierIneligible and the resolver fail-close — projecting a fully capable host
// into the first-run `blocked`/`unsupported` state. The collected profile keeps
// the resolver's fail-close semantics intact for genuinely under-resourced
// hosts.
func hostProfileOrCollected(input *runtimev1.LocalDeviceProfile) *runtimev1.LocalDeviceProfile {
	if profile := cloneDeviceProfile(input); profile != nil {
		return profile
	}
	return collectDeviceProfile()
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

func cloneHostRequirements(input *runtimev1.LocalHostRequirements) *runtimev1.LocalHostRequirements {
	if input == nil {
		return nil
	}
	return &runtimev1.LocalHostRequirements{
		GpuRequired:           input.GetGpuRequired(),
		PythonRuntimeRequired: input.GetPythonRuntimeRequired(),
		SupportedPlatforms:    append([]string(nil), input.GetSupportedPlatforms()...),
		RequiredBackends:      append([]string(nil), input.GetRequiredBackends()...),
	}
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
