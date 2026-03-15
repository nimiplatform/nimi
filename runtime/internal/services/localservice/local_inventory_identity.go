package localservice

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var localInventoryPrefixes = [...]string{"local/", "localai/", "nexa/", "sidecar/"}

func normalizeLocalInventoryID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	for _, prefix := range localInventoryPrefixes {
		if strings.HasPrefix(lower, prefix) {
			suffix := strings.TrimSpace(trimmed[len(prefix):])
			if suffix == "" {
				return ""
			}
			return "local/" + suffix
		}
	}
	return "local/" + trimmed
}

func localModelIdentityKey(modelID string, engine string) string {
	normalizedModelID := normalizeLocalInventoryID(modelID)
	normalizedEngine := strings.ToLower(strings.TrimSpace(engine))
	if normalizedModelID == "" && normalizedEngine == "" {
		return ""
	}
	return normalizedModelID + "::" + normalizedEngine
}

func localArtifactIdentityKey(artifactID string, kind runtimev1.LocalArtifactKind, engine string) string {
	normalizedArtifactID := normalizeLocalInventoryID(artifactID)
	normalizedEngine := strings.ToLower(strings.TrimSpace(engine))
	if normalizedArtifactID == "" && normalizedEngine == "" && kind == runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED {
		return ""
	}
	return fmt.Sprintf("%s::%d::%s", normalizedArtifactID, kind, normalizedEngine)
}

func localModelRecordIdentityKey(record *runtimev1.LocalModelRecord) string {
	if record == nil {
		return ""
	}
	if key := localModelIdentityKey(record.GetModelId(), record.GetEngine()); key != "" {
		return key
	}
	return "local-model-id::" + strings.TrimSpace(record.GetLocalModelId())
}

func localArtifactRecordIdentityKey(record *runtimev1.LocalArtifactRecord) string {
	if record == nil {
		return ""
	}
	if key := localArtifactIdentityKey(record.GetArtifactId(), record.GetKind(), record.GetEngine()); key != "" {
		return key
	}
	return "local-artifact-id::" + strings.TrimSpace(record.GetLocalArtifactId())
}

func dedupeLocalModelRecords(records []*runtimev1.LocalModelRecord) ([]*runtimev1.LocalModelRecord, bool) {
	byKey := make(map[string]*runtimev1.LocalModelRecord, len(records))
	changed := false
	for _, record := range records {
		if record == nil {
			continue
		}
		key := localModelRecordIdentityKey(record)
		if existing, ok := byKey[key]; ok {
			changed = true
			if preferLocalModelRecord(record, existing) {
				byKey[key] = record
			}
			continue
		}
		byKey[key] = record
	}
	out := make([]*runtimev1.LocalModelRecord, 0, len(byKey))
	for _, record := range byKey {
		out = append(out, record)
	}
	return out, changed
}

func dedupeLocalArtifactRecords(records []*runtimev1.LocalArtifactRecord) ([]*runtimev1.LocalArtifactRecord, bool) {
	byKey := make(map[string]*runtimev1.LocalArtifactRecord, len(records))
	changed := false
	for _, record := range records {
		if record == nil {
			continue
		}
		key := localArtifactRecordIdentityKey(record)
		if existing, ok := byKey[key]; ok {
			changed = true
			if preferLocalArtifactRecord(record, existing) {
				byKey[key] = record
			}
			continue
		}
		byKey[key] = record
	}
	out := make([]*runtimev1.LocalArtifactRecord, 0, len(byKey))
	for _, record := range byKey {
		out = append(out, record)
	}
	return out, changed
}

func preferLocalModelRecord(candidate *runtimev1.LocalModelRecord, current *runtimev1.LocalModelRecord) bool {
	return preferInventoryRecord(
		candidate.GetUpdatedAt(),
		candidate.GetInstalledAt(),
		current.GetUpdatedAt(),
		current.GetInstalledAt(),
		localModelStatusRank(candidate.GetStatus()),
		localModelStatusRank(current.GetStatus()),
		candidate.GetLocalModelId(),
		current.GetLocalModelId(),
	)
}

func preferLocalArtifactRecord(candidate *runtimev1.LocalArtifactRecord, current *runtimev1.LocalArtifactRecord) bool {
	return preferInventoryRecord(
		candidate.GetUpdatedAt(),
		candidate.GetInstalledAt(),
		current.GetUpdatedAt(),
		current.GetInstalledAt(),
		localArtifactStatusRank(candidate.GetStatus()),
		localArtifactStatusRank(current.GetStatus()),
		candidate.GetLocalArtifactId(),
		current.GetLocalArtifactId(),
	)
}

func preferInventoryRecord(
	candidateUpdated string,
	candidateInstalled string,
	currentUpdated string,
	currentInstalled string,
	candidateStatusRank int,
	currentStatusRank int,
	candidateLocalID string,
	currentLocalID string,
) bool {
	candidateTime := inventoryLifecycleTime(candidateUpdated, candidateInstalled)
	currentTime := inventoryLifecycleTime(currentUpdated, currentInstalled)
	if candidateTime.After(currentTime) {
		return true
	}
	if currentTime.After(candidateTime) {
		return false
	}
	if candidateStatusRank != currentStatusRank {
		return candidateStatusRank > currentStatusRank
	}
	candidateInstalledTime := inventoryLifecycleTime(candidateInstalled, "")
	currentInstalledTime := inventoryLifecycleTime(currentInstalled, "")
	if candidateInstalledTime.After(currentInstalledTime) {
		return true
	}
	if currentInstalledTime.After(candidateInstalledTime) {
		return false
	}
	return strings.TrimSpace(candidateLocalID) > strings.TrimSpace(currentLocalID)
}

func inventoryLifecycleTime(primary string, fallback string) time.Time {
	for _, raw := range []string{primary, fallback} {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func localModelStatusRank(status runtimev1.LocalModelStatus) int {
	switch status {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		return 4
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
		return 3
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED:
		return 2
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED:
		return 1
	default:
		return 0
	}
}

func localArtifactStatusRank(status runtimev1.LocalArtifactStatus) int {
	switch status {
	case runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_ACTIVE:
		return 4
	case runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_UNHEALTHY:
		return 3
	case runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_INSTALLED:
		return 2
	case runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_REMOVED:
		return 1
	default:
		return 0
	}
}
