package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func localAssetIdentityCandidates(identity string) []string {
	raw := strings.TrimSpace(identity)
	if raw == "" {
		return nil
	}
	out := make([]string, 0, 8)
	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		for _, existing := range out {
			if existing == trimmed {
				return
			}
		}
		out = append(out, trimmed)
	}

	var expand func(string)
	expand = func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		add(trimmed)
		lower := strings.ToLower(trimmed)
		for _, prefix := range []string{"local/", "media/", "speech/", "sidecar/"} {
			if strings.HasPrefix(lower, prefix) {
				expand(trimmed[len(prefix):])
				return
			}
		}
	}
	expand(raw)
	if strings.HasPrefix(strings.ToLower(raw), "runtime-route:") {
		for _, part := range strings.Split(raw, ":") {
			expand(part)
		}
	}
	return out
}

func localAssetRecordMatchesIdentity(asset *runtimev1.LocalAssetRecord, identity string) bool {
	if asset == nil {
		return false
	}
	for _, candidate := range localAssetIdentityCandidates(identity) {
		if localAssetIDMatchesIdentity(asset.GetLocalAssetId(), candidate) ||
			localAssetPathIdentityMatches(asset.GetAssetId(), candidate) ||
			localAssetPathIdentityMatches(asset.GetLogicalModelId(), candidate) {
			return true
		}
	}
	return false
}

func localAssetIDMatchesIdentity(localAssetID string, candidate string) bool {
	localAssetID = strings.TrimSpace(localAssetID)
	candidate = strings.TrimSpace(candidate)
	return localAssetID != "" && candidate != "" && localAssetID == candidate
}

func localAssetPathIdentityMatches(value string, candidate string) bool {
	value = strings.Trim(strings.TrimSpace(value), "/")
	candidate = strings.Trim(strings.TrimSpace(candidate), "/")
	if value == "" || candidate == "" {
		return false
	}
	return value == candidate ||
		strings.HasSuffix(value, "/"+candidate) ||
		strings.HasSuffix(candidate, "/"+value)
}

func (s *Service) localAssetRecordForIdentity(identity string) *runtimev1.LocalAssetRecord {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var matched *runtimev1.LocalAssetRecord
	for _, asset := range s.assets {
		if asset == nil || asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if !localAssetRecordMatchesIdentity(asset, identity) {
			continue
		}
		if matched != nil && strings.TrimSpace(matched.GetLocalAssetId()) != strings.TrimSpace(asset.GetLocalAssetId()) {
			return nil
		}
		matched = asset
	}
	return cloneLocalAsset(matched)
}
