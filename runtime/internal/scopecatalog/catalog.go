package scopecatalog

import (
	"strings"
	"sync"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type versionState struct {
	published bool
	revoked   map[string]bool
}

var defaultPublishedVersions = []string{
	"sdk-v1",
	"sdk-v2",
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
		state = &versionState{published: true, revoked: map[string]bool{}}
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
	if !c.IsPublished(version) {
		c.emitAudit("scope_catalog.validation_failed", version, runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED)
		return runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED
	}
	for _, raw := range scopes {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			continue
		}
		if !isRecognizedScope(scope) {
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

func isRecognizedScope(scope string) bool {
	switch {
	case strings.HasPrefix(scope, "runtime."):
		return hasValidScopeSuffix(scope, "runtime.")
	case strings.HasPrefix(scope, "realm."):
		return hasValidScopeSuffix(scope, "realm.")
	case strings.HasPrefix(scope, "app."):
		return hasValidScopeSuffix(scope, "app.")
	case strings.HasPrefix(scope, "read:"):
		return hasValidScopeSuffix(scope, "read:")
	case strings.HasPrefix(scope, "write:"):
		return hasValidScopeSuffix(scope, "write:")
	case strings.HasPrefix(scope, "grant:"):
		return hasValidScopeSuffix(scope, "grant:")
	default:
		return false
	}
}

func hasValidScopeSuffix(scope string, prefix string) bool {
	suffix := strings.TrimSpace(strings.TrimPrefix(scope, prefix))
	if suffix == "" {
		return false
	}
	if strings.HasPrefix(suffix, ".") || strings.HasSuffix(suffix, ".") || strings.Contains(suffix, "..") {
		return false
	}
	for _, r := range suffix {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			continue
		}
		switch r {
		case '.', '_', '-', '*':
			continue
		default:
			return false
		}
	}
	return true
}
