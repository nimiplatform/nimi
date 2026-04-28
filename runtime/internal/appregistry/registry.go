package appregistry

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

var ErrEmptyAppID = errors.New("empty app id")

// Record is a registered app snapshot used by grant/auth checks.
type Record struct {
	AppID        string
	Manifest     *runtimev1.AppModeManifest
	UpdatedAt    time.Time
	Capabilities []string
	Instances    map[string]InstanceRecord
}

type InstanceRecord struct {
	AppInstanceID string
	DeviceID      string
	RegisteredAt  time.Time
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

func (r *Registry) Upsert(appID string, manifest *runtimev1.AppModeManifest, capabilities []string) error {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return fmt.Errorf("appregistry.Upsert: %w", ErrEmptyAppID)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.apps[appID]
	record.AppID = appID
	record.Manifest = cloneManifest(manifest)
	record.Capabilities = append([]string(nil), capabilities...)
	record.UpdatedAt = time.Now().UTC()
	if record.Instances == nil {
		record.Instances = make(map[string]InstanceRecord)
	}
	r.apps[appID] = record
	return nil
}

func (r *Registry) UpsertInstance(appID string, appInstanceID string, deviceID string, manifest *runtimev1.AppModeManifest, capabilities []string) error {
	appID = strings.TrimSpace(appID)
	appInstanceID = strings.TrimSpace(appInstanceID)
	if appID == "" || appInstanceID == "" {
		return fmt.Errorf("appregistry.UpsertInstance: %w", ErrEmptyAppID)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	record := r.apps[appID]
	record.AppID = appID
	record.Manifest = cloneManifest(manifest)
	record.Capabilities = append([]string(nil), capabilities...)
	record.UpdatedAt = now
	if record.Instances == nil {
		record.Instances = make(map[string]InstanceRecord)
	}
	record.Instances[appInstanceID] = InstanceRecord{
		AppInstanceID: appInstanceID,
		DeviceID:      strings.TrimSpace(deviceID),
		RegisteredAt:  now,
	}
	r.apps[appID] = record
	return nil
}

func (r *Registry) IsInstanceRegistered(appID string, appInstanceID string) bool {
	appID = strings.TrimSpace(appID)
	appInstanceID = strings.TrimSpace(appInstanceID)
	if appID == "" || appInstanceID == "" {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.apps[appID]
	if !ok {
		return false
	}
	_, ok = record.Instances[appInstanceID]
	return ok
}

func (r *Registry) AdmitLocalFirstPartyInstance(appID string, appInstanceID string) bool {
	appID = strings.TrimSpace(appID)
	appInstanceID = strings.TrimSpace(appInstanceID)
	if appID == "" || appInstanceID == "" {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.apps[appID]
	if !ok {
		return false
	}
	if _, ok := record.Instances[appInstanceID]; !ok {
		return false
	}
	if reasonCode, _, ok := ValidateManifest(record.Manifest); !ok || reasonCode != runtimev1.ReasonCode_ACTION_EXECUTED {
		return false
	}
	switch record.Manifest.GetAppMode() {
	case runtimev1.AppMode_APP_MODE_FULL:
		return record.Manifest.GetRuntimeRequired() && record.Manifest.GetRealmRequired()
	default:
		return false
	}
}

func cloneInstances(input map[string]InstanceRecord) map[string]InstanceRecord {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]InstanceRecord, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func (r *Registry) Get(appID string) (Record, bool) {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return Record{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.apps[appID]
	if !ok {
		return Record{}, false
	}
	record.Manifest = cloneManifest(record.Manifest)
	record.Capabilities = append([]string(nil), record.Capabilities...)
	record.Instances = cloneInstances(record.Instances)
	return record, true
}

func cloneManifest(input *runtimev1.AppModeManifest) *runtimev1.AppModeManifest {
	if input == nil {
		return nil
	}
	cloned, ok := proto.Clone(input).(*runtimev1.AppModeManifest)
	if !ok {
		return nil
	}
	return cloned
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
	if domain == "" {
		return runtimev1.ReasonCode_APP_MODE_DOMAIN_FORBIDDEN, "provide_domain_for_scope_validation", false
	}
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
