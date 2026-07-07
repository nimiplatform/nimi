package scopecatalog

import (
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type versionState struct {
	published bool
	admitted  map[string]bool
	revoked   map[string]bool
}

var defaultPublishedVersions = []string{
	"sdk-v1",
	"sdk-v2",
}

var defaultAdmittedScopes = map[string][]string{
	"sdk-v1": {
		"ai.spend.meter",
		"app.messages",
		"grant:admin",
		"grant:delegate",
		"read:*",
		"read:chat",
		"read:profile",
		"realm.settings",
		"runtime.agent.turn.read",
		"runtime.agent.turn.write",
		"runtime.agent.admin",
		"runtime.agent.autonomy.write",
		"runtime.agent.avatar_debug.read",
		"runtime.agent.avatar_debug.write",
		"runtime.agent.companion_participation.read",
		"runtime.agent.companion_participation.write",
		"runtime.agent.create_realm_group_message_candidate",
		"runtime.agent.delegation.read",
		"runtime.agent.delegation.write",
		"runtime.agent.ai_config.read",
		"runtime.agent.ai_config.write",
		"runtime.agent.get_realm_group_message_candidate_evidence",
		"runtime.agent.read",
		"runtime.agent.write",
		"runtime.app.send.cross_app",
		"runtime.app_auth.policy.override",
		"runtime.audit.export",
		"runtime.health",
		"runtime.knowledge.admin",
		"runtime.knowledge.read",
		"runtime.knowledge.write",
		"runtime.memory.admin",
		"runtime.memory.read",
		"runtime.memory.write",
		"runtime.model.remove",
		"write:*",
		"write:chat",
		"write:data",
	},
	"sdk-v2": {
		"ai.spend.meter",
		"app.messages",
		"grant:admin",
		"grant:delegate",
		"read:*",
		"read:chat",
		"read:profile",
		"realm.settings",
		"runtime.agent.turn.read",
		"runtime.agent.turn.write",
		"runtime.agent.admin",
		"runtime.agent.autonomy.write",
		"runtime.agent.avatar_debug.read",
		"runtime.agent.avatar_debug.write",
		"runtime.agent.companion_participation.read",
		"runtime.agent.companion_participation.write",
		"runtime.agent.create_realm_group_message_candidate",
		"runtime.agent.delegation.read",
		"runtime.agent.delegation.write",
		"runtime.agent.ai_config.read",
		"runtime.agent.ai_config.write",
		"runtime.agent.get_realm_group_message_candidate_evidence",
		"runtime.agent.read",
		"runtime.agent.write",
		"runtime.app.send.cross_app",
		"runtime.app_auth.policy.override",
		"runtime.audit.export",
		"runtime.health",
		"runtime.knowledge.admin",
		"runtime.knowledge.read",
		"runtime.knowledge.write",
		"runtime.memory.admin",
		"runtime.memory.read",
		"runtime.memory.write",
		"runtime.model.remove",
		"write:*",
		"write:chat",
		"write:data",
	},
}

// AuditCallback is invoked when the catalog performs an auditable operation.
type AuditCallback func(operation string, version string, reasonCode runtimev1.ReasonCode)

// Catalog tracks published scope catalog versions and revoked scopes.
type Catalog struct {
	mu       sync.RWMutex
	versions map[string]*versionState
	onAudit  AuditCallback
}

func New(opts ...AuditCallback) *Catalog {
	c := &Catalog{
		versions: make(map[string]*versionState),
	}
	if len(opts) > 0 {
		c.onAudit = opts[0]
	}
	for _, version := range defaultPublishedVersions {
		c.versions[version] = &versionState{
			published: true,
			admitted:  admittedScopeSet(defaultAdmittedScopes[version]),
			revoked:   map[string]bool{},
		}
	}
	return c
}

func (c *Catalog) EnsurePublished(version string) bool {
	version = strings.TrimSpace(version)
	if version == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if state, ok := c.versions[version]; ok {
		state.published = true
		c.emitAudit("scope_catalog.version_published", version, runtimev1.ReasonCode_ACTION_EXECUTED)
		return true
	}
	c.versions[version] = &versionState{
		published: true,
		admitted:  map[string]bool{},
		revoked:   map[string]bool{},
	}
	c.emitAudit("scope_catalog.version_published", version, runtimev1.ReasonCode_ACTION_EXECUTED)
	return true
}

func (c *Catalog) IsPublished(version string) bool {
	version = strings.TrimSpace(version)
	if version == "" {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	state, ok := c.versions[version]
	return ok && state.published
}

func (c *Catalog) RevokeScope(version string, scope string) {
	version = strings.TrimSpace(version)
	scope = strings.TrimSpace(scope)
	if version == "" || scope == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	state, ok := c.versions[version]
	if !ok {
		state = &versionState{published: true, admitted: map[string]bool{}, revoked: map[string]bool{}}
		c.versions[version] = state
	}
	state.revoked[scope] = true
}

func (c *Catalog) HasRevokedScope(version string, scopes []string) bool {
	version = strings.TrimSpace(version)
	if version == "" || len(scopes) == 0 {
		return false
	}
	c.mu.RLock()
	state, ok := c.versions[version]
	c.mu.RUnlock()
	if !ok {
		return false
	}
	for _, raw := range scopes {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			continue
		}
		if state.revoked[scope] {
			return true
		}
	}
	return false
}

func (c *Catalog) ValidateScopes(version string, scopes []string) runtimev1.ReasonCode {
	version = strings.TrimSpace(version)
	if version == "" {
		c.emitAudit("scope_catalog.validation_failed", version, runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED)
		return runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED
	}
	c.mu.RLock()
	state, ok := c.versions[version]
	c.mu.RUnlock()
	if !ok || !state.published {
		c.emitAudit("scope_catalog.validation_failed", version, runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED)
		return runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED
	}
	for _, raw := range scopes {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			continue
		}
		if !state.admitted[scope] {
			c.emitAudit("scope_catalog.validation_failed", version, runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH)
			return runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH
		}
	}
	if c.HasRevokedScope(version, scopes) {
		c.emitAudit("scope.revoked.denied", version, runtimev1.ReasonCode_APP_SCOPE_REVOKED)
		return runtimev1.ReasonCode_APP_SCOPE_REVOKED
	}
	return runtimev1.ReasonCode_ACTION_EXECUTED
}

func (c *Catalog) emitAudit(operation string, version string, code runtimev1.ReasonCode) {
	if c.onAudit != nil {
		c.onAudit(operation, version, code)
	}
}

func admittedScopeSet(scopes []string) map[string]bool {
	out := make(map[string]bool, len(scopes))
	for _, raw := range scopes {
		scope := strings.TrimSpace(raw)
		if scope != "" {
			out[scope] = true
		}
	}
	return out
}
