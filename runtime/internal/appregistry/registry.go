package appregistry

import (
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Record is a registered app snapshot used by grant/auth checks.
type Record struct {
	AppID        string
	Manifest     *runtimev1.AppModeManifest
	UpdatedAt    time.Time
	Capabilities []string
}

// Registry stores app registration state in-memory.
type Registry struct {
	mu   sync.RWMutex
	apps map[string]Record
}

func New() *Registry {
	return &Registry{
		apps: make(map[string]Record),
	}
}

func (r *Registry) Upsert(appID string, manifest *runtimev1.AppModeManifest, capabilities []string) {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.apps[appID] = Record{
		AppID:        appID,
		Manifest:     cloneManifest(manifest),
		Capabilities: append([]string(nil), capabilities...),
		UpdatedAt:    time.Now().UTC(),
	}
}

func (r *Registry) Get(appID string) (Record, bool) {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return Record{}, false
	}
	r.mu.RLock()
	record, ok := r.apps[appID]
	r.mu.RUnlock()
	if !ok {
		return Record{}, false
	}
	record.Manifest = cloneManifest(record.Manifest)
	record.Capabilities = append([]string(nil), record.Capabilities...)
	return record, true
}

func cloneManifest(input *runtimev1.AppModeManifest) *runtimev1.AppModeManifest {
	if input == nil {
		return nil
	}
	return &runtimev1.AppModeManifest{
		AppMode:         input.GetAppMode(),
		RuntimeRequired: input.GetRuntimeRequired(),
		RealmRequired:   input.GetRealmRequired(),
		WorldRelation:   input.GetWorldRelation(),
	}
}

func ValidateManifest(manifest *runtimev1.AppModeManifest) (runtimev1.ReasonCode, string, bool) {
	if manifest == nil {
		return runtimev1.ReasonCode_APP_MODE_MANIFEST_INVALID, "fix_mode_manifest_and_resubmit", false
	}
	if manifest.GetAppMode() == runtimev1.AppMode_APP_MODE_UNSPECIFIED {
		return runtimev1.ReasonCode_APP_MODE_MANIFEST_INVALID, "fix_mode_manifest_and_resubmit", false
	}
	if manifest.GetWorldRelation() == runtimev1.WorldRelation_WORLD_RELATION_EXTENSION &&
		manifest.GetAppMode() == runtimev1.AppMode_APP_MODE_LITE {
		return runtimev1.ReasonCode_APP_MODE_WORLD_RELATION_FORBIDDEN, "set_world_relation_render_or_none_or_switch_mode", false
	}
	switch manifest.GetAppMode() {
	case runtimev1.AppMode_APP_MODE_LITE:
		if manifest.GetRuntimeRequired() || !manifest.GetRealmRequired() {
			return runtimev1.ReasonCode_APP_MODE_MANIFEST_INVALID, "fix_mode_manifest_and_resubmit", false
		}
	case runtimev1.AppMode_APP_MODE_CORE_ONLY:
		if !manifest.GetRuntimeRequired() || manifest.GetRealmRequired() {
			return runtimev1.ReasonCode_APP_MODE_MANIFEST_INVALID, "fix_mode_manifest_and_resubmit", false
		}
	case runtimev1.AppMode_APP_MODE_FULL:
		if !manifest.GetRuntimeRequired() || !manifest.GetRealmRequired() {
			return runtimev1.ReasonCode_APP_MODE_MANIFEST_INVALID, "fix_mode_manifest_and_resubmit", false
		}
	default:
		return runtimev1.ReasonCode_APP_MODE_MANIFEST_INVALID, "fix_mode_manifest_and_resubmit", false
	}
	return runtimev1.ReasonCode_ACTION_EXECUTED, "", true
}

func ValidateDomainAndScopes(manifest *runtimev1.AppModeManifest, domain string, scopes []string) (runtimev1.ReasonCode, string, bool) {
	reasonCode, actionHint, ok := ValidateManifest(manifest)
	if !ok {
		return reasonCode, actionHint, false
	}

	domain = strings.ToLower(strings.TrimSpace(domain))
	hasRealm := false
	hasRuntime := false
	for _, raw := range scopes {
		scope := strings.ToLower(strings.TrimSpace(raw))
		if strings.HasPrefix(scope, "realm.") {
			hasRealm = true
		}
		if strings.HasPrefix(scope, "runtime.") {
			hasRuntime = true
		}
	}

	switch manifest.GetAppMode() {
	case runtimev1.AppMode_APP_MODE_LITE:
		if strings.HasPrefix(domain, "runtime") {
			return runtimev1.ReasonCode_APP_MODE_DOMAIN_FORBIDDEN, "remove_runtime_scopes_or_switch_mode_full", false
		}
		if hasRuntime {
			return runtimev1.ReasonCode_APP_MODE_SCOPE_FORBIDDEN, "adjust_scopes_for_app_mode", false
		}
	case runtimev1.AppMode_APP_MODE_CORE_ONLY:
		if strings.HasPrefix(domain, "realm") {
			return runtimev1.ReasonCode_APP_MODE_DOMAIN_FORBIDDEN, "remove_realm_scopes_or_switch_mode_full", false
		}
		if hasRealm {
			return runtimev1.ReasonCode_APP_MODE_SCOPE_FORBIDDEN, "adjust_scopes_for_app_mode", false
		}
	case runtimev1.AppMode_APP_MODE_FULL:
		// Full mode allows both runtime and realm scopes.
	default:
		return runtimev1.ReasonCode_APP_MODE_MANIFEST_INVALID, "fix_mode_manifest_and_resubmit", false
	}
	return runtimev1.ReasonCode_ACTION_EXECUTED, "", true
}
