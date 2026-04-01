package localservice

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var localInventoryPrefixes = [...]string{"local/", "llama/", "media/", "speech/", "sidecar/"}

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

// localAssetIdentityKey produces the unique identity key for an asset.
// Identity: (assetID, kind, engine).
func localAssetIdentityKey(assetID string, kind runtimev1.LocalAssetKind, engine string) string {
	normalizedAssetID := normalizeLocalInventoryID(assetID)
	normalizedEngine := strings.ToLower(strings.TrimSpace(engine))
	if normalizedAssetID == "" && normalizedEngine == "" && kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return ""
	}
	return fmt.Sprintf("%s::%d::%s", normalizedAssetID, kind, normalizedEngine)
}

func localAssetRecordIdentityKey(record *runtimev1.LocalAssetRecord) string {
	if record == nil {
		return ""
	}
	if key := localAssetIdentityKey(record.GetAssetId(), record.GetKind(), record.GetEngine()); key != "" {
		return key
	}
	return "local-asset-id::" + strings.TrimSpace(record.GetLocalAssetId())
}

func isRunnableKind(k runtimev1.LocalAssetKind) bool {
	return k >= runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT && k <= runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT
}

// inferAssetKindFromCapabilities derives the asset kind from the first
// matching capability token. Returns CHAT as the default for runnable assets
// when no capability maps to a known kind.
func inferAssetKindFromCapabilities(capabilities []string) runtimev1.LocalAssetKind {
	for _, cap := range capabilities {
		switch strings.TrimSpace(strings.ToLower(cap)) {
		case "chat", "embedding", "text.generate", "text.embed":
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
		case "image", "image.generate":
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
		case "video", "video.generate":
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO
		case "tts", "audio.synthesize", "voice_workflow.tts_v2v", "voice_workflow.tts_t2v":
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS
		case "stt", "audio.transcribe":
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT
		}
	}
	return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
}

func slugifyLocalAssetID(assetID string) string {
	return slug(normalizeLocalInventoryID(assetID))
}

func dedupeLocalAssetRecords(records []*runtimev1.LocalAssetRecord) ([]*runtimev1.LocalAssetRecord, bool) {
	byKey := make(map[string]*runtimev1.LocalAssetRecord, len(records))
	changed := false
	for _, record := range records {
		if record == nil {
			continue
		}
		key := localAssetRecordIdentityKey(record)
		if existing, ok := byKey[key]; ok {
			changed = true
			if preferLocalAssetRecord(record, existing) {
				byKey[key] = record
			}
			continue
		}
		byKey[key] = record
	}
	out := make([]*runtimev1.LocalAssetRecord, 0, len(byKey))
	for _, record := range byKey {
		out = append(out, record)
	}
	return out, changed
}

func preferLocalAssetRecord(candidate *runtimev1.LocalAssetRecord, current *runtimev1.LocalAssetRecord) bool {
	return preferInventoryRecord(
		candidate.GetUpdatedAt(),
		candidate.GetInstalledAt(),
		current.GetUpdatedAt(),
		current.GetInstalledAt(),
		localAssetStatusRank(candidate.GetStatus()),
		localAssetStatusRank(current.GetStatus()),
		candidate.GetLocalAssetId(),
		current.GetLocalAssetId(),
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

func localAssetStatusRank(status runtimev1.LocalAssetStatus) int {
	switch status {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return 4
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		return 3
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED:
		return 2
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED:
		return 1
	default:
		return 0
	}
}
