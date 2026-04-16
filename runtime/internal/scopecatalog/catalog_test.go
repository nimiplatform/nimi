package scopecatalog

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestNewHasDefaultCatalogVersionsPublished(t *testing.T) {
	c := New()
	for _, version := range []string{"sdk-v1", "sdk-v2"} {
		if !c.IsPublished(version) {
			t.Fatalf("%s should be published by default", version)
		}
	}
}

func TestEnsurePublished(t *testing.T) {
	c := New()
	if c.IsPublished("v2") {
		t.Fatal("v2 should not be published yet")
	}
	c.EnsurePublished("v2")
	if !c.IsPublished("v2") {
		t.Fatal("v2 should be published after EnsurePublished")
	}
}

func TestEnsurePublishedEmptyVersion(t *testing.T) {
	c := New()
	if c.EnsurePublished("") {
		t.Fatal("empty version should return false")
	}
	if c.EnsurePublished("   ") {
		t.Fatal("whitespace-only version should return false")
	}
}

func TestIsPublishedEmptyVersion(t *testing.T) {
	c := New()
	if c.IsPublished("") {
		t.Fatal("empty version should not be published")
	}
}

func TestRevokeScope(t *testing.T) {
	c := New()
	c.RevokeScope("sdk-v1", "runtime.health")
	if !c.HasRevokedScope("sdk-v1", []string{"runtime.health"}) {
		t.Fatal("runtime.health should be revoked")
	}
	if c.HasRevokedScope("sdk-v1", []string{"runtime.status"}) {
		t.Fatal("runtime.status should not be revoked")
	}
}

func TestRevokeScopeEmptyInputs(t *testing.T) {
	c := New()
	c.RevokeScope("", "runtime.health")
	c.RevokeScope("sdk-v1", "")
	if c.HasRevokedScope("sdk-v1", []string{"runtime.health"}) {
		t.Fatal("should not revoke with empty version or scope")
	}
}

func TestHasRevokedScopeEmptyInputs(t *testing.T) {
	c := New()
	if c.HasRevokedScope("", []string{"runtime.health"}) {
		t.Fatal("empty version should return false")
	}
	if c.HasRevokedScope("sdk-v1", nil) {
		t.Fatal("nil scopes should return false")
	}
	if c.HasRevokedScope("sdk-v1", []string{}) {
		t.Fatal("empty scopes should return false")
	}
}

func TestValidateScopesRecognizedPrefixes(t *testing.T) {
	c := New()
	recognized := []string{
		"runtime.health",
		"realm.settings",
		"app.messages",
		"read:profile",
		"write:data",
		"grant:admin",
	}
	code := c.ValidateScopes("sdk-v1", recognized)
	if code != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("valid scopes should return ACTION_EXECUTED, got=%v", code)
	}
}

func TestValidateScopesUnrecognizedPrefix(t *testing.T) {
	c := New()
	code := c.ValidateScopes("sdk-v1", []string{"unknown.scope"})
	if code != runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH {
		t.Fatalf("unrecognized scope should return CAPABILITY_CATALOG_MISMATCH, got=%v", code)
	}
}

func TestValidateScopesRejectsMalformedRecognizedPrefix(t *testing.T) {
	c := New()
	for _, scope := range []string{"runtime.", "realm..settings", "app. ", "read:", "write:bad:extra"} {
		if code := c.ValidateScopes("sdk-v1", []string{scope}); code != runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH {
			t.Fatalf("malformed scope %q should return CAPABILITY_CATALOG_MISMATCH, got=%v", scope, code)
		}
	}
}

func TestValidateScopesUnpublishedVersion(t *testing.T) {
	c := New()
	code := c.ValidateScopes("v999", []string{"runtime.health"})
	if code != runtimev1.ReasonCode_APP_SCOPE_CATALOG_UNPUBLISHED {
		t.Fatalf("unpublished version should return APP_SCOPE_CATALOG_UNPUBLISHED, got=%v", code)
	}
}

func TestValidateScopesRevokedScope(t *testing.T) {
	c := New()
	c.RevokeScope("sdk-v1", "runtime.health")
	code := c.ValidateScopes("sdk-v1", []string{"runtime.health"})
	if code != runtimev1.ReasonCode_APP_SCOPE_REVOKED {
		t.Fatalf("revoked scope should return APP_SCOPE_REVOKED, got=%v", code)
	}
}

func TestValidateScopesEmptySkipped(t *testing.T) {
	c := New()
	code := c.ValidateScopes("sdk-v1", []string{"", "  ", "runtime.health"})
	if code != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("empty scopes should be skipped, got=%v", code)
	}
}

func TestAuditCallback(t *testing.T) {
	var called int
	c := New(func(operation string, version string, reasonCode runtimev1.ReasonCode) {
		called++
	})
	c.EnsurePublished("v2")
	if called != 1 {
		t.Fatalf("audit callback should be called once for EnsurePublished, got=%d", called)
	}
	// Trigger a validation failure to emit a second audit event.
	c.ValidateScopes("unpublished-version", []string{"runtime.health"})
	if called != 2 {
		t.Fatalf("audit callback should be called twice, got=%d", called)
	}
}

func TestRevokeOnUnpublishedVersionCreatesIt(t *testing.T) {
	c := New()
	c.RevokeScope("new-v", "runtime.health")
	if !c.HasRevokedScope("new-v", []string{"runtime.health"}) {
		t.Fatal("revoking on unpublished version should create it")
	}
}
