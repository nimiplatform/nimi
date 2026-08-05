package localservice

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func modelProbeSucceeded(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) bool {
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return false
	case "media":
		return mediaModelProbeSucceeded(model, probe)
	case "speech":
		return speechModelProbeSucceeded(model, probe)
	}
	return probe.healthy
}

func modelProbeFailureDetail(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) string {
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return "llama execution health is private to exact local capability jobs"
	case "media":
		return mediaModelProbeFailureDetail(model, probe)
	case "speech":
		return speechModelProbeFailureDetail(model, probe)
	}
	return defaultString(probe.detail, "model probe failed")
}

func mediaModelProbeSucceeded(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) bool {
	if !probe.healthy {
		return false
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" || len(probe.models) == 0 {
		return false
	}
	_, ok := findComparableProbeModel(probe.models, expectedModelName)
	return ok
}

func mediaModelProbeFailureDetail(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) string {
	if !probe.healthy {
		return defaultString(probe.detail, "media model probe failed")
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" {
		return "media probe requires a model id"
	}
	available := compactProbeModelIDs(probe.models)
	if len(available) == 0 {
		return fmt.Sprintf("media probe missing expected model %q", expectedModelName)
	}
	return fmt.Sprintf("media probe missing expected model %q; available_models=%s", expectedModelName, strings.Join(available, ","))
}

func speechModelProbeSucceeded(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) bool {
	if !probe.healthy {
		return false
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" || len(probe.models) == 0 {
		return false
	}
	matchedModelID, ok := findComparableProbeModel(probe.models, expectedModelName)
	if !ok {
		return false
	}
	requiredCapabilities := normalizeStringSlice(model.GetCapabilities())
	if len(requiredCapabilities) == 0 {
		return true
	}
	availableCapabilities := probeCapabilitiesForModel(probe, matchedModelID)
	if len(availableCapabilities) == 0 {
		return false
	}
	for _, capability := range requiredCapabilities {
		if !stringSliceContainsNormalized(availableCapabilities, capability) {
			return false
		}
	}
	return true
}

func speechModelProbeFailureDetail(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) string {
	if !probe.healthy {
		return defaultString(probe.detail, "speech model probe failed")
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" {
		return "speech probe requires a model id"
	}
	matchedModelID, ok := findComparableProbeModel(probe.models, expectedModelName)
	if !ok {
		available := compactProbeModelIDs(probe.models)
		if len(available) == 0 {
			return fmt.Sprintf("speech probe missing expected model %q", expectedModelName)
		}
		return fmt.Sprintf("speech probe missing expected model %q; available_models=%s", expectedModelName, strings.Join(available, ","))
	}
	requiredCapabilities := normalizeStringSlice(model.GetCapabilities())
	if len(requiredCapabilities) == 0 {
		return defaultString(probe.detail, "speech model probe failed")
	}
	availableCapabilities := probeCapabilitiesForModel(probe, matchedModelID)
	if len(availableCapabilities) == 0 {
		return fmt.Sprintf("speech probe missing required capabilities for %q; available_capabilities=none", matchedModelID)
	}
	for _, capability := range requiredCapabilities {
		if !stringSliceContainsNormalized(availableCapabilities, capability) {
			return fmt.Sprintf(
				"speech probe missing required capability %q for %q; available_capabilities=%s",
				capability,
				matchedModelID,
				strings.Join(availableCapabilities, ","),
			)
		}
	}
	return defaultString(probe.detail, "speech model probe failed")
}

func compactProbeModelIDs(models []string) []string {
	available := make([]string, 0, len(models))
	for _, modelID := range models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed != "" {
			available = append(available, trimmed)
		}
	}
	sort.Strings(available)
	return available
}

func probeCapabilitiesForModel(probe endpointProbeResult, matchedModelID string) []string {
	if len(probe.modelCaps) == 0 {
		return nil
	}
	if caps, ok := probe.modelCaps[matchedModelID]; ok {
		return normalizeStringSlice(caps)
	}
	expectedComparable := normalizeComparableModelID(matchedModelID)
	expectedBase := probeModelIDBase(matchedModelID)
	for modelID, caps := range probe.modelCaps {
		if normalizeComparableModelID(modelID) == expectedComparable || probeModelIDBase(modelID) == expectedBase {
			return normalizeStringSlice(caps)
		}
	}
	return nil
}

func stringSliceContainsNormalized(values []string, target string) bool {
	normalizedTarget := strings.TrimSpace(normalizeLocalCapabilityToken(target))
	if normalizedTarget == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(normalizeLocalCapabilityToken(value)) == normalizedTarget {
			return true
		}
	}
	return false
}

func findComparableProbeModel(models []string, expected string) (string, bool) {
	expectedComparable := normalizeComparableModelID(expected)
	expectedBase := probeModelIDBase(expected)
	for _, modelID := range models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed == "" {
			continue
		}
		if normalizeComparableModelID(trimmed) == expectedComparable {
			return trimmed, true
		}
		if probeModelIDBase(trimmed) == expectedBase {
			return trimmed, true
		}
	}
	return "", false
}

func normalizeComparableModelID(value string) string {
	comparable := strings.ToLower(strings.TrimSpace(value))
	comparable = strings.TrimPrefix(comparable, "models/")
	comparable = strings.TrimPrefix(comparable, "model/")
	comparable = strings.TrimPrefix(comparable, "local/")
	comparable = strings.TrimPrefix(comparable, "media/")
	comparable = strings.TrimPrefix(comparable, "speech/")
	return comparable
}

func probeModelIDBase(value string) string {
	trimmed := normalizeComparableModelID(value)
	if idx := strings.Index(trimmed, "@"); idx > 0 {
		return strings.TrimSpace(trimmed[:idx])
	}
	return trimmed
}
